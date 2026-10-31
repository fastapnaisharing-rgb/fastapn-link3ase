// MARKER_GL_DOA_CONFIG_FE_V1 -- Config รับข้อมูล Detail of Account: User + Account + BU (เฉพาะสิทธิ์ GL)
const API_ROOT = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
const BASE = `${API_ROOT}/api/file-storage/doa-config`;
const hdr = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('fastapn_token') || ''}` });
async function call(url, opt) {
  const r = await fetch(url, { ...opt, headers: hdr() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export const listDoaConfig = (bu) => call(BASE + (bu ? `?bu=${encodeURIComponent(bu)}` : '')).then(j => j.items || []);
export const myDoaConfig = () => call(`${BASE}/mine`).then(j => j.items || []);
export const addDoaConfig = (user_email, items) => call(BASE, { method: 'POST', body: JSON.stringify({ user_email, items }) }); // items: [{bu, cpc, account, sub_acc}]
export const removeDoaConfig = (id) => call(`${BASE}/${id}`, { method: 'DELETE' });

// MARKER_GL_DOA_TB_BACKUP_FE_V1 -- Backup TB ลง DB ชั่วคราว (มีอายุเก็บ) ต่อ BU + งวด
const BK = `${API_ROOT}/api/file-storage/doa-backup`;
export const listDoaBackups = (bu) => call(`${BK}?bu=${encodeURIComponent(bu)}`);
export const getDoaBackup = (id) => call(`${BK}/${id}`).then(j => j.item);
export const saveDoaBackup = (bu, period, file_name, rows, kind = 'TB', account = '') => call(BK, { method: 'POST', body: JSON.stringify({ bu, period, file_name, rows, kind, account }) }); // MARKER_GL_DOA_SIMPLE_BACKUP_V1
export const removeDoaBackup = (id) => call(`${BK}/${id}`, { method: 'DELETE' });

// MARKER_GL_DOA_STAMP_CLEAR_V1 -- Stamp Clear: แถว Detail ที่ทำเสร็จแล้ว (ใช้ร่วมกันทั้ง BU)
const CLR = `${API_ROOT}/api/file-storage/doa-clear`;
export const listDoaClear = (bu) => call(`${CLR}?bu=${encodeURIComponent(bu)}`).then(j => j.items || []);
export const saveDoaClear = (bu, period, items, file_id, status) => call(CLR, { method: 'POST', body: JSON.stringify({ bu, period, items, file_id, status }) }); // items: [{ key, row }]
export const reverseDoaClear = (bu, account, keys) => call(`${CLR}/reverse`, { method: 'POST', body: JSON.stringify({ bu, account, keys }) });
export const listDoaClearDetail = (bu, account) => call(`${CLR}?bu=${encodeURIComponent(bu)}&account=${encodeURIComponent(account)}&detail=1`).then(j => j.items || []); // MARKER_GL_DOA_CLEAR_HISTORY_V1 // MARKER_GL_DOA_CLEAR_REVERSE_V1 -- ยกเลิก Stamp Clear (RVS) ของ Account: ลบแถว Pending/Cleared ที่ยังไม่ถูกย้ายเข้า History
export const setDoaClearStatus = (bu, account, from, to, keys) => call(`${CLR}/status`, { method: 'POST', body: JSON.stringify({ bu, account, from, to, keys }) }); // MARKER_GL_DOA_CLEAR_STATUS_V1 -- Confirm: Pending->Backup | Release: Backup->Pending

// MARKER_GL_DOA_COVER_CONFIG_V1 -- Cover ของ Reconcile: Type 1/2/3 ระดับ BU + ปรับต่อ Account (ไม่ตั้ง = Default)
const CVR = `${API_ROOT}/api/file-storage/doa-cover`;
export const getDoaCover = (bu) => call(`${CVR}?bu=${encodeURIComponent(bu)}`); // { bu_type: 1|2|3|null, accounts: { [acc]: 1|2|3 } }
export const saveDoaCover = (bu, account, type) => call(CVR, { method: 'POST', body: JSON.stringify({ bu, account: account || '', type }) }); // account ว่าง = ระดับ BU | type null/'default' (เฉพาะ Account) = กลับเป็น Default
