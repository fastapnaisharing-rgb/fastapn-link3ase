# -*- coding: utf-8 -*-
# patch_vatcontroller_gl_adjust_diff_adi.py
# GL-TransferVat: Adjust Diff by ADI (ปุ่ม Adjust + ⚙ Config -> Tab ③ + Monitor Segment All + สถานะ Manual + Draft ADI)
import sys, io, shutil
P = r'src\pages\VatController.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_VATCONTROLLER_GL_ADJUST_DIFF_ADI_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)

def rep1(old, new, label):
    global s
    c = s.count(old)
    assert c == 1, '%s: anchor count=%d' % (label, c)
    s = s.replace(old, new)

# ---------- A) State ----------
anchor = "  const [qaGlTab, setQaGlTab] = React.useState(1);"
i = s.index(anchor); j = s.index('\n', i)
assert s.count(anchor) == 1
s = s[:j+1] + (
"  const [qaGlAdj, setQaGlAdj] = React.useState(null); // " + MARK + " -- Adjust ที่ยืนยันแล้ว { dr, cr, total, cover, remark }\n"
"  const [qaGlAdjDraft, setQaGlAdjDraft] = React.useState(null); // ฉบับร่างที่กำลังแก้ใน Tab ③\n"
"  const [qaGlAdjAsk, setQaGlAdjAsk] = React.useState(false); // Dialog ถามเรื่อง Simple\n"
) + s[j+1:]

# reset on close list
rep1("setQaGlOpen(false); setQaGlSimpleCond('auto'); setQaGlAdi('auto'); setQaGlSupplierSearch('');",
     "setQaGlOpen(false); setQaGlSimpleCond('auto'); setQaGlAdi('auto'); setQaGlAdj(null); setQaGlAdjDraft(null); setQaGlAdjAsk(false); setQaGlSupplierSearch('');", 'reset-close')
# reset on open
rep1("    setQaGlTab(1); setQaGlTivList([]); setQaGlAmt('');",
     "    setQaGlTab(1); setQaGlAdj(null); setQaGlAdjDraft(null); setQaGlAdjAsk(false); setQaGlTivList([]); setQaGlAmt('');", 'reset-open')

# ---------- B) Simple standby ----------
rep1("const qaGlSimOf = (it) => (qaGlSimpleCond === 'auto' ? ", "const qaGlSimOf = (it) => ((qaGlSimpleCond === 'auto' || qaGlSimpleCond === 'standby') ? ", 'simof')

# ---------- C) Totals ----------
rep1("    return { invG, invV, sg, sv, dg, dv, ok: qaGlAllItems.length > 0 && Math.abs(dg) <= 1 && Math.abs(dv) <= 1 };\n  }, [quickActionRows, qaGlAllItems]);",
"""    const hasI = qaGlAllItems.length > 0; // MARKER_VATCONTROLLER_GL_ADJUST_DIFF_ADI_V1 -- มี Adjust: ยอด Vat ที่เหลือต้องเท่ายอดที่ Adjust (ไม่บังคับต้องมีใบกำกับ)
    const okG = hasI ? Math.abs(dg) <= 1 : !!qaGlAdj;
    const okV = qaGlAdj ? Math.abs(roundMoney2(dv - qaGlAdj.cover)) <= 1 : Math.abs(dv) <= 1;
    return { invG, invV, sg, sv, dg, dv, ok: (hasI || !!qaGlAdj) && okG && okV };
  }, [quickActionRows, qaGlAllItems, qaGlAdj]);""", 'totals')

# ---------- E) Helpers ----------
helpers = r"""  // MARKER_VATCONTROLLER_GL_ADJUST_DIFF_ADI_V1 -- Adjust Diff by ADI: คู่โอนภาษี (11610752/11630052, Asset 11610755/11630055) ยอด = Diff Vat / เฉลี่ย (Rate BU < 100) แยกแถว 45700/63050000 เฉพาะกรณีเฉลี่ยจริง
  const qaGlAdjRate = () => parseFloat(bu?.['VAT %']);
  const qaGlAdjCanAvg = () => { const r = qaGlAdjRate(); return isFinite(r) && r < 100; };
  const qaGlAdjNewId = () => `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const qaGlAdjMoney = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const qaGlAdjMain = (rows, total) => roundMoney2(total - rows.filter((x) => x.k !== 'main').reduce((a, x) => a + qaGlAdjMoney(x.amt), 0));
  const qaGlAdjMk = (k, ofin, cpc, acc, sub, amt) => ({ k, id: qaGlAdjNewId(), ofin: ofin || '', cpc: cpc || '', acc: acc || '', sub: sub || '', amt: amt == null ? '' : amt });
  const qaGlAdjBuild = () => {
    const dv = qaGlTotals.dv; const dvAbs = roundMoney2(Math.abs(dv));
    if (!(dvAbs > 0)) return null;
    const neg = dv < 0; const rate = qaGlAdjRate();
    const assetAvg = qaGlGroupCls === 'T' && qaGlAdjCanAvg();
    const total = assetAvg ? roundMoney2(dvAbs * rate / 100) : dvAbs;
    const avg = qaGlGroupCls === 'A' && qaGlAdjCanAvg();
    const nonRecov = avg ? roundMoney2(total - roundMoney2(total * rate / 100)) : 0;
    const taxRows = [qaGlAdjMk('main', qaGlBranchDr, qaGlCpcDr, qaGlAccDr, qaGlSubDr)];
    if (avg && nonRecov > 0) taxRows.push(qaGlAdjMk('avg', qaGlBranchDr, '45700', '63050000', qaGlSubDr, nonRecov));
    const invRows = [qaGlAdjMk('main', qaGlBranchCr, qaGlCpcCr, qaGlAccCr, qaGlSubCr)];
    return { total, cover: dv, neg, dr: neg ? invRows : taxRows, cr: neg ? taxRows : invRows, remark: '' };
  };
  const qaGlAdjFlat = (d) => {
    const out = []; if (!d) return out;
    [['dr', 'Dr'], ['cr', 'Cr']].forEach(([key, side]) => {
      const main = d[key].find((x) => x.k === 'main') || {};
      d[key].forEach((x) => {
        if (x.k === 'avg' && !(qaGlAdjMoney(x.amt) > 0)) return;
        out.push({ side, kind: x.k, ofin: String((x.k === 'avg' ? main.ofin : x.ofin) || '').trim(), cpc: String(x.cpc || '').trim(), acc: String(x.acc || '').trim(), sub: String((x.k === 'avg' ? main.sub : x.sub) || '').trim(), amt: x.k === 'main' ? qaGlAdjMain(d[key], d.total) : roundMoney2(qaGlAdjMoney(x.amt)) });
      });
    });
    return out;
  };
  const qaGlAdjUpd = (key, id, patch) => setQaGlAdjDraft((d) => (d ? { ...d, [key]: d[key].map((x) => (x.id === id ? { ...x, ...patch } : x)) } : d));
  const qaGlAdjAddRow = (key) => setQaGlAdjDraft((d) => (d ? { ...d, [key]: [...d[key], qaGlAdjMk('add', '', d[key][0]?.cpc, d[key][0]?.acc, d[key][0]?.sub, '')] } : d));
  const qaGlAdjDelRow = (key, id) => setQaGlAdjDraft((d) => (d ? { ...d, [key]: d[key].filter((x) => x.id !== id) } : d));
  const qaGlAdjCalAvg = (key) => setQaGlAdjDraft((d) => {
    if (!d || !qaGlAdjCanAvg()) return d;
    const rows = d[key]; if (rows.some((x) => x.k === 'avg')) return d;
    const rate = qaGlAdjRate(); const mainAmt = qaGlAdjMain(rows, d.total);
    const nonRecov = roundMoney2(mainAmt - roundMoney2(mainAmt * rate / 100));
    if (!(nonRecov > 0)) return d;
    return { ...d, [key]: [...rows, qaGlAdjMk('avg', '', '45700', '63050000', '', nonRecov)] };
  });
  const qaGlAdjQuick = async () => { // ปุ่ม Adjust: คู่เดียวจบ ยอด = Diff Vat
    const d = qaGlAdjBuild();
    if (!d) { await confirmDialog.alert('ไม่มีส่วนต่าง Vat ให้ Adjust (Diff Vat = 0)', { title: 'Adjust Diff by ADI', variant: 'danger' }); return; }
    setQaGlAdjDraft(d); setQaGlAdjAsk(true);
  };
  const qaGlAdjOpenCfg = async () => { // ⚙ Config: เปิด Tab ③
    const d = qaGlAdj ? JSON.parse(JSON.stringify(qaGlAdj)) : qaGlAdjBuild();
    if (!d) { await confirmDialog.alert('ไม่มีส่วนต่าง Vat ให้ Adjust (Diff Vat = 0)', { title: 'Adjust Diff by ADI', variant: 'danger' }); return; }
    setQaGlAdjDraft(d); setQaGlTab(3);
  };
  const qaGlAdjSubmit = async () => {
    const d = qaGlAdjDraft; if (!d) return;
    const flat = qaGlAdjFlat(d);
    for (const x of flat) {
      if (!x.ofin || !x.acc) { await confirmDialog.alert('กรุณากรอก Ofin Code และ Account ให้ครบทุกแถว', { title: 'Config Adjust', variant: 'danger' }); return; }
      if (x.kind === 'add' && !(x.amt > 0)) { await confirmDialog.alert('แถวที่เพิ่มต้องกรอกยอดมากกว่า 0', { title: 'Config Adjust', variant: 'danger' }); return; }
      if (x.kind === 'main' && x.amt < 0) { await confirmDialog.alert('ยอดรวมแถวที่เพิ่มเกินยอดที่ Adjust (แถวแรกติดลบ) กรุณาปรับยอดก่อน', { title: 'Config Adjust', variant: 'danger' }); return; }
    }
    const sDr = roundMoney2(flat.filter((x) => x.side === 'Dr').reduce((a, x) => a + x.amt, 0));
    const sCr = roundMoney2(flat.filter((x) => x.side === 'Cr').reduce((a, x) => a + x.amt, 0));
    if (Math.abs(sDr - sCr) >= 0.005) { await confirmDialog.alert(`ยอด Dr. (${sDr.toLocaleString(undefined, { minimumFractionDigits: 2 })}) ไม่เท่ายอด Cr. (${sCr.toLocaleString(undefined, { minimumFractionDigits: 2 })})`, { title: 'Config Adjust', variant: 'danger' }); return; }
    setQaGlAdjAsk(true);
  };
  const qaGlAdjApply = (keepSimple) => {
    if (!qaGlAdjDraft) { setQaGlAdjAsk(false); return; }
    setQaGlAdj(JSON.parse(JSON.stringify(qaGlAdjDraft)));
    if (!keepSimple) setQaGlSimpleCond('standby'); else if (qaGlSimpleCond === 'standby') setQaGlSimpleCond('auto');
    setQaGlAdjAsk(false); setQaGlTab(1);
  };
  const qaGlAdjUndo = () => { setQaGlAdj(null); setQaGlAdjDraft(null); if (qaGlSimpleCond === 'standby') setQaGlSimpleCond('auto'); };
"""
rep1("  const handleQaGlAdd = async () => {", helpers + "  const handleQaGlAdd = async () => {", 'helpers')

# ---------- F) Save handler ----------
rep1("if (qaGlAllItems.length === 0) missing.push('ใบกำกับภาษี (TIV number / Tax invoice Date / Amount)');",
     "if (qaGlAllItems.length === 0 && !qaGlAdj) missing.push('ใบกำกับภาษี (TIV number / Tax invoice Date / Amount) หรือ Adjust Diff by ADI');", 'missing')
rep1("        // Simple Input -- 1 Record ต่อ 1 ใบกำกับภาษี",
     "        if (qaGlSimpleCond === 'standby') continue; // " + MARK + " -- ไม่ยึดตามระบบ: Simple เป็น Standby (Null) ไม่ส่ง Simple Input Draft\n        // Simple Input -- 1 Record ต่อ 1 ใบกำกับภาษี", 'simple-skip')
post = r"""      if (qaGlAdj) { // MARKER_VATCONTROLLER_GL_ADJUST_DIFF_ADI_V1 -- ADI ตามยอด Adjust/Config (ไม่ผูกกับใบกำกับ)
        const flatAdjFP = qaGlAdjFlat(qaGlAdj).filter((x) => x.amt > 0);
        const drMainAdjFP = flatAdjFP.find((x) => x.side === 'Dr' && x.kind === 'main') || flatAdjFP[0] || {};
        const grnAdjFP = quickActionGrtRunning ? `${quickActionGrtPrefix}${String(runningStartFP).padStart(quickActionGrtDigitCount, '0')}` : '';
        const lineDescAdjFP = String(qaGlAdj.remark || '').trim() || `Adjust Diff Vat ${grnAdjFP}`.trim();
        const adjBaseFP = {
          bu: bu?.bu, book: bu?.BOOK || null, period: periodTextFP, adi_period: adiPeriodFP, draft_id: draftIdMultiFP, batch_id: null,
          category: adiCategoryFP, source: 'Excel-APN', acc_date: simpleReceiveDateFP,
          bus: busSegFP, grp: grpSegFP, com: comSegFP,
          batch_name: adiBatchNameFP, batch_description: null, journal_name: `APN-SH15-${drMainAdjFP.ofin || ''}-IB-001`, journal_description: null,
          line_description: lineDescAdjFP, line_dff: null, branch_indicator: null, username, fill_started_at: (quickActionFillStartedAtRef.current || new Date()).toISOString(), created_at: new Date().toISOString(), menu_source: 'ap_vat',
        };
        for (const x of flatAdjFP) {
          await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({ ...adjBaseFP, branch: x.ofin, cpc: x.cpc || '99999', acc: x.acc, sub_acc: x.sub || '999999', debit: x.side === 'Dr' ? x.amt : null, credit: x.side === 'Cr' ? x.amt : null }) });
          __vatFpCount++;
        }
      }
"""
rep1("      if (acceptRemarkMode) { // MARKER_VATWATCHLISTOPS_QA_GLTRANSFER_ACCEPT_REMARK_V1 -- Note ถาวร", post + "      if (acceptRemarkMode) { // MARKER_VATWATCHLISTOPS_QA_GLTRANSFER_ACCEPT_REMARK_V1 -- Note ถาวร", 'post-adj')

# ---------- G) JSX ----------
# diffOkV
rep1("const diffOkV = listGl.length > 0 && Math.abs(tGl.dv) <= 1;",
     "const diffOkV = (listGl.length > 0 || !!qaGlAdj) && Math.abs(qaGlAdj ? roundMoney2(tGl.dv - qaGlAdj.cover) : tGl.dv) <= 1;\n        const simOnGl = hasGl && qaGlSimpleCond !== 'standby';", 'diffOkV')
rep1("color: diffOkV ? '#2e7d32' : '#e5484d' }}>{fm2(tGl.dv)}</span>",
     "color: diffOkV ? '#2e7d32' : '#e5484d' }}>{fm2(qaGlAdj ? roundMoney2(tGl.dv - qaGlAdj.cover) : tGl.dv)}</span>", 'diffshow')

# tabs
rep1("<span style={pillS(hasGl ? '#2e7d32' : '#8a8985')}>{hasGl ? simPillGl : 'Standby'}</span></button>",
     "<span style={pillS(qaGlAdj ? '#b26a00' : (hasGl ? '#2e7d32' : '#8a8985'))}>{qaGlAdj ? 'Manual' : (hasGl ? simPillGl : 'Standby')}</span></button>", 'tab1pill')
rep1("<span style={pillS(tGl.ok ? '#2e7d32' : '#e5484d')}>{listGl.length}</span></button>\n",
     "<span style={pillS(tGl.ok ? '#2e7d32' : '#e5484d')}>{listGl.length}</span></button>\n              {(qaGlTab === 3 || !!qaGlAdj) && (<button type=\"button\" style={tabS(qaGlTab === 3)} onClick={() => { if (!qaGlAdjDraft && qaGlAdj) setQaGlAdjDraft(JSON.parse(JSON.stringify(qaGlAdj))); setQaGlTab(3); }}>③ Config Adjust <span style={pillS('#b26a00')}>Manual</span></button>)}\n", 'tab3btn')

# add row: hint + Adjust + gear
rep1("<span style={{ fontSize: '11px', color: addHintColorGl }}>{addHintGl}</span>\n",
"""<span style={{ flex: 1, minWidth: 0, fontSize: '11px', color: addHintColorGl }}>{addHintGl}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button type="button" disabled={quickActionSaving || !(Math.abs(tGl.dv) > 0.005)} onClick={qaGlAdjQuick} title={`Adjust ส่วนต่าง Vat ${fm2(Math.abs(tGl.dv))} ด้วย ADI บรรทัดเดียว (Dr./Cr. จาก SM-Code)`} style={{ padding: '7px 14px', border: '1px solid #1a3a5c', borderRadius: '8px', background: '#fff', color: '#1a3a5c', fontWeight: 600, fontSize: '12px', cursor: (quickActionSaving || !(Math.abs(tGl.dv) > 0.005)) ? 'default' : 'pointer', opacity: (quickActionSaving || !(Math.abs(tGl.dv) > 0.005)) ? 0.4 : 1 }}>Adjust Diff by ADI</button>
                    <button type="button" disabled={quickActionSaving || !(Math.abs(tGl.dv) > 0.005)} onClick={qaGlAdjOpenCfg} title="Config คู่ Dr./Cr. และยอด (กรณีไม่จบในบรรทัดเดียว)" style={{ width: '34px', height: '34px', border: `1px solid ${qaGlAdj ? '#e0a030' : '#1a3a5c'}`, borderRadius: '8px', background: qaGlAdj ? '#fff8e1' : '#fff', color: qaGlAdj ? '#b26a00' : '#1a3a5c', fontSize: '16px', cursor: 'pointer', opacity: !(Math.abs(tGl.dv) > 0.005) ? 0.4 : 1 }}>⚙</button>
                  </span>
""", 'addrow')

# Cal logic: segment replace hasGl -> simOnGl for Simple part
a = s.index("{/* ③ Cal Logic */}")
b = s.index("ADI Journal</div>", a)
seg = s[a:b]
seg = seg.replace("<option value=\"NNN\">NNN</option></select>", "<option value=\"NNN\">NNN</option>{qaGlAdj && <option value=\"standby\">Standby</option>}</select>")
seg = seg.replace("hasGl ? `Transfer ×${listGl.length}` : 'Standby'", "(qaGlSimpleCond === 'standby' && qaGlAdj) ? 'Standby (Null)' : (hasGl ? `Transfer ×${listGl.length}` : 'Standby')")
seg = seg.replace("bdg(hasGl)", "bdg(simOnGl)").replace("hasGl ? yn(", "simOnGl ? yn(").replace("hasGl ? ynOff", "simOnGl ? ynOff")
seg = seg.replace("<span style={hasGl ? yn(yGl) : ynOff}>{!hasGl ? '—'", "<span style={simOnGl ? yn(yGl) : ynOff}>{!simOnGl ? '—'")
seg = seg.replace("{hasGl ? 'No' : '—'}", "{simOnGl ? 'No' : '—'}").replace("{!hasGl ? '—' : (yGl", "{!simOnGl ? '—' : (yGl")
s = s[:a] + seg + s[b:]
assert "(qaGlSimpleCond === 'standby' && qaGlAdj)" in s

# ADI badge
rep1("<span style={bdg(adiOnGl)}><i style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />{adiLabelGl}{adiOnGl && listGl.length > 1 ? ` ×${nAdiGl}` : ''}</span>",
     "<span style={bdg(adiOnGl || !!qaGlAdj)}><i style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />{qaGlAdj ? `Manual-ADJ ×${qaGlAdjFlat(qaGlAdj).length}` : adiLabelGl}{!qaGlAdj && adiOnGl && listGl.length > 1 ? ` ×${nAdiGl}` : ''}</span>", 'adibadge')
rep1("<div style={{ fontSize: '11px', color: '#888', paddingTop: '4px' }}>{!hasGl ? 'Standby",
     "{qaGlAdj && (<div style={{ fontSize: '12px', color: '#b26a00', padding: '2px 0 6px' }}>ADI Adjust · {qaGlAdjFlat(qaGlAdj).length} บรรทัด · Vat {fm2(qaGlAdj.total)} <a href=\"#\" onClick={(e) => { e.preventDefault(); qaGlAdjOpenCfg(); }} style={{ marginLeft: '10px', color: '#2a62b8' }}>แก้ไข</a> <a href=\"#\" onClick={(e) => { e.preventDefault(); qaGlAdjUndo(); }} style={{ marginLeft: '10px', color: '#c0392b' }}>ยกเลิกการ Adjust</a></div>)}\n                <div style={{ fontSize: '11px', color: '#888', paddingTop: '4px' }}>{!hasGl ? 'Standby", 'calnote')

# footer message
rep1("tGl.ok ? 'ยอดใบกำกับตรงกับ Invoice แล้ว พร้อมบันทึก'",
     "tGl.ok ? (qaGlAdj ? `ADI Adjust ${fm2(qaGlAdj.total)} ครอบคลุม Diff Vat แล้ว พร้อมบันทึก` : 'ยอดใบกำกับตรงกับ Invoice แล้ว พร้อมบันทึก')", 'footmsg')

# footer swap
startA = "<button type=\"button\" onClick={() => setQaGlOpen(false)} style={{ padding: '8px 16px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>\n              {(() => { const canAcceptGl"
tab3btns = """{qaGlTab === 3 ? (<>
                <button type="button" onClick={() => { const d = qaGlAdjBuild(); if (d) setQaGlAdjDraft(d); }} style={{ padding: '8px 16px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>คืนค่าเริ่มต้น</button>
                <button type="button" onClick={() => { setQaGlAdjDraft(qaGlAdj ? JSON.parse(JSON.stringify(qaGlAdj)) : null); setQaGlTab(1); }} style={{ padding: '8px 16px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
                <button type="button" onClick={qaGlAdjSubmit} style={{ padding: '8px 16px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>Submit (Adjust)</button>
              </>) : (<>
              """
rep1(startA, tab3btns + startA, 'foot-start')
endB = "{quickActionSaving ? 'กำลังบันทึก...' : 'บันทึก GL-TransferVat'}</button>\n"
rep1(endB, endB + "              </>)}\n", 'foot-end')

# Tab ③ body + ask dialog (before closing of scroll div)
tab3 = r"""            {qaGlTab === 3 && qaGlAdjDraft && (() => { // MARKER_VATCONTROLLER_GL_ADJUST_DIFF_ADI_V1 -- Tab ③ Config Adjust (ฟอร์ม Config ด้านบน + Monitor Segment All ด้านล่าง ขนาดกรอบเดิม)
              const dd = qaGlAdjDraft; const rateA = qaGlAdjRate(); const canAvgA = qaGlAdjCanAvg();
              const flatA = qaGlAdjFlat(dd);
              const sumA = (sd) => roundMoney2(flatA.filter((x) => x.side === sd).reduce((a, x) => a + x.amt, 0));
              const sDrA = sumA('Dr'); const sCrA = sumA('Cr'); const balA = Math.abs(sDrA - sCrA) < 0.005;
              const hasAvgA = [...dd.dr, ...dd.cr].some((x) => x.k === 'avg');
              const preA = String(bu?.['COMPANY CODE'] || '').split('-').map((x) => x.trim()).filter(Boolean);
              const segA = (x) => [...preA, x.ofin, x.cpc, x.acc, x.sub].filter((v) => String(v || '').trim()).join('-');
              const lnA = { display: 'grid', gridTemplateColumns: '0.9fr 0.8fr 1.1fr 0.9fr 1fr 16px', gap: '4px', marginBottom: '4px', alignItems: 'center' };
              const inA = (av) => ({ minWidth: 0, boxSizing: 'border-box', height: '28px', fontSize: '12px', padding: '0 6px', border: av ? '1px solid #f2c777' : '1px solid #b8d4ec', background: av ? '#fff6e0' : '#eaf3fb', borderRadius: '6px', outline: 'none', width: '100%' });
              const roA = { ...inA(false), background: '#f1f1f1', border: '1px solid #ddd', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' };
              const lbA = { fontSize: '10px', color: '#888681' };
              const sideA = (key, label, hbg) => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ background: hbg, textAlign: 'center', padding: '4px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{label}</div>
                  <div style={lnA}><span style={lbA}>Ofin</span><span style={lbA}>CPC</span><span style={lbA}>Account</span><span style={lbA}>Sub Acc</span><span style={{ ...lbA, textAlign: 'right' }}>ยอด</span><i /></div>
                  {dd[key].map((x) => {
                    const isAvg = x.k === 'avg'; const isMain = x.k === 'main';
                    const mainOfin = (dd[key].find((y) => y.k === 'main') || {}).ofin;
                    return (
                      <div key={x.id} style={lnA}>
                        {isAvg ? <input value={mainOfin || ''} readOnly style={{ ...inA(false), background: '#f1f1f1', border: '1px solid #ddd' }} /> : <input value={x.ofin} onChange={(e) => qaGlAdjUpd(key, x.id, { ofin: e.target.value })} style={inA(false)} />}
                        <input value={x.cpc} onChange={(e) => qaGlAdjUpd(key, x.id, { cpc: e.target.value })} style={inA(isAvg)} />
                        <input value={x.acc} onChange={(e) => qaGlAdjUpd(key, x.id, { acc: e.target.value })} style={inA(isAvg)} />
                        <input value={x.sub} onChange={(e) => qaGlAdjUpd(key, x.id, { sub: e.target.value })} style={inA(isAvg)} />
                        {isMain ? <span style={roA}>{fm2(qaGlAdjMain(dd[key], dd.total))}</span> : <input value={x.amt} onChange={(e) => qaGlAdjUpd(key, x.id, { amt: e.target.value })} style={{ ...inA(isAvg), textAlign: 'right' }} />}
                        {isMain ? <i /> : <span title="ลบแถว" onClick={() => qaGlAdjDelRow(key, x.id)} style={{ color: '#c0392b', cursor: 'pointer', textAlign: 'center' }}>×</span>}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                    <button type="button" onClick={() => qaGlAdjAddRow(key)} style={{ border: '1px dashed #4a86d8', color: '#2a62b8', background: '#fff', borderRadius: '6px', padding: '2px 10px', fontSize: '11px', cursor: 'pointer' }}>+ เพิ่มแถวสาขา</button>
                    {canAvgA && !dd[key].some((x) => x.k === 'avg') && (<button type="button" onClick={() => qaGlAdjCalAvg(key)} style={{ border: '1px dashed #e0a030', color: '#b26a00', background: '#fff', borderRadius: '6px', padding: '2px 10px', fontSize: '11px', cursor: 'pointer' }}>Cal Avg</button>)}
                  </div>
                  <div style={{ marginTop: '6px', padding: '4px 10px', borderRadius: '6px', background: balA ? '#e8f5e9' : '#fdeaea', color: balA ? '#2e7d32' : '#c0392b', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span>รวม {key === 'dr' ? 'Dr.' : 'Cr.'}</span><b>{fm2(key === 'dr' ? sDrA : sCrA)}</b></div>
                </div>
              );
              return (
                <div>
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center', padding: '6px 12px', background: '#f6f8fa', borderRadius: '8px', fontSize: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <span>ยอดที่ Adjust (Diff Vat): <b>{fm2(dd.total)}</b></span>
                    <span>ประเภท: <span style={{ background: hasAvgA ? '#fff2d9' : '#eaf3fb', color: hasAvgA ? '#b26a00' : '#1a3a5c', borderRadius: '10px', padding: '1px 9px', fontSize: '11px' }}>{hasAvgA ? `เฉลี่ย (AVG ${isFinite(rateA) ? rateA : ''}%)` : 'ปกติ'}</span></span>
                    <span style={{ color: '#888', fontSize: '11px' }}>{dd.neg ? 'ยอดติดลบ → สลับฝั่ง Dr./Cr.' : 'เพิ่มแถวสาขาแล้วใส่ยอด → แถวแรก (Auto) จะลดลงตามให้'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    {sideA('dr', 'Debit (Dr.)', '#e8ecf3')}
                    {sideA('cr', 'Credit (Cr.)', '#f6ebe0')}
                  </div>
                  <div style={{ margin: '10px 0 8px' }}>
                    <div style={{ fontSize: '11px', color: '#888681', marginBottom: '3px' }}>หมายเหตุ (Line Description) — เว้นว่างได้ ระบบใช้ "Adjust Diff Vat {grnMonGl || ''}"</div>
                    <input value={dd.remark || ''} onChange={(e) => setQaGlAdjDraft((d0) => ({ ...d0, remark: e.target.value }))} style={{ ...yInS, height: '30px' }} />
                  </div>
                  <div style={{ fontSize: '12px', color: '#a98a5c', fontWeight: 600, marginBottom: '3px' }}>Monitor · RESULTS - SEGMENT ALL (ADI)</div>
                  <div style={{ background: '#faf7f2', border: '1px solid #efe6d8', borderRadius: '10px', padding: '6px 8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '22px', fontSize: '11px', color: '#a98a5c', fontWeight: 600, padding: '0 8px 4px' }}><span>GROSS —</span><span>VAT {fm2(dd.total)}</span><span>AMOUNT —</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 120px 120px', alignItems: 'center', fontSize: '10.5px', letterSpacing: '0.04em', color: '#a98a5c', fontWeight: 700, background: '#f7efe3', padding: '4px 8px', borderRadius: '6px' }}><span>#</span><span>RESULTS - SEGMENT ALL (ADI)</span><span style={{ textAlign: 'right' }}>DR.</span><span style={{ textAlign: 'right' }}>CR.</span></div>
                    <div style={{ maxHeight: '136px', overflowY: 'auto' }}>
                      {Array.from({ length: Math.max(4, flatA.length) }).map((_, i) => { const x = flatA[i]; return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 120px 120px', alignItems: 'center', background: x && x.kind === 'avg' ? '#fff4de' : '#fbf9f5', borderRadius: '8px', marginTop: '4px', padding: '5px 8px', height: '28px', boxSizing: 'border-box', fontSize: '12px' }}>
                          <b style={{ color: '#a98a5c' }}>{i + 1}</b>
                          <span style={{ color: x ? '#1f2933' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x ? segA(x) : '—'}</span>
                          <span style={{ textAlign: 'right', color: x && x.side === 'Dr' ? '#1f2933' : '#ccc' }}>{x && x.side === 'Dr' ? fm2(x.amt) : '—'}</span>
                          <span style={{ textAlign: 'right', color: x && x.side === 'Cr' ? '#1f2933' : '#ccc' }}>{x && x.side === 'Cr' ? fm2(x.amt) : '—'}</span>
                        </div>
                      ); })}
                    </div>
                  </div>
                </div>
              );
            })()}
            {qaGlAdjAsk && qaGlAdjDraft && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}>
                <div style={{ background: 'white', borderRadius: '12px', width: '440px', maxWidth: '94vw', padding: '18px 20px', fontSize: '13px', boxShadow: '0 8px 28px rgba(0,0,0,0.25)' }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>Adjust Diff by ADI</div>
                  <div style={{ whiteSpace: 'pre-line', lineHeight: 1.65, marginBottom: '14px' }}>{`Simple ยึด ${qaGlCalc.autoSim} ตามระบบหรือไม่?\n\nยึดตามระบบ  →  Simple คงเดิม\nไม่ยึด  →  Simple เป็น Standby ค่า Null ทั้งหมด ให้ปรับเอง\n\nADI จะสร้างตามยอด Adjust ${fm2(qaGlAdjDraft.total)} ทั้งสองกรณี`}</div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setQaGlAdjAsk(false)} style={{ padding: '8px 14px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
                    <button type="button" onClick={() => qaGlAdjApply(false)} style={{ padding: '8px 14px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ไม่ยึด (ปรับเอง)</button>
                    <button type="button" onClick={() => qaGlAdjApply(true)} style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>ยึดตามระบบ</button>
                  </div>
                </div>
              </div>
            )}
"""
endScroll = "            </>)}\n            </div>\n            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '12px 20px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0 }}>"
rep1(endScroll, "            </>)}\n" + tab3 + "            </div>\n            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '12px 20px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0 }}>", 'tab3body')

# marker
s = s.replace("const [qaGlAdjAsk, setQaGlAdjAsk]", "const [qaGlAdjAsk, setQaGlAdjAsk]", 1)

shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched')
