// MARKER_SP_HANDLER_AUTOUPDATE_V1
// สั่ง SharePoint Handler (fastapn-sp://update) อัปเดตตัวเอง -- เรียกตอน Login (เข้าแอพ) และตอนเปิด Resource Center > VAT Control
// กันรำคาญ: ถามเวอร์ชันล่าสุดจาก Backend แล้วเรียก Handler "เฉพาะเมื่อมีเวอร์ชันใหม่กว่าที่เคยสั่งในเครื่องนี้" (หรือเกิน 7 วันแล้วลองซ้ำกันพลาด)
// Handler เทียบเวอร์ชันกับตัวเองอีกชั้น: เท่ากัน/ใหม่กว่า = ไม่ทำอะไร
const API_ROOT = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
const LS_KEY = 'fastapn_sp_handler_update_try';
const RETRY_MS = 7 * 24 * 3600 * 1000;
let inflight = false;

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
    if (!stj || !Array.isArray(stj.outdated) || stj.outdated.length === 0) return;
    const latest = Number(version);
    if (!Number.isFinite(latest) || latest <= 0) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { last = null; }
    const due = !last || Number(last.v) < latest || (Date.now() - Number(last.at || 0)) > RETRY_MS;
    if (!due) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: latest, at: Date.now() })); } catch { /* ignore */ }
    const uri = `fastapn-sp://update?v=${encodeURIComponent(latest)}&api=${encodeURIComponent(API_ROOT)}&token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
  } catch { /* เงียบ: อัปเดต Handler ไม่ใช่งานหลัก */ } finally { inflight = false; }
}
