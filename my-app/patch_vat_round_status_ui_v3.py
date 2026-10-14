# patch_vat_round_status_ui_v3.py -- รันที่โฟลเดอร์ my-app\src\pages  (ปรับดีไซน์การ์ด Status ใต้ปุ่ม Confirm)
import io, shutil, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'VatController.js'
s = io.open(p, encoding='utf-8').read()
if 'MARKER_VATWATCHLIST_ROUND_STATUS_UI_V3' in s:
    print('already patched'); sys.exit(0)
start_marker = "                  // MARKER_VATWATCHLIST_ROUND_STATUS_UI_V2"
end_marker = "                    </div>\n                  );\n                })()}\n"
assert s.count(start_marker) == 1
i = s.index(start_marker)
j = s.index(end_marker, i) + len(end_marker)
old = s[i:j]
assert "Wait Update" in old and len(old) < 4000, len(old)
new = """                  // MARKER_VATWATCHLIST_ROUND_STATUS_UI_V3 -- การ์ด Round Status: Stepper แนวตั้ง 2 ขั้น (Wait Update -> Confirm) + Badge สถานะ
                  const fmtParts = (v) => { const t = fmtTs(v); if (t === '-') return null; const [d, tm] = t.split(' '); return { d, tm }; };
                  const startP = fmtParts(rs.round_started_at);
                  const confP = confirmThisRound ? fmtParts(rs.confirmed_at) : null;
                  const C = { amber: '#b7791f', amberBg: '#fff6dd', amberRing: '#ffe9a8', green: '#1a7f37', greenBg: '#e3f6e8', greenRing: '#c8ecd3', gray: '#8c959f', line: '#d9dee5', ink: '#24292f' };
                  const circle = (state) => ({ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, lineHeight: 1, boxSizing: 'border-box', zIndex: 1,
                    ...(state === 'done' ? { background: C.green, color: '#fff', border: `2px solid ${C.green}` } : state === 'active' ? { background: '#fff', color: C.amber, border: `2px solid ${C.amber}`, boxShadow: `0 0 0 4px ${C.amberRing}` } : { background: '#fff', color: C.gray, border: `2px dashed ${C.line}` }) });
                  const waitState = confirmedNow ? 'done' : 'active';
                  const confState = confirmedNow ? 'done' : 'idle';
                  const stepWrap = { display: 'grid', gridTemplateColumns: '22px 1fr auto', columnGap: '10px', alignItems: 'center', position: 'relative' };
                  const tm = (pp, color, bold) => (pp ? (<div style={{ textAlign: 'right', lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}><div style={{ fontSize: '12px', fontWeight: bold ? 700 : 500, color }}>{pp.d}</div><div style={{ fontSize: '10.5px', color: C.gray }}>{pp.tm} น.</div></div>) : (<div style={{ fontSize: '12px', color: C.gray }}>—</div>));
                  return (
                    <div style={{ width: '268px', boxSizing: 'border-box', background: 'linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)', border: '1px solid #e3e8ee', borderRadius: '14px', padding: '10px 14px 12px', boxShadow: '0 1px 2px rgba(16,24,40,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '9.5px', letterSpacing: '0.08em', fontWeight: 700, color: C.gray }}>ROUND STATUS</span>
                        <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 9px', borderRadius: '999px', background: confirmedNow ? C.greenBg : C.amberBg, color: confirmedNow ? C.green : C.amber }}>{confirmedNow ? 'Confirm แล้ว' : 'รออัปเดต'}</span>
                      </div>
                      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ position: 'absolute', left: '10px', top: '14px', bottom: '14px', width: '2px', background: confirmedNow ? C.green : C.line, borderRadius: '2px' }} />
                        <div style={stepWrap}>
                          <span style={circle(waitState)}>{confirmedNow ? '✓' : '●'}</span>
                          <div>
                            <div style={{ fontSize: '12.5px', fontWeight: 700, color: confirmedNow ? C.ink : C.amber }}>Wait Update</div>
                            <div style={{ fontSize: '10.5px', color: C.gray }}>Reset รอบใหม่</div>
                          </div>
                          {tm(startP, confirmedNow ? C.ink : C.amber, !confirmedNow)}
                        </div>
                        <div style={stepWrap}>
                          <span style={circle(confState)}>{confirmedNow ? '✓' : ''}</span>
                          <div>
                            <div style={{ fontSize: '12.5px', fontWeight: 700, color: confirmedNow ? C.green : C.gray }}>Confirm</div>
                            <div style={{ fontSize: '10.5px', color: C.gray }}>{confirmThisRound ? (rs.confirmed_by ? `โดย ${rs.confirmed_by}` : 'ยืนยันแล้ว') : (donutPct < 95 ? 'รอ Upload ถึง 95%' : 'พร้อม Confirm')}</div>
                          </div>
                          {tm(confP, C.green, true)}
                        </div>
                      </div>
                    </div>
                  );
                })()}
"""
# ปุ่ม Confirm ให้กว้างเท่าการ์ด + ไอคอนสถานะ
b_old = "style={{ padding: '9px 16px', fontSize: '12px', border: 'none', borderRadius: '8px', background: donutPct < 95 ? '#b8bfc7' : '#1a3a5c', color: 'white', cursor: donutPct < 95 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>Confirm ว่า Data ครบแล้ว</button>"
b_new = "style={{ width: '268px', padding: '10px 16px', fontSize: '12.5px', fontWeight: 600, border: 'none', borderRadius: '10px', background: donutPct < 95 ? '#b8bfc7' : '#1a3a5c', color: 'white', cursor: donutPct < 95 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', boxShadow: donutPct < 95 ? 'none' : '0 2px 6px rgba(26,58,92,0.28)' }}>{donutPct < 95 ? '🔒 ' : '✓ '}Confirm ว่า Data ครบแล้ว</button>"
assert s.count(b_old) == 1, s.count(b_old)
shutil.copy(p, p + '.bak_roundstatus_v3')
s = s[:i] + new + s[j:]
s = s.replace(b_old, b_new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK')
