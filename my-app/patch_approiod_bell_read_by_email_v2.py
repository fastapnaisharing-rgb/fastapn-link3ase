# -*- coding: utf-8 -*-
# MARKER_APPERIOD_NOTIF_READBY_EMAIL_V2
# Bug: POST /notifications/:id/read และตอนสร้าง Notification เก็บ "อีเมล" ลง read_by
#      แต่ GET /notifications กรอง/คำนวณ is_read ด้วย "username" -> ไม่เคย Match
#      กดอ่านกี่ครั้งก็ไม่หายจาก Bell และจุดสีน้ำเงิน (ยังไม่อ่าน) ไม่หาย
# Fix: GET เช็ค read_by ทั้ง username และอีเมล
# ต้องรันหลัง patch_approiod_bell_30min_after_login_v1.py (ใช้ $4 = req.user.email)
# ใช้: python patch_approiod_bell_read_by_email_v2.py <path ของ routes\apPeriod.js>
import sys, shutil, os

MARKER = "MARKER_APPERIOD_NOTIF_READBY_EMAIL_V2"

def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์")
        sys.exit(1)
    return src.replace(old, new)

path = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\apPeriod.js"
with open(path, "rb") as f:
    raw = f.read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")

if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว")
    sys.exit(0)
if "MARKER_APPERIOD_NOTIF_30MIN_AFTER_LOGIN_V1" not in src:
    print("[ABORT] ต้องรัน patch_approiod_bell_30min_after_login_v1.py ก่อน")
    sys.exit(1)

old1 = """           category IN ('AP_PERIOD', 'AP_PERIOD_REQUEST')
           AND read_by @> to_jsonb($3::text)
         )"""
new1 = """           category IN ('AP_PERIOD', 'AP_PERIOD_REQUEST')
           -- MARKER_APPERIOD_NOTIF_READBY_EMAIL_V2 -- read_by เก็บเป็นอีเมล ต้องเช็คทั้ง username และอีเมล
           AND (read_by @> to_jsonb($3::text) OR read_by @> to_jsonb($4::text))
         )"""
src = safe_replace(src, old1, new1, "read_by filter")

old2 = "      is_read: Array.isArray(n.read_by) && n.read_by.includes(username)"
new2 = "      is_read: Array.isArray(n.read_by) && (n.read_by.includes(username) || n.read_by.includes(req.user.email))"
src = safe_replace(src, old2, new2, "is_read")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")

out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
