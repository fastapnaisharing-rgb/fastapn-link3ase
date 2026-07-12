/**
 * OCRScanWidget.js (v2 — Batch-based)
 * ================================================================
 * รองรับ Flow ใหม่: Upload 1 ไฟล์ = 1 Batch ที่อาจแบ่งเป็นหลาย "ชุด" (Set)
 * แต่ละชุดจะ ready_for_review ทยอยออกมาเรื่อยๆ ไม่ต้องรอทั้งไฟล์เสร็จ
 * (Concept: "เสร็จชุดไหน ปล่อยชุดนั้นออกมาเลย")
 * ================================================================
 */
import React, { useState, useEffect, useCallback } from "react";

const API_BASE = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '') + '/api/ocr';

function getAuthToken() {
  return sessionStorage.getItem("fastapn_token");
}

async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// img tag ส่ง Authorization header ตรงๆ ไม่ได้ ต้อง fetch เป็น blob แล้วสร้าง object URL แทน
async function fetchImageBlobUrl(pageId) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/page-image/${pageId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

const SET_STATUS_LABEL = {
  pending: "รอคิว",
  processing: "กำลังประมวลผล...",
  ready_for_review: "พร้อมตรวจสอบ",
  approved: "อนุมัติแล้ว",
};

// ---------------- ส่วน Monitor: รายการ Batch ทั้งหมดที่เคย Upload ----------------
function BatchHistory({ onSelectBatch }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadBatches = useCallback(async () => {
    try {
      const data = await apiFetch(`${API_BASE}/batches`);
      setBatches(data.batches);
    } catch (err) {
      console.error("load batches error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBatches();
    const interval = setInterval(loadBatches, 5000); // อัพเดตทุก 5 วิ เผื่อมี Batch กำลังทำงานอยู่
    return () => clearInterval(interval);
  }, [loadBatches]);

  if (loading) return <p style={{ color: "#888", marginTop: 24 }}>กำลังโหลดประวัติ...</p>;
  if (batches.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>ไฟล์ที่เคยอัพโหลด</p>
      {batches.map((b) => {
        const isProcessing = b.pages_done < b.total_pages;
        return (
          <div
            key={b.batch_id}
            onClick={() => onSelectBatch(b.batch_id)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              border: "1px solid #ddd",
              borderRadius: 6,
              marginBottom: 8,
              cursor: "pointer",
              background: isProcessing ? "#fff8ec" : "#fff",
            }}
          >
            <span>
              {b.source_file_name || "(ไม่ทราบชื่อไฟล์)"} — {b.pages_done}/{b.total_pages} หน้า
            </span>
            <span style={{ fontSize: 12, color: "#888" }}>
              {b.sets_ready > 0 && <span style={{ color: "#3c763d" }}>พร้อมตรวจ {b.sets_ready} • </span>}
              {b.sets_approved > 0 && <span>อนุมัติแล้ว {b.sets_approved} • </span>}
              {isProcessing ? "กำลังทำงาน..." : "เสร็จสมบูรณ์"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function OCRScanWidget({ documentType = "ap_invoice", onReadyToReview }) {
  const [batchId, setBatchId] = useState(null);
  const [phase, setPhase] = useState("upload"); // upload | processing
  const [uploading, setUploading] = useState(false);
  const [batchStatus, setBatchStatus] = useState(null); // { batch, pageProgress, sets }
  const [error, setError] = useState(null);
  const [previewSetId, setPreviewSetId] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [formValues, setFormValues] = useState({}); // { fieldName: currentValue } — แก้ไขได้ก่อน Approve
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null); // { message, existingSetId }
  const [batchHistory, setBatchHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // ---------------- โหลดรายการ Batch เก่าทั้งหมดตอนเปิดหน้า (Monitor) ----------------
  const loadBatchHistory = useCallback(async () => {
    try {
      const data = await apiFetch(`${API_BASE}/batches`);
      setBatchHistory(data.batches || []);
    } catch (err) {
      console.error("load batch history error:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBatchHistory();
    // รีเฟรชรายการ Batch เก่าทุก 10 วินาที (เผื่อ Batch ที่กำลังทำอยู่มีความคืบหน้าเพิ่ม)
    const interval = setInterval(loadBatchHistory, 10000);
    return () => clearInterval(interval);
  }, [loadBatchHistory]);

  // ---------------- Upload ----------------
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", documentType);

      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setBatchId(data.batchId);
      setPhase("processing");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ---------------- Poll สถานะ Batch ----------------
  const poll = useCallback(async () => {
    if (!batchId) return;
    try {
      const data = await apiFetch(`${API_BASE}/batch-status/${batchId}`);
      setBatchStatus(data);
    } catch (err) {
      console.error("poll batch-status error:", err);
    }
  }, [batchId]);

  useEffect(() => {
    if (phase !== "processing") return;
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [phase, poll]);

  // ---------------- ดูผล OCR ของชุดที่เลือก (พร้อมโหลดรูปภาพ) ----------------
  const handleViewResult = async (setId) => {
    setPreviewSetId(setId);
    setPreviewResult(null);
    setApproveError(null);
    setDuplicateWarning(null);
    try {
      const data = await apiFetch(`${API_BASE}/result/${setId}`);
      // โหลดรูปภาพของแต่ละหน้าเป็น blob URL
      const pagesWithImages = await Promise.all(
        data.pages.map(async (p) => {
          try {
            const imageUrl = await fetchImageBlobUrl(p.id);
            return { ...p, imageUrl };
          } catch (e) {
            return { ...p, imageUrl: null };
          }
        })
      );
      setPreviewResult({ ...data, pages: pagesWithImages });

      // เตรียมค่าเริ่มต้นของฟอร์ม จาก Field ที่ OCR ดึงมาได้ (ให้พนักงานแก้ไขได้ก่อน Approve)
      const initialValues = {};
      for (const f of data.fields || []) {
        initialValues[f.field_name] = f.final_value ?? f.ocr_value ?? "";
      }
      setFormValues(initialValues);
    } catch (err) {
      setError(err.message);
    }
  };

  // ---------------- Approve: ส่งค่าที่พนักงานตรวจสอบ/แก้ไขแล้ว ----------------
  const handleApprove = async (confirmDuplicate = false) => {
    if (!previewResult) return;
    setApproving(true);
    setApproveError(null);
    try {
      const fieldsPayload = (previewResult.fields || []).map((f) => ({
        fieldName: f.field_name,
        ocrValue: f.ocr_value,
        finalValue: formValues[f.field_name] ?? f.ocr_value,
      }));

      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/approve/${previewSetId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplierId: previewResult.set.supplier_id,
          invoiceNo: formValues.invoice_no,
          fields: fieldsPayload,
          confirmDuplicate,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.error === "duplicate_invoice") {
        // เจอ Invoice ซ้ำ — ต้องให้พนักงานยืนยันก่อนว่าจะ Approve ทั้งที่ซ้ำไหม
        setDuplicateWarning({ message: body.message, existingSetId: body.existingSetId });
        return;
      }
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      // Approve สำเร็จ — ปิด Preview แล้วรีเฟรช List
      setPreviewSetId(null);
      setPreviewResult(null);
      setDuplicateWarning(null);
      loadBatchHistory();
      if (batchId) poll();
    } catch (err) {
      setApproveError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleReset = () => {
    setBatchId(null);
    setPhase("upload");
    setBatchStatus(null);
    setError(null);
    setPreviewSetId(null);
    setPreviewResult(null);
  };

  const donePages = batchStatus?.pageProgress?.done ?? 0;
  const totalPages = batchStatus?.pageProgress?.total ?? 0;
  const sets = batchStatus?.sets ?? [];

  return (
    <div style={{ maxWidth: 700, margin: "2rem auto" }}>
      {phase === "upload" && (
        <div style={{ padding: "2rem", border: "2px dashed #ccc", borderRadius: 8, textAlign: "center" }}>
          <input type="file" accept="application/pdf" onChange={handleFileChange} disabled={uploading} />
          {uploading && <p>กำลังอัพโหลด + แยกหน้า...</p>}
          {error && <p style={{ color: "#d9534f" }}>เกิดข้อผิดพลาด: {error}</p>}
        </div>
      )}

      {phase === "upload" && (
        <BatchHistory
          onSelectBatch={(selectedBatchId) => {
            setBatchId(selectedBatchId);
            setPhase("processing");
          }}
        />
      )}

      {phase === "processing" && (
        <div>
          <div style={{ padding: "1rem 1.5rem", background: "#f5f5f5", borderRadius: 8, marginBottom: 16 }}>
            <p style={{ margin: 0 }}>
              ประมวลผล OCR แล้ว {donePages} / {totalPages} หน้า — พบ {sets.length} ชุดเอกสาร
            </p>
            <div style={{ width: "100%", background: "#ddd", borderRadius: 4, overflow: "hidden", marginTop: 8 }}>
              <div
                style={{
                  width: `${totalPages ? (donePages / totalPages) * 100 : 0}%`,
                  background: "#5cb85c",
                  height: 8,
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>

          {/* รายการชุดที่ทยอย ready ออกมา */}
          <div>
            {sets.length === 0 && <p style={{ color: "#888" }}>ยังไม่มีชุดเอกสารเสร็จ รอสักครู่...</p>}
            {sets.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  marginBottom: 8,
                  background: s.status === "ready_for_review" ? "#eaf6ea" : "#fff",
                }}
              >
                <span>
                  ชุดที่ {i + 1} — {s.total_pages} หน้า —{" "}
                  <strong>{SET_STATUS_LABEL[s.status] || s.status}</strong>
                </span>
                {s.status === "ready_for_review" && (
                  <div>
                    <button onClick={() => handleViewResult(s.id)} style={{ marginRight: 8 }}>
                      ดูผล OCR
                    </button>
                    {onReadyToReview && (
                      <button onClick={() => onReadyToReview(s.id)}>ไปกรอกฟอร์ม</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button onClick={handleReset} style={{ marginTop: 16, background: "none", border: "none", color: "#888", cursor: "pointer" }}>
            ยกเลิก / อัพโหลดใหม่
          </button>
        </div>
      )}

      {/* Preview ผล OCR — Side by Side (รูปภาพ + ข้อความ) */}
      {previewSetId && (
        <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <strong>ผล OCR — ชุด {previewSetId.slice(0, 8)}...</strong>
            <button onClick={() => setPreviewSetId(null)}>ปิด</button>
          </div>
          {!previewResult && <p>กำลังโหลด...</p>}
          {previewResult && previewResult.pages.map((p) => (
            <div
              key={p.page_number}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 16,
                paddingBottom: 16,
                borderBottom: "1px solid #e0e0e0",
              }}
            >
              {/* ซ้าย: รูปภาพต้นฉบับ */}
              <div>
                <p style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>หน้า {p.page_number} — ต้นฉบับ</p>
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={`invoice page ${p.page_number}`}
                    style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6 }}
                  />
                ) : (
                  <p style={{ color: "#d9534f", fontSize: 12 }}>โหลดรูปไม่สำเร็จ</p>
                )}
              </div>

              {/* ขวา: ข้อความที่ OCR อ่านได้ */}
              <div style={{ fontSize: 13, maxHeight: 400, overflowY: "auto" }}>
                <p style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>ข้อความที่อ่านได้</p>
                {(p.raw_ocr_result || []).map((t, idx) => (
                  <div key={idx} style={{ marginBottom: 2 }}>
                    <span style={{ color: t.confidence >= 0.9 ? "#3c763d" : t.confidence >= 0.7 ? "#8a6d3b" : "#a94442" }}>
                      [{(t.confidence * 100).toFixed(0)}%]
                    </span>{" "}
                    {t.text}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* ฟอร์มตรวจสอบ/แก้ไข Field ก่อน Approve — "AI-extracted, please verify" */}
          {previewResult && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "2px solid #ddd" }}>
              <p style={{ fontSize: 12, color: "#b06d00", marginBottom: 12 }}>
                🤖 ข้อมูลอ่านโดยระบบอัตโนมัติ — กรุณาตรวจสอบความถูกต้องก่อนกด Approve
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                {(previewResult.fields || []).filter(f => f.field_name !== "line_items").map((f) => {
                  const conf = f.ocr_confidence || 0;
                  const confColor = conf >= 0.9 ? "#3c763d" : conf >= 0.7 ? "#8a6d3b" : "#a94442";
                  return (
                    <div key={f.field_name}>
                      <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>
                        {f.field_name} <span style={{ color: confColor }}>({(conf * 100).toFixed(0)}%)</span>
                      </label>
                      <input
                        type="text"
                        value={formValues[f.field_name] ?? ""}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, [f.field_name]: e.target.value }))}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          border: `1px solid ${confColor}`,
                          borderRadius: 4,
                          fontSize: 13,
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Line Items — แสดงเป็นตารางเล็กๆ (ยังแก้ไขไม่ได้ในเวอร์ชันนี้) */}
              {(() => {
                const lineItemsField = (previewResult.fields || []).find(f => f.field_name === "line_items");
                if (!lineItemsField) return null;
                let items = [];
                try { items = JSON.parse(lineItemsField.ocr_value); } catch (e) { /* ignore */ }
                if (!items.length) return null;
                return (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>รายการสินค้า (Line Items)</p>
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#eee" }}>
                          {Object.keys(items[0]).map((col) => (
                            <th key={col} style={{ padding: 6, textAlign: "left", border: "1px solid #ddd" }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((row, idx) => (
                          <tr key={idx}>
                            {Object.keys(items[0]).map((col) => (
                              <td key={col} style={{ padding: 6, border: "1px solid #ddd" }}>{row[col] || "-"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Validation Flags (เช่น ยอดเงินไม่สอดคล้องกัน) */}
              {(previewResult.flags || []).length > 0 && (
                <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", borderRadius: 6, fontSize: 12, color: "#856404" }}>
                  ⚠️ พบข้อควรระวัง: {previewResult.flags.map(fl => fl.flag_type).join(", ")} — กรุณาตรวจสอบยอดเงินให้ละเอียด
                </div>
              )}

              {/* คำเตือน Invoice ซ้ำ */}
              {duplicateWarning && (
                <div style={{ marginBottom: 12, padding: 12, background: "#f8d7da", borderRadius: 6, fontSize: 13, color: "#721c24" }}>
                  <p style={{ margin: "0 0 8px" }}>⚠️ {duplicateWarning.message}</p>
                  <button onClick={() => handleApprove(true)} style={{ marginRight: 8 }}>
                    ยืนยัน Approve ทั้งที่ซ้ำ
                  </button>
                  <button onClick={() => setDuplicateWarning(null)}>ยกเลิก</button>
                </div>
              )}

              {approveError && (
                <p style={{ color: "#d9534f", fontSize: 13, marginBottom: 12 }}>เกิดข้อผิดพลาด: {approveError}</p>
              )}

              {!duplicateWarning && (
                <button
                  onClick={() => handleApprove(false)}
                  disabled={approving}
                  style={{
                    background: "#5cb85c",
                    color: "#fff",
                    border: "none",
                    padding: "10px 20px",
                    borderRadius: 6,
                    fontSize: 14,
                    cursor: approving ? "not-allowed" : "pointer",
                    opacity: approving ? 0.6 : 1,
                  }}
                >
                  {approving ? "กำลังบันทึก..." : "✓ Approve"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}