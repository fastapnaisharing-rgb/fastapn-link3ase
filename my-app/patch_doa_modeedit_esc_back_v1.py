# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- กด Esc ใน Mode Edit (Preview Detail เต็มหน้า) => กลับมาหน้า Preview
 - Esc ตอนอยู่ Full Screen ของเบราว์เซอร์: เบราว์เซอร์ใช้ Esc ออก Full Screen เอง (ไม่ส่ง keydown) => ดักด้วย fullscreenchange
 - Esc ตอนไม่ได้อยู่ Full Screen (เต็มหน้าในแท็บ): ดักด้วย keydown
 - ล้างค่าที่เลือก / คำค้นเมื่อกลับ Preview
Run จากโฟลเดอร์ my-app:  python patch_doa_modeedit_esc_back_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_MODEEDIT_ESC_BACK_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_esc_back_v1')
old = "  }, [pageMode]);\n  return (\n    <div onClick={embed ? undefined : onClose}"
assert s.count(old) == 1, s.count(old)
new = ("  }, [pageMode]);\n"
"  React.useEffect(() => { /* MARKER_GL_DOA_MODEEDIT_ESC_BACK_V1 -- Esc ใน Mode Edit => กลับ Preview */\n"
"    if (!pageMode) return undefined; let wasFs = !!document.fullscreenElement;\n"
"    const back = () => { setEdit(false); setSelK(new Set()); setQ(''); };\n"
"    const onKey = (e) => { if (e.key === 'Escape') back(); };\n"
"    const onFs = () => { if (document.fullscreenElement) wasFs = true; else if (wasFs) back(); };\n"
"    document.addEventListener('keydown', onKey); document.addEventListener('fullscreenchange', onFs);\n"
"    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };\n"
"  }, [pageMode]);\n"
"  return (\n    <div onClick={embed ? undefined : onClose}")
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
