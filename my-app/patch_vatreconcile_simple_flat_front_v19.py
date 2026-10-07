# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SIMPLE_FLAT_FRONT_V19
# แท็บ Simple ใน Preview = ตารางแบน A-O ตรง Original (Branch, Type, Receive Date ... Claim %) + แถว "XXXXXX รวมสาขา" / "รวมสุทธิ" (แก้ Cell ได้ -> DB)
import sys, shutil
M = "MARKER_VATRECONCILE_SIMPLE_FLAT_FRONT_V19"
P = sys.argv[1] if len(sys.argv) > 1 else "VatReconcileDashboard.js"
raw = open(P, "rb").read(); crlf = b"\r\n" in raw
s = raw.decode("utf-8").replace("\r\n", "\n")
if M in s: sys.exit("skip")
shutil.copy2(P, P + ".bak_before_v19")
def rep(old, new):
    global s
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    s = s.replace(old, new)

rep("function SimpleOriginalView({ data, bu, onEdited }) {", "function SimpleOriginalView({ data, bu, onEdited, flat, simpleType }) {")
rep("<SimpleOriginalView data={curTab.data} bu={bu} onEdited={onSourceEdited} />", "<SimpleOriginalView data={curTab.data} bu={bu} onEdited={onSourceEdited} flat simpleType={simpleType} />")

FLAT = r"""  if (flat) { // MARKER_VATRECONCILE_SIMPLE_FLAT_FRONT_V19
    const NAVY = '#002060';
    const FB = '1px solid #000';
    const hd = { background: NAVY, color: '#fff', fontWeight: 700, textAlign: 'center', border: '1px solid #fff', padding: '3px 4px', fontSize: 12, verticalAlign: 'middle', height: 36 };
    const bx = { border: FB, padding: '1px 4px', fontSize: 12, fontFamily: 'Tahoma, "Segoe UI", sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', verticalAlign: 'bottom', background: '#fff' };
    const bxR = { ...bx, textAlign: 'right' };
    const nf = (v) => {
      if (v == null || v === '') return '';
      const n = Number(v); if (!Number.isFinite(n)) return String(v);
      const t = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return n < 0 ? <span style={{ color: '#ff0000' }}>({t})</span> : t;
    };
    const pc = (v) => (v == null || v === '' ? '' : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2));
    const colW = [92, 53, 79, 66, 92, 119, 238, 106, 53, 198, 99, 99, 99, 99, 66];
    const typ = (r) => r.simple_type || (simpleType === 'simple_avg' ? 'AVG' : '100');
    const SumRow = ({ label, rows, bg, bold }) => (
      <tr>
        {Array.from({ length: 15 }, (_, i) => {
          const base = { ...bx, background: bg, fontWeight: 700 };
          if (i === 0) return <td key={i} style={base}>{label}</td>;
          if (i >= 10 && i <= 13) return <td key={i} style={{ ...base, textAlign: 'right' }}>{nf(sum(rows, ['paid_amount', 'paid_vat', 'claimed_amount', 'claimed_vat'][i - 10]))}</td>;
          return <td key={i} style={base} />;
        })}
      </tr>
    );
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', border: `1px solid ${RP_BORDER}`, color: '#000' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: colW.reduce((a, b) => a + b, 0) }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              {['Branch', 'Type', 'Receive Date', 'Running No', 'Tax Invoice Date', 'Tax Invoice No', 'Vendor Name', 'Tax ID', 'Branch', 'Item Detail', 'Paid Amount', 'Paid VAT', 'Claim Amount', 'Claim VAT', 'Claim %'].map((h, i) => (
                <th key={i} style={{ ...hd, position: 'sticky', top: 0, zIndex: 2 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <React.Fragment key={g.branch}>
                {g.rows.map((r, i) => (
                  <tr key={r.id ?? i}>
                    <td style={bx}>{g.branch}</td>
                    <td style={bx}>{typ(r)}</td>
                    {cellEd(gi, i, r, 'receive_date', soDate(r.receive_date), bxR)}
                    {cellEd(gi, i, r, 'running_no', r.running_no ?? '', bx)}
                    {cellEd(gi, i, r, 'tax_invoice_date', soDate(r.tax_invoice_date), bxR)}
                    {cellEd(gi, i, r, 'tax_invoice_no', r.tax_invoice_no || '', bx)}
                    {cellEd(gi, i, r, 'vendor_name', r.vendor_name || '', bx)}
                    {cellEd(gi, i, r, 'tax_id', soZero(r.tax_id), bx)}
                    {cellEd(gi, i, r, 'branch_field', soZero(r.branch_field), bx)}
                    {cellEd(gi, i, r, 'item_detail', r.item_detail || '', bx)}
                    {cellEd(gi, i, r, 'paid_amount', nf(r.paid_amount), bxR)}
                    {cellEd(gi, i, r, 'paid_vat', nf(r.paid_vat), bxR)}
                    {cellEd(gi, i, r, 'claimed_amount', nf(r.claimed_amount), bxR)}
                    {cellEd(gi, i, r, 'claimed_vat', nf(r.claimed_vat), bxR)}
                    {cellEd(gi, i, r, 'claim_percent', pc(r.claim_percent), bxR)}
                  </tr>
                ))}
                <SumRow label={`${g.branch} รวมสาขา`} rows={g.rows} bg="#deebf7" />
              </React.Fragment>
            ))}
            <SumRow label="รวมสุทธิ" rows={allRows} bg="#bdd7ee" />
          </tbody>
        </table>
      </div>
    );
  }
"""
rep("""  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', border: `1px solid ${RP_BORDER}`, padding: '14px 16px', color: '#000' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>""", FLAT + """  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', border: `1px solid ${RP_BORDER}`, padding: '14px 16px', color: '#000' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>""")
open(P, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("OK")
