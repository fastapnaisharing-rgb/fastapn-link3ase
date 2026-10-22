# -*- coding: utf-8 -*-
"""
patch_vat_t36_config_levels_v1.py  (รันที่โฟลเดอร์ my-app)
Temp. T36 > ⚙ Config : ทุก BU > By BU > By Supplier (BU + ชื่อ Vendor), 2 Tab, รายการ(Description) กลางตามสูตร Macro,
Liability / Receive Date / VAT (จาก Company List) / Expense Type (Dropdown SM-Code) / เติม Supplier / Supplier Name + ชื่ออื่น
แก้เฉพาะ src/pages/VatController.js  -- Idempotent (MARKER) , .bak 1 ไฟล์ , All-or-nothing
"""
import os, re, sys, shutil, subprocess

MARKER = "MARKER_VAT_T36_CONFIG_LEVELS_V2"
TARGET = os.path.join("src", "pages", "VatController.js")

STATE_BLOCK = r'''  // MARKER_VAT_T36_CONFIG_LEVELS_V2 -- Config 3 ระดับ: ทุก BU › By BU › By Supplier (Supplier = BU + ชื่อ Vendor ; ไม่ข้าม BU) ; รายการ(Description) เป็นค่ากลางตามสูตร Macro ; เก็บในเครื่อง (vat_t36_cfg_v2)
  const T36_CFG_DEF = { lcpc: '', lacc: '', lsub: '', snMode: 'paste', snCustom: '', recv: 'eom', day: '15', fill: true, vat: 'auto', exp: '' };
  const T36_DESC_DEF = '{MM-YYYY} ยื่นรายงานภาษีซื้อ ภพ.36|{Supplier}|{Receipt}|{BU}';
  const [t36Cfg, setT36Cfg] = React.useState(() => {
    try {
      const v2 = JSON.parse(localStorage.getItem('vat_t36_cfg_v2') || 'null');
      if (v2 && typeof v2 === 'object' && v2.ovr) return { gdesc: v2.gdesc || T36_DESC_DEF, ovr: v2.ovr || {}, alias: v2.alias || {} };
      const v1 = JSON.parse(localStorage.getItem('vat_t36_bu_cfg_v1') || '{}'); const ovr = {};
      Object.keys(v1 || {}).forEach((k) => { const c = v1[k] || {}; const n = {}; if (c.recv !== undefined) n.recv = c.recv; if (c.day !== undefined) n.day = c.day; if (c.fillSup !== undefined) n.fill = c.fillSup; if (c.exp) n.exp = c.exp; if (Object.keys(n).length) ovr[k] = n; });
      return { gdesc: T36_DESC_DEF, ovr, alias: {} };
    } catch (e) { return { gdesc: T36_DESC_DEF, ovr: {}, alias: {} }; }
  });
  const [t36ShowCfg, setT36ShowCfg] = React.useState(false);
  const [t36CfgTab, setT36CfgTab] = React.useState('bu');
  React.useEffect(() => { try { localStorage.setItem('vat_t36_cfg_v2', JSON.stringify(t36Cfg)); } catch (e) { /* ignore */ } }, [t36Cfg]);
  const [t36Co, setT36Co] = React.useState([]); // company_list -> VAT % ของแต่ละ BU
  React.useEffect(() => {
    let off = false;
    const load = () => apiFetch('/company_list').then((res) => { if (!off) setT36Co(Array.isArray(res) ? res : []); }).catch(() => { /* ignore */ });
    load();
    const un = subscribeWs(['company_list_updated'], load);
    return () => { off = true; try { if (typeof un === 'function') un(); } catch (e) { /* ignore */ } };
  }, []);
  const t36SupKey = (bu, vendor) => { const k = `${bu}|${t36NameKey(vendor)}`; const al = t36Cfg.alias || {}; const hit = Object.keys(al).find((sk) => sk.split('|')[0] === bu && String(al[sk] || '').split(',').some((a) => a.trim() && `${bu}|${t36NameKey(a)}` === k)); return hit || k; };
  const t36CfgMerge = (layers) => layers.reduce((a, l) => ({ ...a, ...(l ? Object.fromEntries(Object.entries(l).filter(([kk, vv]) => vv !== undefined)) : {}) }), { ...T36_CFG_DEF });
  const t36Layers = (level) => { const o = t36Cfg.ovr || {}; if (level === '*') return []; const b = level.split('|')[0]; return level === b ? [o['*']] : [o['*'], o[b]]; };
  const t36ParentOf = (level) => t36CfgMerge(t36Layers(level));
  const t36EffOf = (level) => t36CfgMerge([...t36Layers(level), (t36Cfg.ovr || {})[level]]);
  const t36CfgOf = (bu, vendor) => { const o = t36Cfg.ovr || {}; const L = [o['*'], bu ? o[bu] : null]; if (bu && vendor) L.push(o[t36SupKey(bu, vendor)]); return t36CfgMerge(L); };
  const t36CfgSet = (level, k, v) => setT36Cfg((c) => { const o = { ...(c.ovr || {}) }; const cur = { ...(o[level] || {}) }; if (v === '' || v === undefined || v === null) delete cur[k]; else cur[k] = v; if (Object.keys(cur).length) o[level] = cur; else delete o[level]; return { ...c, ovr: o }; });
  const t36CfgReset = (level) => setT36Cfg((c) => { const o = { ...(c.ovr || {}) }; delete o[level]; const al = { ...(c.alias || {}) }; delete al[level]; return { ...c, ovr: o, alias: al }; });
  const t36AliasSet = (sk, v) => setT36Cfg((c) => { const al = { ...(c.alias || {}) }; if (String(v).trim()) al[sk] = v; else delete al[sk]; return { ...c, alias: al }; });
  const t36DescSet = (v) => setT36Cfg((c) => ({ ...c, gdesc: v }));
'''

REC_BLOCK = r'''  const t36CoRate = (buU) => { const c = t36Co.find((r) => String(r.bu ?? r.BU ?? '').trim().toUpperCase() === buU); const n = c ? parseFloat(c['VAT %']) : NaN; return Number.isFinite(n) ? n : null; };
  const t36VatAvg = (x, cfg) => { // VAT Average% : auto = VAT % ของ BU ใน Company List (100 หรือว่าง -> ว่าง) ; 100 = ว่างเสมอ ; avg = เหมือน auto + ถ้า BU ไม่มี % ใช้ % ของ Branch List
    if (cfg.vat === '100') return '';
    const ok = (n) => Number.isFinite(n) && n > 0 && n < 100; const rate = t36CoRate(x.buU); if (ok(rate)) return String(rate);
    if (cfg.vat === 'avg' && x.brCode) { const b = t36Br.rows.find((r) => String(r['Simple Brand Code'] ?? '').trim() === x.brCode); const p = b ? parseFloat(b['%']) : NaN; if (ok(p)) return String(p); }
    return '';
  };
  const t36PeriodTxt = (() => { const pm = /^(\d{4})-(\d{2})/.exec(String(periodMonth || '')); const y = pm ? +pm[1] : new Date().getFullYear(); const m = pm ? +pm[2] : new Date().getMonth() + 1; return `${String(m).padStart(2, '0')}-${y}`; })();
  const t36SupText = (x, cfg) => { // Supplier Name : paste = ตามที่วาง ; sm = ชื่อใน SM-Code (เฉพาะที่จับชื่อได้จริง) ; custom = พิมพ์เอง
    if (cfg.snMode === 'custom' && String(cfg.snCustom || '').trim()) return String(cfg.snCustom).trim();
    if (cfg.snMode === 'sm' && x.sm && (x.smKind === 'BU' || x.smKind === 'ANYBU')) return String(x.sm['Company Name'] ?? x.sm['Supplier Name'] ?? '').trim() || x.vendor;
    return x.vendor;
  };
  const t36DescOf = (x, cfg) => { // สูตร Macro: MM-YYYY ยื่นรายงานภาษีซื้อ ภพ.36|Supplier|เลขที่ใบเสร็จ|BU (BU = Branch List[BU] ตาม Simple Brand Code) ; หา SM-Code ไม่เจอ -> Notfound Data!!!
    if (!x.smKind && !t36Sm.loading) return 'Notfound Data!!!';
    const bb = x.brCode ? t36Br.rows.find((r) => String(r['Simple Brand Code'] ?? '').trim() === x.brCode) : null;
    const buTxt = String((bb && (bb['bu'] ?? bb['BU'])) ?? '').trim() || x.buU;
    return String(t36Cfg.gdesc || T36_DESC_DEF).replace(/\{MM-YYYY\}/g, () => t36PeriodTxt).replace(/\{Supplier\}/g, () => t36SupText(x, cfg)).replace(/\{Receipt\}/g, () => x.inv).replace(/\{BU\}/g, () => buTxt);
  };
  const t36Rec = (x) => { // ฝั่ง Cr: ถ้า SM-Code ที่จับได้ (Supplier Name + BU) เป็น Short Name = T36 ใช้ของมันเอง ไม่งั้นใช้ T36 ตัวแรกของ BU ; Config (Liability) ตั้งทับได้
    const sm = x.sm; const smIsT36 = sm && String(sm['Short Name'] || '').trim().toUpperCase() === 'T36';
    const gen = (x.buU && t36Sm.rows.find((r) => String(r['BU'] ?? '').trim().toUpperCase() === x.buU)) || t36SmRow;
    const cr0 = smIsT36 ? { cc: String(sm['CPC_Cr'] ?? '').trim(), acc: String(sm['Account_Cr'] ?? '').trim(), sub: String(sm['Sub Acc_Cr'] ?? '').trim() } : (gen ? { cc: String(gen['CPC_Cr'] ?? '').trim(), acc: String(gen['Account_Cr'] ?? '').trim(), sub: String(gen['Sub Acc_Cr'] ?? '').trim() } : t36Cr);
    const cfg = t36CfgOf(x.buU, x.vendor);
    const cr = { cc: String(cfg.lcpc || '').trim() || cr0.cc, acc: String(cfg.lacc || '').trim() || cr0.acc, sub: String(cfg.lsub || '').trim() || cr0.sub };
    const own = (x.smKind === 'BU' || x.smKind === 'ANYBU') && cfg.fill !== false; // Supplier Code/Tax ID/สาขา ใช้เฉพาะเมื่อจับชื่อ Supplier ได้จริง
    const g = (k) => (sm && sm[k] != null ? String(sm[k]).trim() : '');
    const go = (k) => (own ? g(k) : '');
    return { liability_cost_center_special: cr.cc, liability_account_special: cr.acc, liability_sub_account_special: cr.sub, supplier_code: go('Supplier Code'), tax_id: go('Tax ID'), branch_no: go('Branch'), expense_type: String(cfg.exp || '').trim() || g('Expense Type'), supplier_name: t36SupText(x, cfg), receive_date: t36RecvFor(x.buU, x.vendor), tax_invoice_date: x.date, vendor_tax_invoice_number: x.inv, // MARKER_VAT_T36_VENDOR_INV_SAME_V1
    line_number: String(x.i + 1), description: t36DescOf(x, cfg), amount_ex_vat: x.base, vat_amount: x.vat, branch_code: x.brCode, vat_average_percent: t36VatAvg(x, cfg) };
  };
'''

MODAL_BLOCK = r'''                {t36ShowCfg && (() => {
                  const o = t36Cfg.ovr || {};
                  const busList = [...new Set(t36Out.map((z) => z.buU).filter(Boolean))].sort();
                  const sups = []; const seen = {};
                  t36Out.forEach((z) => { if (!z.buU || !z.vendor) return; const sk = t36SupKey(z.buU, z.vendor); if (seen[sk]) { seen[sk].n += 1; return; } seen[sk] = { sk, bu: z.buU, name: z.vendor, n: 1 }; sups.push(seen[sk]); });
                  sups.sort((a, b) => (a.bu + a.name).localeCompare(b.bu + b.name));
                  const expOpts = [...new Set(t36Sm.all.map((r) => String(r['Expense Type'] ?? '').trim()).filter(Boolean))].sort();
                  const inp = { border: '1px solid #c5d6ee', borderRadius: '6px', padding: '3px 6px', fontSize: '12px', boxSizing: 'border-box' };
                  const th = { padding: '6px 8px', background: '#f3f6fa', border: '1px solid #d9e0e8', fontSize: '12px', color: '#1a3a5c', whiteSpace: 'nowrap', textAlign: 'left' };
                  const td = { border: '1px solid #e5e7eb', padding: '3px 6px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
                  const RECV = [['eom', 'สิ้นเดือน Period'], ['15', 'วันที่ 15'], ['day', 'กำหนดวันเอง']];
                  const VAT = [['auto', 'Auto (Company List)'], ['100', 'VAT 100%'], ['avg', 'VAT AVG']];
                  const FILL = [['y', 'เติม'], ['n', 'ไม่เติม']];
                  const SN = [['paste', 'ตามที่วาง'], ['sm', 'ตาม SM-Code'], ['custom', 'กำหนดเอง']];
                  const sel = (level, k, opts) => {
                    const par = t36ParentOf(level); const own = o[level] || {}; const base = level === '*';
                    const gv = (v) => (k === 'fill' ? (v === undefined ? undefined : (v ? 'y' : 'n')) : v);
                    const cur = gv(own[k]); const parV = gv(par[k]); const parLbl = (opts.find((p) => p[0] === parV) || [parV, parV])[1];
                    return (
                      <select value={cur === undefined ? (base ? parV : '') : cur} onChange={(e) => { const v = e.target.value; t36CfgSet(level, k, v === '' ? '' : (k === 'fill' ? v === 'y' : v)); }} style={{ ...inp, color: cur === undefined && !base ? '#9ca3af' : '#111827' }}>
                        {!base && <option value="">↳ {parLbl}</option>}
                        {opts.map((p) => <option key={p[0]} value={p[0]}>{p[1]}</option>)}
                      </select>);
                  };
                  const txt = (level, k, ph, w) => {
                    const par = t36ParentOf(level); const own = o[level] || {};
                    return (<input list={k === 'exp' ? 't36-exp-opts' : undefined} value={own[k] ?? ''} placeholder={String(par[k] || '') || ph} onChange={(e) => t36CfgSet(level, k, k === 'day' ? e.target.value.replace(/\D/g, '').slice(0, 2) : e.target.value)} style={{ ...inp, width: w }} />);
                  };
                  const row = (level, label, sub, isSup, sk) => {
                    const eff = t36EffOf(level);
                    return (
                      <tr key={level}>
                        <td style={{ ...td, fontWeight: 600, background: '#fafbfd' }}>{label}{sub ? <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>{sub}</span> : null}</td>
                        <td style={td}>{txt(level, 'lcpc', 'ตาม SM-Code', 70)}</td>
                        <td style={td}>{txt(level, 'lacc', 'ตาม SM-Code', 80)}</td>
                        <td style={td}>{txt(level, 'lsub', 'ตาม SM-Code', 70)}</td>
                        <td style={td}>{sel(level, 'recv', RECV)}{eff.recv === 'day' ? <> {txt(level, 'day', '15', 36)}</> : null}</td>
                        <td style={td}>{sel(level, 'vat', VAT)}</td>
                        <td style={td}>{txt(level, 'exp', 'ตาม SM-Code', 150)}</td>
                        <td style={td}>{sel(level, 'fill', FILL)}</td>
                        {isSup && <td style={td}>{sel(level, 'snMode', SN)}{eff.snMode === 'custom' ? <> {txt(level, 'snCustom', 'ชื่อที่ต้องการ', 130)}</> : null}</td>}
                        {isSup && <td style={td}><input value={(t36Cfg.alias || {})[sk] || ''} placeholder="ชื่ออื่นของ Supplier นี้ (คั่นด้วย ,)" onChange={(e) => t36AliasSet(sk, e.target.value)} style={{ ...inp, width: '200px' }} /></td>}
                        <td style={td}><button type="button" style={{ ...t36Btn, padding: '2px 10px', fontSize: '12px' }} onClick={() => t36CfgReset(level)}>{level === '*' ? 'ค่าเริ่มต้น' : 'ล้างที่ตั้ง'}</button></td>
                      </tr>);
                  };
                  const sample = t36OutKept[0];
                  const prev = sample ? t36DescOf(sample, t36CfgOf(sample.buU, sample.vendor)) : t36DescOf({ sm: null, smKind: 'BU', vendor: 'ชื่อ Supplier', inv: 'เลขที่ใบเสร็จ', brCode: '', buU: 'BU' }, T36_CFG_DEF);
                  const head = (isSup) => (<thead><tr>
                    <th style={th}>{isSup ? 'BU · Supplier' : 'ระดับ'}</th><th style={th}>Liability CPC</th><th style={th}>Liability Account</th><th style={th}>Liability Sub</th><th style={th}>Receive Date</th><th style={th}>VAT</th><th style={th}>Expense Type</th><th style={th}>เติม Supplier/Tax ID/สาขา</th>
                    {isSup && <th style={th}>Supplier Name</th>}{isSup && <th style={th}>ชื่ออื่น (Alias)</th>}<th style={th} />
                  </tr></thead>);
                  const tabBtn = (id, label) => (<button type="button" onClick={() => setT36CfgTab(id)} style={{ ...t36Btn, borderRadius: '18px', padding: '4px 16px', background: t36CfgTab === id ? '#1a3a5c' : '#fff', color: t36CfgTab === id ? '#fff' : '#1a3a5c', fontWeight: 600 }}>{label}</button>);
                  return (
                    <div onClick={() => setT36ShowCfg(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 12px 40px rgba(0,0,0,0.3)', maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto', minWidth: '900px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a3a5c', flex: 1 }}>⚙ Config Temp. T36 — ทุก BU › By BU › By Supplier</div>
                        <button type="button" style={t36Btn} onClick={() => setT36ShowCfg(false)}>ปิด</button>
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>ช่องที่ไม่ตั้ง = สืบทอดจากระดับบน (ทุก BU → BU → Supplier) · Supplier = BU + ชื่อ Vendor (ไม่ข้าม BU) · เก็บไว้ในเครื่องนี้</div>
                      <div style={{ background: '#f3f6fa', border: '1px solid #d9e0e8', borderRadius: '8px', padding: '8px 10px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#1a3a5c', marginBottom: '4px' }}>รายการ (Description) — ใช้เหมือนกันทุกแถว · ตามสูตร Macro</div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input value={t36Cfg.gdesc ?? T36_DESC_DEF} onChange={(e) => t36DescSet(e.target.value)} style={{ ...inp, flex: 1, minWidth: '420px' }} />
                          {['{MM-YYYY}', '{Supplier}', '{Receipt}', '{BU}'].map((tk) => (<button key={tk} type="button" style={{ ...t36Btn, padding: '2px 8px', fontSize: '12px' }} onClick={() => t36DescSet(`${t36Cfg.gdesc ?? T36_DESC_DEF}${tk}`)}>+ {tk}</button>))}
                          <button type="button" style={{ ...t36Btn, padding: '2px 8px', fontSize: '12px' }} onClick={() => t36DescSet(T36_DESC_DEF)}>ค่าตาม Macro</button>
                        </div>
                        <div style={{ fontSize: '12px', color: '#374151', marginTop: '4px' }}>ตัวอย่าง: <b>{prev}</b></div>
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>MM-YYYY = เดือน Period · Supplier = ตามโหมด Supplier Name · Receipt = เลขที่ใบเสร็จ · BU = BU ของ Branch List ตาม Simple Brand Code · หา SM-Code ไม่เจอ → "Notfound Data!!!"</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>{tabBtn('bu', 'By BU')}{tabBtn('sup', 'By Supplier')}</div>
                      <datalist id="t36-exp-opts">{expOpts.map((v) => <option key={v} value={v} />)}</datalist>
                      {t36CfgTab === 'bu' ? (
                        <table style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
                          {head(false)}
                          <tbody>{row('*', 'ทุก BU', '(ค่าเริ่มต้น)', false, '')}{busList.map((b) => row(b, b, '', false, ''))}</tbody>
                        </table>
                      ) : (
                        sups.length === 0 ? (<div style={{ padding: '18px', color: '#9ca3af', fontSize: '13px' }}>ยังไม่มีข้อมูลที่วาง — วางข้อมูลก่อนจึงจะมีรายชื่อ Supplier ให้ตั้งค่า</div>) : (
                          <table style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
                            {head(true)}
                            <tbody>{sups.map((s) => row(s.sk, `${s.bu} · ${s.name}`, `${s.n} แถว`, true, s.sk))}</tbody>
                          </table>)
                      )}
                      <details style={{ marginTop: '10px', fontSize: '12px', color: '#6b7280' }}>
                        <summary style={{ cursor: 'pointer' }}>ไม่ต้อง Set (มาจากข้อมูลที่วาง / SM-Code / ระบบ)</summary>
                        <div style={{ padding: '6px 4px', lineHeight: 1.7 }}>เลขที่ใบเสร็จ → Tax Invoice No. / Vendor Tax Invoice No. · วัน/เดือน/ปี → Tax Invoice Date · มูลค่าฐานภาษี → Amount Ex VAT · ภ.พ.36 → VAT Amount · สาขา Oracle → Branch Code (Branch List) · ลำดับ → Line Number · Supplier Code / Tax ID / สาขา ← SM-Code · Liability (ว่าง) ← SM-Code ที่ Short Name = T36 · VAT % ← Company List</div>
                      </details>
                    </div>
                    </div>);
                })()}
'''

def balanced(s):
    # ตรวจวงเล็บคร่าว ๆ (ไม่นับใน string/template) -- ใช้กับบล็อกใหม่
    st = []; pairs = {')': '(', ']': '[', '}': '{'}; i = 0; q = None
    while i < len(s):
        c = s[i]
        if q:
            if c == '\\': i += 2; continue
            if c == q: q = None
        elif c in "'\"`": q = c
        elif c == '/' and s[i:i+2] == '//': 
            j = s.find('\n', i); i = len(s) if j < 0 else j; continue
        elif c in '([{': st.append(c)
        elif c in ')]}':
            if not st or st.pop() != pairs[c]: return False
        i += 1
    return not st

def main():
    if not os.path.isfile(TARGET):
        print("ไม่พบ", TARGET, "-- ให้รันที่โฟลเดอร์ my-app"); sys.exit(1)
    raw = open(TARGET, "rb").read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    txt = raw.decode("utf-8-sig")
    crlf = "\r\n" in txt
    s = txt.replace("\r\n", "\n")
    if MARKER in s:
        print("แพตช์นี้ถูกใช้แล้ว (", MARKER, ") -- ไม่ทำซ้ำ"); return

    # A1 state
    a = s.find("  // MARKER_VAT_T36_BU_CONFIG_V1")
    e0 = "  const t36CfgReset = (bu) => setT36Cfg((c) => { const n = { ...c }; delete n[bu]; return n; });\n"
    b = s.find(e0)
    if a < 0 or b < 0 or b < a: print("หา anchor ส่วน State ไม่เจอ"); sys.exit(1)
    s = s[:a] + STATE_BLOCK + s[b + len(e0):]

    # A2 recv
    o1 = "  const t36RecvFor = (bu) => {\n    const c = t36CfgOf(bu); if (c.recv === 'eom') return t36Recv;"
    n1 = "  const t36RecvFor = (bu, vendor) => {\n    const c = t36CfgOf(bu, vendor); if (c.recv === 'eom') return t36Recv;"
    if s.count(o1) != 1: print("หา anchor t36RecvFor ไม่เจอ"); sys.exit(1)
    s = s.replace(o1, n1)

    # A3 rec
    a = s.find("  const t36Rec = (x) => {")
    b = s.find("  const t36Btn = {")
    if a < 0 or b < 0 or b < a: print("หา anchor t36Rec ไม่เจอ"); sys.exit(1)
    s = s[:a] + REC_BLOCK + s[b:]

    # A4 modal
    a = s.find("                {t36ShowCfg && (() => {")
    endm = "                })()}\n"
    b = s.find(endm, a)
    if a < 0 or b < 0: print("หา anchor Config modal ไม่เจอ"); sys.exit(1)
    s = s[:a] + MODAL_BLOCK + s[b + len(endm):]

    # A5 summary line
    o5 = "t36OutKept.map((z) => t36RecvFor(z.buU))"
    if s.count(o5) != 1: print("หา anchor สรุป Receive Date ไม่เจอ"); sys.exit(1)
    s = s.replace(o5, "t36OutKept.map((z) => t36RecvFor(z.buU, z.vendor))")

    for nm, blk in (("STATE", STATE_BLOCK), ("REC", REC_BLOCK), ("MODAL", MODAL_BLOCK)):
        if not balanced(blk): print("วงเล็บบล็อก", nm, "ไม่สมดุล -- ยกเลิก (ไม่แก้ไฟล์)"); sys.exit(1)

    out = s.replace("\n", "\r\n") if crlf else s
    data = (b"\xef\xbb\xbf" if bom else b"") + out.encode("utf-8")

    tmp = TARGET + ".new"
    open(tmp, "wb").write(data)
    chk = (
        "const p=require('@babel/parser');const fs=require('fs');"
        "p.parse(fs.readFileSync(process.argv[1],'utf8'),{sourceType:'module',plugins:['jsx']});console.log('babel-ok')"
    )
    try:
        r = subprocess.run(["node", "-e", chk, os.path.abspath(tmp)], capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            print("Babel parse ไม่ผ่าน -- ยกเลิก (ไม่แก้ไฟล์จริง)\n", r.stderr[:1500]); os.remove(tmp); sys.exit(1)
        print("Babel parse ผ่าน")
    except FileNotFoundError:
        print("(ไม่พบ node -- ข้ามการตรวจ Babel ; npm run build จะตรวจให้)")
    shutil.copyfile(TARGET, TARGET + ".bak")
    os.replace(tmp, TARGET)
    print("OK แก้", TARGET, "เรียบร้อย (สำรอง .bak ไว้) -- ต่อไป: npm run build")

main()
