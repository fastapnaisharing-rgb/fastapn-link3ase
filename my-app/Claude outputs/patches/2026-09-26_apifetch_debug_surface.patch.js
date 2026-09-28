#!/usr/bin/env node
/**
 * MARKER_APIFETCH_SURFACE_DEBUG_DETAIL_V1
 * -- Patch Script: ทำให้ apiFetch (src/api.js) โชว์ debug_message/debug_detail/debug_code
 * -- ที่ Backend (genericTable.js) ส่งมาอยู่แล้วทุกครั้งที่ Response เป็น 500 (ดู
 * -- MARKER_GENERICTABLE_TEMP_DEBUG_ERROR_V1 ใน src/routes/genericTable.js) แทนที่จะ
 * -- เห็นแค่ "Internal server error" เฉยๆ โดยไม่รู้สาเหตุจริงจาก Postgres
 * --
 * -- วิธีใช้:  node patches/2026-09-26_apifetch_debug_surface.patch.js
 * -- (รันจาก root ของ my-app -- Idempotent: รันซ้ำกี่ครั้งก็ได้ ถ้า Patch ไปแล้วจะข้ามให้)
 *
 * -- Rollback:  node patches/2026-09-26_apifetch_debug_surface.patch.js --revert
 * -- (เอา src/api.js.bak ที่ Patch นี้สร้างไว้ตอน Apply ครั้งแรก กลับมาทับของเดิม)
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'src', 'api.js');
const BACKUP = TARGET + '.bak';
const MARKER = 'MARKER_APIFETCH_SURFACE_DEBUG_DETAIL_V1';

const OLD_BLOCK = `  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }`;

const NEW_BLOCK = `  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // ${MARKER} -- Backend (genericTable.js) ส่ง debug_message/debug_detail/debug_code
    // มาด้วยตอน 500 อยู่แล้ว แต่เดิม apiFetch ทิ้งไปหมด เหลือแค่ err.error ("Internal server error" เฉยๆ)
    // ทำให้เห็นแค่ Error กลางๆ ไม่รู้สาเหตุจริงจาก Postgres -- แก้ให้โผล่ Detail จริงมาด้วย
    const detailParts = [err.debug_message, err.debug_detail, err.debug_code].filter(Boolean);
    const message = err.error || 'Request failed';
    throw new Error(detailParts.length ? \`\${message} — \${detailParts.join(' | ')}\` : message);
  }`;

function apply() {
  if (!fs.existsSync(TARGET)) {
    console.error(`[patch] ไม่พบไฟล์: ${TARGET}`);
    process.exit(1);
  }
  const content = fs.readFileSync(TARGET, 'utf8');

  if (content.includes(MARKER)) {
    console.log(`[patch] ${MARKER} -- Patch ไปแล้ว ข้ามให้ (Idempotent)`);
    return;
  }
  if (!content.includes(OLD_BLOCK)) {
    console.error('[patch] ไม่เจอ Code Block เดิมที่คาดไว้ใน src/api.js -- อาจถูกแก้ไขไปแล้วในรูปแบบอื่น กรุณาตรวจสอบด้วยมือ');
    process.exit(1);
  }

  // สำรองไฟล์เดิมไว้ก่อน Patch เสมอ (ตาม Convention เดิมของ Backend เช่น genericTable.js.bak)
  if (!fs.existsSync(BACKUP)) {
    fs.writeFileSync(BACKUP, content, 'utf8');
    console.log(`[patch] สำรองไฟล์เดิมไว้ที่: ${BACKUP}`);
  }

  const patched = content.replace(OLD_BLOCK, NEW_BLOCK);
  fs.writeFileSync(TARGET, patched, 'utf8');
  console.log(`[patch] ${MARKER} -- Apply สำเร็จ: ${TARGET}`);
}

function revert() {
  if (!fs.existsSync(BACKUP)) {
    console.error(`[patch] ไม่พบไฟล์สำรอง: ${BACKUP} -- ไม่สามารถ Revert ได้`);
    process.exit(1);
  }
  fs.copyFileSync(BACKUP, TARGET);
  console.log(`[patch] Revert สำเร็จ: คืนค่า ${TARGET} จาก ${BACKUP}`);
}

if (process.argv.includes('--revert')) {
  revert();
} else {
  apply();
}
