# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_EXCEL_LOOK_FRONT_V20
# หน้า Reconcile (ReportVat_VGR) ใน Preview ให้เหมือนชีตใน Excel ที่ Export + ช่องผู้จัดทำ (Prepare by ของ BU) แก้ได้แล้วบันทึกลง DB
import sys, shutil, os
M = "MARKER_VATRECONCILE_EXCEL_LOOK_FRONT_V20"
P = sys.argv[1] if len(sys.argv) > 1 else "VatReconcileDashboard.js"
raw = open(P, "rb").read(); crlf = b"\r\n" in raw
s = raw.decode("utf-8").replace("\r\n", "\n")
if M in s: sys.exit("skip: already patched")
n = 1
while os.path.exists("%s.bak_before_v20" % P + ("" if n == 1 else str(n))): n += 1
shutil.copy2(P, "%s.bak_before_v20" % P + ("" if n == 1 else str(n)))

def rep(old, new):
    global s
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    s = s.replace(old, new)

# 1) state สำหรับช่อง Prepare by
a0 = s.index("  const [prepVal, setPrepVal] = useState(null);")
b0 = s.index("  };\n", s.index("setPrepVal(v);")) + len("  };\n")
s = s[:a0] + s[b0:]
rep("""  const [exportMsg, setExportMsg] = useState(null); // { ok, text }
""", """  const [exportMsg, setExportMsg] = useState(null); // { ok, text }
  const [prepVal, setPrepVal] = useState(null); // """ + M + """ -- ค่า Prepare by ที่แก้แล้ว (null = ใช้ค่าจาก data.header.preparedBy)
  const [prepEdit, setPrepEdit] = useState(false);
  const [prepDraft, setPrepDraft] = useState('');
  const prepCancel = useRef(false);
  const savePrep = async () => {
    if (prepCancel.current) { prepCancel.current = false; setPrepEdit(false); return; }
    const cur = prepVal != null ? prepVal : (data?.header?.preparedBy || '');
    const next = prepDraft.trim();
    setPrepEdit(false);
    if (next === cur) return;
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/prepared-by`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ bu: state.bu, value: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      setPrepVal(next);
    } catch (err) {
      window.alert(err?.message || 'บันทึกไม่สำเร็จ');
    }
  };
""")

# 2) ลบตัวแปรที่ไม่ใช้แล้ว (กัน no-unused-vars)
a = s.index("  const th = (extra) => ({\n    background: RP_HEAD_GRAD")
b = s.index("  const tdBase = {")
s = s[:a] + s[b:]
a = s.index("  const pill = (ok, text) => (")
b = s.index("  const nPairs = data ?")
s = s[:a] + s[b:]

# 3) Block reconcile ใหม่
start = s.index("          {!loading && !error && data && view === 'reconcile' && (\n            <>\n              <div style={{ textAlign: 'center', lineHeight: 1.6 }}>")
endm = "\n            </>\n          )}\n        </div>\n\n        {/* MARKER_VATRECONCILE_SHEET_TABS_FRONT_V13 -- แถบชีตแบบ Excel (ล่าง) */}"
end = s.index(endm)

NEW = r"""          {!loading && !error && data && view === 'reconcile' && (() => {
            /* MARKER_VATRECONCILE_EXCEL_LOOK_FRONT_V20 -- หน้าตาเหมือนชีต ReportVat_VGR ใน Excel ที่ Export */
            const NAVY = '#002060';
            const BK = '1px solid #000';
            const SHEET_FONT = 'Tahoma, "Segoe UI", sans-serif';
            const hd = { background: NAVY, color: '#fff', fontWeight: 700, textAlign: 'center', border: '1px solid #fff', padding: '6px 6px', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 13 };
            const tdx = { ...tdBase, border: '1px solid #bfbfbf', borderRight: '1px solid #bfbfbf', borderBottom: '1px solid #bfbfbf', padding: '3px 6px', fontSize: 13, fontFamily: SHEET_FONT, background: '#fff' };
            const num = (v) => {
              const n = Number(v) || 0;
              if (Math.abs(n) < 0.005) return <span style={{ display: 'block', textAlign: 'center' }}>-</span>;
              return <span style={{ color: n < 0 ? '#ff5050' : 'inherit' }}>{n < 0 ? `(${rpFmt(-n)})` : rpFmt(n)}</span>;
            };
            const nd = new Date();
            const dd = String(nd.getDate()).padStart(2, '0'); const mm = String(nd.getMonth() + 1).padStart(2, '0');
            const dateDots = `วันที่ ...${dd}…/...${mm}…/...${nd.getFullYear()}...`;
            const prep = prepVal != null ? prepVal : (data.header.preparedBy || '');
            const chk = data.checkDiff.applicable ? (data.checkDiff.unbalance === 0 ? 'Approve Balance' : 'Found Diff in Detail') : (hasDiff ? 'Found Diff' : 'Approve Balance');
            const stTxt = (t) => (t === 'Temporary' ? 'Temp.' : t);
            const colW = [78, 270, ...Array(nPairs * 2).fill(124), 124, 110, 210, 74];
            const totBg = '#deebf7';
            const totTd = { ...tdx, background: totBg, fontWeight: 700, borderTop: BK };
            const sigLine = { fontFamily: SHEET_FONT, fontSize: 13, lineHeight: '24px', whiteSpace: 'nowrap' };
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <input
                    type="text" value={branchQ} onChange={(e) => setBranchQ(e.target.value)} placeholder="ค้นหารหัส/ชื่อสาขา"
                    style={{ padding: '5px 10px', border: `1px solid ${RP_BORDER}`, borderRadius: 6, fontSize: 12.5, width: 220 }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#334155' }}>
                    <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> เฉพาะสาขา Not Balance
                  </label>
                  <span style={{ color: '#57606a' }}>แสดง {shownRows.length} / {data.rows.length} สาขา (Total คิดจากทุกสาขา)</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {cards.map(([k, v]) => (
                    <div key={k} style={{ border: `1px solid ${RP_BORDER}`, borderRadius: 8, padding: '3px 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 11, color: '#57606a' }}>{k}</span>
                      <b style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: (k === 'Diff' || k.startsWith('Diff (')) && Number(String(v).replace(/,/g, '')) !== 0 ? '#cf222e' : '#24292f' }}>{v}</b>
                    </div>
                  ))}
                </div>
                {data.overCount > 0 && (
                  <div style={{ margin: '0 0 8px', padding: '6px 12px', borderRadius: 8, background: '#ffe5e5', color: '#cf222e', fontSize: 12.5, fontWeight: 600 }}>
                    ⚠ Over Period {data.overCount} รายการ ใน {data.rows.filter((r) => r.overCount > 0).length} สาขา (Tax Invoice Date เป็นเดือนหลังเดือน {data.header.periodLabel}) — กดไอคอนในช่อง Remark เพื่อดู Detail
                  </div>
                )}
                {data.futureCount > 0 && (
                  <div style={{ margin: '0 0 8px', padding: '6px 12px', borderRadius: 8, background: '#fff3cd', color: '#856404', fontSize: 12.5, fontWeight: 600 }}>
                    ⚠ พบ Future Date {data.futureCount} รายการ ใน {data.rows.filter((r) => r.futureCount > 0).length} สาขา (Receive Date น้อยกว่า Tax Invoice Date) — กดไอคอนในช่อง Remark เพื่อดูรายการ
                  </div>
                )}
                <div style={{ border: `1px solid ${RP_BORDER}`, overflow: 'auto', flex: expanded ? '1 1 0' : '0 0 auto', minHeight: expanded ? 200 : 0, maxHeight: expanded ? 'none' : '62vh', background: '#fff', fontFamily: SHEET_FONT, color: '#000' }}>
                  <div style={{ minWidth: colW.reduce((a, b) => a + b, 0) }}>
                    <div style={{ textAlign: 'center', fontSize: 13, lineHeight: '21px', padding: '6px 0 0' }}>
                      <div>{data.header.title}</div>
                      <div>{data.header.company}</div>
                      {data.header.taxId && <div>เลขประจำตัวผู้เสียภาษี &nbsp;&nbsp;&nbsp; {data.header.taxId}</div>}
                      <div>ประจำเดือน {data.header.periodLabel}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '8px 4px 4px', fontSize: 13 }}>
                      <span>{data.account}</span>
                      {chk && (
                        <span style={{ padding: '2px 14px', fontWeight: 700, border: '1px solid #bfbfbf', background: data.checkDiff.unbalance === 0 ? '#ccffcc' : '#ff5050', color: data.checkDiff.unbalance === 0 ? '#0070c0' : NAVY }}>
                          Check Diff: {chk}{data.checkDiff.unbalance ? ` (${data.checkDiff.unbalance})` : ''}
                        </span>
                      )}
                    </div>
                    <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: colW.reduce((a, b) => a + b, 0), fontVariantNumeric: 'tabular-nums' }}>
                      <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                      <thead>
                        <tr>
                          <th rowSpan={2} style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>รหัสสาขา</th>
                          <th rowSpan={2} style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>สาขา</th>
                          {data.pairLabels.map((p) => <th key={p} colSpan={2} style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>{p}</th>)}
                          <th style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>ภาษีตาม T/B</th>
                          <th rowSpan={2} style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>ผลต่าง</th>
                          <th rowSpan={2} style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>Remark</th>
                          <th rowSpan={2} style={{ ...hd, position: 'sticky', top: 0, zIndex: 3 }}>Status</th>
                        </tr>
                        <tr>
                          {data.pairLabels.map((p) => (
                            <React.Fragment key={p}>
                              <th style={{ ...hd, top: 35, position: 'sticky', zIndex: 3, fontWeight: 500 }}>มูลค่า</th>
                              <th style={{ ...hd, top: 35, position: 'sticky', zIndex: 3, fontWeight: 500 }}>ภาษี</th>
                            </React.Fragment>
                          ))}
                          <th style={{ ...hd, top: 35, position: 'sticky', zIndex: 3, fontWeight: 500 }}>{data.tbLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownRows.length === 0 && (
                          <tr><td colSpan={2 + nPairs * 2 + 4} style={{ ...tdx, textAlign: 'center', color: '#999', padding: '24px 4px' }}>ไม่พบข้อมูลของ BU / Account / Period นี้</td></tr>
                        )}
                        {shownRows.map((r) => {
                          const ok = r.status === 'ตรงกัน';
                          const hasFuture = (r.futureCount || 0) > 0; // MARKER_VATRECONCILE_DRILLDOWN_V1
                          const hasOver = (r.overCount || 0) > 0;
                          const closed = r.branchStatus === 'Closed';
                          const rowTx = r.branchMissing ? { background: '#ffd6d6' } : closed ? { color: '#ff0000' } : {};
                          return (
                            <tr key={r.branch} title={r.branchMissing ? 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export' : undefined}>
                              <td style={{ ...tdx, ...rowTx, textAlign: 'left' }}>{r.branch}</td>
                              <td style={{ ...tdx, ...rowTx, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
                              {r.pairs.map((p, i) => (
                                <React.Fragment key={i}>
                                  <td style={{ ...tdx, ...rowTx }}>{cell(p[0])}</td>
                                  <td style={{ ...tdx, ...rowTx }}>{cell(p[1])}</td>
                                </React.Fragment>
                              ))}
                              <td style={{ ...tdx, ...rowTx }}>{cell(r.tb)}</td>
                              <td style={{ ...tdx, ...rowTx, color: ok ? rowTx.color : '#cf222e', fontWeight: ok ? 400 : 700 }}>{num(r.diff)}</td>
                              <td style={{ ...tdx, ...rowTx, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                {/* MARKER_VATRECONCILE_SINGLE_NOTICE_ICON_V9 -- ไอคอนเดียว: Detail (ปกติ) / Notice (มีปัญหา) อยู่ในช่อง Remark */}
                                {(() => {
                                  const issues = [
                                    r.branchMissing && 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export', // MARKER_VATRECONCILE_BRANCH_MISSING_FRONT_V10
                                    !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,
                                    hasOver && `Over Period ${r.overCount} รายการ (เดือนของ Tax Invoice Date เกินเดือน Period)`,
                                    hasFuture && `Future Date ${r.futureCount} รายการ (Receive Date น้อยกว่า Tax Invoice Date)`,
                                  ].filter(Boolean);
                                  const has = issues.length > 0;
                                  const severe = !ok || hasOver || r.branchMissing;
                                  const col = !has ? '#0969da' : severe ? '#cf222e' : '#856404';
                                  return (
                                    <button type="button" aria-label={has ? 'มี Notice ดู Detail' : 'ดู Detail'}
                                      title={has ? issues.join('\n') + '\n(กดเพื่อดู Detail)' : 'ดู Detail (Input Summary) ของสาขานี้'}
                                      onClick={() => goView('input', r.branch)}
                                      style={{ position: 'relative', verticalAlign: 'middle', width: 22, height: 22, padding: 0, borderRadius: 5, cursor: 'pointer', border: `1px solid ${!has ? '#0969da' : severe ? '#f1a9a9' : '#e8d48a'}`, background: !has ? '#fff' : severe ? '#ffe5e5' : '#fff3cd', color: col, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                      {has ? (
                                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3.2M8 11.6v.1" /></svg>
                                      ) : (
                                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5.5h6M5 8h6M5 10.5h4" /></svg>
                                      )}
                                      {issues.length > 1 && (
                                        <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, background: '#cf222e', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '14px', textAlign: 'center' }}>{issues.length}</span>
                                      )}
                                    </button>
                                  );
                                })()}
                              </td>
                              <td style={{ ...tdx, ...rowTx, textAlign: 'center', whiteSpace: 'nowrap', padding: '3px 2px' }} title={r.inactiveDate ? `Inactive Date: ${r.inactiveDate}` : ''}>
                                {r.branchStatus ? (
                                  <span style={{ display: 'block', padding: '1px 4px', fontWeight: 600, ...(RP_BRANCH_STATUS[r.branchStatus] || { background: '#f1efe8', color: '#444441' }) }}>{stTxt(r.branchStatus)}</span>
                                ) : <span style={{ color: '#9aa4b2' }}>-</span>}
                              </td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td colSpan={2} style={{ ...totTd, textAlign: 'left', position: 'sticky', bottom: 0 }}>Total</td>
                          {data.totals.pairs.map((p, i) => (
                            <React.Fragment key={i}>
                              <td style={{ ...totTd, position: 'sticky', bottom: 0 }}>{num(p[0])}</td>
                              <td style={{ ...totTd, position: 'sticky', bottom: 0 }}>{num(p[1])}</td>
                            </React.Fragment>
                          ))}
                          <td style={{ ...totTd, position: 'sticky', bottom: 0 }}>{num(data.totals.tb)}</td>
                          <td
                            onClick={Math.abs(data.totals.diff) > 0.005 ? () => goView('input', '', true) : undefined}
                            title={Math.abs(data.totals.diff) > 0.005 ? 'กดเพื่อดู Detail ทุกสาขา' : undefined}
                            style={{ ...totTd, position: 'sticky', bottom: 0, color: Math.abs(data.totals.diff) > 0.005 ? '#cf222e' : 'inherit', cursor: Math.abs(data.totals.diff) > 0.005 ? 'pointer' : 'default', textDecoration: Math.abs(data.totals.diff) > 0.005 ? 'underline' : 'none' }}
                          >{num(data.totals.diff)}</td>
                          <td style={{ ...totTd, position: 'sticky', bottom: 0 }} />
                          <td style={{ ...totTd, position: 'sticky', bottom: 0 }} />
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '14px 8px 18px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={sigLine}>
                          ผู้จัดทำ :{' '}
                          {prepEdit ? (
                            <input autoFocus value={prepDraft} onChange={(e) => setPrepDraft(e.target.value)} onBlur={savePrep}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePrep(); } else if (e.key === 'Escape') { prepCancel.current = true; setPrepEdit(false); } }}
                              style={{ font: 'inherit', width: 220, padding: '1px 4px', border: '2px solid #1a7f37', outline: 'none' }} />
                          ) : (
                            <span
                              title={data.header.preparedByEditable ? 'ดับเบิลคลิกเพื่อแก้ไข (บันทึกลง DB ของ BU นี้)' : 'ไม่พบคอลัมน์ Prepare by ใน company_list / vat_setting ของ BU นี้'}
                              onDoubleClick={() => { if (!data.header.preparedByEditable) return; prepCancel.current = false; setPrepDraft(prep); setPrepEdit(true); }}
                              style={{ cursor: data.header.preparedByEditable ? 'text' : 'default', borderBottom: data.header.preparedByEditable ? '1px dotted #888' : 'none', minWidth: 80, display: 'inline-block' }}>
                              {prep || ' '}
                            </span>
                          )}
                        </div>
                        <div style={sigLine}>{dateDots}</div>
                        <div style={{ height: 24 }} />
                        <div style={sigLine}>ผู้ตรวจสอบ &nbsp;: ......................................</div>
                        <div style={sigLine}>{dateDots}</div>
                      </div>
                      <div>
                        <div style={sigLine}>ผู้อนุมัติ..............................................ผู้จัดการฝ่ายบัญชี</div>
                        <div style={sigLine}>{dateDots}</div>
                        <div style={{ height: 24 }} />
                        <div style={sigLine}>ผู้รับ........................................เจ้าหน้าที่ &nbsp;TAX</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}"""
# ตัด JSX เดิมออก: start..(end ก่อน "\n        </div>\n\n        {/* MARKER_..SHEET_TABS")
tail_start = end + len("\n            </>\n          )}")
s = s[:start] + NEW + s[tail_start:]
open(P, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("OK")
