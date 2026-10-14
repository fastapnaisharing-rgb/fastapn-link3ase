#!/usr/bin/env python3
# patch_cfm_frontend.py -- CFM: Error List (FC) + TB Status  | MARKER_VATRECONCILE_CFM_V1
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "MARKER_VATRECONCILE_CFM_V1" in s:
    print("already patched"); sys.exit(0)
a1 = "function ReconcileReportPopup({ state, periodLabel, onClose, onExport }) {"
assert s.count(a1) == 1
comp = r'''// MARKER_VATRECONCILE_CFM_V1 -- CFM: Error List (FC ใน Tax Invoice No. / Description) + TB Status ERROR | เตือนอย่างเดียว ไม่บล็อก Save/Export
function CfmFcPanel({ cfm }) {
  const [list, setList] = useState(() => (cfm.fcList || []).map((r) => ({ ...r })));
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setList((cfm.fcList || []).map((r) => ({ ...r }))); }, [cfm]);
  const openCount = list.filter((r) => !r.checked).length;
  const toggle = async (ids, checked) => {
    if (busy || !ids.length) return;
    setBusy(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/cfm-fc-ack`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ids, checked }),
      });
      if (!res.ok) throw new Error(`บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      const set = new Set(ids);
      setList((prev) => prev.map((r) => (set.has(r.id) ? { ...r, checked } : r)));
    } catch (e) { window.alert(e.message || 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const errs = cfm.tbErrors || [];
  if (!list.length && !errs.length && !cfm.simpleFallback) return null;
  const th = { padding: '4px 8px', border: '1px solid #d0d7de', background: '#f6f8fa', fontSize: 12, whiteSpace: 'nowrap' };
  const td = { padding: '4px 8px', border: '1px solid #e5e7eb', fontSize: 12, whiteSpace: 'nowrap' };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div style={{ margin: '10px 0' }}>
      {errs.length > 0 && (
        <div style={{ background: '#ffebe9', color: '#cf222e', border: '1px solid #ff8182', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 6 }}>
          <b>TB Status: ERROR</b> — ตรวจพบข้อมูล Input ของ FC ในรายงานภาษี
          {errs.map((e, i) => <div key={i} style={{ fontSize: 12 }}>• {e.message}</div>)}
        </div>
      )}
      {cfm.simpleFallback && (
        <div style={{ background: '#fff8c5', color: '#7d4e00', border: '1px solid #eac54f', borderRadius: 8, padding: '6px 12px', fontSize: 12, marginBottom: 6 }}>
          ไฟล์ Simple ที่นำเข้าก่อนหน้านี้ไม่มียอด "รวมสาขา" — ใช้ผลรวมรายบรรทัดแทน (อาจต่างจากรวมสุทธิของ Oracle 0.01)
        </div>
      )}
      {list.length > 0 && (
        <div style={{ background: openCount ? '#fff8c5' : '#dafbe1', color: openCount ? '#7d4e00' : '#1a7f37', border: `1px solid ${openCount ? '#eac54f' : '#aceebb'}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b>{openCount ? `⚠ Error List: พบ ${openCount} รายการที่อาจเป็นค่าใช้จ่ายสาขา FC ลงใน HO` : '✓ Error List: ตรวจแล้วครบทุกรายการ'}</b>
            <span style={{ fontSize: 12 }}>(ทั้งหมด {list.length} รายการ · VAT {fmt(list.reduce((t, r) => t + (Number(r.paid_vat) || 0), 0))})</span>
            <button type="button" onClick={() => setOpen((v) => !v)} style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 12, borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{open ? 'ซ่อน' : 'แสดง'}</button>
            {openCount > 0 && <button type="button" disabled={busy} onClick={() => toggle(list.filter((r) => !r.checked).map((r) => r.id), true)} style={{ padding: '2px 10px', fontSize: 12, borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>ติ๊กตรวจแล้วทั้งหมด</button>}
          </div>
          {open && (
            <div style={{ overflow: 'auto', maxHeight: 260, marginTop: 8, background: '#fff', borderRadius: 6 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>{['ตรวจแล้ว', 'เหตุผล', 'สาขา', 'Tax Invoice No.', 'ผู้ขาย', 'รายการ', 'มูลค่า', 'ภาษี'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} style={{ opacity: r.checked ? 0.55 : 1 }}>
                      <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!r.checked} disabled={busy} onChange={(e) => toggle([r.id], e.target.checked)} /></td>
                      <td style={td}>{[r.in_invoice && 'FC ใน Invoice', r.in_desc && 'FC ใน Description'].filter(Boolean).join(' / ')}</td>
                      <td style={td}>{r.branch}</td>
                      <td style={td}>{r.tax_invoice_no}</td>
                      <td style={td}>{r.vendor_name}</td>
                      <td style={td}>{r.item_detail}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(r.paid_amount)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(r.paid_vat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'''
s = s.replace(a1, comp + a1, 1)
a2 = "                <div style={{ fontSize: 13, color: '#57606a' }}>ประจำเดือน {data.header.periodLabel}</div>\n              </div>\n"
assert s.count(a2) == 1, s.count(a2)
s = s.replace(a2, a2 + "              {data.isCfm && data.cfm && <CfmFcPanel cfm={data.cfm} />}{/* MARKER_VATRECONCILE_CFM_V1 */}\n", 1)
open(p, "w", encoding="utf-8").write(s)
print("Dashboard patched")
