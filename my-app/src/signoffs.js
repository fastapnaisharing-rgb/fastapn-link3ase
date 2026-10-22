// MARKER_GL_SIGNOFF_PROFILE_FE_V1
// ข้อมูลผู้ลงนามของ User ที่ล็อกอิน: Prepare by = my_name + my_job | Review by = report_to_name + report_to_job
// ตั้งค่าที่ System Console > Profile | หน้าอื่นเรียกใช้: const p = await loadSignoffProfile();
const API_ROOT = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
const URL_ = `${API_ROOT}/api/file-storage/signoff-profile`;
const hdr = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('fastapn_token') || ''}` });
async function call(opt) {
  const r = await fetch(URL_, { ...opt, headers: hdr() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export const loadSignoffProfile = () => call();
export const saveSignoffProfile = (p) => call({ method: 'PUT', body: JSON.stringify(p) });
