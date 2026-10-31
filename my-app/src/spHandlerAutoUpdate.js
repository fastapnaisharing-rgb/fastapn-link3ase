// MARKER_SP_HANDLER_AUTOUPDATE_V1
// สั่ง SharePoint Handler (fastapn-sp://update) อัปเดตตัวเอง -- เรียกตอน Login (เข้าแอพ) และตอนเปิด Resource Center > VAT Control
// กันรำคาญ: ถามเวอร์ชันล่าสุดจาก Backend แล้วเรียก Handler "เฉพาะเมื่อมีเวอร์ชันใหม่กว่าที่เคยสั่งในเครื่องนี้" (หรือเกิน 7 วันแล้วลองซ้ำกันพลาด)
// Handler เทียบเวอร์ชันกับตัวเองอีกชั้น: เท่ากัน/ใหม่กว่า = ไม่ทำอะไร
const API_ROOT = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
const LS_KEY = 'fastapn_sp_handler_update_try';
const RETRY_MS = 7 * 24 * 3600 * 1000;
let inflight = false;
// MARKER_SP_LISTENER_LAUNCH_V1 -- ตัวช่วยกลางสั่ง Handler ทุกตัว: ส่งผ่าน Listener ในเครื่อง (http://127.0.0.1:47831 POST /run, ไฟล์ D:\\apps\\fastapn-sp-listener.ps1) -> ไม่มีกล่อง "Open" ของ Browser | ถ้า Listener ไม่ทำงาน/ไม่รองรับคำสั่งนั้น/ถูกบล็อก -> ถอยกลับไปเปิดลิงก์โปรโตคอลแบบเดิม
const SP_LISTENER = 'http://127.0.0.1:47831';
const spListenerState = { ok: null, at: 0 };
export function spOpenProtocol(uri) {
  const a = document.createElement('a');
  a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
}
// คืน Promise<boolean>: true = Listener รับคำสั่งแล้ว (ไม่ต้องเปิดโปรโตคอล) | false = ต้องใช้ทางเดิม
export function spLaunchAsync(uri) {
  if (spListenerState.ok === false && Date.now() - spListenerState.at < 60000) return Promise.resolve(false);
  let ctl = null; let timer = null;
  try { ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; if (ctl) timer = setTimeout(() => ctl.abort(), 2500); } catch (_) { ctl = null; }
  return fetch(`${SP_LISTENER}/run`, { method: 'POST', mode: 'cors', cache: 'no-store', headers: { 'Content-Type': 'text/plain' }, body: uri, signal: ctl ? ctl.signal : undefined })
    .then((r) => { if (r.status === 400) return false; if (!r.ok) throw new Error('listener ' + r.status); spListenerState.ok = true; return true; })
    .catch(() => { spListenerState.ok = false; spListenerState.at = Date.now(); return false; })
    .finally(() => { if (timer) clearTimeout(timer); });
}
export function spLaunch(uri) { spLaunchAsync(uri).then((ok) => { if (!ok) spOpenProtocol(uri); }); }


export async function maybeUpdateSpHandler() {
  if (inflight) return;
  inflight = true;
  try {
    const token = sessionStorage.getItem('fastapn_token');
    if (!token) return;
    const res = await fetch(`${API_ROOT}/api/file-storage/sp-handler/version`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const { version } = await res.json();
    // MARKER_SP_HANDLER_AUTOUPDATE_ONLY_KNOWN_V2 -- สั่ง update เฉพาะเครื่องที่ Handler (v2+) เคยรายงานเวอร์ชันและต่ำกว่าล่าสุดแล้วเท่านั้น
    // Handler v1 / ไม่ได้ติดตั้ง ไม่รู้จักคำสั่ง update -> จะเด้ง Popup Error "คำสั่งไม่ครบ" ทุกครั้งที่ Refresh จึงไม่ยิงให้
    const st = await fetch(`${API_ROOT}/api/file-storage/sp-handler/my-status`, { headers: { Authorization: `Bearer ${token}` } });
    if (!st.ok) return;
    const stj = await st.json();
    // MARKER_SP_AUTOUPDATE_PROFILE_V1 -- สั่ง update เมื่อเวอร์ชันเก่า หรือ Permission เปลี่ยนจนโปรไฟล์ปลายทางในเครื่องไม่ตรง (Backend ส่ง needUpdate / profileHash)
    const needUp = !!stj && (stj.needUpdate === true || (Array.isArray(stj.outdated) && stj.outdated.length > 0));
    if (!needUp) return;
    const ph = String((stj && stj.profileHash) || '');
    const latest = Number(version);
    if (!Number.isFinite(latest) || latest <= 0) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { last = null; }
    const due = !last || Number(last.v) < latest || String((last && last.h) || '') !== ph || (Date.now() - Number(last.at || 0)) > RETRY_MS;
    if (!due) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: latest, h: ph, at: Date.now() })); } catch { /* ignore */ }
    const uri = `fastapn-sp://update?v=${encodeURIComponent(latest)}&api=${encodeURIComponent(API_ROOT)}&token=${encodeURIComponent(token)}&profile=1`;
    spLaunch(uri); // MARKER_SP_LISTENER_LAUNCH_V1
  } catch { /* เงียบ: อัปเดต Handler ไม่ใช่งานหลัก */ } finally { inflight = false; }
}

// MARKER_OUTLOOK_AUTOUPDATE_V1 -- สั่ง Listener (v3+) โหลด fastapn-outlook.ps1 ใหม่จาก Backend มาแทนตัวเก่าในเครื่องเอง (ไม่ต้องโหลดไฟล์ไปวาง) | คืน true = สำเร็จ, false = ใช้ไม่ได้ (Listener ไม่มี/เก่า/ล้มเหลว) -> ผู้เรียกถอยไปโหลดไฟล์แบบเดิม
export async function updateOutlookViaListener() {
  const base = 'http://127.0.0.1:47831';
  try {
    const token = sessionStorage.getItem('fastapn_token');
    if (!token) return false;
    const ctl1 = new AbortController(); const t1 = setTimeout(() => ctl1.abort(), 2500);
    const pr = await fetch(`${base}/ping`, { signal: ctl1.signal }); clearTimeout(t1);
    const pj = await pr.json();
    if (!pj || Number(pj.listenerVersion) < 3) return false;
    const ctl2 = new AbortController(); const t2 = setTimeout(() => ctl2.abort(), 40000);
    const r = await fetch(`${base}/update-outlook`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `api=${encodeURIComponent(API_ROOT)}&token=${encodeURIComponent(token)}`, signal: ctl2.signal }); clearTimeout(t2);
    const j = await r.json();
    return !!(j && j.ok);
  } catch { return false; }
}
