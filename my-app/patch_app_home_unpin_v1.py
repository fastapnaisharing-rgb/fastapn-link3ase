# -*- coding: utf-8 -*-
# MARKER_APP_HOME_UNPIN_V1
# กดปุ่ม Home (เมนูซ้าย) -> ยกเลิกปักหมุด Flyout อัตโนมัติ (ล้างค่าใน localStorage ของ User) แล้วกลับเป็น Sidebar ปกติ
# ใช้: python patch_app_home_unpin_v1.py src\App.js
import sys, shutil, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8", newline="").read()
if "MARKER_APP_HOME_UNPIN_V1" in src:
    print("already patched"); sys.exit(0)

old = "const selectPage = (id) => { setActivePage(id); if (flyoutPinnedRef.current) return;"
assert src.count(old) == 1, "selectPage anchor not unique"
new = ("const selectPage = (id) => { setActivePage(id); "
       "if (id === 'home' && flyoutPinnedRef.current) { flyoutPinnedRef.current = false; setFlyoutPinned(false); "
       "try { if (flyoutPinKey) localStorage.removeItem(flyoutPinKey); } catch (_) { /* ไม่เป็นไร */ } } /* MARKER_APP_HOME_UNPIN_V1 กด Home = เลิกปักหมุด */ "
       "if (flyoutPinnedRef.current) return;")
shutil.copyfile(path, path + ".bak_homeunpin_v1")
src = src.replace(old, new)
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
