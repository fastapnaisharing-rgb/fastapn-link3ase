// MARKER_PDFORIENT_BROWSER_V1
// ตัดสินทิศของ PDF สแกนใน Browser "ก่อนอัปโหลด" -- เครื่องสแกน (เช่น RICOH) เขียน /Rotate 270 ลงไฟล์
// แต่ภาพจริงตั้งตรงอยู่แล้ว => โปรแกรมที่หมุนตาม /Rotate (poppler/pdf.js) เห็นภาพตะแคง -> OCR อ่านตารางไม่ออก
//
// วิธี: ถ้าไฟล์มี /Rotate 90/180/270 -> เรนเดอร์หน้าแรกเล็กๆ 2 แบบ (ตาม /Rotate vs ไม่ใช้) แล้วดูว่าแบบไหน
// มี "แถบบรรทัดตัวอักษรแนวนอน" ชัดกว่า (พลังงานต่างของแถว/คอลัมน์) -> ถ้าแบบ "ไม่ใช้ /Rotate" ชนะชัดเจน
// แก้ค่า /Rotate ในไฟล์เป็น 0 (แทนที่แบบความยาวเท่าเดิม xref จึงไม่เสีย) แล้วส่งไฟล์ที่แก้แล้วไป OCR
// ทุกกรณีผิดพลาด/ไม่มั่นใจ -> คืนไฟล์เดิม (Backend ยังมี Auto-Orient สำรองอยู่)

const MAX_BYTES = 30 * 1024 * 1024;
const WIN_RATIO = 1.3; // แบบ "ไม่ใช้ /Rotate" ต้องชนะอย่างน้อย 30% ถึงจะแก้ไฟล์

// หา "/Rotate <digits>" ในไบต์ดิบ (ไม่ decode เป็น string กันไบต์เพี้ยน) -> [{start,end}] ของตัวเลข
function findRotateNumbers(bytes) {
  const pat = [0x2f, 0x52, 0x6f, 0x74, 0x61, 0x74, 0x65]; // "/Rotate"
  const out = [];
  const n = bytes.length - pat.length;
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== 0x2f || bytes[i + 1] !== 0x52) continue;
    let ok = true;
    for (let k = 2; k < pat.length; k++) { if (bytes[i + k] !== pat[k]) { ok = false; break; } }
    if (!ok) continue;
    let p = i + pat.length;
    const ws = p;
    while (p < bytes.length && (bytes[p] === 0x20 || bytes[p] === 0x0a || bytes[p] === 0x0d || bytes[p] === 0x09)) p++;
    if (p === ws) continue; // ต้องมี whitespace คั่น
    const s = p;
    while (p < bytes.length && bytes[p] >= 0x30 && bytes[p] <= 0x39) p++;
    if (p === s) continue;
    let val = 0;
    for (let q = s; q < p; q++) val = val * 10 + (bytes[q] - 0x30);
    out.push({ start: s, end: p, value: val });
  }
  return out;
}

// พลังงานความเปลี่ยนแปลงระหว่างแถวติดกัน / ระหว่างคอลัมน์ติดกัน (ของ Pixel มืด)
// ตัวอักษรตั้งตรง => ผลรวมต่อแถวแกว่งแรง (บรรทัดข้อความ) มากกว่าผลรวมต่อคอลัมน์ => ค่ามากกว่า 1
function horizontalness(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  const rows = new Float64Array(h);
  const cols = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      if (g < 140) { rows[y]++; cols[x]++; }
    }
  }
  let er = 0, ec = 0;
  for (let y = 1; y < h; y++) er += Math.abs(rows[y] - rows[y - 1]);
  for (let x = 1; x < w; x++) ec += Math.abs(cols[x] - cols[x - 1]);
  return (er / Math.max(1, h - 1)) / (ec / Math.max(1, w - 1) + 1e-6);
}

async function renderScore(page, rotation) {
  const base = page.getViewport({ scale: 1, rotation });
  const scale = 400 / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return horizontalness(canvas);
}

/**
 * @param {File} file
 * @returns {Promise<{file: File, changed: boolean, reason: string}>}
 */
export async function normalizePdfOrientation(file) {
  try {
    if (!file || file.size > MAX_BYTES) return { file, changed: false, reason: 'skip-size' };
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const rots = findRotateNumbers(bytes).filter(r => r.value === 90 || r.value === 180 || r.value === 270);
    if (!rots.length) return { file, changed: false, reason: 'no-rotate' }; // ไฟล์ปกติ ไม่ต้องโหลด pdf.js

    const pdfjsLib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.entry');
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default || worker;
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const page = await doc.getPage(1);
    const sRendered = await renderScore(page, page.rotate);
    const sOrig = await renderScore(page, 0);
    try { doc.destroy(); } catch (_) {}
    if (!(sOrig > sRendered * WIN_RATIO)) {
      return { file, changed: false, reason: `keep rendered=${sRendered.toFixed(2)} orig=${sOrig.toFixed(2)}` };
    }
    // แก้ /Rotate N -> /Rotate 0 + ช่องว่างเติมให้ความยาวเท่าเดิม (offset/xref ไม่เปลี่ยน)
    const patched = new Uint8Array(bytes);
    for (const r of rots) {
      patched[r.start] = 0x30;
      for (let k = r.start + 1; k < r.end; k++) patched[k] = 0x20;
    }
    const out = new File([patched], file.name, { type: 'application/pdf', lastModified: file.lastModified });
    return { file: out, changed: true, reason: `use-original rendered=${sRendered.toFixed(2)} orig=${sOrig.toFixed(2)}` };
  } catch (e) {
    return { file, changed: false, reason: 'error: ' + (e && e.message ? e.message : e) };
  }
}
