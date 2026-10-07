# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_BACKUP_CURRENT_PERIOD_V1
# Upload File > Backup แสดงเฉพาะ Batch ของ Period ปัจจุบัน (เช่น Period 10.2026 ต้องไม่เห็นงานเดือน 09.2026)
# ดูย้อนหลังได้ที่ Backup > Transaction (เก็บทุก Batch เหมือนเดิม) -- ใช้ field `period` ที่ Backend /vat-export/history ส่งมา
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_VATCONTROLLER_BACKUP_CURRENT_PERIOD_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)

rep("""  const VAT_HIST_BACKUP_DAYS = 15;
  const isBackupVisible = (b) => {
    if (b.status !== 'pv-backup') return false;
    if (!b.finishedAt) return false;
    const t = new Date(b.finishedAt).getTime();
    return !isNaN(t) && (Date.now() - t) <= VAT_HIST_BACKUP_DAYS * 24 * 60 * 60 * 1000;
  };""", """  // MARKER_VATCONTROLLER_BACKUP_CURRENT_PERIOD_V1 -- Backup โชว์เฉพาะ Period ปัจจุบัน (ปิด Period แล้วหายจากหน้านี้ · ย้อนหลังดูที่ Backup > Transaction)
  const [curPeriodKey, setCurPeriodKey] = React.useState('');
  React.useEffect(() => {
    apiFetch('/vat/period/status').then((ps) => setCurPeriodKey(vatPeriodKey(ps?.vat_period_current_month))).catch(() => {});
  }, [refreshKey]);
  const isBackupVisible = (b) => {
    if (b.status !== 'pv-backup') return false;
    const bk = vatPeriodKey(b.period);
    if (!curPeriodKey || !bk) return true; // อ่าน Period ไม่ได้ -> แสดงไว้ก่อน ไม่ซ่อนงาน
    return bk === curPeriodKey;
  };""", "visible")
rep("""function VatExportHistoryTable({ refreshKey, onDataChanged }) {""",
    """// แปลง Period หลายรูปแบบ ('YYYY-MM', 'YYYY-MM-DD', 'MM/YYYY', 'SEP-26', 'Sep 2026', ปี พ.ศ.) -> 'YYYY-MM' ('' ถ้าอ่านไม่ออก)
function vatPeriodKey(p) {
  const s = String(p == null ? '' : p).trim();
  if (!s) return '';
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const fixY = (y) => { let n = parseInt(y, 10); if (isNaN(n)) return 0; if (n < 100) n += 2000; if (n > 2400) n -= 543; return n; };
  const out = (y, m) => (y && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : '');
  let m = s.match(/^(\\d{4})[-/.](\\d{1,2})/);
  if (m) return out(fixY(m[1]), parseInt(m[2], 10));
  m = s.match(/^(\\d{1,2})[-/.](\\d{4})$/);
  if (m) return out(fixY(m[2]), parseInt(m[1], 10));
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[\\s\\-/.]*(\\d{2,4})$/);
  if (m) return out(fixY(m[2]), MON.indexOf(m[1].toUpperCase()) + 1);
  return '';
}
function VatExportHistoryTable({ refreshKey, onDataChanged }) {""", "fn")
rep("""<span style={{ fontSize: '11px', color: '#999' }}>แสดง {VAT_HIST_BACKUP_DAYS} วันนับจากกด Finish</span>""",
    """<span style={{ fontSize: '11px', color: '#999' }}>แสดงเฉพาะงานของ Period ปัจจุบัน</span>""", "label")
rep("""'ไม่มี Backup ในช่วง 15 วัน'""", """'ไม่มี Backup ใน Period ปัจจุบัน'""", "empty")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
