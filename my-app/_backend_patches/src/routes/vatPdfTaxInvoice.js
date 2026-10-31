// MARKER_VATPDFTAXINV_SERVER_READ_V1
// อ่านใบกำกับภาษี PDF (ที่มี Text ฝังในไฟล์) ฝั่ง Server ด้วย pdfjs-dist -- ใช้ตัวอ่าน/Template ชุดเดียวกับ Frontend (src/lib/pdfTaxInvoiceReader.js = สำเนาของ my-app/src/utils/pdfTaxInvoiceReader.js)
// Frontend ส่ง PDF มาเป็นชุดเล็ก (multipart, field "files") -> ตอบผลที่อ่านได้กลับทันที (ไม่มี Job/คิวค้างใน Server, ไม่เก็บไฟล์ลงดิสก์ -- เก็บใน Memory แล้วทิ้ง)
// Endpoint:
//   GET  /api/vat-pdf-taxinvoice/ping  -> { ok, pdfjs, parallel }   (Frontend ใช้เช็กว่า Server อ่านให้ได้ไหม)
//   POST /api/vat-pdf-taxinvoice/read  -> { ok, results:[...] }     (เรียงตามลำดับไฟล์ที่ส่งมา; body field "names" = JSON array ชื่อไฟล์ UTF-8 ถ้าต้องการ)
import { Router } from "express";
import multer from "multer";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { readPdfTaxInvoice } from "../lib/pdfTaxInvoiceReader.js";

const router = Router();

const MAX_FILES = 40;                       // ต่อ 1 คำขอ
const MAX_FILE_BYTES = 30 * 1024 * 1024;    // 30MB ต่อไฟล์
const PER_FILE_TIMEOUT_MS = 20000;          // ไฟล์เสียไม่ให้ค้างทั้งชุด
const MAX_PARALLEL = Math.max(1, Number(process.env.PDF_TAXINV_PARALLEL || 2)); // อ่านพร้อมกันทั้ง Server (รวมทุกคน) -- ไม่ให้ Server หนักเกิน

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

// ── pdfjs-dist (รุ่น legacy สำหรับ Node) โหลดครั้งเดียว ──
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const req = createRequire(import.meta.url);
  const pkgJson = req.resolve("pdfjs-dist/package.json");
  const root = path.dirname(pkgJson);
  const lib = await import(pathToFileURL(path.join(root, "legacy", "build", "pdf.mjs")).href);
  const withSep = (p) => (p.endsWith(path.sep) ? p : p + path.sep);
  const standardFontDataUrl = withSep(path.join(root, "standard_fonts"));
  const cMapUrl = withSep(path.join(root, "cmaps"));
  // ตัวอ่านเรียก getDocument({data, useSystemFonts}) -- เติมค่าที่ Node ต้องใช้ให้ตรงนี้ ไม่ต้องแก้ตัวอ่าน
  _pdfjs = {
    version: lib.version,
    getDocument: (opts) => lib.getDocument({ ...opts, standardFontDataUrl, cMapUrl, cMapPacked: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }),
  };
  return _pdfjs;
}

// ── จำกัดจำนวนที่อ่านพร้อมกันทั้ง Server ──
let active = 0;
const waiters = [];
const acquire = () => new Promise((resolve) => { if (active < MAX_PARALLEL) { active++; resolve(); } else waiters.push(resolve); });
const release = () => { const next = waiters.shift(); if (next) next(); else active--; };

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("อ่านไฟล์เกินเวลา " + Math.round(ms / 1000) + " วินาที")), ms))]);
const fixName = (n) => { try { return Buffer.from(String(n || ""), "latin1").toString("utf8"); } catch (_) { return String(n || ""); } }; // multer ถอดชื่อไฟล์เป็น latin1 -> แปลงกลับเป็น UTF-8 (ชื่อไทย)

router.get("/ping", async (_req, res) => {
  try { const p = await getPdfjs(); res.json({ ok: true, pdfjs: p.version, parallel: MAX_PARALLEL, maxFiles: MAX_FILES }); }
  catch (e) { res.status(503).json({ ok: false, error: "pdfjs-dist ยังไม่พร้อมบน Server: " + (e && e.message) }); }
});

router.post("/read", (req, res, next) => {
  upload.array("files", MAX_FILES)(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: "รับไฟล์ไม่สำเร็จ: " + err.message });
    next();
  });
}, async (req, res) => {
  let pdfjs;
  try { pdfjs = await getPdfjs(); } catch (e) { return res.status(503).json({ ok: false, error: "pdfjs-dist ยังไม่พร้อมบน Server: " + (e && e.message) }); }
  const files = req.files || [];
  let names = [];
  try { names = JSON.parse(req.body && req.body.names ? req.body.names : "[]"); } catch (_) { names = []; }
  const results = new Array(files.length);
  await Promise.all(files.map(async (f, i) => {
    const name = (Array.isArray(names) && names[i]) || fixName(f.originalname);
    await acquire();
    try {
      results[i] = await withTimeout(readPdfTaxInvoice(pdfjs, f.buffer, name), PER_FILE_TIMEOUT_MS);
    } catch (e) {
      results[i] = { fileName: name, status: "unreadable", warnings: ["Server อ่านไม่ได้: " + ((e && e.message) || e)], supplierKey: null, supplier: { taxId: null, branch: null }, buyer: { taxId: null, branch: null, name: "" }, invoiceNo: null, invoiceDate: null, invoiceRef: null };
    } finally {
      release();
      f.buffer = null; // ทิ้งไฟล์จาก Memory
    }
  }));
  res.json({ ok: true, results });
});

export default router;
