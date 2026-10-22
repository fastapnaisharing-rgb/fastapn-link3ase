# -*- coding: utf-8 -*-
"""
guard_markers.py -- กันฟีเจอร์หายจากการถูกเขียนทับด้วยไฟล์เก่า (FastAPN Link3ase)

หลักการ: ทุก Patch ใส่ MARKER_xxx ไว้ในโค้ด สคริปต์นี้จดว่า "แต่ละไฟล์เคยมี Marker อะไรบ้าง"
แล้วเทียบกับไฟล์ปัจจุบัน ถ้า Marker ตัวไหนหายไป = มีฟีเจอร์หาย -> เตือนทันที + บอกว่าไปเอาคืนจากสำเนาตัวไหน

วิธีใช้ (รันที่โฟลเดอร์ my-app):
  python guard_markers.py snapshot         # จด Marker ปัจจุบัน + เก็บสำเนาไฟล์ที่เปลี่ยน (รันเมื่อยืนยันว่าหน้าเว็บปกติ)
  python guard_markers.py check            # เช็กว่ามี Marker หายไหม (รันก่อน/หลังแก้ไฟล์ทุกครั้ง) -- exit 1 ถ้ามีของหาย
  python guard_markers.py forget MARKER_X  # ลบ Marker ที่ตั้งใจเอาออกจริง ๆ ออกจากรายการ (กันเตือนซ้ำ)
  python guard_markers.py restore-info     # บอกว่าสำเนาล่าสุดของแต่ละไฟล์อยู่ไหน

ไฟล์ที่ติดตาม: src/**/*.js, *.jsx (ไม่รวม .bak, node_modules, build)
ข้อมูลเก็บที่: _guard/markers_manifest.json และ _guard/snapshots/
"""
import sys, os, re, json, hashlib, shutil, time

ROOT = os.getcwd()
if "--root" in sys.argv:
    i = sys.argv.index("--root"); ROOT = sys.argv[i + 1]; del sys.argv[i:i + 2]
GUARD = os.path.join(ROOT, "_guard")
MANIFEST = os.path.join(GUARD, "markers_manifest.json")
SNAPS = os.path.join(GUARD, "snapshots")
KEEP_PER_FILE = 15
RX = re.compile(r"MARKER_[A-Z0-9_]+")


def tracked():
    out = []
    base = os.path.join(ROOT, "src")
    for dp, dn, fn in os.walk(base):
        dn[:] = [d for d in dn if d not in ("node_modules", "build")]
        for f in fn:
            if f.endswith((".js", ".jsx")):
                out.append(os.path.join(dp, f))
    return sorted(out)


def rel(p):
    return os.path.relpath(p, ROOT).replace("\\", "/")


def markers_of(p):
    with open(p, "rb") as fh:
        return set(RX.findall(fh.read().decode("utf-8", "replace")))


def sha(p):
    h = hashlib.sha1()
    with open(p, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


def load():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return {"files": {}}


def save(m):
    os.makedirs(GUARD, exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(m, fh, ensure_ascii=False, indent=1, sort_keys=True)


def latest_snapshot(r):
    d = os.path.join(SNAPS, r.replace("/", "__"))
    if not os.path.isdir(d):
        return None
    fs = sorted(os.listdir(d))
    return os.path.join(d, fs[-1]) if fs else None


def cmd_snapshot():
    m = load(); ts = time.strftime("%Y%m%d_%H%M%S"); n_copy = 0
    for p in tracked():
        r = rel(p); cur = markers_of(p); h = sha(p)
        ent = m["files"].get(r, {"markers": [], "sha": ""})
        ent["markers"] = sorted(set(ent["markers"]) | cur)  # รวม: Marker ที่เคยมี ไม่หายจากรายการเอง
        if ent.get("sha") != h and cur:
            d = os.path.join(SNAPS, r.replace("/", "__")); os.makedirs(d, exist_ok=True)
            shutil.copy2(p, os.path.join(d, ts + "__" + os.path.basename(p))); n_copy += 1
            old = sorted(os.listdir(d))
            for f in old[:-KEEP_PER_FILE]:
                os.remove(os.path.join(d, f))
        ent["sha"] = h; ent["at"] = ts
        m["files"][r] = ent
    save(m)
    print("snapshot OK: %d ไฟล์ติดตาม, เก็บสำเนาใหม่ %d ไฟล์ -> %s" % (len(m["files"]), n_copy, rel(GUARD)))


def cmd_check():
    m = load()
    if not m["files"]:
        print("ยังไม่มี manifest -- รัน: python guard_markers.py snapshot"); return 2
    bad = 0
    for p in tracked():
        r = rel(p); ent = m["files"].get(r)
        if not ent:
            continue
        miss = sorted(set(ent["markers"]) - markers_of(p))
        if miss:
            bad += 1
            print("\n[หาย] %s -- Marker หาย %d ตัว:" % (r, len(miss)))
            for x in miss[:60]:
                print("   - " + x)
            if len(miss) > 60:
                print("   ... อีก %d ตัว" % (len(miss) - 60))
            s = latest_snapshot(r)
            if s:
                print("   สำเนาที่มีของครบ: " + rel(s))
    gone = [r for r in m["files"] if not os.path.exists(os.path.join(ROOT, r))]
    for r in gone:
        bad += 1; print("\n[ไฟล์หาย] %s" % r)
    if bad:
        print("\n*** พบของหาย %d ไฟล์ -- อย่าเพิ่ง Deploy / บอก Claude ให้คืนจากสำเนาด้านบน ***" % bad)
        return 1
    print("check OK: ไม่มี Marker หาย (%d ไฟล์)" % len(m["files"]))
    return 0


def cmd_forget(names):
    m = load(); n = 0
    for ent in m["files"].values():
        k = [x for x in ent["markers"] if x not in names]
        n += len(ent["markers"]) - len(k); ent["markers"] = k
    save(m); print("ลบออกจากรายการแล้ว %d รายการ" % n)


def cmd_info():
    for p in tracked():
        s = latest_snapshot(rel(p))
        if s:
            print("%-48s -> %s" % (rel(p), rel(s)))


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else "check"
    if c == "snapshot": cmd_snapshot()
    elif c == "check": sys.exit(cmd_check())
    elif c == "forget": cmd_forget(set(sys.argv[2:]))
    elif c == "restore-info": cmd_info()
    else: print(__doc__)
