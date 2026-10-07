# -*- coding: utf-8 -*-
# MARKER_APPERIOD_NOTIF_30MIN_AFTER_LOGIN_V1
# Bell: แจ้งเตือน category 'AP_PERIOD' (ปิด/เปิด Period) อยู่ได้ 30 นาทีหลัง User นั้น Login
# (นับจาก GREATEST(เวลา Login ล่าสุด, เวลาที่สร้าง Notification)) แทนที่จะค้าง 3 วัน
# ใช้: python patch_approiod_bell_30min_after_login_v1.py <path ของ routes\apPeriod.js>
import sys, shutil, os

MARKER = "MARKER_APPERIOD_NOTIF_30MIN_AFTER_LOGIN_V1"

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

# 1) เพิ่มเงื่อนไข 30 นาทีหลัง Login ต่อท้ายเงื่อนไข 3 วันเดิม
old1 = """           notifications.created_at > NOW() - INTERVAL '3 days'
           OR (notifications.category = 'support-feedback' AND t.status = 'new')
         )
       ORDER BY notifications.created_at DESC
       LIMIT 50`,
      [permList, userRole, username]"""
new1 = """           notifications.created_at > NOW() - INTERVAL '3 days'
           OR (notifications.category = 'support-feedback' AND t.status = 'new')
         )
         -- MARKER_APPERIOD_NOTIF_30MIN_AFTER_LOGIN_V1
         -- ── AP_PERIOD (แจ้งเพื่อทราบว่าปิด/เปิด Period แล้ว) อยู่ใน Bell ได้แค่ 30 นาที
         -- ── หลัง User นี้ Login (หรือหลังสร้าง Notification ถ้าสร้างหลัง Login) ──
         AND (
           notifications.category <> 'AP_PERIOD'
           OR NOW() < GREATEST(
                notifications.created_at,
                COALESCE(
                  (SELECT MAX(a.created_at) FROM activity_log a
                    WHERE a.user_email = $4::text AND a.action = 'LOGIN' AND a.module = 'AUTH'),
                  notifications.created_at
                )
              ) + INTERVAL '30 minutes'
         )
       ORDER BY notifications.created_at DESC
       LIMIT 50`,
      [permList, userRole, username, req.user.email]"""
src = safe_replace(src, old1, new1, "notifications query")

# backup
n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")

out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
