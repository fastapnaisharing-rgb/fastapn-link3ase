# patch_vat_round_status_ui_v2.py -- รันที่โฟลเดอร์ my-app\src\pages
# เปลี่ยน Status ใต้ปุ่ม Confirm (BU ทั้งหมด Active) เป็น Timeline 2 ขั้น: Wait Update (Reset) -> Confirm
import io, shutil, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'VatController.js'
s = io.open(p, encoding='utf-8').read()
if 'MARKER_VATWATCHLIST_ROUND_STATUS_UI_V2' in s:
    print('already patched'); sys.exit(0)
a = "                  const row = { fontSize: '11px', color: '#57606a', whiteSpace: 'nowrap', textAlign: 'right' };\n"
b_end = "                    </div>\n                  );\n                })()}\n"
i = s.index(a)
j = s.index(b_end, i) + len(b_end)
assert s.count(a) == 1
old = s[i:j]
assert "Status : Wait Update" in old and "Status : Confirm" in old and len(old) < 1800, len(old)
new = """                  // MARKER_VATWATCHLIST_ROUND_STATUS_UI_V2 -- Timeline 2 ขั้น: Wait Update -> Confirm (เหลือง = ขั้นปัจจุบัน, เขียว = เสร็จแล้ว, เทา = ยังไม่ถึง)
                  const stepRow = { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '11px', position: 'relative', whiteSpace: 'nowrap' };
                  const dot = (bg, border, ring) => ({ width: '12px', height: '12px', borderRadius: '50%', border: `2px solid ${border}`, background: bg, flexShrink: 0, boxSizing: 'border-box', boxShadow: ring ? `0 0 0 3px ${ring}` : 'none' });
                  const link = { position: 'absolute', left: '5px', top: '-7px', height: '10px', borderLeft: '2px solid #d0d7de' };
                  const pill = (bg, color) => ({ fontSize: '9.5px', padding: '1px 7px', borderRadius: '9px', background: bg, color, fontWeight: 600 });
                  const waitDot = confirmedNow ? dot('#1a7f37', '#1a7f37') : dot('#d4a017', '#d4a017', '#fff4d1');
                  const confDot = confirmedNow ? dot('#1a7f37', '#1a7f37', '#dcf5e3') : dot('#fff', '#d0d7de');
                  return (
                    <div style={{ background: '#fff', border: '1px solid #e3e8ee', borderRadius: '10px', padding: '8px 10px', display: 'flex', flexDirection: 'column' }}>
                      <div style={stepRow}>
                        <span style={waitDot} />
                        <span style={{ fontWeight: 600, width: '78px', color: confirmedNow ? '#8c959f' : '#9a6700' }}>Wait Update</span>
                        <span style={pill(confirmedNow ? '#f1f3f5' : '#fff4d1', confirmedNow ? '#8c959f' : '#9a6700')}>Reset</span>
                        <span style={{ marginLeft: 'auto', color: confirmedNow ? '#8c959f' : '#9a6700', fontWeight: confirmedNow ? 400 : 700 }}>{fmtTs(rs.round_started_at)}</span>
                      </div>
                      <div style={stepRow}>
                        <span style={link} />
                        <span style={confDot} />
                        <span style={{ fontWeight: 600, width: '78px', color: confirmedNow ? '#1a7f37' : '#8c959f' }}>Confirm</span>
                        {confirmedNow ? <span style={pill('#dcf5e3', '#1a7f37')}>Done</span> : null}
                        <span style={{ marginLeft: 'auto', color: confirmedNow ? '#1a7f37' : '#8c959f', fontWeight: confirmedNow ? 700 : 400 }}>{confirmThisRound ? `${fmtTs(rs.confirmed_at)}${rs.confirmed_by ? ` โดย ${rs.confirmed_by}` : ''}` : '—'}</span>
                      </div>
                    </div>
                  );
                })()}
"""
shutil.copy(p, p + '.bak_roundstatus_v2')
s = s[:i] + new + s[j:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK')
