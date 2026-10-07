# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_CELL_EDIT_FRONT_V14
# Preview: ดับเบิลคลิกแก้ Cell ได้ทุกชีตต้นทาง (Detail / TB / Simple) แล้วบันทึกลง DB (ต้องใช้ Backend v7)
#  - TB + Simple ใช้ Excel Grid เดิม (Drag-select + Ctrl+C) ผ่าน PUT /vat-reconcile/cell
#  - Simple แบบ Layout ต้นฉบับ แก้ได้ที่ Cell เช่นกัน (รวมสาขา/รวมสุทธิ คำนวณใหม่ทันที)
#  - Cover / ReportVat / Pivot คำนวณใหม่อัตโนมัติจากต้นทางหลังแก้ (หน่วง 0.7 วิ)
# ใช้: python patch_vatreconcile_cell_edit_front_v14.py <path src\pages\VatReconcileDashboard.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_CELL_EDIT_FRONT_V14"
path = sys.argv[1] if len(sys.argv) > 1 else r"src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
if MARKER in s:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
def rp(s, old, new, label):
    c = s.count(old)
    if c != 1:
        print(f"[ABORT] {label}: anchor พบ {c} ครั้ง (ต้องเป็น 1)"); sys.exit(1)
    return s.replace(old, new)

# 1) ตารางที่แก้ได้
s = rp(s, "const EDITABLE_TABLE_BY_REPORT = { 'input_summary|detail': 'vat_reconcile_input_summary' };",
  "const EDITABLE_TABLE_BY_REPORT = { 'input_summary|detail': 'vat_reconcile_input_summary', 'tb|': 'tb', 'simple_100|detail': 'simple_detail', 'simple_avg|detail': 'simple_detail' }; // " + MARKER, "editable map")
# 2) signature
s = rp(s, "function ReportPreviewTable({ data, onRowAction, actionLabel, initialBranch }) {",
          "function ReportPreviewTable({ data, onRowAction, actionLabel, initialBranch, onEdited }) {", "signature")
# 3) putField
s = rp(s, "        const res = await fetch(`${VAT_RECONCILE_API_BASE}/${editableTable}/${rowId}`, {\n          method: 'PUT',\n          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },\n          body: JSON.stringify({ [field]: value }),\n        });",
  "        const viaCell = editableTable === 'tb' || editableTable === 'simple_detail';\n        const res = await fetch(viaCell ? `${VAT_RECONCILE_API_BASE}/vat-reconcile/cell` : `${VAT_RECONCILE_API_BASE}/${editableTable}/${rowId}`, {\n          method: 'PUT',\n          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },\n          body: JSON.stringify(viaCell ? { table: editableTable, id: rowId, field, value } : { [field]: value }),\n        });", "putField")
# 4) หลังบันทึก
s = rp(s, "      setLocalRows((prev) => prev.map((r) => (r.id === rowId ? calcInputStatusRow({ ...r, ...updates }, data.period) : r)));\n",
  "      setLocalRows((prev) => prev.map((r) => (r.id === rowId ? (editableTable === 'vat_reconcile_input_summary' ? calcInputStatusRow({ ...r, ...updates }, data.period) : { ...r, ...updates }) : r)));\n      if (typeof onEdited === 'function') onEdited();\n", "after save")
# 5) Popup: liveData + refresh
s = rp(s, "  const { loading, error, data, bu, account } = state;\n",
  "  const { loading, error, bu, account } = state;\n  const [liveData, setLiveData] = useState(null); // " + MARKER + " -- ข้อมูล Reconcile ที่คำนวณใหม่หลังแก้ต้นทาง\n  const data = liveData || state.data;\n  const refreshTimer = useRef(null);\n  const onSourceEdited = () => {\n    clearTimeout(refreshTimer.current);\n    refreshTimer.current = setTimeout(() => {\n      fetchReconcileReport({ bu: state.bu, account: state.account, period: state.period }).then(setLiveData).catch(() => {});\n    }, 700);\n  };\n  useEffect(() => () => clearTimeout(refreshTimer.current), []);\n", "popup data")
s = rp(s, "                    <SimpleOriginalView data={curTab.data} bu={bu} />", "                    <SimpleOriginalView data={curTab.data} bu={bu} onEdited={onSourceEdited} />", "simple view use")
s = rp(s, "<ReportPreviewTable key={`${view}|${selBranch}`} data={curTab.data} initialBranch={view === 'input' ? selBranch : ''} />",
          "<ReportPreviewTable key={`${view}|${selBranch}`} data={curTab.data} initialBranch={view === 'input' ? selBranch : ''} onEdited={onSourceEdited} />", "table use")

# 6) SimpleOriginalView แก้ได้
s = rp(s, "function SimpleOriginalView({ data, bu }) {\n  const groups = (data && data.groups) || [];\n",
'''function SimpleOriginalView({ data, bu, onEdited }) {
  const [gs, setGs] = useState((data && data.groups) || []);
  const [edit, setEdit] = useState(null); // { gi, ri, col }
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(false);
  const groups = gs;
  const NUM_COLS = ['paid_amount', 'paid_vat', 'claimed_amount', 'claimed_vat', 'claim_percent'];
  const commitEdit = async () => {
    if (!edit || busy) return;
    if (cancelRef.current) { cancelRef.current = false; return; }
    const r = gs[edit.gi].rows[edit.ri];
    const next = val.trim();
    if (next === String(r[edit.col] ?? '').trim()) { setEdit(null); return; }
    setBusy(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/cell`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ table: 'simple_detail', id: r.id, field: edit.col, value: next === '' ? null : next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      const nv = next === '' ? null : NUM_COLS.includes(edit.col) ? Number(next.replace(/,/g, '').replace(/%$/, '')) : next;
      setGs((prev) => prev.map((g, gi) => (gi !== edit.gi ? g : { ...g, rows: g.rows.map((x, ri) => (ri === edit.ri ? { ...x, [edit.col]: nv } : x)) })));
      setEdit(null);
      if (typeof onEdited === 'function') onEdited();
    } catch (err) {
      window.alert(err?.message || 'บันทึกไม่สำเร็จ');
    }
    setBusy(false);
  };
  const cellEd = (gi, ri, r, col, shown, style) => {
    const on = edit && edit.gi === gi && edit.ri === ri && edit.col === col;
    return (
      <td style={on ? { ...style, padding: 0 } : style} title={r.id ? 'ดับเบิลคลิกเพื่อแก้ไข' : undefined}
        onDoubleClick={() => { if (!r.id) return; cancelRef.current = false; setEdit({ gi, ri, col }); setVal(r[col] == null ? '' : String(r[col])); }}>
        {on ? (
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { cancelRef.current = true; setEdit(null); } }}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '2px 4px', border: '2px solid #1a7f37', outline: 'none' }} />
        ) : shown}
      </td>
    );
  };
''', "simple head")
s = rp(s, "              {g.rows.map((r, i) => (\n                <tr key={i}>\n                  <td style={tdC}>{soDate(r.receive_date)}</td>\n                  <td style={tdC}>{r.running_no ?? ''}</td>\n                  <td style={tdC}>{soDate(r.tax_invoice_date)}</td>\n                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.tax_invoice_no || ''}</td>\n                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.vendor_name || ''}</td>\n                  <td style={tdC}>{soZero(r.tax_id)}</td>\n                  <td style={tdC}>{soZero(r.branch_field)}</td>\n                  <td style={td}></td>\n                  <td style={{ ...td, minWidth: 260 }}>{r.item_detail || ''}</td>\n                  <td style={tdR}>{soNum(r.paid_amount)}</td>\n                  <td style={tdR}>{soNum(r.paid_vat)}</td>\n                  <td style={tdR}>{soNum(r.claimed_amount)}</td>\n                  <td style={tdR}>{soNum(r.claimed_vat)}</td>\n                  <td style={tdR}>{r.claim_percent == null ? '' : `${Number(r.claim_percent).toFixed(2)}%`}</td>\n                </tr>\n              ))}\n",
"""              {g.rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  {cellEd(gi, i, r, 'receive_date', soDate(r.receive_date), tdC)}
                  {cellEd(gi, i, r, 'running_no', r.running_no ?? '', tdC)}
                  {cellEd(gi, i, r, 'tax_invoice_date', soDate(r.tax_invoice_date), tdC)}
                  {cellEd(gi, i, r, 'tax_invoice_no', r.tax_invoice_no || '', { ...td, whiteSpace: 'nowrap' })}
                  {cellEd(gi, i, r, 'vendor_name', r.vendor_name || '', { ...td, whiteSpace: 'nowrap' })}
                  {cellEd(gi, i, r, 'tax_id', soZero(r.tax_id), tdC)}
                  {cellEd(gi, i, r, 'branch_field', soZero(r.branch_field), tdC)}
                  <td style={td}></td>
                  {cellEd(gi, i, r, 'item_detail', r.item_detail || '', { ...td, minWidth: 260 })}
                  {cellEd(gi, i, r, 'paid_amount', soNum(r.paid_amount), tdR)}
                  {cellEd(gi, i, r, 'paid_vat', soNum(r.paid_vat), tdR)}
                  {cellEd(gi, i, r, 'claimed_amount', soNum(r.claimed_amount), tdR)}
                  {cellEd(gi, i, r, 'claimed_vat', soNum(r.claimed_vat), tdR)}
                  {cellEd(gi, i, r, 'claim_percent', r.claim_percent == null ? '' : `${Number(r.claim_percent).toFixed(2)}%`, tdR)}
                </tr>
              ))}
""", "simple rows")
s = rp(s, "          {groups.map((g) => (\n            <React.Fragment key={g.branch}>\n              {g.rows.map((r, i) => (\n                <tr key={r.id ?? i}>",
          "          {groups.map((g, gi) => (\n            <React.Fragment key={g.branch}>\n              {g.rows.map((r, i) => (\n                <tr key={r.id ?? i}>", "groups map gi")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copy2(path, f"{path}.bak{n:02d}")
open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
