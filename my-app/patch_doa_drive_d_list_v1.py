# -*- coding: utf-8 -*-
"""
patch_doa_drive_d_list_v1.py   (วางข้าง DetailOfAccount.js แล้วรัน: python patch_doa_drive_d_list_v1.py)
MARKER: MARKER_GL_DOA_DRIVE_D_LIST_V1

Modal "สร้าง Backup Detail" (Connect แล้ว BU ยังไม่มี Backup):
  1) กรอบล่าง Modal แสดงรายการไฟล์ใน Drive D (D:\\apps\\Backup_DOH ผ่าน Handler v18) กรอง BU นี้ + Detail ของ Account ที่กด Connect (ไม่สนงวด) + ไฟล์รวมทั้ง BU
  2) ปุ่ม "ใช้ไฟล์นี้" = Handler ดึงไฟล์ขึ้น Backend ชั่วคราว -> หน้าเว็บอ่าน -> ไหลเข้า makeBackup เดิม (ยืนยัน -> บันทึก Backup งวดตามชื่อไฟล์ -> Connect ให้อัตโนมัติ)
  3) ดึง Detail ถูกชีต: ไฟล์ที่ Customize แยก Detail หลายชีต -> ไล่ทุกชีต เอาเฉพาะชีตที่มีหัว Detail (Branch / Account Code / Journal name) แล้วต่อแถวรวมกัน | ชีต Cover/Summary ข้าม | ไม่พบชีต Detail เลย = ใช้ชีตแรกเหมือนเดิม | แสดงชื่อชีตที่ใช้ในหน้ายืนยัน
  Backup ไม่มีการลบ: เก็บ = ทับไฟล์ชื่อเดิมไปเรื่อยๆ (Handler v18 action backup)
"""
import os
import shutil, sys


def die(msg):
    print("[ABORT] " + msg)
    sys.exit(1)


def load(path):
    if not os.path.isfile(path):
        die("ไม่พบไฟล์: " + path)
    with open(path, "r", encoding="utf-8", newline="") as f:
        s = f.read()
    nl = "\r\n" if "\r\n" in s else "\n"
    return s, nl


def apply(src, nl, marker, edits):
    """edits = [(label, old, new)] ; old ต้องพบ 1 ครั้งพอดี ; \\n ใน old/new ถูกแปลงเป็นรูปแบบขึ้นบรรทัดของไฟล์"""
    if marker in src:
        print("[SKIP] พบ " + marker + " แล้ว (Idempotent) ไม่เขียนไฟล์")
        sys.exit(0)
    out = src
    for label, old, new in edits:
        o = old.replace("\n", nl)
        n = new.replace("\n", nl)
        c = out.count(o)
        if c != 1:
            die("Anchor '%s' พบ %d ครั้ง (ต้อง 1) -- ไม่เขียนไฟล์ ไฟล์อาจไม่ตรงเวอร์ชัน ให้ส่งไฟล์ปัจจุบันมาตรวจ" % (label, c))
        out = out.replace(o, n, 1)
    return out


def save(path, out):
    shutil.copyfile(path, path + ".bak")  # .bak ไฟล์เดียว ทับของเดิมทุกครั้ง
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)


def same_balance(src, out):
    """เทียบความสมดุลวงเล็บ 'เฉพาะส่วนที่เพิ่ม' (นับดิบในไฟล์ต้นฉบับอาจไม่สมดุลเพราะอยู่ใน String/Regex)"""
    return all((out.count(a) - out.count(b)) == (src.count(a) - src.count(b)) for a, b in (("{", "}"), ("(", ")"), ("[", "]")))


HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "DetailOfAccount.js")
MARKER = "MARKER_GL_DOA_DRIVE_D_LIST_V1"

src, nl = load(TARGET)

DETAIL_PICK = r"""
  if (want === 'Detail') { /* MARKER_GL_DOA_DETAIL_MULTISHEET_V1 -- Detail ที่ Customize ได้ (เช่น แยกหลายชีต): ไล่ทุกชีต เอาเฉพาะชีตที่มีหัวคอลัมน์ Detail (Branch / Account Code / Journal name) แล้วต่อแถวเข้าด้วยกันตามหัวคอลัมน์ | ชีต Cover/Summary ที่ไม่ใช่ Detail ข้าม | ไม่พบชีต Detail เลย = ใช้ชีตแรกเหมือนเดิม */
    const parts = wb.SheetNames.map(n => { const m = tbReportToMatrix(toM(n)); return { n, m, c: detailCols(m), k: detailRows(m).length }; }).filter(x => x.c && x.k > 0);
    if (parts.length) {
      const base = parts[0].m.map(r => (r || []).slice()); const bi = parts[0].c.idx; const w = base.reduce((a, r) => Math.max(a, r.length), 14);
      parts.slice(1).forEach(x => { detailRows(x.m).forEach(o => { const r = new Array(w).fill(''); DET_KEYS.forEach((k, i) => { if (bi[i] >= 0) r[bi[i]] = o[k]; }); base.push(r); }); });
      base.__sheets = parts.map(x => `${x.n} (${x.k})`); return base;
    }
  }"""

HELPERS = r"""  /* MARKER_GL_DOA_DRIVE_D_LIST_V1 -- Drive D (D:\apps\Backup_DOH) ผ่าน SharePoint Handler v18: list = ดูรายการ / pull = ดึงไฟล์ | Backup ไม่มีลบ (เก็บ = ทับไฟล์ชื่อเดิม) */
  const [dropAcc, setDropAcc] = React.useState(''); const [dFiles, setDFiles] = React.useState({ st: 'idle', items: [], msg: '' }); const [dTick, setDTick] = React.useState(0); const [pullBusy, setPullBusy] = React.useState('');
  const spApi = () => { try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); return { root, tk: sessionStorage.getItem('fastapn_token') || '' }; } catch (e) { return { root: '', tk: '' }; } };
  const spLaunch = (uri) => { const h = document.createElement('a'); h.href = uri; h.style.display = 'none'; document.body.appendChild(h); h.click(); h.remove(); };
  const spNewReq = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const spPoll = async (url, tk, tries) => { for (let i = 0; i < tries; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } }); if (r.ok) { const j = await r.json(); if (j && j.ready) return j; } } catch (e) { /* ลองใหม่ */ } } return null; };
  React.useEffect(() => {
    if (!dropPop) return undefined; let off = false; const { root, tk } = spApi();
    if (!tk) { setDFiles({ st: 'err', items: [], msg: 'ไม่พบ Token — กรุณา Login ใหม่' }); return undefined; }
    setDFiles({ st: 'busy', items: [], msg: '' }); const rq = spNewReq();
    spLaunch(`fastapn-sp://list?dest=dod&path=&req=${rq}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`);
    (async () => {
      const j = await spPoll(`${root}/api/file-storage/sp-handler/local/result?req=${rq}`, tk, 15); if (off) return;
      if (!j) { setDFiles({ st: 'err', items: [], msg: 'ไม่ได้รับรายการจาก Handler — ตรวจว่าติดตั้ง Handler v18 แล้ว (Resource Center > Setup - Tools > Update)' }); return; }
      setDFiles({ st: 'ok', items: (j.items || []).filter(x => !x.dir), msg: '' });
    })();
    return () => { off = true; };
  }, [dropPop, dTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const dFilt = (() => { /* กรอง: BU นี้ + ไม่ใช่งวดปัจจุบัน | Detail ของ Account ที่กด Connect (ไม่สนงวด) แยกจากไฟล์รวมทั้ง BU | ชื่อไฟล์ <COM>_<BU>_Detail_backup_<YYYY.MM>[_<Account>].xlsx */
    const re = /_Detail_backup_(\d{4}\.\d{2})(?:_([^_]+))?\.xlsx$/i;
    const rows = dFiles.items.map(x => { const nm = String(x.name || String(x.path).split('/').pop()); if (nm.indexOf('_' + bu + '_Detail_backup_') < 0) return null; const m = re.exec(nm); return m ? { ...x, name: nm, per: m[1], acc: m[2] || '' } : null; }).filter(x => x && x.per !== period);
    const srt = (a) => a.slice().sort((p, q) => String(q.per).localeCompare(String(p.per)));
    return { acc: dropAcc ? srt(rows.filter(x => x.acc === dropAcc)) : [], whole: srt(rows.filter(x => !x.acc)) };
  })();
  const pullFromD = async (it) => {
    const { root, tk } = spApi(); if (!tk) { setDbMsg('ไม่พบ Token — กรุณา Login ใหม่'); return; }
    setPullBusy(it.path); const rq = spNewReq();
    try {
      spLaunch(`fastapn-sp://pull?dest=dod&path=${encodeURIComponent(it.path)}&req=${rq}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`);
      const j = await spPoll(`${root}/api/file-storage/sp-handler/local/pull-result?req=${rq}`, tk, 30);
      if (!j || !j.b64) { setDbMsg('✗ ดึงไฟล์จาก Drive D ไม่สำเร็จ (Handler ไม่ตอบ หรือไม่พบไฟล์)'); return; }
      const bin = atob(j.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const f = new File([u8], j.name || it.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      await makeBackup(f, it.per);
    } catch (e) { setDbMsg('✗ ดึงไฟล์ไม่สำเร็จ: ' + e.message); } finally { setPullBusy(''); }
  };
"""

MODAL = r"""          <div style={{ marginTop: 14, borderTop: '1px solid #E3E8EF', paddingTop: 10 }}>{/* MARKER_GL_DOA_DRIVE_D_LIST_V1 -- รายการไฟล์ใน Drive D (กรอบแดง) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a3a5c' }}>ไฟล์ใน Drive D · BU {bu}{dropAcc ? ` · Account ${dropAcc}` : ''}</span>
              <button type="button" title="รีเฟรชรายการจาก Drive D" disabled={dFiles.st === 'busy'} onClick={() => setDTick(t => t + 1)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 26, width: 30, cursor: 'pointer' }}>↻</button>
            </div>
            {dFiles.st === 'busy' && <div style={{ fontSize: 12, color: '#57606a' }}>กำลังอ่านรายการจาก Handler…</div>}
            {dFiles.st === 'err' && <div style={{ fontSize: 12, color: '#B42318' }}>{dFiles.msg}</div>}
            {dFiles.st === 'ok' && !dFilt.acc.length && !dFilt.whole.length && <div style={{ fontSize: 12, color: '#57606a' }}>ไม่พบไฟล์ Backup Detail ของ BU นี้ใน Drive D</div>}
            {dFiles.st === 'ok' && (dFilt.acc.length > 0 || dFilt.whole.length > 0) && (
              <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid #E3E8EF', borderRadius: 8 }}>
                {[['Detail ของ Account ' + dropAcc, dFilt.acc], ['ไฟล์รวมทั้ง BU', dFilt.whole]].filter(g => g[1].length).map(g => (
                  <div key={g[0]}>
                    <div style={{ background: '#F4F7FB', padding: '4px 10px', fontSize: 12, color: '#57606a' }}>{g[0]}</div>
                    {g[1].map(it => (
                      <div key={it.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderTop: '1px solid #EEF2F7', fontSize: 13 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.path}>📄 {it.name}</span>
                        <span style={{ color: '#6b7785', fontSize: 12, whiteSpace: 'nowrap' }}>งวด {it.per} · {Math.max(1, Math.round((it.size || 0) / 1024))} KB</span>
                        <button type="button" disabled={!!pullBusy || mkBusy} onClick={() => pullFromD(it)} style={{ border: '1px solid #1a3a5c', background: pullBusy === it.path ? '#EEF5FF' : '#1a3a5c', color: pullBusy === it.path ? '#1a3a5c' : '#fff', borderRadius: 6, height: 26, padding: '0 10px', cursor: 'pointer', fontSize: 12 }}>{pullBusy === it.path ? 'กำลังดึง…' : 'ใช้ไฟล์นี้'}</button>
                      </div>))}
                  </div>))}
              </div>)}
          </div>
"""

E = [
    ("fileToMatrix-sig",
     "async function fileToMatrix(file) {",
     "async function fileToMatrix(file, want) {"),
    ("fileToMatrix-detail",
     "  const toM = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });",
     "  const toM = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });" + DETAIL_PICK),
    ("makeBackup-sig",
     "const makeBackup = async (f) => {",
     "const makeBackup = async (f, perOv) => {"),
    ("makeBackup-per",
     "if (!f) return; let per = mkPer || prevPeriod;",
     "if (!f) return; let per = perOv || mkPer || prevPeriod; /* MARKER_GL_DOA_DRIVE_D_LIST_V1 -- perOv = งวดจากชื่อไฟล์ที่เลือกจาก Drive D */"),
    ("makeBackup-matrix",
     "      const mat = await fileToMatrix(f);\n      const n = detailRows(mat).length;",
     "      const mat = await fileToMatrix(f, 'Detail');\n      const n = detailRows(mat).length;"),
    ("makeBackup-confirm",
     r"ไฟล์: ${f.name} (${n} แถว)\nBU ${bu} · งวด ${per}",
     r"ไฟล์: ${f.name} (${n} แถว)${mat.__sheets ? '\nชีต Detail: ' + mat.__sheets.join(' + ') : ''}\nBU ${bu} · งวด ${per}"),
    ("toggle-empty-1",
     "if (!it.length) { bkSet(code, { conn: 'empty', sel: '' }); setDropPop(true); return; }",
     "if (!it.length) { bkSet(code, { conn: 'empty', sel: '' }); setDropAcc(String(code)); setDropPop(true); return; }"),
    ("toggle-empty-2",
     "if (bkHave && !bkHave.has(String(code))) { bkSet(code, { conn: 'empty', sel: '' }); setDropPop(true); return; }",
     "if (bkHave && !bkHave.has(String(code))) { bkSet(code, { conn: 'empty', sel: '' }); setDropAcc(String(code)); setDropPop(true); return; }"),
    ("connectall-empty",
     "codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'empty', sel: '' }; }); return n; }); setDropPop(true); return; }",
     "codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'empty', sel: '' }; }); return n; }); setDropAcc(''); setDropPop(true); return; }"),
    ("helpers",
     "  const prevPeriod = React.useMemo(() => { /* MARKER_GL_DOA_BACKUP_PREV_OF_PERIOD_V1",
     HELPERS + "  const prevPeriod = React.useMemo(() => { /* MARKER_GL_DOA_BACKUP_PREV_OF_PERIOD_V1"),
    ("modal-list",
     "          <div style={{ textAlign: 'right', marginTop: 14 }}><button type=\"button\" onClick={() => setDropPop(false)}",
     MODAL + "          <div style={{ textAlign: 'right', marginTop: 14 }}><button type=\"button\" onClick={() => setDropPop(false)}"),
]

out = apply(src, nl, MARKER, E)
if not same_balance(src, out):
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")
save(TARGET, out)
print("[OK] DetailOfAccount.js: เพิ่มรายการไฟล์ Drive D ใน Modal + ดึง Detail หลายชีต | สำรอง .bak แล้ว")
