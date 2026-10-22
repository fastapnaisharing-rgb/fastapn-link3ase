# -*- coding: utf-8 -*-
"""
patch_filestorage_standby_admin_v1.py   (วางข้าง fileStorage.js ใน src\\routes แล้วรัน: python patch_filestorage_standby_admin_v1.py)
MARKER: MARKER_GL_DOA_TB_STANDBY_ADMIN_V1

TB กลาง (kind = TBRAW) + Stamp Module:
  - ตาราง doa_tb_stamp (bu, period, account, module) -- สร้างให้เองถ้ายังไม่มี (ไม่แตะตารางเดิม)
  - เมื่อมีการโยน TB เข้า (POST /doa-backup kind=TBRAW) หรือมีการเพิ่ม/ลบ Config -> ตรวจ TB กลางของ BU นั้นกับ "Config ทั้งหมด" (ทุกคน) แล้ว Stamp Module ที่ใช้ Account นั้น
    (Module = Profile > Module ของผู้ตั้ง Config | ผู้ตั้งไม่มี Module = "(ไม่ระบุ Module)") | Config แบบ Exclude ไม่ Stamp
  - Stamp ที่ไม่ตรงกับ Config ปัจจุบันแล้วถูกถอดอัตโนมัติ (ตารางนี้เป็นค่าที่คำนวณได้ ไม่ใช่ข้อมูล TB) | Stamp เดิมคงเวลาเดิม
  - GET /api/file-storage/doa-backup-admin/standby (Owner / Admin): ทุก BU/งวด -> Account ที่ไม่มี Module ใช้ = Standby | มี Module ใช้ = used พร้อมชื่อ Module
ไม่ลบ/ไม่แก้ข้อมูล TB ที่เก็บไว้
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
TARGET = os.path.join(HERE, "fileStorage.js")
MARKER = "MARKER_GL_DOA_TB_STANDBY_ADMIN_V1"

src, nl = load(TARGET)

CODE = r'''// MARKER_GL_DOA_TB_STANDBY_ADMIN_V1 -- TB กลาง: ตรวจกับ Config ทั้งหมด แล้ว Stamp Module ที่ใช้ Account | Admin Operation ดู Standby ทุก BU
const DOA_SEGKEY_RE = /(?:^|-)(\d{1,2})-(\d{2})-(\d{4})-(\w+)-(\w+)-(\d{5,})-(\w+)\s*$/;
const doaTbAccounts = (m) => {
  if (!Array.isArray(m)) return [];
  const cell = (r, j) => (Array.isArray(r) && j >= 0 && r[j] != null ? String(r[j]).trim() : "");
  const num = (v) => { const t = String(v == null ? "" : v).trim(); if (!t) return 0; const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const n = Number(t.replace(/[(),\s-]/g, "")); return Number.isNaN(n) ? 0 : (neg ? -n : n); };
  const hi = m.findIndex((r) => Array.isArray(r) && r.some((c) => /^account$/i.test(String(c || "").trim())));
  let kc = -1;
  for (let j = 0; j < 4 && kc < 0; j++) { let n = 0; for (let i = 0; i < Math.min(m.length, 300); i++) { if (DOA_SEGKEY_RE.test(cell(m[i], j))) { n++; if (n >= 3) { kc = j; break; } } } }
  if (hi < 0 && kc < 0) return [];
  const hd = (m[hi] || []).map((c) => String(c || "").trim()); const ix = (re) => hd.findIndex((c) => re.test(c));
  const ja = ix(/^account$/i), jc = ix(/^(cpc|cost\s*(center|centre)|cc)\b/i), js = ix(/sub\s*-?\s*acc|sub\s*account|subacc/i), jd = ix(/^desc/i), je = ix(/^ending/i);
  const out = new Map();
  for (let i = hi < 0 ? 0 : hi + 1; i < m.length; i++) {
    const r = m[i]; const k = kc >= 0 ? DOA_SEGKEY_RE.exec(cell(r, kc)) : null;
    const code = k ? k[6] : cell(r, ja); if (!code || !/\d/.test(code) || !/^[0-9A-Za-z._\/-]+$/.test(code)) continue;
    const cpc = k ? k[5] : cell(r, jc); const sub = k ? k[7] : cell(r, js); const o = out.get(code) || { code, name: "", e: 0, n: 0, cpcs: new Set(), pairs: new Set() };
    o.e += je >= 0 ? num(r[je]) : 0; o.n += 1; if (cpc) o.cpcs.add(cpc); o.pairs.add(cpc + "\u0001" + sub); if (!o.name && jd >= 0) o.name = cell(r, jd); out.set(code, o);
  }
  return [...out.values()];
};
pool.query(`CREATE TABLE IF NOT EXISTS doa_tb_stamp (
  bu TEXT NOT NULL, period TEXT NOT NULL, account TEXT NOT NULL, module TEXT NOT NULL,
  stamped_by TEXT, stamped_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (bu, period, account, module))`)
  .catch((e) => console.error("[migrate doa_tb_stamp]:", e.message));
const doaZ0 = (x) => String(x == null ? "" : x).replace(/^0+/, "");
const doaMt = (cfg, v, all) => { const c = String(cfg == null ? "" : cfg).trim().toUpperCase(); return !c || c === all || c === String(v == null ? "" : v).toUpperCase() || doaZ0(c) === doaZ0(v); };
// ตรวจ TB กลางของ BU กับ Config ทั้งหมด (ทุกคน) แล้ว Stamp Module -- ถอด Stamp ที่ไม่ตรง Config ปัจจุบัน / คงเวลา Stamp เดิม
async function doaRestampBu(bu) {
  const tq = await pool.query("SELECT period, data FROM doa_tb_backup WHERE kind = 'TBRAW' AND bu = $1", [bu]);
  if (!tq.rows.length) return;
  const cq = await pool.query("SELECT account, cpc, cpc_mode, sub_acc, sub_mode, LOWER(user_email) AS e FROM doa_account_config WHERE bu = $1 AND auto_from IS NULL", [bu]);
  const mq = await pool.query("SELECT LOWER(owner_email) AS e, module FROM user_signoff_profile");
  const modOf = {}; mq.rows.forEach((r) => { modOf[r.e] = String(r.module || "").trim() || "(ไม่ระบุ Module)"; });
  const byAcc = new Map(); cq.rows.forEach((r) => { const k = String(r.account); if (!byAcc.has(k)) byAcc.set(k, []); byAcc.get(k).push(r); });
  const want = new Map(); // period -> Set("account\u0001module\u0001email")
  for (const t of tq.rows) {
    const set = want.get(t.period) || new Set();
    for (const a of doaTbAccounts(t.data)) {
      const rules = byAcc.get(a.code) || [];
      for (const r of rules) {
        if (r.cpc_mode === "exclude" || r.sub_mode === "exclude") continue;
        const exs = rules.filter((x) => x.e === r.e && (x.cpc_mode === "exclude" || x.sub_mode === "exclude"));
        const hit = [...a.pairs].some((p) => { const [cpc, sub] = p.split("\u0001"); return doaMt(r.cpc, cpc, "BBBBB") && doaMt(r.sub_acc, sub, "BBBBBB") && !exs.some((x) => (x.cpc_mode === "exclude" ? doaMt(x.cpc, cpc, "\u0000") : true) && (x.sub_mode === "exclude" ? doaMt(x.sub_acc, sub, "\u0000") : true)); });
        if (hit) set.add(a.code + "\u0001" + (modOf[r.e] || "(ไม่ระบุ Module)") + "\u0001" + r.e);
      }
    }
    want.set(t.period, set);
  }
  for (const [period, set] of want) {
    const keep = new Set([...set].map((x) => x.split("\u0001").slice(0, 2).join("\u0001")));
    const ex = await pool.query("SELECT account, module FROM doa_tb_stamp WHERE bu = $1 AND period = $2", [bu, period]);
    for (const r of ex.rows) { if (!keep.has(r.account + "\u0001" + r.module)) await pool.query("DELETE FROM doa_tb_stamp WHERE bu = $1 AND period = $2 AND account = $3 AND module = $4", [bu, period, r.account, r.module]); }
    for (const x of set) { const [account, module, e] = x.split("\u0001"); await pool.query("INSERT INTO doa_tb_stamp (bu, period, account, module, stamped_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bu, period, account, module) DO NOTHING", [bu, period, account, module, e]); }
  }
}
router.get("/doa-backup-admin/standby", async (req, res) => {
  const u = req.user || {};
  if (u.appRole !== "Owner" && u.appRole !== "Admin") return res.status(403).json({ error: "เฉพาะ Owner / Admin" });
  try {
    const bq = await pool.query("SELECT DISTINCT bu FROM doa_tb_backup WHERE kind = 'TBRAW'");
    for (const b of bq.rows) { try { await doaRestampBu(b.bu); } catch (e) { console.error("[doa restamp]", b.bu, e.message); } }
    const q = await pool.query("SELECT id, bu, period, file_name, row_count, owner, created_by, created_at, data FROM doa_tb_backup WHERE kind = 'TBRAW' ORDER BY bu, period DESC, owner LIMIT 300");
    const sq = await pool.query("SELECT bu, period, account, module, stamped_by, stamped_at FROM doa_tb_stamp");
    const st = new Map(); sq.rows.forEach((r) => { const k = r.bu + "\u0001" + r.period; if (!st.has(k)) st.set(k, new Map()); const m = st.get(k); if (!m.has(r.account)) m.set(r.account, []); m.get(r.account).push({ module: r.module, by: r.stamped_by, at: r.stamped_at }); });
    const items = q.rows.map((r) => {
      const accs = doaTbAccounts(r.data); const have = st.get(r.bu + "\u0001" + r.period) || new Map(); const stby = accs.filter((a) => !have.has(a.code)); const used = accs.filter((a) => have.has(a.code));
      return { id: r.id, bu: r.bu, period: r.period, file_name: r.file_name, row_count: r.row_count, owner: r.owner, created_at: r.created_at,
        total_accounts: accs.length, config_accounts: used.length, standby_count: stby.length,
        standby: stby.slice(0, 300).map((a) => ({ code: a.code, name: a.name, e: Math.round(a.e * 100) / 100, cpc_count: a.cpcs.size, rows: a.n })),
        used: used.slice(0, 300).map((a) => ({ code: a.code, name: a.name, e: Math.round(a.e * 100) / 100, cpc_count: a.cpcs.size, modules: have.get(a.code).map((x) => x.module).sort(), stamped_at: have.get(a.code).map((x) => x.at).sort()[0] || null })) };
    });
    res.json({ items });
  } catch (e) { console.error("[doa-backup-admin standby]", e.message); res.status(500).json({ error: "Internal server error" }); }
});

'''

E = [
 ("insert-block",
  'router.get("/doa-backup/:id", async (req, res) => {',
  CODE.rstrip("\n") + "\n\n" + 'router.get("/doa-backup/:id", async (req, res) => {'),
 ("restamp-on-tbraw",
  '    res.json({ ok: true, id: q.rows[0].id, expires_at: q.rows[0].expires_at, retention_months: months });',
  '    if (kind === "TBRAW") doaRestampBu(bu).catch((e) => console.error("[doa restamp TBRAW]", e.message)); // MARKER_GL_DOA_TB_STANDBY_ADMIN_V1 -- โยน TB เข้า = ตรวจกับ Config ทั้งหมด + Stamp Module\n'
  '    res.json({ ok: true, id: q.rows[0].id, expires_at: q.rows[0].expires_at, retention_months: months });'),
 ("restamp-on-config-add",
  '    res.json({ ok: true, added: items.length });',
  '    for (const kb of new Set(items.map((x) => x.bu))) doaRestampBu(kb).catch((e) => console.error("[doa restamp cfg add]", e.message)); // MARKER_GL_DOA_TB_STANDBY_ADMIN_V1 -- ผูก Config = Stamp Module ใน TB กลางทันที\n'
  '    res.json({ ok: true, added: items.length });'),
 ("restamp-on-config-delete",
  '    if (old.rows[0]) await doaRecalcAutoExclude(old.rows[0].bu, old.rows[0].account);',
  '    if (old.rows[0]) await doaRecalcAutoExclude(old.rows[0].bu, old.rows[0].account);\n'
  '    if (old.rows[0]) doaRestampBu(old.rows[0].bu).catch((e) => console.error("[doa restamp cfg del]", e.message)); // MARKER_GL_DOA_TB_STANDBY_ADMIN_V1'),
]

out = apply(src, nl, MARKER, E)
if not same_balance(src, out):
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")
import subprocess
tmp = os.path.join(HERE, "fileStorage.new.mjs")
with open(tmp, "w", encoding="utf-8", newline="") as f:
    f.write(out)
try:
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode != 0:
        os.remove(tmp); die("node --check ไม่ผ่าน: " + (r.stderr or r.stdout))
except FileNotFoundError:
    print("[WARN] ไม่พบ node ใน PATH — ข้าม node --check")
if os.path.exists(tmp): os.remove(tmp)
save(TARGET, out)
print("[OK] fileStorage.js: TB กลาง Stamp Module (doa_tb_stamp) + GET /doa-backup-admin/standby | สำรอง .bak แล้ว")
print("     ต่อไป: Restart-Service fastapn-backend")
