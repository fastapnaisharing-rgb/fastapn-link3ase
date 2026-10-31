# -*- coding: utf-8 -*-
"""
patch_replace_bu_lock_v1.py  --  กัน replace_bu ใส่ข้อมูล Incomplete ซ้ำทั้งชุด (Race Condition)
สาเหตุ: replace_bu ถูกเรียก 2 ครั้งซ้อนกัน (กดซ้ำ/Retry) -> ทั้งคู่ DELETE ก่อนที่อีกฝั่งจะ COMMIT -> INSERT ซ้ำทั้งชุด
แก้: ล็อกต่อ BU (pg_advisory_xact_lock) ทันทีหลัง BEGIN -- ครั้งที่ 2 รอครั้งที่ 1 COMMIT แล้ว DELETE ของมันจะลบแถวของครั้งที่ 1 ทิ้งก่อน INSERT
วิธีรัน (บน Server): วางไฟล์นี้โฟลเดอร์เดียวกับ app.js -> python patch_replace_bu_lock_v1.py -> Restart-Service fastapn-backend
Idempotent: ถ้ามี MARKER_APP_REPLACE_BU_ADVISORY_LOCK_V1 แล้วจะข้าม | สำรอง app.js.bak_replace_bu_lock_v1 ก่อนเขียน
"""
import os, re, shutil, subprocess, sys

MARKER = 'MARKER_APP_REPLACE_BU_ADVISORY_LOCK_V1'
TARGET = sys.argv[1] if len(sys.argv) > 1 else 'app.js'

ANCHOR = '    await client.query("SET LOCAL lock_timeout = \'20s\'");'
INSERT = (
    '    // ' + MARKER + ' -- ล็อกต่อ BU (เรียงชื่อกัน Deadlock) ให้ replace_bu ของ BU เดียวกันทำทีละรอบ: รอบที่สอง (กดซ้ำ/Retry) รอรอบแรก COMMIT ก่อน แล้ว DELETE จะลบแถวรอบแรกทิ้ง -> ไม่ซ้ำ\n'
    '    await client.query("SET LOCAL lock_timeout = \'300s\'");\n'
    '    for (const __b of [...new Set(bus.map((x) => String(x)))].sort()) { await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["vat_replace_bu:" + __b]); }\n'
)

def balance_ok(s):
    return s.count('{') == s.count('}') and s.count('(') == s.count(')')

def main():
    if not os.path.isfile(TARGET):
        print('ไม่พบไฟล์', TARGET); sys.exit(1)
    src = open(TARGET, encoding='utf-8').read()
    if MARKER in src:
        print('SKIP: มี', MARKER, 'แล้ว'); return
    r = src.find('app.post("/api/vat_watchlist_report/replace_bu"')
    if r < 0 or src.count('app.post("/api/vat_watchlist_report/replace_bu"') != 1:
        print('ERROR: หา route replace_bu ไม่เจอหรือเจอมากกว่า 1 จุด'); sys.exit(1)
    i = src.find(ANCHOR, r)
    nxt = src.find('\napp.', r + 10)  # route ถัดไป
    if i < 0 or (nxt > 0 and i > nxt) or 'await client.query("BEGIN");' not in src[r:i]:
        print('ERROR: หา Anchor ภายใน replace_bu (หลัง BEGIN) ไม่เจอ'); sys.exit(1)
    new = src[:i] + INSERT + src[i:]
    if not balance_ok(new) and balance_ok(src):
        print('ERROR: Bracket ไม่สมดุลหลัง Patch'); sys.exit(1)
    bak = TARGET + '.bak_replace_bu_lock_v1'
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak)
    tmp = TARGET + '.tmp_patch.js'
    open(tmp, 'w', encoding='utf-8', newline='').write(new)
    try:
        subprocess.run(['node', '--check', tmp], check=True)
    except Exception as e:
        os.remove(tmp); print('ERROR: node --check ไม่ผ่าน', e); sys.exit(1)
    os.replace(tmp, TARGET)
    print('OK: Patch สำเร็จ ->', TARGET, '(สำรอง', bak + ')')
    print('ขั้นต่อไป: Restart-Service fastapn-backend')

main()
