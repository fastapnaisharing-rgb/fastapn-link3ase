# -*- coding: utf-8 -*-
"""
patch_filestorage_storage_dashboard_v2.py   (วางข้าง fileStorage.js ใน src\\routes แล้วรัน: python patch_filestorage_storage_dashboard_v2.py)
MARKER: MARKER_STORAGE_DASHBOARD_V2   (แทนที่ v1 -- ใช้ได้ทั้งกรณีเคยรัน v1 แล้ว และยังไม่เคยรัน)

Storage Dashboard (System Console > Backend Ops)
  GET /api/file-storage/storage-stats[?refresh=1]  Owner/Admin
      - นับเฉพาะข้อมูล FASTAPN (ฐานข้อมูล + ไฟล์อัปโหลด) ไม่รวม Windows/โปรแกรม (แสดงเป็น "อย่างอื่นบนดิสก์")
      - พื้นที่ว่างรายไดรฟ์ หักสำรองให้เครื่อง reserve_pct (ค่าเริ่มต้น 20%) = พื้นที่ที่เก็บเพิ่มได้จริง
      - โควตารายกลุ่ม = % ของ (ข้อมูล FASTAPN + พื้นที่ที่เก็บเพิ่มได้จริง) ; คาดว่าเต็มคิดจากการโตของข้อมูล FASTAPN
  PUT /api/file-storage/storage-config             Owner only  : โควตา %, เพดานงวดต่อ BU, เกณฑ์เหลือง/แดง, reserve_pct
  ตารางใหม่ (CREATE IF NOT EXISTS): storage_setting, storage_quota, storage_history (+คอลัมน์ app_bytes)
  env (ไม่บังคับ): STORAGE_CAPACITY_GB, STORAGE_FILES_DIR, STORAGE_DB_DIR
อ่านข้อมูลอย่างเดียว ไม่แก้/ลบข้อมูลเดิม ไม่ลบ TBRAW
"""
import os, sys, subprocess, shutil


def die(msg):
    print("[ABORT] " + msg)
    sys.exit(1)


def load(path):
    if not os.path.isfile(path):
        die("ไม่พบไฟล์: " + path)
    with open(path, "r", encoding="utf-8", newline="") as f:
        s = f.read()
    nl = "\r\n" if "\r\n" in s else "\n"
    return s, nl


def apply(src, nl, marker, edits):
    """edits = [(label, old, new)] ; old ต้องพบ 1 ครั้งพอดี ; \\n ใน old/new ถูกแปลงเป็นรูปแบบขึ้นบรรทัดของไฟล์"""
    if marker in src:
        print("[SKIP] พบ " + marker + " แล้ว (Idempotent) ไม่เขียนไฟล์")
        sys.exit(0)
    out = src
    for label, old, new in edits:
        o = old.replace("\n", nl)
        n = new.replace("\n", nl)
        c = out.count(o)
        if c != 1:
            die("Anchor '%s' พบ %d ครั้ง (ต้อง 1) -- ไม่เขียนไฟล์ ไฟล์อาจไม่ตรงเวอร์ชัน ให้ส่งไฟล์ปัจจุบันมาตรวจ" % (label, c))
        out = out.replace(o, n, 1)
    return out


def save(path, out):
    shutil.copyfile(path, path + ".bak")  # .bak ไฟล์เดียว ทับของเดิมทุกครั้ง
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)


def same_balance(src, out):
    """เทียบความสมดุลวงเล็บ 'เฉพาะส่วนที่เพิ่ม' (นับดิบในไฟล์ต้นฉบับอาจไม่สมดุลเพราะอยู่ใน String/Regex)"""
    return all((out.count(a) - out.count(b)) == (src.count(a) - src.count(b)) for a, b in (("{", "}"), ("(", ")"), ("[", "]")))


HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "fileStorage.js")
M2 = "MARKER_STORAGE_DASHBOARD_V2"
M1 = "// MARKER_STORAGE_DASHBOARD_V1 --"
ANCHOR = 'router.get("/doa-backup/:id", async (req, res) => {'

src, nl = load(TARGET)
if M2 in src:
    print("[SKIP] พบ " + M2 + " แล้ว (Idempotent) ไม่เขียนไฟล์")
    sys.exit(0)

CODE = r'''// MARKER_STORAGE_DASHBOARD_V2 -- Storage Dashboard (System Console > Backend Ops): นับเฉพาะข้อมูล FASTAPN, พื้นที่ว่างรายไดรฟ์หักสำรอง, โควตา (อ่านอย่างเดียว)
const ST_GIB = 1073741824;
const ST_GROUPS = [
  { key: "doa", label: "Detail of Account (GL)", pct: 45, test: (n) => /^doa_/.test(n) },
  { key: "files", label: "ไฟล์ที่อัปโหลด (File Storage)", pct: 25, test: () => false },
  { key: "vat", label: "VAT / AP / Batch", pct: 15, test: (n) => /^(vat_|ap_|batch_|invoice)/.test(n) },
  { key: "logsp", label: "Activity Log + SharePoint Handler", pct: 5, test: (n) => /^(activity_log|sp_)/.test(n) },
  { key: "reserve", label: "เผื่อระบบ / Backup / อื่นๆ", pct: 10, test: () => true },
];
const stGroupKey = (n) => { for (const g of ST_GROUPS) if (g.test(n)) return g.key; return "reserve"; };
let stCache = null;
pool.query(`CREATE TABLE IF NOT EXISTS storage_setting (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`).catch((e) => console.error("[storage_setting]", e.message));
pool.query(`CREATE TABLE IF NOT EXISTS storage_quota (grp TEXT PRIMARY KEY, pct NUMERIC NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`).catch((e) => console.error("[storage_quota]", e.message));
pool.query(`CREATE TABLE IF NOT EXISTS storage_history (day DATE PRIMARY KEY, db_bytes BIGINT, used_bytes BIGINT, total_bytes BIGINT, free_bytes BIGINT, created_at TIMESTAMPTZ DEFAULT NOW())`)
  .then(() => pool.query(`ALTER TABLE storage_history ADD COLUMN IF NOT EXISTS app_bytes BIGINT`)) // V2: ขนาดข้อมูล FASTAPN (DB + ไฟล์) ใช้คำนวณคาดว่าเต็ม
  .catch((e) => console.error("[storage_history]", e.message));
let stFilesBytes = 0; // ขนาดไฟล์อัปโหลดล่าสุดที่สแกนได้ (ใช้ตอน Snapshot รายวัน)

const stDiskOf = async (p, label) => {
  try {
    if (!p || typeof fs.promises.statfs !== "function") return null;
    const s = await fs.promises.statfs(p); const bs = Number(s.bsize);
    const total = Number(s.blocks) * bs, free = Number(s.bavail) * bs;
    return { label, path: p, total, free, used: Math.max(0, total - Number(s.bfree) * bs) };
  } catch (e) { return null; }
};
const stDrives = async () => {
  const list = [];
  let fdir = process.env.STORAGE_FILES_DIR || "";
  if (!fdir) { try { const r = await pool.query("SELECT file_path FROM file_storage WHERE file_path IS NOT NULL ORDER BY id DESC LIMIT 1"); if (r.rows[0]) fdir = path.dirname(r.rows[0].file_path); } catch (e) {} }
  const a = await stDiskOf(fdir, "ไฟล์ที่อัปโหลด"); if (a) { a.kinds = ["files"]; list.push(a); }
  let ddir = process.env.STORAGE_DB_DIR || "";
  if (!ddir) { try { const r = await pool.query("SHOW data_directory"); ddir = r.rows[0] && r.rows[0].data_directory; } catch (e) {} }
  const b = await stDiskOf(ddir, "ฐานข้อมูล PostgreSQL"); if (b) { b.kinds = ["db"]; list.push(b); }
  const seen = new Set(), uniq = [];
  for (const d of list) { const k = d.total + "|" + d.used; if (seen.has(k)) { const o = uniq.find((x) => x.total + "|" + x.used === k); if (o) { o.label += " + " + d.label; o.kinds = o.kinds.concat(d.kinds); } continue; } seen.add(k); uniq.push(d); }
  return uniq;
};
const stSettings = async () => {
  const o = { doa_max_periods: 24, warn_yellow: 70, warn_red: 90, reserve_pct: 20, quotas: {} };
  ST_GROUPS.forEach((g) => { o.quotas[g.key] = g.pct; });
  try {
    (await pool.query("SELECT k, v FROM storage_setting")).rows.forEach((r) => { const n = Number(r.v); if (Number.isFinite(n) && r.k in o) o[r.k] = n; });
    (await pool.query("SELECT grp, pct FROM storage_quota")).rows.forEach((r) => { if (r.grp in o.quotas) o.quotas[r.grp] = Number(r.pct); });
  } catch (e) {}
  return o;
};
const stSnapshot = async () => {
  try {
    const db = Number((await pool.query("SELECT pg_database_size(current_database()) AS b")).rows[0].b);
    const dr = await stDrives();
    const total = dr.reduce((s, d) => s + d.total, 0), free = dr.reduce((s, d) => s + d.free, 0), used = dr.reduce((s, d) => s + d.used, 0);
    await pool.query(`INSERT INTO storage_history (day, db_bytes, used_bytes, total_bytes, free_bytes, app_bytes) VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)
      ON CONFLICT (day) DO UPDATE SET db_bytes = EXCLUDED.db_bytes, used_bytes = EXCLUDED.used_bytes, total_bytes = EXCLUDED.total_bytes, free_bytes = EXCLUDED.free_bytes, app_bytes = EXCLUDED.app_bytes, created_at = NOW()`, [db, dr.length ? used : db, total || null, dr.length ? free : null, db + stFilesBytes]);
  } catch (e) { console.error("[storage_snapshot]", e.message); }
};
setTimeout(stSnapshot, 60000).unref();
setInterval(stSnapshot, 6 * 3600 * 1000).unref();

router.get("/storage-stats", async (req, res) => {
  const u = req.user || {};
  if (u.appRole !== "Owner" && u.appRole !== "Admin") return res.status(403).json({ error: "เฉพาะ Owner / Admin" });
  try {
    if (req.query.refresh !== "1" && stCache && Date.now() - stCache.at < 120000) return res.json({ ...stCache.data, cached: true });
    const out = { at: new Date().toISOString() };
    const cfg = await stSettings(); out.config = cfg;
    out.db = (await pool.query("SELECT current_database() AS name, pg_database_size(current_database())::bigint AS bytes")).rows[0]; out.db.bytes = Number(out.db.bytes);
    // ตาราง + จัดกลุ่ม
    const tq = await pool.query(`SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS total, pg_relation_size(c.oid)::bigint AS tbl, pg_indexes_size(c.oid)::bigint AS idx, COALESCE(s.n_live_tup, 0)::bigint AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY total DESC`);
    const tabs = tq.rows.map((r) => ({ name: r.name, group: stGroupKey(r.name), total: Number(r.total), tbl: Number(r.tbl), idx: Number(r.idx), rows: Number(r.rows) }));
    const gb = {}; ST_GROUPS.forEach((g) => { gb[g.key] = { key: g.key, label: g.label, bytes: 0, tables: 0, files: 0 }; });
    tabs.forEach((t) => { gb[t.group].bytes += t.total; gb[t.group].tables += 1; });
    out.tables = tabs.slice(0, 10); out.table_count = tabs.length;
    // ไฟล์บนดิสก์ (stat ทีละชุด เพดาน 50,000 ไฟล์ / 20 วินาที)
    const fq = await pool.query("SELECT module, status, file_path FROM file_storage WHERE file_path IS NOT NULL LIMIT 50000").catch(() => ({ rows: [] }));
    const fm = new Map(); const t0 = Date.now(); let scanned = 0, truncated = false, fbytes = 0, fcount = 0;
    for (let i = 0; i < fq.rows.length; i += 200) {
      if (Date.now() - t0 > 20000) { truncated = true; break; }
      const part = fq.rows.slice(i, i + 200);
      const rs = await Promise.allSettled(part.map((r) => fs.promises.stat(r.file_path)));
      part.forEach((r, j) => { const k = (r.module || "-") + "|" + (r.status || "-"); const o = fm.get(k) || { module: r.module || "-", status: r.status || "-", files: 0, missing: 0, bytes: 0 }; if (rs[j].status === "fulfilled") { o.files += 1; o.bytes += rs[j].value.size; fbytes += rs[j].value.size; fcount += 1; } else o.missing += 1; fm.set(k, o); scanned++; });
    }
    gb.files.bytes = fbytes; gb.files.files = fcount;
    out.files = { rows: [...fm.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 15), scanned, total: fq.rows.length, truncated };
    // ความจุ: นับเฉพาะข้อมูล FASTAPN (DB + ไฟล์อัปโหลด) / พื้นที่ว่างรายไดรฟ์หักสำรอง reserve_pct ให้เครื่อง
    stFilesBytes = fbytes;
    const drives = await stDrives(); const rsv = cfg.reserve_pct;
    const appBytes = out.db.bytes + fbytes;
    drives.forEach((x) => { x.used_pct = x.total ? Math.round(x.used / x.total * 1000) / 10 : null; x.reserve = Math.round(x.total * rsv / 100); x.usable_free = Math.max(0, x.free - x.reserve);
      x.app = (x.kinds.includes("db") ? out.db.bytes : 0) + (x.kinds.includes("files") ? fbytes : 0); x.other = Math.max(0, x.used - x.app); x.app_pct = (x.app + x.usable_free) > 0 ? Math.round(x.app / (x.app + x.usable_free) * 1000) / 10 : 100; });
    out.drives = drives;
    let source = "disk", diskTotal = 0, diskUsed = 0, diskFree = 0, usableFree = 0, other = 0;
    if (drives.length) { diskTotal = drives.reduce((s, x) => s + x.total, 0); diskUsed = drives.reduce((s, x) => s + x.used, 0); diskFree = drives.reduce((s, x) => s + x.free, 0); usableFree = drives.reduce((s, x) => s + x.usable_free, 0); other = drives.reduce((s, x) => s + x.other, 0); }
    else { const capGb = Number(process.env.STORAGE_CAPACITY_GB || 0); if (capGb > 0) { source = "env"; diskTotal = capGb * ST_GIB; diskUsed = appBytes; diskFree = Math.max(0, diskTotal - appBytes); usableFree = Math.max(0, diskTotal * (1 - rsv / 100) - appBytes); } else source = "none"; }
    const appCap = appBytes + usableFree; const total = appCap;
    out.capacity = { source, reserve_pct: rsv, app_bytes: appBytes, db_bytes: out.db.bytes, files_bytes: fbytes, other_bytes: other, disk_total: diskTotal, disk_used: diskUsed, disk_free: diskFree, usable_free: usableFree, app_capacity: appCap, pct: appCap ? Math.round(appBytes / appCap * 1000) / 10 : null };
    out.groups = ST_GROUPS.map((g) => { const q = cfg.quotas[g.key] || 0, qb = total ? total * q / 100 : 0, b = gb[g.key]; return { key: g.key, label: g.label, bytes: b.bytes, tables: b.tables, files: b.files, quota_pct: q, quota_bytes: qb, use_pct: qb ? Math.round(b.bytes / qb * 1000) / 10 : null }; });
    // Detail of Account
    const dk = await pool.query("SELECT kind, count(*)::int AS files, count(DISTINCT bu)::int AS bus, COALESCE(sum(pg_column_size(data)), 0)::bigint AS bytes FROM doa_tb_backup GROUP BY kind ORDER BY bytes DESC").catch(() => ({ rows: [] }));
    const dt = await pool.query("SELECT bu, kind, count(*)::int AS files, COALESCE(sum(pg_column_size(data)), 0)::bigint AS bytes FROM doa_tb_backup GROUP BY bu, kind ORDER BY bytes DESC LIMIT 5").catch(() => ({ rows: [] }));
    const dp = await pool.query("SELECT bu, count(*)::int AS periods FROM doa_tb_backup WHERE kind = 'TBRAW' GROUP BY bu ORDER BY periods DESC, bu LIMIT 30").catch(() => ({ rows: [] }));
    out.doa = { by_kind: dk.rows.map((r) => ({ kind: r.kind, files: r.files, bus: r.bus, bytes: Number(r.bytes) })), top_bu: dt.rows.map((r) => ({ bu: r.bu, kind: r.kind, files: r.files, bytes: Number(r.bytes) })), max_periods: cfg.doa_max_periods,
      periods: dp.rows.map((r) => ({ bu: r.bu, periods: r.periods, max: cfg.doa_max_periods, level: r.periods >= cfg.doa_max_periods ? "red" : (r.periods >= cfg.doa_max_periods * 0.9 ? "yellow" : "ok") })) };
    // Memory ของ Process
    const mu = process.memoryUsage(); out.process = { rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal, external: mu.external, arrayBuffers: mu.arrayBuffers };
    try { let ln = 0, lb = 0; for (const v of spLocalBox.values()) { ln += 1; try { lb += JSON.stringify(v).length; } catch (e) {} } out.mem_caches = [{ name: "ที่พักชั่วคราว Drive D (spLocalBox)", entries: ln, bytes: lb }]; } catch (e) { out.mem_caches = []; }
    // คาดว่าเต็ม: การโตของข้อมูล FASTAPN เทียบกับพื้นที่ว่างที่ใช้ได้ (ต้องมีประวัติ >= 7 วัน)
    const hq = await pool.query("SELECT day, app_bytes FROM storage_history WHERE app_bytes IS NOT NULL AND day >= CURRENT_DATE - 90 ORDER BY day").catch(() => ({ rows: [] }));
    out.forecast = { days_of_history: hq.rows.length, per_month: null, months_left: null };
    if (hq.rows.length >= 2) {
      const a = hq.rows[0], z = hq.rows[hq.rows.length - 1], span = Math.max(1, Math.round((new Date(z.day) - new Date(a.day)) / 86400000));
      if (span >= 7) { const perDay = (Number(z.app_bytes) - Number(a.app_bytes)) / span; out.forecast.per_month = Math.round(perDay * 30); if (perDay > 0 && usableFree > 0) out.forecast.months_left = Math.round(usableFree / perDay / 30 * 10) / 10; }
    }
    // Alerts
    const al = [], Y = cfg.warn_yellow, R = cfg.warn_red, lv = (p) => (p >= R ? "red" : (p >= Y ? "yellow" : null));
    drives.forEach((x) => { const l = lv(x.app_pct); if (l) al.push({ level: l, text: "ไดรฟ์ " + x.path.slice(0, 3) + " (" + x.label + "): FASTAPN ใช้ " + x.app_pct + "% ของพื้นที่ที่ใช้ได้" + (x.usable_free <= 0 ? " — ที่ว่างเหลือต่ำกว่าส่วนที่กันไว้ให้เครื่อง" : "") }); });
    out.groups.forEach((g) => { if (g.use_pct != null && lv(g.use_pct)) al.push({ level: lv(g.use_pct), text: g.label + " ใช้ " + g.use_pct + "% ของโควตา" }); });
    out.doa.periods.forEach((p) => { if (p.level !== "ok") al.push({ level: p.level, text: "BU " + p.bu + " เก็บ " + p.periods + "/" + p.max + " งวด" + (p.level === "red" ? " — ควรย้ายงวดเก่าไป SharePoint" : " — ใกล้เต็ม") }); });
    if (out.forecast.months_left != null && out.forecast.months_left <= 3) al.push({ level: out.forecast.months_left <= 1 ? "red" : "yellow", text: "คาดว่าดิสก์เต็มในอีก ~" + out.forecast.months_left + " เดือน" });
    out.alerts = al;
    stCache = { at: Date.now(), data: out };
    res.json(out);
  } catch (e) { console.error("[storage-stats]", e.message); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/storage-config", async (req, res) => {
  const u = req.user || {};
  if (u.appRole !== "Owner") return res.status(403).json({ error: "เฉพาะ Owner" });
  try {
    const b = req.body || {}, by = u.email || u.username || "";
    if (b.quotas) {
      let sum = 0; const rows = [];
      for (const g of ST_GROUPS) { const n = Number(b.quotas[g.key]); if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: "โควตา " + g.key + " ต้องเป็น 0-100" }); sum += n; rows.push([g.key, n]); }
      if (sum > 100.0001) return res.status(400).json({ error: "ผลรวมโควตาต้องไม่เกิน 100% (ตอนนี้ " + sum + "%)" });
      for (const [k, n] of rows) await pool.query("INSERT INTO storage_quota (grp, pct, updated_by) VALUES ($1,$2,$3) ON CONFLICT (grp) DO UPDATE SET pct = EXCLUDED.pct, updated_by = EXCLUDED.updated_by, updated_at = NOW()", [k, n, by]);
    }
    const sets = [["doa_max_periods", 1, 600], ["warn_yellow", 1, 100], ["warn_red", 1, 100], ["reserve_pct", 0, 60]];
    for (const [k, lo, hi] of sets) { if (b[k] == null) continue; const n = Number(b[k]); if (!Number.isFinite(n) || n < lo || n > hi) return res.status(400).json({ error: k + " ต้องอยู่ระหว่าง " + lo + "-" + hi }); await pool.query("INSERT INTO storage_setting (k, v, updated_by) VALUES ($1,$2,$3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_by = EXCLUDED.updated_by, updated_at = NOW()", [k, String(n), by]); }
    stCache = null;
    res.json({ ok: true, config: await stSettings() });
  } catch (e) { console.error("[storage-config]", e.message); res.status(500).json({ error: "Internal server error" }); }
});

'''
CODE = CODE.replace("\n", nl)
if src.count(ANCHOR) != 1:
    die("Anchor doa-backup/:id พบ %d ครั้ง (ต้อง 1) -- ไฟล์อาจไม่ตรงเวอร์ชัน" % src.count(ANCHOR))
i_end = src.index(ANCHOR)
if M1 in src:
    i_start = src.index(M1)
    if src.count(M1) != 1 or i_start > i_end:
        die("พบ v1 ในรูปแบบที่ไม่คาดคิด -- ไม่เขียนไฟล์")
    out = src[:i_start] + CODE.rstrip() + nl + nl + src[i_end:]
    how = "แทนที่ v1"
else:
    out = src[:i_end] + CODE.rstrip() + nl + nl + src[i_end:]
    how = "เพิ่มใหม่"
if not same_balance(src, out) and M1 not in src:
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")
tmp = os.path.join(HERE, "fileStorage.chk.mjs")
with open(tmp, "w", encoding="utf-8", newline="") as f:
    f.write(out)
try:
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode != 0:
        os.remove(tmp); die("node --check ไม่ผ่าน: " + (r.stderr or r.stdout))
except FileNotFoundError:
    print("[WARN] ไม่พบ node ใน PATH -- ข้าม node --check")
if os.path.exists(tmp): os.remove(tmp)
save(TARGET, out)
print("[OK] fileStorage.js: Storage Dashboard v2 (" + how + ") | สำรอง .bak แล้ว")
print("     ต่อไป: Restart-Service fastapn-backend (ตั้ง env STORAGE_CAPACITY_GB ได้ ถ้าอ่านดิสก์ไม่ได้)")
