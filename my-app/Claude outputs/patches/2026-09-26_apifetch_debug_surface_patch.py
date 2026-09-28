#!/usr/bin/env python3
"""
MARKER_APIFETCH_SURFACE_DEBUG_DETAIL_V1
-- Patch Script (Python version): ทำให้ apiFetch (src/api.js) โชว์
-- debug_message/debug_detail/debug_code ที่ Backend (genericTable.js) ส่งมาอยู่แล้ว
-- ทุกครั้งที่ Response เป็น 500 (ดู MARKER_GENERICTABLE_TEMP_DEBUG_ERROR_V1 ใน
-- src/routes/genericTable.js) แทนที่จะเห็นแค่ "Internal server error" เฉยๆ

ไฟล์นี้อยู่ที่ my-app/Claude outputs/patches/ (ลึกจาก my-app 2 ชั้น)

วิธีใช้ (รันจาก root ของ my-app):
    python "Claude outputs/patches/2026-09-26_apifetch_debug_surface_patch.py"

Rollback:
    python "Claude outputs/patches/2026-09-26_apifetch_debug_surface_patch.py" --revert

Idempotent: รันซ้ำกี่ครั้งก็ได้ ถ้า Patch ไปแล้วจะข้ามให้อัตโนมัติ

หมายเหตุ: บนเครื่องนี้ src/api.js ถูก Apply Fix ตัวนี้ตรงๆ ไปแล้ว (ไม่ต้องรัน
Script นี้ซ้ำ) -- ไฟล์นี้มีไว้เป็น Record/เผื่อต้องเอาไป Apply ซ้ำที่ Environment อื่น
(เช่น Deploy ขึ้น Production Server อีกเครื่อง) เท่านั้น
"""
import sys
from pathlib import Path

MARKER = "MARKER_APIFETCH_SURFACE_DEBUG_DETAIL_V1"

SCRIPT_DIR = Path(__file__).resolve().parent
TARGET = SCRIPT_DIR.parent.parent / "src" / "api.js"
BACKUP = TARGET.with_suffix(TARGET.suffix + ".bak")

OLD_BLOCK = """  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }"""

NEW_BLOCK = f"""  if (!res.ok) {{
    const err = await res.json().catch(() => ({{}}));
    // {MARKER} -- Backend (genericTable.js) ส่ง debug_message/debug_detail/debug_code
    // มาด้วยตอน 500 อยู่แล้ว แต่เดิม apiFetch ทิ้งไปหมด เหลือแค่ err.error ("Internal server error" เฉยๆ)
    // ทำให้เห็นแค่ Error กลางๆ ไม่รู้สาเหตุจริงจาก Postgres -- แก้ให้โผล่ Detail จริงมาด้วย
    const detailParts = [err.debug_message, err.debug_detail, err.debug_code].filter(Boolean);
    const message = err.error || 'Request failed';
    throw new Error(detailParts.length ? `${{message}} — ${{detailParts.join(' | ')}}` : message);
  }}"""


def apply_patch():
    if not TARGET.exists():
        print(f"[patch] ไม่พบไฟล์: {TARGET}")
        sys.exit(1)

    content = TARGET.read_text(encoding="utf-8")

    if MARKER in content:
        print(f"[patch] {MARKER} -- Patch ไปแล้ว ข้ามให้ (Idempotent)")
        return

    if OLD_BLOCK not in content:
        print("[patch] ไม่เจอ Code Block เดิมที่คาดไว้ใน src/api.js -- อาจถูกแก้ไขไปแล้วในรูปแบบอื่น กรุณาตรวจสอบด้วยมือ")
        sys.exit(1)

    # สำรองไฟล์เดิมไว้ก่อน Patch เสมอ (ตาม Convention เดิมของ Backend เช่น genericTable.js.bak)
    if not BACKUP.exists():
        BACKUP.write_text(content, encoding="utf-8")
        print(f"[patch] สำรองไฟล์เดิมไว้ที่: {BACKUP}")

    patched = content.replace(OLD_BLOCK, NEW_BLOCK)
    TARGET.write_text(patched, encoding="utf-8")
    print(f"[patch] {MARKER} -- Apply สำเร็จ: {TARGET}")


def revert_patch():
    if not BACKUP.exists():
        print(f"[patch] ไม่พบไฟล์สำรอง: {BACKUP} -- ไม่สามารถ Revert ได้")
        sys.exit(1)
    TARGET.write_text(BACKUP.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"[patch] Revert สำเร็จ: คืนค่า {TARGET} จาก {BACKUP}")


if __name__ == "__main__":
    if "--revert" in sys.argv:
        revert_patch()
    else:
        apply_patch()
