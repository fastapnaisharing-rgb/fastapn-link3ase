/**
 * geminiSplitMerge.js
 * ================================================================
 * ใช้ Gemini ช่วยแยก/รวมชุดเอกสาร (Split & Merge) จากภาพหน้า PDF
 * มี Budget Check ก่อนยิงทุกครั้ง + บันทึกการใช้งานหลังยิงเสร็จ
 * (ไม่มีทางเกิน GEMINI_MONTHLY_BUDGET_USD ที่ตั้งไว้ฝั่ง Backend)
 * ================================================================
 */

const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-flash-lite-latest";
const API_BASE = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '') + '/api/ocr';

function getAuthToken() {
  return sessionStorage.getItem("fastapn_token");
}

// Timeout เริ่มต้นสำหรับ request ทั่วไป (toggle/budget/log) — เร็วอยู่แล้วปกติ
const DEFAULT_TIMEOUT_MS = 15000;
// Gemini เองอาจใช้เวลานานกว่าตามจำนวนหน้า/ขนาดภาพ ให้เวลามากกว่า
const GEMINI_TIMEOUT_MS = 45000;

// ห้าม await fetch() เฉยๆ ไม่มี timeout เด็ดขาด — ถ้า network ค้างเงียบๆ
// (ไม่ error ไม่ resolve) ทั้ง resolveGrouping() จะไม่มีวันจบ แล้ว
// apply-groups/skip-grouping จะไม่ถูกเรียกเลย หน้าจะค้างที่ pending_grouping
// ตลอดไป (นี่คือสาเหตุของบั๊ก "0/20 ค้าง" ที่เจอ)
function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function apiFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const token = getAuthToken();
  let res;
  try {
    res = await fetchWithTimeout(
      url,
      { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } },
      timeoutMs
    );
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * เช็คว่ายังมี Budget เหลือให้ยิง Gemini ไหม (เรียกก่อนทุกครั้ง)
 * @returns {Promise<{canUse: boolean, remainingBudget: number, monthlySpend: number, monthlyBudget: number}>}
 */
export async function checkGeminiBudget() {
  return apiFetch(`${API_BASE}/gemini/budget-status`);
}

/**
 * บันทึกการใช้งาน Gemini กลับไปที่ Backend (เรียกหลังยิงเสร็จทุกครั้ง
 * ไม่ว่าจะสำเร็จหรือ Error — เพื่อให้ยอดสะสมตรงกับความเป็นจริง)
 */
async function logGeminiUsage({ inputTokens, outputTokens, batchId, success, errorMessage }) {
  try {
    await apiFetch(`${API_BASE}/gemini/log-usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: "split_merge",
        modelName: GEMINI_MODEL,
        inputTokens,
        outputTokens,
        batchId,
        calledBy: sessionStorage.getItem("fastapn_username") || null,
        success,
        errorMessage,
      }),
    });
  } catch (err) {
    // การ Log ใช้งานพลาด ไม่ควรทำให้ Flow หลักพังไปด้วย — แค่ Log ไว้เฉยๆ
    console.error("[geminiSplitMerge] logGeminiUsage failed:", err);
  }
}

/**
 * แปลง Blob รูปภาพเป็น Base64 (ไม่รวม Prefix "data:image/png;base64,")
 */
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * เรียก Gemini ให้วิเคราะห์ว่าแต่ละหน้าควรจัดกลุ่มเป็นเอกสารเดียวกันกับ
 * หน้าไหนบ้าง (Split & Merge)
 *
 * @param {Array<{pageNumber: number, imageBlob: Blob}>} pages - รูปภาพแต่ละหน้า (Blob)
 * @param {string} batchId - ใช้สำหรับบันทึก Usage Log อ้างอิงกลับ
 * @returns {Promise<{groups: Array<{pages: number[], reason: string}>, usedFallback: boolean}>}
 */
/**
 * เช็คว่าตอนนี้เปิด Gemini OCR อยู่ไหม (Manual Toggle — Admin ปิดเองได้
 * ล่วงหน้า ไม่ต้องรอ Budget หมดจริง)
 * @returns {Promise<{enabled: boolean}>}
 */
export async function checkGeminiToggle() {
  return apiFetch(`${API_BASE}/gemini/toggle-status`);
}

export async function callGeminiSplitMerge(pages, batchId) {
  if (!GEMINI_API_KEY) {
    console.warn("[geminiSplitMerge] ไม่พบ REACT_APP_GEMINI_API_KEY — ข้าม Gemini ไปใช้ Logic เดิมแทน");
    return { groups: null, usedFallback: true, reason: "no_api_key" };
  }

  // 0) เช็ค Manual Toggle ก่อนสุด (เร็วสุด ไม่ต้องเรียก Budget/Gemini เลยถ้าปิดอยู่)
  try {
    const toggle = await checkGeminiToggle();
    if (!toggle.enabled) {
      console.warn("[geminiSplitMerge] Gemini ถูกปิดไว้ (Manual Toggle) — ใช้ Logic เดิมแทน");
      return { groups: null, usedFallback: true, reason: "manually_disabled" };
    }
  } catch (err) {
    console.error("[geminiSplitMerge] เช็ค Toggle ไม่สำเร็จ:", err);
    // เช็ค Toggle พังเอง -> Fail-safe ไปทาง Fallback (ปลอดภัยกว่าเสี่ยงยิง Gemini ทั้งที่เช็คสถานะไม่ได้)
    return { groups: null, usedFallback: true, reason: "toggle_check_failed" };
  }

  // 1) เช็ค Budget ก่อนยิงทุกครั้ง
  let budget;
  try {
    budget = await checkGeminiBudget();
  } catch (err) {
    console.error("[geminiSplitMerge] เช็ค Budget ไม่สำเร็จ:", err);
    return { groups: null, usedFallback: true, reason: "budget_check_failed" };
  }

  if (!budget.canUse) {
    console.warn(
      `[geminiSplitMerge] Budget หมดแล้ว (ใช้ไป $${budget.monthlySpend} จาก $${budget.monthlyBudget}) — ใช้ Logic เดิมแทน`
    );
    return { groups: null, usedFallback: true, reason: "budget_exceeded", budget };
  }

  // 2) เตรียมภาพส่งให้ Gemini (แปลงเป็น Base64 ทุกหน้า)
  const parts = [];
  for (const page of pages) {
    const base64 = await blobToBase64(page.imageBlob);
    parts.push({ text: `หน้า ${page.pageNumber}:` });
    parts.push({ inline_data: { mime_type: "image/png", data: base64 } });
  }

  const prompt = `
คุณเป็นระบบแยกเอกสารใบกำกับภาษี/ใบเสร็จ จากชุดภาพหน้ากระดาษที่ให้มา
วิเคราะห์ว่าแต่ละหน้าควรถูกจัดกลุ่มเป็นเอกสารเดียวกันกับหน้าไหนบ้าง
(เอกสารเดียวกัน = เลขที่ Invoice เดียวกัน หรือมีข้อความ "Page X of Y" ต่อเนื่องกัน
หรือหน้าถัดไปเป็นรายการสินค้า/สรุปยอดที่ต่อเนื่องจากหน้าก่อนหน้าโดยไม่มีหัวเอกสารใหม่)

สำหรับแต่ละกลุ่ม (เอกสาร 1 ใบ) ให้อ่านข้อมูลเบื้องต้นเพิ่มเติมด้วย (ถ้าอ่านไม่ได้ให้ใส่ null):
- invoiceNo: เลขที่ใบกำกับภาษี/ใบแจ้งหนี้
- supplierName: ชื่อบริษัทผู้ขาย (ผู้ออกเอกสาร ไม่ใช่ผู้ซื้อ)
- docDate: วันที่บนเอกสาร (Format YYYY-MM-DD ถ้าแปลงได้)
- taxId: เลขประจำตัวผู้เสียภาษีของ "ผู้ซื้อ" (บริษัทที่รับสินค้า/บริการ ไม่ใช่ผู้ขาย) 13 หลัก
- lineItemCount: นับจำนวนบรรทัดรายการสินค้า/บริการทั้งหมดในเอกสารนี้ (นับทุกหน้ารวมกันถ้าเอกสารมีหลายหน้า)

ตอบกลับเป็น JSON เท่านั้น ในรูปแบบนี้ (pages ใช้เลขหน้าตามที่ระบุไว้ในภาพ):
{
  "groups": [
    {
      "pages": [1, 2],
      "reason": "มีเลข Invoice เดียวกัน INV-001",
      "invoiceNo": "INV-001",
      "supplierName": "บริษัท ตัวอย่าง จำกัด",
      "docDate": "2026-07-19",
      "taxId": "0105536149875",
      "lineItemCount": 12
    }
  ]
}
`;

  // 3) ยิง Gemini จริง
  let response, data;
  try {
    response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...parts] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
      GEMINI_TIMEOUT_MS
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Gemini API Error ${response.status}`);
    }

    data = await response.json();
  } catch (err) {
    if (err.name === "AbortError") {
      err = new Error(`Gemini API request timed out after ${GEMINI_TIMEOUT_MS}ms`);
    }
    console.error("[geminiSplitMerge] เรียก Gemini ไม่สำเร็จ:", err);
    await logGeminiUsage({
      inputTokens: 0,
      outputTokens: 0,
      batchId,
      success: false,
      errorMessage: err.message,
    });
    return { groups: null, usedFallback: true, reason: "gemini_call_failed", error: err.message };
  }

  // 4) บันทึก Token ที่ใช้จริง (Gemini ส่ง usageMetadata กลับมาให้เสมอ)
  const usage = data.usageMetadata || {};
  await logGeminiUsage({
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    batchId,
    success: true,
    errorMessage: null,
  });

  // 5) แกะผลลัพธ์ JSON ออกมา
  try {
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(jsonText);
    return { groups: parsed.groups, usedFallback: false };
  } catch (err) {
    console.error("[geminiSplitMerge] Parse ผลลัพธ์ Gemini ไม่สำเร็จ:", err, data);
    return { groups: null, usedFallback: true, reason: "parse_failed" };
  }
}