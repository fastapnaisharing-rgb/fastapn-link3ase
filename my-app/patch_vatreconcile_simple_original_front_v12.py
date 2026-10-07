# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_FRONT_V12
# แท็บ Simple ใน Popup Reconcile: วาด Layout เหมือนไฟล์ Simple Report ต้นฉบับ (ต้องใช้ Backend v5 ที่ส่ง "groups")
# ถ้า Backend ยังไม่ได้อัปเดต (ไม่มี groups) จะ Fallback เป็น Grid เดิม
# ใช้: python patch_vatreconcile_simple_original_front_v12.py <path src\pages\VatReconcileDashboard.js>
import sys, shutil, os, glob
MARKER = "MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_FRONT_V12"
path = sys.argv[1] if len(sys.argv) > 1 else r"src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)

def safe_replace(s, old, new):
    c = s.count(old)
    if c != 1:
        print(f"[ABORT] anchor พบ {c} ครั้ง (ต้องเป็น 1): {old[:70]!r}"); sys.exit(1)
    return s.replace(old, new)

COMP = r'''// MARKER_VATRECONCILE_SIMPLE_ORIGINAL_LAYOUT_FRONT_V12 -- แสดง Simple Report ตาม Layout ไฟล์ต้นฉบับ (หัวรายงาน + ตารางหัวคอลัมน์ 2 ชั้น + รวมสาขา + รวมสุทธิ)
const SO_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const soDate = (v) => {
  if (v == null || v === '') return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return `${m[3]}-${SO_MON[Number(m[2]) - 1] || m[2]}-${m[1].slice(2)}`;
};
const soNum = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const soZero = (v) => {
  if (v == null || v === '') return '';
  return /^0+$/.test(String(v).trim()) ? '0' : String(v);
};

function SimpleOriginalView({ data, bu }) {
  const groups = (data && data.groups) || [];
  const h0 = (groups[0] && groups[0].header) || {};
  const BD = '1px solid #000';
  const th = { border: BD, background: '#e5f1fb', fontWeight: 700, textAlign: 'center', padding: '3px 6px', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' };
  const td = { border: BD, padding: '2px 6px', fontSize: 12, verticalAlign: 'top' };
  const tdR = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
  const tdC = { ...td, textAlign: 'center', whiteSpace: 'nowrap' };
  const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const allRows = groups.reduce((a, g) => a.concat(g.rows), []);
  const lbl = { fontWeight: 700, paddingRight: 8, whiteSpace: 'nowrap' };
  const Total = ({ label, rows }) => (
    <tr style={{ fontWeight: 700 }}>
      <td style={td} colSpan={8}></td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={tdR}>{soNum(sum(rows, 'paid_amount'))}</td>
      <td style={tdR}>{soNum(sum(rows, 'paid_vat'))}</td>
      <td style={tdR}>{soNum(sum(rows, 'claimed_amount'))}</td>
      <td style={tdR}>{soNum(sum(rows, 'claimed_vat'))}</td>
      <td style={td}></td>
    </tr>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', border: `1px solid ${RP_BORDER}`, padding: '14px 16px', color: '#000' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{h0.report_title || 'รายงานภาษีซื้อ'}</div>
      <table style={{ fontSize: 12.5, marginBottom: 8, borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={lbl}>Bu Code :</td><td>{bu || ''}</td></tr>
          <tr><td style={lbl}>Report ID :</td><td>{h0.report_id || ''}</td></tr>
          <tr><td style={lbl}>Print Date :</td><td>{h0.print_date ? soDate(h0.print_date) : ''}</td></tr>
          <tr><td style={lbl}>Print By :</td><td>{h0.print_by || ''}</td></tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 12.5, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div><b>ชื่อผู้ประกอบการ :</b> {h0.operator_name || ''}</div>
          <div><b>ที่อยู่ :</b> {h0.address_line1 || ''}</div>
          {h0.address_line2 ? <div style={{ paddingLeft: 40 }}>{h0.address_line2}</div> : null}
          {h0.address_line3 ? <div style={{ paddingLeft: 40 }}>{h0.address_line3}</div> : null}
        </div>
        <div>
          <div><b>เลขประจำตัวผู้เสียภาษี :</b> {h0.company_tax_id || ''}</div>
          <div><b>รหัสสาขา :</b> {(groups[0] && groups[0].branch) || ''}</div>
          <div><b>สาขาที่ :</b> {h0.branch_no || ''}</div>
        </div>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={th} colSpan={2}>รับสินค้า/รับเอกสาร</th>
            <th style={th} colSpan={3}>ใบกำกับภาษี</th>
            <th style={th} rowSpan={2}>เลขประจำตัว<br />ผู้เสียภาษีอากร</th>
            <th style={th} rowSpan={2}>สถาน<br />ประกอบการ<br />สาขาที่</th>
            <th style={th} rowSpan={2}>&nbsp;</th>
            <th style={{ ...th, minWidth: 260 }} rowSpan={2}>รายการ</th>
            <th style={th} colSpan={2}>ภาษีซื้อที่ชำระ</th>
            <th style={th} colSpan={3}>ภาษีซื้อที่ใช้สิทธิ์</th>
          </tr>
          <tr>
            <th style={th}>วัน/เดือน/ปี</th>
            <th style={th}>ลำดับที่</th>
            <th style={th}>วัน/เดือน/ปี</th>
            <th style={th}>เลขที่</th>
            <th style={th}>ชื่อผู้ค้า</th>
            <th style={th}>มูลค่าสินค้า</th>
            <th style={th}>เงินภาษี</th>
            <th style={th}>มูลค่าสินค้า</th>
            <th style={th}>เงินภาษี</th>
            <th style={th}>(%)</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.branch}>
              {g.rows.map((r, i) => (
                <tr key={i}>
                  <td style={tdC}>{soDate(r.receive_date)}</td>
                  <td style={tdC}>{r.running_no ?? ''}</td>
                  <td style={tdC}>{soDate(r.tax_invoice_date)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.tax_invoice_no || ''}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.vendor_name || ''}</td>
                  <td style={tdC}>{soZero(r.tax_id)}</td>
                  <td style={tdC}>{soZero(r.branch_field)}</td>
                  <td style={td}></td>
                  <td style={{ ...td, minWidth: 260 }}>{r.item_detail || ''}</td>
                  <td style={tdR}>{soNum(r.paid_amount)}</td>
                  <td style={tdR}>{soNum(r.paid_vat)}</td>
                  <td style={tdR}>{soNum(r.claimed_amount)}</td>
                  <td style={tdR}>{soNum(r.claimed_vat)}</td>
                  <td style={tdR}>{r.claim_percent == null ? '' : `${Number(r.claim_percent).toFixed(2)}%`}</td>
                </tr>
              ))}
              <Total label={`รวมสาขา ${g.branch}`} rows={g.rows} />
            </React.Fragment>
          ))}
          {groups.length > 1 && <Total label="รวมสุทธิ" rows={allRows} />}
        </tbody>
      </table>
    </div>
  );
}

'''
anchor = "// MARKER_VATRECONCILEDASHBOARD_PREVIEWTABLE_EDITABLE_GRID_V1 -- Excel-Style Grid"
src = safe_replace(src, anchor, COMP + anchor)

old = "                  <ReportPreviewTable key={`${view}|${selBranch}`} data={curTab.data} initialBranch={view === 'input' ? selBranch : ''} />\n"
new = ("                  {view === 'simple' && curTab.data.groups && curTab.data.groups.length > 0 ? (\n"
       "                    <SimpleOriginalView data={curTab.data} bu={bu} />\n"
       "                  ) : (\n"
       "                    <ReportPreviewTable key={`${view}|${selBranch}`} data={curTab.data} initialBranch={view === 'input' ? selBranch : ''} />\n"
       "                  )}\n")
src = safe_replace(src, old, new)

n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copy2(path, f"{path}.bak{n:02d}")
out = src.replace("\n", "\r\n") if crlf else src
open(path, "wb").write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
