# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13
# Popup Preview: แถบชีตด้านล่างแบบ Excel  Cover | ReportVat_VGR | Detail | TB | Pivot | Simple  (ตรงกับชีตในไฟล์ Export)
#   Cover / Pivot คำนวณจากข้อมูลที่โหลดแล้ว · TB โหลดจาก type=tb · Detail/Simple ใช้ของเดิม
# ใช้: python patch_vatreconcile_sheet_tabs_front_v13.py <path src\pages\VatReconcileDashboard.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13"
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

s = rp(s, "const tabKey = (v, b) => (v === 'simple' ? `simple|${b}` : `input|${b || ''}`);",
       "const tabKey = (v, b) => (v === 'simple' ? `simple|${b}` : v === 'tb' ? 'tb|' : `input|${b || ''}`); // " + MARKER, "tabKey")
s = rp(s, "    if (v === 'reconcile') return;\n", "    if (v === 'reconcile' || v === 'cover' || v === 'pivot') return; // " + MARKER + "\n", "goView local")
s = rp(s, "    const type = v === 'input' ? 'input_summary' : simpleType;\n", "    const type = v === 'input' ? 'input_summary' : v === 'tb' ? 'tb' : simpleType;\n", "goView type")
s = rp(s, "  const curTab = view === 'reconcile' ? null : tabData[tabKey(view, selBranch)];\n",
       "  const isLocalView = view === 'reconcile' || view === 'cover' || view === 'pivot';\n  const curTab = isLocalView ? null : tabData[tabKey(view, selBranch)];\n", "curTab")
s = rp(s, "overflowY: view === 'reconcile' ? 'auto' : 'hidden'", "overflowY: isLocalView ? 'auto' : 'hidden'", "overflowY")
s = rp(s, "        {!loading && !error && data && view !== 'reconcile' && (\n          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px 0'",
       "        {!loading && !error && data && (view === 'input' || view === 'simple') && (\n          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px 0'", "topbar cond")
s = rp(s, "          {!loading && !error && data && view !== 'reconcile' && (\n            <>\n              {view === 'input' && !selBranch",
       "          {!loading && !error && data && (view === 'input' || view === 'simple' || view === 'tb') && (\n            <>\n              {view === 'input' && !selBranch", "detail cond")

LOCAL = r'''          {/* MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13 -- ชีต Cover */}
          {!loading && !error && data && view === 'cover' && (() => {
            const cv = data.cover;
            const rowsC = [[`Detail ${data.account}`, cv.perTb, cv.perDetail, cv.diff]];
            if (cv.finCredit != null) rowsC.push(['Detail of FinCredit 46250', null, null, cv.finCredit]);
            const cb = '1px solid #d9d9d9';
            const hc = { background: '#002060', color: '#fff', fontWeight: 700, padding: '5px 10px', borderTop: cb, borderLeft: cb, borderRight: cb };
            const nc = (v) => <span style={{ color: Number(v) < 0 ? '#ff0000' : 'inherit' }}>{v == null ? '' : rpFmt(v)}</span>;
            return (
              <div style={{ border: '2px solid #bfbfbf', maxWidth: 900, background: '#fff', fontSize: 13 }}>
                <div style={{ background: '#002060', color: '#fff', fontWeight: 700, textAlign: 'center', padding: '4px 0' }}>DETAIL OF ACCOUNT</div>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 2, padding: '14px 12px', borderBottom: '2px solid #bfbfbf' }}>
                  <b>Company</b><span>{data.buCode?.numeric ? `${data.buCode.numeric} ` : ''}{data.header.companyEn || data.header.company}</span>
                  <b>Branch</b><span>{data.rows.length ? `${data.rows[0].branch}-${data.rows[data.rows.length - 1].branch}` : ''} {data.header.companyEn || data.header.company}</span>
                  <b>Account code</b><span>{data.account}</span>
                  <b>Account name</b><span>{data.accountName}</span>
                  <b>Period</b><span>{periodLabel}</span>
                </div>
                <div style={{ padding: '12px 12px 16px' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
                    <thead><tr>
                      <th style={{ ...hc, textAlign: 'left' }}>By CPC</th>
                      <th style={{ ...hc, textAlign: 'center' }}>Per TB</th><th style={{ ...hc, textAlign: 'center' }}>Per Detail</th>
                      <th style={{ ...hc, textAlign: 'center' }}>Diff</th><th style={{ ...hc, textAlign: 'left' }}>Remark</th>
                    </tr></thead>
                    <tbody>
                      {rowsC.map((r) => (
                        <tr key={r[0]}>
                          <td style={{ padding: '14px 10px', borderLeft: cb }}>{r[0]}</td>
                          <td style={{ padding: '14px 10px', textAlign: 'right', borderLeft: cb, borderRight: cb }}>{nc(r[1])}</td>
                          <td style={{ padding: '14px 10px', textAlign: 'right', borderRight: cb }}>{nc(r[2])}</td>
                          <td style={{ padding: '14px 10px', textAlign: 'right', borderRight: cb }}>{nc(r[3])}</td>
                          <td style={{ borderRight: cb }} />
                        </tr>
                      ))}
                      <tr style={{ background: '#9dc3e6', fontWeight: 700, borderTop: '1px solid #000', borderBottom: '2px solid #000' }}>
                        <td style={{ padding: '5px 10px' }}>Diff</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{nc(cv.perTb)}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{nc(cv.perDetail)}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{nc(cv.coverDiff)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          {/* ชีต Pivot (สรุปตามสาขา จาก Input-N 100%) */}
          {!loading && !error && data && view === 'pivot' && (
            <div style={{ border: `1px solid ${RP_BORDER}`, borderRadius: 8, overflow: 'auto', flex: '1 1 0', minHeight: 200 }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                <thead><tr>
                  {['สาขา', 'ชื่อผู้ประกอบการ', 'Sum of ภาษีซื้อที่ชำระ(มูลค่าสินค้า)', 'Sum of ภาษีซื้อที่ชำระ(เงินภาษี)'].map((h) => (
                    <th key={h} style={{ background: '#f2f2f2', color: '#002060', padding: '6px 8px', border: `1px solid ${RP_BORDER}`, position: 'sticky', top: 0 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.rows.filter((r) => r.pairs[0][0] || r.pairs[0][1]).map((r) => (
                    <tr key={r.branch}>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}` }}>{r.branch}</td>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}` }}>{r.name}</td>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(r.pairs[0][0])}</td>
                      <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(r.pairs[0][1])}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#ffccff', fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}` }}>Grand Total</td>
                    <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(data.totals.pairs[0][0])}</td>
                    <td style={{ padding: '5px 8px', border: `1px solid ${RP_BORDER}`, textAlign: 'right' }}>{rpFmt(data.totals.pairs[0][1])}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
'''
anchor = "          {!loading && !error && data && view === 'reconcile' && (\n"
s = rp(s, anchor, LOCAL + anchor, "insert local views")

BAR = r'''        {/* MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13 -- แถบชีตแบบ Excel (ล่าง) */}
        {!loading && !error && data && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 14px', background: '#f3f3f3', borderTop: `1px solid ${RP_BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
            {[
              ['cover', 'Cover'],
              ['reconcile', data.sheet || 'ReportVat_VGR'],
              ['input', data.template === 'avg' ? 'A-Detail' : 'Detail'],
              ['tb', 'TB'],
              ...(data.template === 'avg' ? [] : [['pivot', 'Pivot']]),
              ...(simpleType ? [['simple', simpleType === 'simple_avg' ? 'Simple AVG' : 'Simple Excel BU']] : []),
            ].map(([k, label]) => {
              const on = view === k;
              return (
                <button key={k} type="button" onClick={() => goView(k, k === 'input' ? selBranch : undefined, k === 'input' && data.rows.length <= 30)}
                  style={{ padding: '6px 16px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', borderTop: on ? '2px solid #1a7f37' : '2px solid transparent', background: on ? '#fff' : 'transparent', color: on ? '#1a7f37' : '#475569' }}>
                  {label}
                </button>
              );
            })}
          </div>
        )}

'''
foot = "        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '10px 18px', borderTop: `1px solid ${RP_BORDER}`, flexShrink: 0 }}>\n"
s = rp(s, foot, BAR + foot, "insert bar")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copy2(path, f"{path}.bak{n:02d}")
open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
