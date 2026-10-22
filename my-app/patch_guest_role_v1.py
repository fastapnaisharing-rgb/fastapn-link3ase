# -*- coding: utf-8 -*-
r"""
patch_guest_role_v1.py -- เพิ่ม Role "Guest" (Frontend)
วางไฟล์นี้ไว้ที่ my-app\ แล้วรัน:  python patch_guest_role_v1.py

แก้ 3 ไฟล์ (สำรอง .bak ไฟล์ละ 1 ไฟล์ เขียนทับทุกครั้ง):
  src\pages\UserManagement.js  -- ปุ่ม Guest ใน Permission ขั้นต่ำ (เฉพาะแท็บเมนู ไม่รวม Document Access),
                                  Add User / ตัวกรอง Role / สี Role / DEFAULT_PERMISSIONS
  src\App.js                   -- ROLE_RANK มี guest, ซ่อน Master Data จาก Guest, ซ่อนเมนูโมดูลที่ไม่มีเมนู Guest
  src\contexts\useUserRole.js  -- เพิ่ม isGuest
Idempotent (เช็ค MARKER) / All-or-nothing (anchor ไม่เจอ = ไม่เขียนไฟล์ใดเลย)
"""
import os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MARKER = "MARKER_GUEST_ROLE_V1"

FILES = {
    "um":  os.path.join(HERE, "src", "pages", "UserManagement.js"),
    "app": os.path.join(HERE, "src", "App.js"),
    "ur":  os.path.join(HERE, "src", "contexts", "useUserRole.js"),
}


def read(path):
    with open(path, "rb") as f:
        raw = f.read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw[3:].decode("utf-8") if bom else raw.decode("utf-8")
    return text, bom


def write(path, text, bom):
    data = text.encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    with open(path, "wb") as f:
        f.write(data)


def eol_of(text):
    return "\r\n" if "\r\n" in text else "\n"


def rep(text, old, new, label, expect=1):
    n = text.count(old)
    if n != expect:
        raise RuntimeError("anchor '%s' พบ %d ครั้ง (ต้องการ %d)" % (label, n, expect))
    return text.replace(old, new)


def balanced(text):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    # ตรวจแบบหยาบ: นับสมดุลทั้งไฟล์ (ไม่ข้าม String/Comment) เทียบก่อน-หลังแก้
    return {c: text.count(c) for c in "()[]{}"}


def patch_um(t):
    E = eol_of(t)
    t = rep(t,
        "Viewer: { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false, ApproveBatch: false }",
        "Viewer: { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false, ApproveBatch: false }," + E +
        "    Guest:  { VAT: false, 'I-Pro': false, GL: false, IE: false, Function: false, Manual: false, ApproveBatch: false } // " + MARKER + " -- Guest เริ่มต้น No ทั้งหมด Owner เปิดให้รายคนเอง",
        "DEFAULT_PERMISSIONS.Viewer")
    t = rep(t,
        "Viewer: { bg: '#e6f4ea', fg: '#1e7a3a', bd: '#9fd3ad', hint: 'ทุก Role เข้าได้' },",
        "Guest:  { bg: '#f0e9fb', fg: '#6a3fb5', bd: '#cdb8ee', hint: 'ทุก Role รวม Guest เข้าได้' }, // " + MARKER + E +
        "  Viewer: { bg: '#e6f4ea', fg: '#1e7a3a', bd: '#9fd3ad', hint: 'ทุก Role เข้าได้' },",
        "MIN_ROLE_STYLE.Viewer")
    t = rep(t,
        "function MinRoleSwitch({ value, onChange, disabled }) {",
        "function MinRoleSwitch({ value, onChange, disabled, allowGuest }) { // " + MARKER + " -- allowGuest = แท็บเมนู (AP/VAT/IE/GL/I-Pro) เท่านั้น | Document Access ไม่มี Guest",
        "MinRoleSwitch signature")
    t = rep(t,
        "{['Viewer', 'Editor', 'Admin'].map((r) => {",
        "{(allowGuest ? ['Guest', 'Viewer', 'Editor', 'Admin'] : ['Viewer', 'Editor', 'Admin']).map((r) => {",
        "MinRoleSwitch list")
    t = rep(t,
        "onClick={() => { if (!on) onChange(r); }} title={c.hint}",
        "onClick={() => { if (!on) onChange(r); }} title={allowGuest && r === 'Viewer' ? 'Viewer ขึ้นไป (Guest เข้าไม่ได้)' : c.hint}",
        "MinRoleSwitch title")
    # แท็บเมนู 2 จุด (Group เดี่ยว + Group รวม) ส่ง allowGuest | Document Access (doc-) ไม่ส่ง
    t = rep(t,
        "<MinRoleSwitch value={minRoles[item.id] || (['vat-watchlist-ops', 'vat-dashboard'].includes(item.id) ? 'Viewer' : 'Editor')} disabled={!isOwner}",
        "<MinRoleSwitch allowGuest value={minRoles[item.id] || (['vat-watchlist-ops', 'vat-dashboard'].includes(item.id) ? 'Viewer' : 'Editor')} disabled={!isOwner}",
        "MinRoleSwitch usage menus", expect=2)
    # Role Filter
    t = rep(t,
        "<option value='Viewer'>Viewer</option>",
        "<option value='Viewer'>Viewer</option><option value='Guest'>Guest</option>",
        "filter option")
    # Add User (Owner เท่านั้นเห็น Guest)
    t = rep(t,
        "<option>Admin</option><option>Editor</option><option>Viewer</option></select>",
        "<option>Admin</option><option>Editor</option><option>Viewer</option>{isOwner && <option>Guest</option>}</select>",
        "add user select")
    # เปลี่ยน Role รายแถว
    n_before = t
    t, k = re.subn(r"<option>Admin</option><option>Editor</option><option>Viewer</option>(?=\r?\n)",
                   "<option>Admin</option><option>Editor</option><option>Viewer</option>{(isOwner || u.role === 'Guest') && <option>Guest</option>}", t)
    if k != 1:
        raise RuntimeError("row role select พบ %d ครั้ง (ต้องการ 1)" % k)
    t = rep(t, "{ Owner: 1, Admin: 2, Editor: 3, Viewer: 4 }", "{ Owner: 1, Admin: 2, Editor: 3, Viewer: 4, Guest: 5 }", "ROLE_ORDER")
    t = rep(t,
        "const roleColor = { Owner: '#27500A', Admin: '#1a3a5c', Editor: '#0F6E56', Viewer: '#888' };",
        "const roleColor = { Owner: '#27500A', Admin: '#1a3a5c', Editor: '#0F6E56', Viewer: '#888', Guest: '#6a3fb5' };",
        "roleColor")
    t = rep(t,
        "const roleBg = { Owner: '#EAF3DE', Admin: '#e8f0fb', Editor: '#f0faf6', Viewer: '#f5f5f5' };",
        "const roleBg = { Owner: '#EAF3DE', Admin: '#e8f0fb', Editor: '#f0faf6', Viewer: '#f5f5f5', Guest: '#f0e9fb' };",
        "roleBg")
    return t


def patch_app(t):
    E = eol_of(t)
    t = rep(t,
        "const { currentUser, userRole, userName, logout, userPermissions } = useAuth();",
        "const { currentUser, userRole, userName, logout, userPermissions } = useAuth();" + E +
        "  const isGuest = String(userRole || '').toLowerCase() === 'guest'; // " + MARKER + " -- Guest เห็นเฉพาะเมนูที่ตั้ง Permission ขั้นต่ำ = Guest (และต้องมี Permission โมดูลที่ Owner เปิดให้รายคน)",
        "useAuth destructure")
    t = rep(t,
        "const hasAnyModulePerm = isOwner || [",
        "const hasAnyModulePerm = isOwner || !isGuest && [",
        "hasAnyModulePerm")
    t = rep(t,
        "const ROLE_RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 };",
        "const ROLE_RANK = { guest: 0, viewer: 1, editor: 2, admin: 3, owner: 4 }; // " + MARKER,
        "ROLE_RANK")
    t = rep(t,
        "return (ROLE_RANK[String(userRole || '').toLowerCase()] ?? 0) >= (ROLE_RANK[String(need).toLowerCase()] ?? 1);",
        "return (ROLE_RANK[String(userRole || '').toLowerCase()] ?? 0) >= (ROLE_RANK[String(need).toLowerCase()] ?? 2);",
        "menuMinRoleOk compare")
    t = rep(t,
        "const hasAnyPermission = (reqPerms) => isOwner ||",
        "const guestSeesMenu = (menu) => !isGuest || menu.groups.some(g => g.items.some(it => menuMinRoleOk(it.id))); // " + MARKER + " -- Guest: โมดูลที่ไม่มีเมนู Guest เลย = ซ่อนทั้งโมดูล" + E +
        "  const hasAnyPermission = (reqPerms) => isOwner ||",
        "guestSeesMenu def")
    t = rep(t,
        "(userPermissions?.['Manual'] && !maintenanceMenus.includes('ap-controller'))",
        "(userPermissions?.['Manual'] && guestSeesMenu(AP_CONTROLLER_MENU) && !maintenanceMenus.includes('ap-controller'))",
        "AP trigger")
    t = rep(t,
        "(userPermissions?.['VAT'] && !maintenanceMenus.includes('vat-controller'))",
        "(userPermissions?.['VAT'] && guestSeesMenu(VAT_CONTROLLER_MENU) && !maintenanceMenus.includes('vat-controller'))",
        "VAT trigger")
    t = rep(t,
        "(userPermissions?.['IE'] && !maintenanceMenus.includes('ie-controller'))",
        "(userPermissions?.['IE'] && guestSeesMenu(IE_CONTROLLER_MENU) && !maintenanceMenus.includes('ie-controller'))",
        "IE trigger")
    t = rep(t,
        "ALL_FUNCTION_MENUS.filter(m => userPermissions?.[m.permKey] === true &&",
        "ALL_FUNCTION_MENUS.filter(m => userPermissions?.[m.permKey] === true && (!isGuest || menuMinRoleOk(m.id)) &&",
        "FUNCTION_MENUS filter")
    return t


def patch_ur(t):
    t = rep(t, "const isViewer = true;", "const isViewer = true;\n  const isGuest  = role === 'guest'; // " + MARKER, "isViewer")
    t = rep(t,
        "return { role, loading: !authReady, isOwner, isAdmin, isEditor, isViewer };",
        "return { role, loading: !authReady, isOwner, isAdmin, isEditor, isViewer, isGuest };",
        "return")
    return t


def main():
    plan = [("um", patch_um), ("app", patch_app), ("ur", patch_ur)]
    staged = {}
    for key, fn in plan:
        path = FILES[key]
        if not os.path.isfile(path):
            print("ไม่พบไฟล์:", path); sys.exit(1)
        text, bom = read(path)
        if MARKER in text:
            print("[ข้าม] %s มี %s อยู่แล้ว" % (os.path.basename(path), MARKER))
            continue
        try:
            new = fn(text)
        except RuntimeError as e:
            print("[หยุด] %s: %s -- ยังไม่ได้เขียนไฟล์ใดเลย" % (os.path.basename(path), e))
            sys.exit(1)
        # ตรวจวงเล็บสมดุลเทียบก่อน/หลัง (ส่วนที่เพิ่มต้องสมดุลในตัวเอง)
        b0, b1 = balanced(text), balanced(new)
        for o, c in ("()", "[]", "{}"):
            d = (b1[o] - b0[o]) - (b1[c] - b0[c])
            if d != 0:
                print("[หยุด] %s: วงเล็บ %s%s ไม่สมดุล (ต่าง %d)" % (os.path.basename(path), o, c, d))
                sys.exit(1)
        staged[key] = (path, new, bom)
    for key, (path, new, bom) in staged.items():
        shutil.copyfile(path, path + ".bak")  # 1 .bak ต่อไฟล์ เขียนทับ
        write(path, new, bom)
        print("[แก้แล้ว] %s (สำรอง .bak)" % os.path.relpath(path, HERE))
    print("เสร็จ -- ตรวจ: findstr /c:\"%s\" src\\App.js src\\pages\\UserManagement.js src\\contexts\\useUserRole.js" % MARKER)
    print("ต่อไป: npm run build  แล้ว robocopy build D:\\fastapn\\build /E /IS /IT /PURGE")


if __name__ == "__main__":
    main()
