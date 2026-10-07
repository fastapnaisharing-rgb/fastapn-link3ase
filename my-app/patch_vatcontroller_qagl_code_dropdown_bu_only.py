# -*- coding: utf-8 -*-
# patch: Dropdown Code (Draft Monitor) แสดงเฉพาะ SM-Code ของ BU ปัจจุบัน (SM master คอลัมน์ BU หรือ Code ขึ้นต้นด้วย <BU>-)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
a = """.filter((x) => String(x['Tax ID'] || '').trim() === tx);"""
assert s.count(a) == 1
b = """.filter((x) => String(x['Tax ID'] || '').trim() === tx && (() => { const B = String(bu?.bu || '').trim().toUpperCase(); const xb = String(x['BU'] || '').trim().toUpperCase(); const xc = String(x['SM-Code'] || '').trim().toUpperCase(); return !B || xb === B || xc.startsWith(`${B}-`); })()); // MARKER_QA_GL_CODE_DROPDOWN_BU_ONLY_V1"""
s = s.replace(a, b)
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
