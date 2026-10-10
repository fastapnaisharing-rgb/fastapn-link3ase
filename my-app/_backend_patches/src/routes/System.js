import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
import os from "os";
import { execSync, exec } from "child_process"; // MARKER_FIX_GETCURRENTCPU_ASYNC

const router = Router();

// ── คำนวณ RAM % ปัจจุบันของทั้งเครื่อง ──
function getCurrentRam() {
  const total = Math.round(os.totalmem() / 1024 / 1024);
  const free = Math.round(os.freemem() / 1024 / 1024);
  const used = total - free;
  const pct = Math.round((used / total) * 100);
  return { pct, used, total };
}

// ── คำนวณ CPU % ปัจจุบันของทั้งเครื่อง ผ่าน Windows Performance Counter ──
// ── (instantaneous, ไม่ต้องวัด 2 จังหวะเทียบกันเหมือน os.cpus() เพราะ ────
// ── Get-Counter ให้ค่า % Processor Time ปัจจุบันตรงๆอยู่แล้ว) ─────────────
// MARKER_SYSTEM_CPU_HISTORY
// MARKER_FIX_GETCURRENTCPU_SINGLEFLIGHT
let _cpuInFlight = null;
let _cpuLastValue = 0;
let _cpuLastAt = 0;
const CPU_CACHE_TTL_MS = 5000; // ไม่ Spawn ใหม่ถ้าเพิ่งวัดไปไม่เกิน 5 วิ

// MARKER_SYNC_GETCURRENTCPU_EXPORT_V1 -- Export ให้ app.js import ใช้ร่วมกัน แทนที่จะมี getCurrentCpu()
// ของตัวเองแยกกัน 2 ชุด (ทำให้ /health กับ /cpu-current เคย Cache คนละก้อน
// และรายงานค่า CPU ไม่ตรงกัน) -- ดู patch_app_sync_getcurrentcpu.py คู่กัน
export async function getCurrentCpu() {
  // ใช้ Cache ถ้าเพิ่งวัดไปไม่เกิน TTL -- กันหลาย Request พร้อมกัน Spawn ซ้ำ
  if (Date.now() - _cpuLastAt < CPU_CACHE_TTL_MS) return _cpuLastValue;
  // ถ้ามีการวัดกำลังทำงานอยู่แล้ว (In-flight) -> รอผลจากตัวเดิม ไม่ Spawn ซ้อน
  if (_cpuInFlight) return _cpuInFlight;

  _cpuInFlight = new Promise((resolve) => {
    const cmd = `powershell -Command "(Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 3 | Select-Object -ExpandProperty CounterSamples | Measure-Object -Property CookedValue -Average).Average"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 8000 }, (err, stdout) => {
      let pct = 0;
      if (err) {
        console.error("getCurrentCpu error:", err.message);
      } else {
        const parsed = Math.round(parseFloat(String(stdout).trim()));
        pct = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
      }
      _cpuLastValue = pct;
      _cpuLastAt = Date.now();
      _cpuInFlight = null;
      resolve(pct);
    });
  });
  return _cpuInFlight;
}

// ── ดึง Top Process ที่กิน RAM สูงสุด ผ่าน PowerShell (Windows Server) ──
// MARKER_FIX_RAM_HELPERS_ASYNC
const _topProcessesInFlight = new Map();
const _topProcessesCache = new Map();
const TOP_PROCESSES_CACHE_TTL_MS = 55000;

async function getTopProcesses(limit = 10) {
  const cached = _topProcessesCache.get(limit);
  if (cached && Date.now() - cached.at < TOP_PROCESSES_CACHE_TTL_MS) return cached.value;
  if (_topProcessesInFlight.has(limit)) return _topProcessesInFlight.get(limit);

  const p = new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Process | Sort-Object WS -Descending | Select-Object -First ${limit} Name, Id, CPU, SessionId, @{Name='RAM';Expression={[math]::Round($_.WS/1MB,1)}}, @{Name='StartTime';Expression={if($_.StartTime){$_.StartTime.ToString('o')}else{''}}} | ConvertTo-Json"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 10000 }, (err, stdout) => {
      let result = [];
      if (err) {
        console.error("getTopProcesses error:", err.message);
      } else {
        try {
          const parsed = JSON.parse(stdout);
          result = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          console.error("getTopProcesses parse error:", e.message);
        }
      }
      _topProcessesCache.set(limit, { value: result, at: Date.now() });
      _topProcessesInFlight.delete(limit);
      resolve(result);
    });
  });
  _topProcessesInFlight.set(limit, p);
  return p;
}

// ── CPU % แยกตามแต่ละ Core (logical processor) ──────────────────────────
// MARKER_CPU_PER_CORE_BREAKDOWN
let _perCoreInFlight = null;
let _perCoreCache = null;
let _perCoreCacheAt = 0;
const PER_CORE_CACHE_TTL_MS = 55000;

async function getPerCoreCpu() {
  if (_perCoreCache && Date.now() - _perCoreCacheAt < PER_CORE_CACHE_TTL_MS) return _perCoreCache;
  if (_perCoreInFlight) return _perCoreInFlight;

  _perCoreInFlight = new Promise((resolve) => {
    // ดึง Total + Per Core ใน call เดียว → ค่า Total และ Per Core sync กันแน่นอน
    const cmd = `powershell -Command "Get-Counter '\\Processor(*)\\% Processor Time' -SampleInterval 1 -MaxSamples 1 | Select-Object -ExpandProperty CounterSamples | Select-Object InstanceName, CookedValue | ConvertTo-Json"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 8000 }, (err, stdout) => {
      let cores = [];
      let totalPct = 0;
      if (err) {
        console.error("getPerCoreCpu error:", err.message);
      } else {
        try {
          const parsed = JSON.parse(stdout);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          // แยก _total ออก แล้วเอาไปเป็น totalPct
          const totalRow = arr.find((r) => r.InstanceName === "_total");
          if (totalRow) totalPct = Math.min(100, Math.max(0, Math.round(totalRow.CookedValue)));
          cores = arr
            .filter((r) => r.InstanceName !== "_total")
            .map((r) => ({
              core: parseInt(r.InstanceName, 10),
              pct: Math.min(100, Math.max(0, Math.round(r.CookedValue))),
            }))
            .filter((r) => Number.isFinite(r.core))
            .sort((a, b) => a.core - b.core);
        } catch (e) {
          console.error("getPerCoreCpu parse error:", e.message, "stdout:", stdout);
        }
      }
      _perCoreCache = { cores, totalPct };
      _perCoreCacheAt = Date.now();
      _perCoreInFlight = null;
      resolve({ cores, totalPct });
    });
  });
  return _perCoreInFlight;
}

// ── ดึง Top Process ที่กิน CPU สูงสุด (เรียงตาม CPU time สะสม ไม่ใช่ RAM) ──
const _topCpuInFlight = new Map();
const _topCpuCache = new Map();
const TOP_CPU_CACHE_TTL_MS = 5000;

async function getTopProcessesByCpu(limit = 8) {
  const cached = _topCpuCache.get(limit);
  if (cached && Date.now() - cached.at < TOP_CPU_CACHE_TTL_MS) return cached.value;
  if (_topCpuInFlight.has(limit)) return _topCpuInFlight.get(limit);

  const p = new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Name, Id, CPU | ConvertTo-Json"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 10000 }, (err, stdout) => {
      let result = [];
      if (err) {
        console.error("getTopProcessesByCpu error:", err.message);
      } else {
        try {
          const parsed = JSON.parse(stdout);
          result = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          console.error("getTopProcessesByCpu parse error:", e.message);
        }
      }
      _topCpuCache.set(limit, { value: result, at: Date.now() });
      _topCpuInFlight.delete(limit);
      resolve(result);
    });
  });
  _topCpuInFlight.set(limit, p);
  return p;
}

// ── นับจำนวน PowerShell ที่ไม่มีหน้าต่างเปิดอยู่ (Orphan) พร้อมอายุ ──
// ── Fix: เช็ค SessionId=0 แทน MainWindowHandle (กัน Kill Session RDP ของคนจริง) ──
let _orphanInFlight = null;
let _orphanCache = null;
let _orphanCacheAt = 0;
const ORPHAN_CACHE_TTL_MS = 3000;

async function getOrphanPowerShell() {
  if (_orphanCache && Date.now() - _orphanCacheAt < ORPHAN_CACHE_TTL_MS) return _orphanCache;
  if (_orphanInFlight) return _orphanInFlight;

  _orphanInFlight = new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq 0 } | Select-Object Id, CPU, @{Name='StartTime';Expression={$_.StartTime.ToString('o')}}, @{Name='RAM';Expression={[math]::Round($_.WS/1MB,1)}} | ConvertTo-Json"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 10000 }, (err, stdout) => {
      let result = [];
      if (err) {
        console.error("getOrphanPowerShell error:", err.message);
      } else if (stdout && String(stdout).trim()) {
        try {
          const parsed = JSON.parse(stdout);
          result = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          console.error("getOrphanPowerShell parse error:", e.message);
        }
      }
      _orphanCache = result;
      _orphanCacheAt = Date.now();
      _orphanInFlight = null;
      resolve(result);
    });
  });
  return _orphanInFlight;
}

// ── ดึง RAM ของ Backend (node) โดยตรง ไม่พึ่งว่าจะติด Top 10 หรือไม่ ──
let _backendRamInFlight = null;
let _backendRamCache = 0;
let _backendRamCacheAt = 0;
const BACKEND_RAM_CACHE_TTL_MS = 3000;

async function getBackendRam() {
  if (Date.now() - _backendRamCacheAt < BACKEND_RAM_CACHE_TTL_MS) return _backendRamCache;
  if (_backendRamInFlight) return _backendRamInFlight;

  _backendRamInFlight = new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Measure-Object WS -Sum | Select-Object -ExpandProperty Sum"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 5000 }, (err, stdout) => {
      let mb = 0;
      if (err) {
        console.error("getBackendRam error:", err.message);
      } else {
        const bytes = parseInt(String(stdout).trim(), 10);
        mb = Number.isFinite(bytes) ? Math.round(bytes / 1024 / 1024) : 0;
      }
      _backendRamCache = mb;
      _backendRamCacheAt = Date.now();
      _backendRamInFlight = null;
      resolve(mb);
    });
  });
  return _backendRamInFlight;
}

// ── เช็คว่า PID นี้ยังมีอยู่จริงในระบบไหม (ใช้ Verify หลัง Stop-Process) ──
function isProcessAlive(pid) {
  try {
    const out = execSync(`powershell -Command "if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'ALIVE' } else { 'DEAD' }"`, { windowsHide: true, encoding: "utf8", timeout: 5000 });
    return out.trim() === "ALIVE";
  } catch (err) {
    return false;
  }
}

// ── Kill หลาย PID พร้อมกันในคำสั่ง PowerShell เดียว (เร็วกว่าเรียกทีละตัวมาก) ──
// ── PowerShell แต่ละครั้งที่ Spawn ใช้เวลา Start ~300ms-1s เอง ถ้ามี 30+ Process ──
// ── จะรวมเวลาหลักสิบวินาที เลย Batch เป็นคำสั่งเดียวจบ ────────────────────────
function killProcessesBatch(pids) {
  if (!pids.length) return;
  const idList = pids.join(',');
  try {
    execSync(`powershell -Command "Stop-Process -Id ${idList} -Force -ErrorAction SilentlyContinue"`, { windowsHide: true, timeout: 15000 });
  } catch (err) {
    console.error('killProcessesBatch error:', err.message);
  }
}

// MARKER_THROTTLE_BEFORE_KILL_OPTION2
// ── ลด Priority เป็น Idle แทนการฆ่า — ใช้เป็น Stage แรกก่อน Auto-kill จริง ──
// ── ให้ "หน้าต่างแก้ตัว" ก่อนฆ่าจริง (Reversible, ไม่กระทบ RAM แต่ลด CPU Contention) ──
function throttleProcessesBatch(pids) {
  if (!pids.length) return;
  const idList = pids.join(',');
  try {
    execSync(`powershell -Command "Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'Idle' }"`, { windowsHide: true, timeout: 15000 });
  } catch (err) {
    console.error('throttleProcessesBatch error:', err.message);
  }
}

// ── เช็คว่า PID ไหนใน List ยังมีชีวิตอยู่บ้าง (Batch เดียวกันเหมือนกัน) ──────
function getAliveProcessIds(pids) {
  if (!pids.length) return new Set();
  const idList = pids.join(',');
  try {
    const out = execSync(`powershell -Command "Get-Process -Id ${idList} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`, { windowsHide: true, encoding: "utf8", timeout: 10000 });
    const alive = out.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    return new Set(alive);
  } catch (err) {
    console.error('getAliveProcessIds error:', err.message);
    return new Set();
  }
}

// ── Whitelist process ที่ห้าม Kill เด็ดขาด ──────────────────────────────────
const CRITICAL_WHITELIST = ['node','dotnet','postgres','nginx','lsass','svchost','wininit','csrss','smss','services','python','registry','dwm','msmpeng','sentinel'];

// ── ดึง PID + state จาก pg_stat_activity ──────────────────────────────────
// ── แยก active (query อยู่จริง) กับ idle (เปิดค้างแต่ไม่ได้ทำอะไร) ────────
async function getActiveDbPids() {
  try {
    const { rows } = await pool.query(
      `SELECT pid, state, application_name,
              EXTRACT(EPOCH FROM (NOW() - state_change))/60 AS idle_minutes
       FROM pg_stat_activity
       WHERE state IN ('active', 'idle') AND pid <> pg_backend_pid()`
    );
    // Map<pid, { state, appName, idleMinutes }>
    return new Map(rows.map(r => [r.pid, {
      state: r.state,
      appName: (r.application_name || '').trim(),
      idleMinutes: parseFloat(r.idle_minutes) || 0,
    }]));
  } catch (err) {
    console.error('getActiveDbPids error:', err.message);
    return new Map();
  }
}

// ── คำนวณ Safety Score ของ Process แต่ละตัว ────────────────────────────────
// ── ≥80 = Auto-kill, 50-79 = ให้ Owner เลือก, <50 = ห้าม Kill ─────────────
// ── scoreProcess ดึง CPU tracking จาก process_cpu_tracking (ครอบคลุมทุก process) ──
async function scoreProcess(proc, activeDbPids, isOrphan = false) {
  const pid = proc.Id || proc.id;
  const name = (proc.Name || proc.name || '').toLowerCase();
  let score = 0;
  const reasons = [];

  // ── หักก่อนเลย ถ้าติด critical whitelist → จบทันที ──
  if (CRITICAL_WHITELIST.some(w => name.includes(w))) {
    return { score: -100, tier: 'block', reasons: ['critical whitelist'] };
  }

  // ── DB connection — แยก state: active (query จริง) vs idle (เปิดค้าง) ──
  const dbInfo = activeDbPids.get(pid);
  if (dbInfo) {
    const { state, appName, idleMinutes } = dbInfo;
    if (state === 'active') {
      // Query อยู่จริง → ห้าม kill
      score -= 80;
      reasons.push('มี active DB query');
    } else if (state === 'idle') {
      // ไม่มี app name = backend connection pool เราเอง → ห้าม kill
      if (!appName) {
        score -= 60;
        reasons.push('idle DB ไม่มี app name (น่าจะเป็น backend pool)');
      } else if (appName.toLowerCase().includes('pgadmin')) {
        // pgAdmin idle นาน = เปิดค้างไม่มีคนใช้
        if (idleMinutes > 30) {
          score -= 5;
          reasons.push(`pgAdmin idle นาน ${Math.round(idleMinutes)} นาที`);
        } else if (idleMinutes > 10) {
          score -= 10;
          reasons.push(`pgAdmin idle ${Math.round(idleMinutes)} นาที`);
        } else {
          score -= 30;
          reasons.push(`pgAdmin เพิ่งใช้ (idle ${Math.round(idleMinutes)} นาที)`);
        }
      } else {
        // app อื่น idle ค้าง
        score -= 20;
        reasons.push(`idle DB (${appName}) ${Math.round(idleMinutes)} นาที`);
      }
    }
  }

  // ── ดึง CPU tracking สดจาก process_cpu_tracking ──
  const { rows: tracked } = await pool.query(
    `SELECT last_cpu, prev_cpu, idle_rounds, cpu_changed_at, start_time
     FROM process_cpu_tracking WHERE pid = $1`, [pid]
  );
  const tr = tracked[0];

  if (tr) {
    // CPU ขยับใน 15 นาทีล่าสุด → หัก
    const changedRecently = tr.cpu_changed_at &&
      (Date.now() - new Date(tr.cpu_changed_at).getTime()) < 15 * 60 * 1000;
    if (changedRecently) {
      score -= 60;
      reasons.push('CPU ขยับใน 15 นาทีล่าสุด');
    }

    // CPU นิ่ง ≥ 3 รอบ → +40
    if ((tr.idle_rounds || 0) >= 3) {
      score += 40;
      reasons.push(`CPU นิ่ง ${tr.idle_rounds} รอบ`);
    }

    // อายุ process จาก tracking (ถูกกว่า proc.StartTime ที่อาจ missing)
    const startTime = tr.start_time || proc.StartTime;
    if (startTime) {
      const ageMs = Date.now() - new Date(startTime).getTime();
      if (ageMs > 45 * 60 * 1000) {
        score += 25;
        reasons.push(`ทำงานนาน ${Math.round(ageMs / 60000)} นาที`);
      }
    }
  } else {
    // ไม่มีใน tracking → เพิ่งเริ่ม หรือยังไม่มีข้อมูล → ไม่ให้ bonus CPU
    reasons.push('ยังไม่มีข้อมูล CPU history');

    // ใช้ StartTime จาก proc โดยตรง (กรณี getTopProcesses ดึงมาได้)
    if (proc.StartTime) {
      const ageMs = Date.now() - new Date(proc.StartTime).getTime();
      if (ageMs > 45 * 60 * 1000) {
        score += 25;
        reasons.push(`ทำงานนาน ${Math.round(ageMs / 60000)} นาที`);
      }
    }
  }

  // ไม่อยู่ whitelist → +20
  score += 20;
  reasons.push('ไม่ใช่ critical process');

  // SessionId = 0 → +15
  if ((proc.SessionId ?? proc.sessionId) === 0) {
    score += 15;
    reasons.push('SessionId=0 (background)');
  }

  // ไม่มี DB connection เลย → +10
  if (!activeDbPids.has(pid)) {
    score += 10;
    reasons.push('ไม่มี DB connection');
  }

  // pgAdmin idle > 30 นาที → bonus (เปิดค้างไม่มีคนใช้จริง) → +15
  const dbInfoBonus = activeDbPids.get(pid);
  if (dbInfoBonus?.state === 'idle' && dbInfoBonus?.appName?.toLowerCase().includes('pgadmin') && dbInfoBonus?.idleMinutes > 30) {
    score += 15;
    reasons.push('pgAdmin idle นานเกิน 30 นาที (น่าจะไม่มีคนใช้)');
  }

  // RAM > 200 MB → +10
  const ramMb = proc.RAM || proc.ram || 0;
  if (ramMb > 200) {
    score += 10;
    reasons.push(`RAM สูง ${ramMb} MB`);
  }

  let tier = score >= 80 ? 'auto' : score >= 50 ? 'suggest' : 'block';
  // MARKER_THROTTLE_BEFORE_KILL_OPTION2: ไม่ใช่ Orphan PowerShell จริง (มาจาก Top-RAM ทั่วไป)
  // ห้าม Auto-kill เด็ดขาด แม้ Score จะสูงแค่ไหนก็ตาม — ลดขั้นเป็น suggest บังคับให้ Owner ยืนยันเองเสมอ
  if (!isOrphan && tier === 'auto') {
    tier = 'suggest';
    reasons.push('ไม่ใช่ Orphan PowerShell จริง (มาจาก Top-RAM ทั่วไป) — ห้าม Auto-kill');
  }
  return { score, tier, reasons };
}

const AGE_THRESHOLD_NORMAL_MS    = 45 * 60 * 1000;
const AGE_THRESHOLD_EMERGENCY_MS = 1 * 60 * 60 * 1000;
const EMERGENCY_RAM_PCT = 70;
const CONFIRM_ROUNDS_NORMAL = 3;
const CONFIRM_ROUNDS_EMERGENCY = 1;

async function evaluateOrphanSafety(orphans, ramPct) {
  const now = Date.now();
  const isEmergency = ramPct >= EMERGENCY_RAM_PCT;
  const ageThresholdMs = isEmergency ? AGE_THRESHOLD_EMERGENCY_MS : AGE_THRESHOLD_NORMAL_MS;
  const confirmRounds = isEmergency ? CONFIRM_ROUNDS_EMERGENCY : CONFIRM_ROUNDS_NORMAL;

  let safeCount = 0, watchingCount = 0, safeRamMb = 0;
  const safePids = [];

  for (const p of orphans) {
    if (!p.StartTime) { watchingCount++; continue; }
    const ageMs = now - new Date(p.StartTime).getTime();
    const isOldEnough = ageMs > ageThresholdMs;

    const { rows } = await pool.query(
      `SELECT last_cpu_seconds, is_idle, idle_streak FROM orphan_process_tracking WHERE pid = $1`,
      [p.Id]
    );
    const tracked = rows[0];
    const cpuUnchanged = tracked && Number(tracked.last_cpu_seconds) === Number(p.CPU || 0);

    if (tracked) {
      const idleStreak = cpuUnchanged ? (tracked.is_idle ? tracked.idle_streak + 1 : 1) : 0;
      await pool.query(
        `UPDATE orphan_process_tracking 
         SET last_cpu_seconds = $1, last_checked_at = NOW(), is_idle = $2, idle_streak = $3
         WHERE pid = $4`,
        [p.CPU || 0, cpuUnchanged, idleStreak, p.Id]
      );
      if (isOldEnough && cpuUnchanged && idleStreak >= confirmRounds) {
        safeCount++;
        safeRamMb += p.RAM || 0;
        safePids.push(p.Id);
      } else {
        watchingCount++;
      }
    } else {
      await pool.query(
        `INSERT INTO orphan_process_tracking (pid, start_time, last_cpu_seconds, is_idle, idle_streak)
         VALUES ($1, $2, $3, false, 0)
         ON CONFLICT (pid) DO NOTHING`,
        [p.Id, p.StartTime, p.CPU || 0]
      );
      watchingCount++;
    }
  }

  const currentIds = orphans.map(p => p.Id);
  if (currentIds.length > 0) {
    await pool.query(`DELETE FROM orphan_process_tracking WHERE pid != ALL($1::int[])`, [currentIds]);
  } else {
    await pool.query(`DELETE FROM orphan_process_tracking`);
  }

  return { safeCount, watchingCount, safeRamMb: Math.round(safeRamMb), safePids, isEmergency };
}
// ── ตรวจ RAM ผิดปกติ + แจ้งเตือนเข้ากระดิ่ง (เรียกจาก takeRamSnapshot ทุก 5 นาที) ──
// ── แจ้งครั้งเดียวตอนเจอครั้งแรก ไม่ทับซ้ำจนกว่า RAM จะกลับปกติ (ลบแล้วค่อยแจ้งใหม่รอบถัดไป) ──
async function checkAndNotifyAnomaly() {
  const { rows } = await pool.query(
    `SELECT ram_pct, top_processes, recorded_at
     FROM system_ram_history
     WHERE recorded_at > NOW() - INTERVAL '48 hours'
     ORDER BY recorded_at ASC`
  );
  if (rows.length < 2) return;

  const minRow = rows.reduce((min, r) => (r.ram_pct < min.ram_pct ? r : min), rows[0]);
  const latestRow = rows[rows.length - 1];
  const increase = latestRow.ram_pct - minRow.ram_pct;

  if (increase < 15) {
    // ── RAM กลับสู่ปกติแล้ว → ล้าง Notification เดิมทิ้ง (ถ้ามี) ──
    await pool.query(`DELETE FROM notifications WHERE category = 'RAM_ANOMALY'`);
    return;
  }

  const hoursSpan = Math.round((new Date(latestRow.recorded_at) - new Date(minRow.recorded_at)) / (1000 * 60 * 60));
  const minProcs = minRow.top_processes || [];
  const latestProcs = latestRow.top_processes || [];
  const topSuspect = latestProcs.map(lp => {
    const before = minProcs.find(mp => mp.Name === lp.Name);
    return { name: lp.Name, beforeRam: before?.RAM || 0, afterRam: lp.RAM || 0, diff: (lp.RAM || 0) - (before?.RAM || 0) };
  }).sort((a, b) => b.diff - a.diff)[0];

  const title = `RAM สูงผิดปกติ — เพิ่มขึ้น ${increase}% ใน ${hoursSpan} ชม.`;
  const message = `RAM เพิ่มขึ้น ${increase}% ระหว่าง ${new Date(minRow.recorded_at).toLocaleString('th-TH')} ถึง ${new Date(latestRow.recorded_at).toLocaleString('th-TH')}`
    + (topSuspect ? ` — สาเหตุที่เป็นไปได้คือ ${topSuspect.name} เพิ่มจาก ${topSuspect.beforeRam} เป็น ${topSuspect.afterRam} MB` : '');

  // ── DO NOTHING เพื่อไม่ทับ read_by เดิม ถ้ามี Notification เดิมค้างอยู่แล้ว (ยังไม่หาย ยังไม่ถูกลบ) ──
  await pool.query(
    `INSERT INTO notifications (title, message, category, action_type, target_role, created_by, read_by)
     VALUES ($1, $2, 'RAM_ANOMALY', 'RAM_ANOMALY', 'Owner', 'system', '[]'::jsonb)
     ON CONFLICT (category) DO NOTHING`,
    [title, message]
  );
}

// ── ตรวจ Orphan ที่ปลอดภัยแล้ว + แจ้งเตือนเข้ากระดิ่ง (เรียกจาก takeRamSnapshot ทุก 5 นาที) ──
// ── Upsert ทับเป็น Notification เดียวเสมอ ถ้า Safe = 0 แล้วให้ลบทิ้ง (รอบหน้ามี Safe ใหม่ค่อยแจ้งใหม่) ──
async function checkAndNotifyOrphanSafe() {
  const orphans = await getOrphanPowerShell();
  const ramNow = getCurrentRam();
  const safety = await evaluateOrphanSafety(orphans, ramNow.pct);

  if (safety.safeCount > 0) {
    await pool.query(
      `INSERT INTO notifications (title, message, category, action_type, target_role, created_by, read_by)
       VALUES ($1, $2, 'RAM_ORPHAN_SAFE', 'KILL_ORPHAN_SAFE', 'Owner', 'system', '[]'::jsonb)
       ON CONFLICT (category) DO UPDATE SET
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         created_at = NOW(),
         read_by = '[]'::jsonb`,
      [
        `มีโปรแกรมปลอดภัยที่จะปิด ${safety.safeCount} ตัว (RAM ${ramNow.pct}%)`,
        `PowerShell Orphan ไม่ได้ใช้งานนานเกินเกณฑ์ — รวม ${safety.safeRamMb} MB`,
      ]
    );
  } else {
    await pool.query(`DELETE FROM notifications WHERE category = 'RAM_ORPHAN_SAFE'`);
  }
}

// ── Cache สำหรับ /ram-current กัน PowerShell spawn ซ้ำถี่เกินไป ─────────────
// ── TTL 30 วินาที: เปิดหน้าครั้งแรกได้ผลทันที รอบถัดไปค่อย refresh จริง ───
let _ramCurrentCache = null;
let _ramCurrentCachedAt = 0;
const RAM_CURRENT_TTL_MS = 30 * 1000;

async function fetchRamCurrentFresh() {
  const ram = getCurrentRam();
  const cpu = await getCurrentCpu();
  const topProcesses = await getTopProcesses(10);
  const orphans = await getOrphanPowerShell();
  const safety = await evaluateOrphanSafety(orphans, ram.pct);
  const backendRamMb = await getBackendRam();
  const orphanRamMb = orphans.reduce((sum, p) => sum + (p.RAM || 0), 0);
  return {
    ram, cpu, topProcesses,
    orphanCount: orphans.length,
    orphanRamMb: Math.round(orphanRamMb),
    orphanSafety: {
      safeCount: safety.safeCount,
      watchingCount: safety.watchingCount,
      safeRamMb: safety.safeRamMb,
      isEmergency: safety.isEmergency,
      backendRamMb,
    },
  };
}

// ── export ให้ takeRamSnapshot เรียกอัปเดต cache ทุก Cron round ──────────────
export async function refreshRamCurrentCache() {
  try {
    const data = await fetchRamCurrentFresh();
    _ramCurrentCache = data;
    _ramCurrentCachedAt = Date.now();
  } catch (err) {
    console.error('refreshRamCurrentCache error:', err.message);
  }
}

// GET /api/system/ram-current — ส่ง cache ถ้ายังอายุอยู่ มิฉะนั้น fetch ใหม่
router.get("/ram-current", async (req, res) => {
  try {
    const age = Date.now() - _ramCurrentCachedAt;
    if (_ramCurrentCache && age < RAM_CURRENT_TTL_MS) {
      return res.json({ ..._ramCurrentCache, _cached: true, _cacheAgeMs: age });
    }
    const data = await fetchRamCurrentFresh();
    _ramCurrentCache = data;
    _ramCurrentCachedAt = Date.now();
    res.json({ ...data, _cached: false, _cacheAgeMs: 0 });
  } catch (err) {
    console.error("GET /system/ram-current error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/system/ram-history?hours=24 — ประวัติ RAM สำหรับวาดกราฟ (รวม top_processes สำหรับ Stacked Area)
router.get("/ram-history", async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  try {
    const { rows } = await pool.query(
      `SELECT ram_pct, ram_used_mb, ram_total_mb, top_processes, recorded_at
       FROM system_ram_history
       WHERE recorded_at > NOW() - INTERVAL '1 hour' * $1
       ORDER BY recorded_at ASC`,
      [hours]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /system/ram-history error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── บันทึก Snapshot RAM ปัจจุบัน (เรียกจาก Cron Job ใน app.js ทุก 5 นาที) ──
// ── เก็บเฉพาะตอน RAM % เปลี่ยนแปลง + ลบข้อมูลเก่าเกิน 7 วันในจังหวะเดียวกัน ──
// ── อัปเดต CPU tracking ของทุก process ที่ดึงมาจาก Top 15 ──────────────────
// ── เรียกทุก 5 นาทีพร้อม takeRamSnapshot เพื่อให้ scoreProcess() มีข้อมูล ──
// ── SQL: CREATE TABLE IF NOT EXISTS process_cpu_tracking (
//      pid INT PRIMARY KEY, name TEXT, last_cpu FLOAT, prev_cpu FLOAT,
//      cpu_changed_at TIMESTAMPTZ, idle_rounds INT DEFAULT 0,
//      start_time TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW()
//    ); ──────────────────────────────────────────────────────────────────────
async function updateProcessCpuTracking(procs) {
  if (!procs.length) return;
  const now = new Date();
  for (const p of procs) {
    const pid = p.Id;
    const name = p.Name || '';
    const cpu = Number(p.CPU || 0);
    const startTime = p.StartTime || null;

    const { rows } = await pool.query(
      `SELECT last_cpu, idle_rounds FROM process_cpu_tracking WHERE pid = $1`, [pid]
    );
    const tracked = rows[0];

    if (tracked) {
      const cpuChanged = Number(tracked.last_cpu) !== cpu;
      const idleRounds = cpuChanged ? 0 : (tracked.idle_rounds || 0) + 1;
      await pool.query(
        `UPDATE process_cpu_tracking
         SET name=$1, prev_cpu=last_cpu, last_cpu=$2, idle_rounds=$3,
             cpu_changed_at=CASE WHEN $4 THEN NOW() ELSE cpu_changed_at END,
             start_time=COALESCE(start_time,$5), updated_at=$6
         WHERE pid=$7`,
        [name, cpu, idleRounds, cpuChanged, startTime, now, pid]
      );
    } else {
      await pool.query(
        `INSERT INTO process_cpu_tracking (pid, name, last_cpu, prev_cpu, idle_rounds, start_time, updated_at)
         VALUES ($1, $2, $3, $3, 0, $4, $5)
         ON CONFLICT (pid) DO NOTHING`,
        [pid, name, cpu, startTime, now]
      );
    }
  }
  // ── ลบ process ที่หายไปจากระบบแล้ว (ไม่อยู่ใน top 15 นานเกิน 30 นาที) ──
  await pool.query(
    `DELETE FROM process_cpu_tracking WHERE updated_at < NOW() - INTERVAL '30 minutes'`
  );
}

// MARKER_THROTTLE_BEFORE_KILL_OPTION2
// ── ก่อนฆ่าจริง ต้องลด Priority ก่อนอย่างน้อย THROTTLE_GRACE_MS (เผื่อ Detection ผิดพลาด) ──
// ── SQL ที่ต้องรันก่อนใช้ Patch นี้ (ครั้งเดียว):
//    ALTER TABLE process_cpu_tracking ADD COLUMN IF NOT EXISTS throttled_at TIMESTAMPTZ;
const THROTTLE_GRACE_MS = 30 * 60 * 1000; // 30 นาที

// รับ List ที่ Score ถึง tier='auto' (เฉพาะ Orphan PowerShell จริงเท่านั้นหลัง Patch นี้)
// รอบแรกที่เจอ -> ลด Priority + บันทึกเวลา ยังไม่ฆ่า
// ผ่านมาแล้ว >= 30 นาที และยังเข้าเกณฑ์เดิม -> ฆ่าจริง
async function throttleThenKill(autoKill, { triggeredBy, username = 'system', ramBeforePct }) {
  if (!autoKill.length) return { toThrottle: [], killedPids: [], failedPids: [], ramAfter: null, stillWaiting: [] };

  const pids = autoKill.map(p => p.Id).filter(Boolean);
  const { rows } = await pool.query(
    `SELECT pid, throttled_at FROM process_cpu_tracking WHERE pid = ANY($1::int[])`,
    [pids]
  );
  const throttledAtMap = new Map(rows.map(r => [r.pid, r.throttled_at]));

  const toThrottleNow = [];
  const toKillNow = [];
  const stillWaiting = [];

  for (const p of autoKill) {
    const throttledAt = throttledAtMap.get(p.Id);
    if (!throttledAt) {
      toThrottleNow.push(p);
    } else if (Date.now() - new Date(throttledAt).getTime() >= THROTTLE_GRACE_MS) {
      toKillNow.push(p);
    } else {
      stillWaiting.push(p);
    }
  }

  // ── Stage 1: ลด Priority ตัวที่เพิ่งเจอรอบแรก + บันทึกเวลา (ยังไม่ฆ่า) ──
  if (toThrottleNow.length > 0) {
    const throttlePids = toThrottleNow.map(p => p.Id);
    throttleProcessesBatch(throttlePids);
    await pool.query(
      `UPDATE process_cpu_tracking SET throttled_at = NOW() WHERE pid = ANY($1::int[])`,
      [throttlePids]
    );
    await pool.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ($1, 'BACKEND_OPS', 'THROTTLE_ORPHAN_PROCESS', $2, NOW())`,
      [username, JSON.stringify({
        triggered_by: triggeredBy,
        throttled_pids: throttlePids,
        count: throttlePids.length,
        grace_minutes: THROTTLE_GRACE_MS / 60000,
        process_detail: toThrottleNow.map(p => ({ pid: p.Id, name: p.Name, ram_mb: p.RAM, score: p.score, reasons: p.reasons })),
      })]
    );
  }

  // ── Stage 2: ฆ่าจริงตัวที่ผ่านหน้าต่างแก้ตัวมาแล้ว ──────────────────────
  let killedPids = [], failedPids = [], ramAfter = null;
  if (toKillNow.length > 0) {
    const killPids = toKillNow.map(p => p.Id);
    killProcessesBatch(killPids);
    const aliveAfter = getAliveProcessIds(killPids);
    killedPids = killPids.filter(pid => !aliveAfter.has(pid));
    failedPids = killPids.filter(pid => aliveAfter.has(pid));
    ramAfter = getCurrentRam();

    if (killedPids.length > 0) {
      await pool.query(`DELETE FROM orphan_process_tracking WHERE pid = ANY($1::int[])`, [killedPids]);
      await pool.query(`DELETE FROM process_cpu_tracking WHERE pid = ANY($1::int[])`, [killedPids]);
      await pool.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ($1, 'BACKEND_OPS', 'KILL_ORPHAN_PROCESS', $2, NOW())`,
        [username, JSON.stringify({
          triggered_by: triggeredBy,
          killed_pids: killedPids,
          failed_pids: failedPids,
          count: killedPids.length,
          ram_before_pct: ramBeforePct,
          ram_after_pct: ramAfter.pct,
          throttled_minutes_before_kill: THROTTLE_GRACE_MS / 60000,
          process_detail: toKillNow.map(p => ({
            pid: p.Id, name: p.Name, ram_mb: p.RAM,
            score: p.score, reasons: p.reasons,
            killed: killedPids.includes(p.Id),
          })),
        })]
      );
      await pool.query(`DELETE FROM notifications WHERE category = 'RAM_ORPHAN_SAFE'`);
    }
  }

  return { toThrottle: toThrottleNow, killedPids, failedPids, ramAfter, stillWaiting };
}

export async function takeRamSnapshot() {

  const ram = getCurrentRam();

  const { rows: lastRows } = await pool.query(
    `SELECT ram_pct FROM system_ram_history ORDER BY recorded_at DESC LIMIT 1`
  );
  const lastPct = lastRows[0]?.ram_pct;

  // ── ดึง top 15 เสมอ เพื่อ update CPU tracking แม้ RAM % ไม่เปลี่ยน ──
  const topProcesses = await getTopProcesses(15);

  // ── อัปเดต CPU tracking ทุก round ──
  await updateProcessCpuTracking(topProcesses);

  if (lastPct !== ram.pct) {
    await pool.query(
      `INSERT INTO system_ram_history (ram_pct, ram_used_mb, ram_total_mb, top_processes)
       VALUES ($1, $2, $3, $4)`,
      [ram.pct, ram.used, ram.total, JSON.stringify(topProcesses.slice(0, 5))]
    );
  }

  await pool.query(
    `DELETE FROM system_ram_history WHERE recorded_at < NOW() - INTERVAL '7 days'`
  );

  await checkAndNotifyAnomaly();
  await checkAndNotifyOrphanSafe();

  // ── Auto-kill เงียบๆ ทุก Cron round: Kill process score ≥ 80 ──────────────
  // MARKER_THROTTLE_BEFORE_KILL_OPTION2: เฉพาะ Orphan PowerShell จริงเท่านั้นที่ถึง tier='auto' ได้
  // (Top-RAM ทั่วไปถูก scoreProcess ลดขั้นเป็น suggest บังคับเสมอ) + ลด Priority ก่อน 30 นาทีค่อยฆ่าจริง
  try {
    const orphans = await getOrphanPowerShell();
    const allProcs = [...orphans, ...topProcesses.filter(t => !orphans.find(o => o.Id === t.Id))];
    const activeDbPids = await getActiveDbPids();
    const scored = await Promise.all(allProcs.map(async p => {
      const isOrphan = !!orphans.find(o => o.Id === p.Id);
      const { score, tier, reasons } = await scoreProcess(p, activeDbPids, isOrphan);
      return { ...p, score, tier, reasons };
    }));
    const autoKill = scored.filter(p => p.tier === 'auto');
    await throttleThenKill(autoKill, { triggeredBy: 'cron_auto_score', ramBeforePct: ram.pct });
  } catch (err) {
    console.error('takeRamSnapshot auto-kill error:', err.message);
  }

  // ── อัปเดต cache ของ /ram-current ทุก Cron round ──
  await refreshRamCurrentCache();

  return { ok: true, recorded: lastPct !== ram.pct, ram };
}

// POST /api/system/ram-snapshot — สำหรับ Manual Trigger จาก Frontend (ปุ่มรีเฟรช)
router.post("/ram-snapshot", async (req, res) => {
  try {
    const result = await takeRamSnapshot();
    res.json(result);
  } catch (err) {
    console.error("POST /system/ram-snapshot error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/system/ram-analysis — วิเคราะห์จุดผิดปกติอัตโนมัติ
router.get("/ram-analysis", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ram_pct, top_processes, recorded_at
       FROM system_ram_history
       WHERE recorded_at > NOW() - INTERVAL '48 hours'
       ORDER BY recorded_at ASC`
    );

    if (rows.length < 2) {
      return res.json({ hasAnomaly: false });
    }

    const minRow = rows.reduce((min, r) => (r.ram_pct < min.ram_pct ? r : min), rows[0]);
    const latestRow = rows[rows.length - 1];
    const increase = latestRow.ram_pct - minRow.ram_pct;

    if (increase < 15) {
      return res.json({ hasAnomaly: false });
    }

    const hoursSpan = Math.round((new Date(latestRow.recorded_at) - new Date(minRow.recorded_at)) / (1000 * 60 * 60));

    const minProcs = minRow.top_processes || [];
    const latestProcs = latestRow.top_processes || [];
    const procDiffs = latestProcs.map(lp => {
      const before = minProcs.find(mp => mp.Name === lp.Name);
      return {
        name: lp.Name,
        beforeRam: before?.RAM || 0,
        afterRam: lp.RAM || 0,
        diff: (lp.RAM || 0) - (before?.RAM || 0),
      };
    }).sort((a, b) => b.diff - a.diff);

    res.json({
      hasAnomaly: true,
      increase,
      hoursSpan,
      fromTime: minRow.recorded_at,
      toTime: latestRow.recorded_at,
      topSuspect: procDiffs[0] || null,
    });
  } catch (err) {
    console.error("GET /system/ram-analysis error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/system/kill-orphans/preview — Score + Auto-kill (≥80) ทันที แล้วส่ง suggest กลับให้ Owner เลือก
// ── auto tier จัดการเงียบๆ ก่อนเลย Owner เห็นแค่ผลลัพธ์ + suggest tier ──
router.post("/kill-orphans/preview", async (req, res) => {
  const role = req.user.appRole;
  const username = await getUsernameByEmail(req.user.email);
  if (role !== "Owner") {
    return res.status(403).json({ error: "Owner only" });
  }
  try {
    const orphans = await getOrphanPowerShell();
    const topProcs = getTopProcesses(15);
    const ramNow = getCurrentRam();
    const activeDbPids = await getActiveDbPids();

    const allProcs = [...orphans, ...topProcs.filter(t => !orphans.find(o => o.Id === t.Id))];
    const scored = await Promise.all(allProcs.map(async p => {
      const isOrphan = !!orphans.find(o => o.Id === p.Id);
      const { score, tier, reasons } = await scoreProcess(p, activeDbPids, isOrphan);
      return { ...p, score, tier, reasons };
    }));

    const autoKill = scored.filter(p => p.tier === 'auto');
    const suggest  = scored.filter(p => p.tier === 'suggest');

    // MARKER_THROTTLE_BEFORE_KILL_OPTION2: ลด Priority ก่อน 30 นาทีค่อยฆ่าจริง (เฉพาะ Orphan จริง)
    const result = await throttleThenKill(autoKill, { triggeredBy: 'auto_score', username, ramBeforePct: ramNow.pct });
    const ramAfterAuto = result.ramAfter || ramNow;

    const autoRamMb    = Math.round(autoKill.reduce((s, p) => s + (p.RAM || 0), 0));
    const suggestRamMb = Math.round(suggest.reduce((s, p) => s + (p.RAM || 0), 0));

    // ── ส่งกลับ: ผลของ Throttle/Kill + suggest ที่รอ Owner เลือก (ไม่ส่ง blocked) ──
    res.json({
      throttledCount: result.toThrottle.length,
      throttledNames: result.toThrottle.map(p => p.Name),
      autoKilled: autoKill.map(p => ({ name: p.Name, ram_mb: p.RAM, score: p.score, killed: result.killedPids.includes(p.Id) })),
      autoKilledCount: result.killedPids.length,
      autoRamMb,
      suggest,
      suggestRamMb,
      ramNow: ramAfterAuto,
    });
  } catch (err) {
    console.error("POST /system/kill-orphans/preview error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// POST /api/system/kill-orphans/confirm-safe — Auto-kill ทุก process ที่ score ≥ 80
// ── ดึง process สดๆ + score ใหม่ทุกครั้ง กัน race condition จาก Preview ──
// ── triggered_by: 'auto_score' เสมอ, log ระบุ score แต่ละ PID ──
router.post("/kill-orphans/confirm-safe", async (req, res) => {
  const role = req.user.appRole;
  const username = await getUsernameByEmail(req.user.email);
  if (role !== "Owner") {
    return res.status(403).json({ error: "Owner only" });
  }

  try {
    // ── Score สดๆ ──
    const orphans = await getOrphanPowerShell();
    const topProcs = getTopProcesses(15);
    const ramNow = getCurrentRam();
    const activeDbPids = await getActiveDbPids();
    const allProcs = [...orphans, ...topProcs.filter(t => !orphans.find(o => o.Id === t.Id))];
    const scored = await Promise.all(allProcs.map(async p => {
      const isOrphan = !!orphans.find(o => o.Id === p.Id);
      const { score, tier, reasons } = await scoreProcess(p, activeDbPids, isOrphan);
      return { ...p, score, tier, reasons };
    }));

    const autoKill = scored.filter(p => p.tier === 'auto');

    if (!autoKill.length) {
      return res.status(400).json({ error: "ไม่มีโปรแกรมที่ผ่านเกณฑ์ Auto-kill (score ≥ 80) ตอนนี้" });
    }

    // MARKER_THROTTLE_BEFORE_KILL_OPTION2: ลด Priority ก่อน 30 นาทีค่อยฆ่าจริง (เฉพาะ Orphan จริง)
    const result = await throttleThenKill(autoKill, { triggeredBy: 'auto_score', username, ramBeforePct: ramNow.pct });
    const ramAfter = result.ramAfter || ramNow;

    res.json({
      ok: true,
      throttledCount: result.toThrottle.length,
      throttledNames: result.toThrottle.map(p => p.Name),
      killedCount: result.killedPids.length,
      failedCount: result.failedPids.length,
      ramAfter,
    });
  } catch (err) {
    console.error("POST /system/kill-orphans/confirm-safe error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// POST /api/system/kill-orphans/confirm — Kill PIDs ที่ Owner ติ๊กเลือกจาก suggest tier
// ── รับ pids[] จาก Frontend, re-score สดๆ กัน stale data, ห้าม Kill ถ้า score <50 ──
router.post("/kill-orphans/confirm", async (req, res) => {
  const role = req.user.appRole;
  const username = await getUsernameByEmail(req.user.email);
  if (role !== "Owner") {
    return res.status(403).json({ error: "Owner only" });
  }

  const { pids } = req.body;
  if (!Array.isArray(pids) || pids.length === 0) {
    return res.status(400).json({ error: "pids required" });
  }

  try {
    // ── Re-score สดๆ กัน race condition ──
    const orphans = await getOrphanPowerShell();
    const topProcs = getTopProcesses(15);
    const ramNow = getCurrentRam();
    const activeDbPids = await getActiveDbPids();
    const allProcs = [...orphans, ...topProcs.filter(t => !orphans.find(o => o.Id === t.Id))];
    const scored = await Promise.all(allProcs.map(async p => {
      const isOrphan = !!orphans.find(o => o.Id === p.Id);
      const { score, tier, reasons } = await scoreProcess(p, activeDbPids, isOrphan);
      return { ...p, score, tier, reasons };
    }));

    // ── กรองเฉพาะ PID ที่ส่งมา และ score ≥ 50 เท่านั้น (ห้าม Kill block tier) ──
    const pidSet = new Set(pids);
    const eligible = scored.filter(p => pidSet.has(p.Id) && p.score >= 50);
    const blockedPids = pids.filter(pid => !eligible.find(p => p.Id === pid));

    const eligiblePids = eligible.map(p => p.Id);
    killProcessesBatch(eligiblePids);
    const aliveAfter = getAliveProcessIds(eligiblePids);
    const killedPids = eligiblePids.filter(pid => !aliveAfter.has(pid));
    const failedPids = eligiblePids.filter(pid => aliveAfter.has(pid));

    const ramAfter = getCurrentRam();

    await pool.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ($1, 'BACKEND_OPS', 'KILL_ORPHAN_PROCESS', $2, NOW())`,
      [username, JSON.stringify({
        triggered_by: 'owner_confirm',
        killed_pids: killedPids,
        failed_pids: failedPids,
        blocked_pids: blockedPids,
        count: killedPids.length,
        ram_before_pct: ramNow.pct,
        ram_after_pct: ramAfter.pct,
        process_detail: eligible.map(p => ({
          pid: p.Id, name: p.Name, ram_mb: p.RAM,
          score: p.score, reasons: p.reasons,
          killed: killedPids.includes(p.Id),
        })),
      })]
    );

    await pool.query(`DELETE FROM notifications WHERE category = 'RAM_ANOMALY'`);

    res.json({ ok: true, killedCount: killedPids.length, failedCount: failedPids.length, blockedCount: blockedPids.length, ramAfter });
  } catch (err) {
    console.error("POST /system/kill-orphans/confirm error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── CPU History: เก็บ Snapshot (เรียกจาก Cron ใน app.js ทุก 5 นาทีคู่กับ RAM) ──
export async function takeCpuSnapshot() {
  const cpuPct = await getCurrentCpu();

  const { rows: lastRows } = await pool.query(
    `SELECT cpu_pct FROM system_cpu_history ORDER BY recorded_at DESC LIMIT 1`
  );
  const lastPct = lastRows[0]?.cpu_pct;

  // ── เก็บ top_processes เฉพาะตอน Spike (>= 70%) กันไม่ให้ Table บวมโดยไม่จำเป็น ──
  const isSpike = cpuPct >= 70;
  const topProcesses = isSpike ? getTopProcesses(5) : null;
  // ── เก็บ per_core ทุกครั้งที่ insert (ใช้ตัวเดียวกับ /cpu-cores) ──────────
  const { cores: perCore, totalPct: perCoreTotalPct } = await getPerCoreCpu();

  if (lastPct !== cpuPct) {
    await pool.query(
      `INSERT INTO system_cpu_history (cpu_pct, top_processes, per_core)
       VALUES ($1, $2, $3)`,
      [cpuPct, topProcesses ? JSON.stringify(topProcesses) : null, JSON.stringify(perCore)]
    );
  }

  await pool.query(
    `DELETE FROM system_cpu_history WHERE recorded_at < NOW() - INTERVAL '10 days'`
  );

  return { cpu_pct: cpuPct, isSpike };
}

// GET /api/system/cpu-current — ค่า CPU ปัจจุบัน (Live, ไม่ผ่าน Cache)
router.get("/cpu-current", async (req, res) => {
  try {
    res.json({ pct: await getCurrentCpu() });
  } catch (err) {
    console.error("GET /system/cpu-current error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/system/cpu-history?hours=24 — ประวัติ CPU สำหรับวาดกราฟ/ตาราง Log
router.get("/cpu-history", async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  try {
    const { rows } = await pool.query(
      `SELECT cpu_pct, top_processes, per_core, recorded_at
       FROM system_cpu_history
       WHERE recorded_at > NOW() - INTERVAL '1 hour' * $1
       ORDER BY recorded_at ASC`,
      [hours]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /system/cpu-history error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/system/cpu-cores — % แยกตาม Core + process per core + top CPU processes
router.get("/cpu-cores", async (req, res) => {
  try {
    const [perCore, topProcesses, coreProcesses] = await Promise.all([
      getPerCoreCpu(),
      getTopProcessesByCpu(8),
      getProcessesPerCore(),
    ]);
    const cores = perCore.cores ?? perCore;
    const totalPct = perCore.totalPct ?? null;
    res.json({ cores, totalPct, topProcesses, coreProcesses });
  } catch (err) {
    console.error("GET /system/cpu-cores error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ── ดึง Process แยกตาม Core (distribute top CPU process ลงแต่ละ core) ────
// IdealProcessor เป็น write-only บน Windows Server นี้ → ใช้วิธี distribute แทน
let _coreProcsInFlight = null;
let _coreProcsCache = null;
let _coreProcsCacheAt = 0;
const CORE_PROCS_TTL_MS = 55000;

async function getProcessesPerCore() {
  if (_coreProcsCache && Date.now() - _coreProcsCacheAt < CORE_PROCS_TTL_MS) return _coreProcsCache;
  if (_coreProcsInFlight) return _coreProcsInFlight;

  _coreProcsInFlight = new Promise((resolve) => {
    // ดึง top process เรียงตาม CPU time + จำนวน core จาก Get-Counter
    const cmd = `powershell -Command "` +
      `$procs = Get-Process | Where-Object {$_.CPU -gt 0} | ` +
        `Sort-Object CPU -Descending | Select-Object -First 12 | ` +
        `Select-Object Name,Id,@{N='CPU';E={[math]::Round($_.CPU,1)}}; ` +
      `$cores = (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors; ` +
      `[PSCustomObject]@{procs=$procs;cores=$cores} | ConvertTo-Json -Depth 3"`;
    exec(cmd, { windowsHide: true, encoding: "utf8", timeout: 10000 }, (err, stdout) => {
      let result = [];
      if (!err && stdout && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout);
          const coreCount = parsed.cores || 4;
          let procs = parsed.procs;
          if (!Array.isArray(procs)) procs = procs ? [procs] : [];
          // distribute: process อันดับ 1 → core 0, อันดับ 2 → core 1, ...
          // แสดง top 3 process ต่อ core (round-robin)
          const coreMap = {};
          for (let i = 0; i < coreCount; i++) coreMap[i] = [];
          procs.forEach((p, idx) => {
            const core = idx % coreCount;
            if (coreMap[core].length < 3) {
              coreMap[core].push({ core, name: p.Name, pct: 0 });
            }
          });
          for (const c of Object.values(coreMap)) result.push(...c);
        } catch (e) {
          console.error("getProcessesPerCore parse error:", e.message);
        }
      }
      _coreProcsCache = result;
      _coreProcsCacheAt = Date.now();
      _coreProcsInFlight = null;
      resolve(result);
    });
  });
  return _coreProcsInFlight;
}


// ── Disk Junk Scanner ──────────────────────────────────────────────────────
// GET /api/system/disk-junk/scan — สแกนหา Junk file บน Server
// POST /api/system/disk-junk/clear — ลบ Junk ตาม category ที่เลือก

import { statSync, readdirSync, rmSync } from "fs";
import path from "path";

const JUNK_CATEGORIES = [
  {
    id: "temp",
    name: "Temp files",
    badge: "เคลียร์ได้ปลอดภัย",
    level: "safe",
    paths: [
      "C:\\Windows\\Temp",
      "C:\\tmp",
    ],
    maxAgeHours: 1,
  },
  {
    id: "app_logs",
    name: "App logs เก่า",
    badge: "เคลียร์ได้ปลอดภัย",
    level: "safe",
    paths: [
      "C:\\apps\\fastapn-backend\\logs",
      "C:\\inetpub\\logs",
    ],
    maxAgeHours: 24 * 7,
    extensions: [".log", ".txt"],
  },
  {
    id: "ocr_temp",
    name: "OCR temp",
    badge: "เคลียร์ได้ปลอดภัย",
    level: "safe",
    paths: ["C:\\tmp"],
    pattern: /^ocr_/,
    maxAgeHours: 1,
  },
];

function calcDirSize(dirPath, maxAgeHours, pattern, extensions) {
  let totalBytes = 0;
  let fileCount = 0;
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (pattern && !pattern.test(entry.name)) continue;
      if (extensions && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const st = statSync(fullPath);
        if (st.mtimeMs < cutoff) {
          totalBytes += st.size;
          fileCount++;
        }
      } catch {}
    }
  } catch {}
  return { bytes: totalBytes, count: fileCount };
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

router.get("/disk-junk/scan", async (req, res) => {
  try {
    const results = JUNK_CATEGORIES.map(cat => {
      let totalBytes = 0;
      let totalFiles = 0;
      for (const p of cat.paths) {
        const { bytes, count } = calcDirSize(p, cat.maxAgeHours, cat.pattern, cat.extensions);
        totalBytes += bytes;
        totalFiles += count;
      }
      return {
        id: cat.id,
        name: cat.name,
        badge: cat.badge,
        level: cat.level,
        paths: cat.paths,
        bytes: totalBytes,
        sizeLabel: totalBytes > 0 ? formatBytes(totalBytes) : "0 MB",
        fileCount: totalFiles,
        maxAgeHours: cat.maxAgeHours,
      };
    });

    const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
    res.json({ items: results, totalBytes, totalLabel: formatBytes(totalBytes) });
  } catch (err) {
    console.error("GET /system/disk-junk/scan error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/disk-junk/clear", async (req, res) => {
  const role = req.user?.appRole;
  if (role !== "Owner" && role !== "Admin") {
    return res.status(403).json({ error: "Owner/Admin only" });
  }

  const { categories } = req.body; // string[] เช่น ["temp","app_logs","ocr_temp"]
  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: "categories required" });
  }

  let totalDeleted = 0;
  let totalFiles = 0;
  const errors = [];

  for (const catId of categories) {
    const cat = JUNK_CATEGORIES.find(c => c.id === catId);
    if (!cat) continue;
    const cutoff = Date.now() - cat.maxAgeHours * 60 * 60 * 1000;
    for (const dirPath of cat.paths) {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (cat.pattern && !cat.pattern.test(entry.name)) continue;
          if (cat.extensions && !cat.extensions.includes(path.extname(entry.name).toLowerCase())) continue;
          const fullPath = path.join(dirPath, entry.name);
          try {
            const st = statSync(fullPath);
            if (st.mtimeMs < cutoff) {
              rmSync(fullPath, { force: true });
              totalDeleted += st.size;
              totalFiles++;
            }
          } catch (e) {
            errors.push(fullPath + ": " + e.message);
          }
        }
      } catch (e) {
        errors.push(dirPath + ": " + e.message);
      }
    }
  }

  const username = await getUsernameByEmail(req.user.email).catch(() => "unknown");
  await pool.query(
    `INSERT INTO activity_log (username, module, action, detail, created_at)
     VALUES ($1, 'BACKEND_OPS', 'CLEAR_DISK_JUNK', $2, NOW())`,
    [username, JSON.stringify({ categories, totalFiles, totalDeleted, errors: errors.slice(0, 10) })]
  ).catch(() => {});

  res.json({
    ok: true,
    deletedFiles: totalFiles,
    deletedBytes: totalDeleted,
    deletedLabel: formatBytes(totalDeleted),
    errors: errors.slice(0, 10),
  });
});


// ── Auto Clean Junk (เรียกจาก cron ทุก 6 ชั่วโมง) ────────────────────────
let _lastAutoClean = 0;
const AUTO_CLEAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง

export async function autoCleanJunk(force = false) {
  const now = Date.now();
  if (!force && now - _lastAutoClean < AUTO_CLEAN_INTERVAL_MS) return;
  _lastAutoClean = now;

  const categories = ["temp", "app_logs", "ocr_temp"];
  let totalDeleted = 0;
  let totalFiles = 0;
  const errors = [];

  for (const catId of categories) {
    const cat = JUNK_CATEGORIES.find(c => c.id === catId);
    if (!cat) continue;
    const cutoff = Date.now() - cat.maxAgeHours * 60 * 60 * 1000;
    for (const dirPath of cat.paths) {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (cat.pattern && !cat.pattern.test(entry.name)) continue;
          if (cat.extensions && !cat.extensions.includes(path.extname(entry.name).toLowerCase())) continue;
          const fullPath = path.join(dirPath, entry.name);
          try {
            const st = statSync(fullPath);
            if (st.mtimeMs < cutoff) {
              rmSync(fullPath, { force: true });
              totalDeleted += st.size;
              totalFiles++;
            }
          } catch (e) {
            errors.push(e.message);
          }
        }
      } catch {}
    }
  }

  if (totalFiles > 0) {
    console.log(`[autoCleanJunk] ลบ ${totalFiles} ไฟล์ รวม ${formatBytes(totalDeleted)}`);
    await pool.query(
      `INSERT INTO activity_log (username, module, action, detail, created_at)
       VALUES ('system-cron', 'BACKEND_OPS', 'AUTO_CLEAN_JUNK', $1, NOW())`,
      [JSON.stringify({ categories, totalFiles, totalDeleted, errors: errors.slice(0, 5) })]
    ).catch(() => {});
  }
}

export default router;