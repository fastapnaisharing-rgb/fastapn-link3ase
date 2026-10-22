# -*- coding: utf-8 -*-
"""
patch_filestorage_local_dod_v1.py   (วางข้าง fileStorage.js ใน src\\routes แล้วรัน: python patch_filestorage_local_dod_v1.py)
MARKER: MARKER_SP_LOCAL_DOD_V1

Backend รองรับ Drive D ของเครื่องผู้ใช้ (Handler v18, dest=dod):
  POST /api/file-storage/sp-handler/local/list         <- Handler ส่งรายการไฟล์ใน D:\\apps\\Backup_DOH (พักในหน่วยความจำ 5 นาที ตาม req ของผู้ใช้)
  GET  /api/file-storage/sp-handler/local/result?req=  -> หน้าเว็บอ่านรายการ (ไม่ปนกับ Cache SharePoint / ไม่ปนระหว่างผู้ใช้-เครื่อง)
  POST /api/file-storage/sp-handler/local/pull?req=&name=  <- Handler ส่งไฟล์ (<=25MB) ที่หน้าเว็บขอดึง
  GET  /api/file-storage/sp-handler/local/pull-result?req= -> หน้าเว็บรับไฟล์เป็น Base64 (อ่านครั้งเดียวแล้วลบทิ้ง)
ไม่แตะ DB / ไม่แก้ Route เดิม | สิทธิ์ = spCanUse เหมือน Route /sp-handler อื่น
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
MARKER = "MARKER_SP_LOCAL_DOD_V1"

src, nl = load(TARGET)

ROUTES = r"""// MARKER_SP_LOCAL_DOD_V1 -- Drive D ของเครื่องผู้ใช้ (dest=dod): Handler v18 ส่งรายการ/ไฟล์มา "พักชั่วคราว" ในหน่วยความจำ (5 นาที) ตาม req ของผู้ใช้คนนั้น -- ไม่เก็บลง DB เพราะเป็นไฟล์ในเครื่องแต่ละคน (ไม่ปนกันระหว่างเครื่อง/ผู้ใช้)
const spLocalBox = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of spLocalBox) if (t - v.at > 300000) spLocalBox.delete(k); }, 60000).unref();
const spLocalKey = async (req, kind, id) => {
  const u = await getUsernameByEmail(req.user.email); const r = String(id || "");
  if (!u || !/^[A-Za-z0-9]{8,64}$/.test(r)) return null;
  return `${kind}|${u}|${r}`;
};
router.post("/sp-handler/local/list", async (req, res) => {
  if (!(await spCanUse(req))) return spDeny(res);
  try {
    const b = req.body || {}; const k = await spLocalKey(req, "list", b.req);
    if (!k) return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
    if (spLocalBox.size > 500) return res.status(429).json({ error: "คำขอมากเกินไป ลองใหม่ภายหลัง" });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 1500)
      .filter((i) => i && typeof i.path === "string" && i.path && !i.path.includes("..") && i.path.length < 500)
      .map((i) => ({ path: i.path, name: i.path.split("/").pop(), dir: !!i.dir, size: Math.max(0, Number(i.size) || 0), mtime: i.mtime || null }));
    spLocalBox.set(k, { at: Date.now(), items, machine: String(b.machine || "").slice(0, 64) });
    res.json({ ok: true, count: items.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get("/sp-handler/local/result", async (req, res) => {
  if (!(await spCanUse(req))) return spDeny(res);
  try {
    const k = await spLocalKey(req, "list", req.query.req);
    if (!k) return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
    const v = spLocalBox.get(k);
    if (!v) return res.json({ ready: false });
    res.json({ ready: true, items: v.items, machine: v.machine });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post("/sp-handler/local/pull", express.raw({ type: "application/octet-stream", limit: "25mb" }), async (req, res) => {
  if (!(await spCanUse(req))) return spDeny(res);
  try {
    const k = await spLocalKey(req, "pull", req.query.req); const buf = req.body;
    if (!k || !Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
    if (spLocalBox.size > 500) return res.status(429).json({ error: "คำขอมากเกินไป ลองใหม่ภายหลัง" });
    const name = String(req.query.name || "file").split(/[\\/]/).pop().slice(0, 200) || "file";
    spLocalBox.set(k, { at: Date.now(), name, buf });
    res.json({ ok: true, bytes: buf.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get("/sp-handler/local/pull-result", async (req, res) => {
  if (!(await spCanUse(req))) return spDeny(res);
  try {
    const k = await spLocalKey(req, "pull", req.query.req);
    if (!k) return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
    const v = spLocalBox.get(k);
    if (!v || !v.buf) return res.json({ ready: false });
    spLocalBox.delete(k); // อ่านได้ครั้งเดียว
    res.json({ ready: true, name: v.name, b64: v.buf.toString("base64") });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

"""

E = [
    ("import-express",
     'import { Router } from "express";',
     'import { Router } from "express";\nimport express from "express"; // MARKER_SP_LOCAL_DOD_V1 -- ใช้ express.raw รับไฟล์จาก Handler'),
    ("insert-routes",
     "// GET /api/file-storage/sp-handler/my-status -> เวอร์ชันล่าสุด",
     ROUTES.rstrip("\n") + "\n\n// GET /api/file-storage/sp-handler/my-status -> เวอร์ชันล่าสุด"),
]

out = apply(src, nl, MARKER, E)
if not same_balance(src, out):
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")

import subprocess, tempfile
tmp = os.path.join(HERE, "fileStorage.new.mjs")
with open(tmp, "w", encoding="utf-8", newline="") as f:
    f.write(out)
try:
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode != 0:
        os.remove(tmp)
        die("node --check ไม่ผ่าน: " + (r.stderr or r.stdout))
except FileNotFoundError:
    print("[WARN] ไม่พบ node ใน PATH — ข้าม node --check")
os.remove(tmp) if os.path.exists(tmp) else None
save(TARGET, out)
print("[OK] fileStorage.js: เพิ่ม Route Drive D (local/list, local/result, local/pull, local/pull-result)")
print("     ต่อไป: Restart-Service fastapn-backend")
