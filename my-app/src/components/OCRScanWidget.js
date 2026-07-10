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

const SET_STATUS_LABEL = {
  pending: "รอคิว",
  processing: "กำลังประมวลผล...",
  ready_for_review: "พร้อมตรวจสอบ",
  approved: "อนุมัติแล้ว",
};

export default function OCRScanWidget({ documentType = "ap_invoice", onReadyToReview }) {
  const [batchId, setBatchId] = useState(null);
  const [phase, setPhase] = useState("upload"); // upload | processing
  const [uploading, setUploading] = useState(false);
  const [batchStatus, setBatchStatus] = useState(null); // { batch, pageProgress, sets }
  const [error, setError] = useState(null);
  const [previewSetId, setPreviewSetId] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);

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

  // ---------------- ดูผล OCR ของชุดที่เลือก ----------------
  const handleViewResult = async (setId) => {
    setPreviewSetId(setId);
    setPreviewResult(null);
    try {
      const data = await apiFetch(`${API_BASE}/result/${setId}`);
      setPreviewResult(data);
    } catch (err) {
      setError(err.message);
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

      {/* Preview ผล OCR ดิบๆ ของชุดที่เลือก */}
      {previewSetId && (
        <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>ผล OCR — ชุด {previewSetId.slice(0, 8)}...</strong>
            <button onClick={() => setPreviewSetId(null)}>ปิด</button>
          </div>
          {!previewResult && <p>กำลังโหลด...</p>}
          {previewResult && (
            <div style={{ marginTop: 10, maxHeight: 300, overflowY: "auto", fontSize: 13 }}>
              {previewResult.pages.map((p) => (
                <div key={p.page_number} style={{ marginBottom: 10 }}>
                  <em style={{ color: "#888" }}>หน้า {p.page_number}</em>
                  {(p.raw_ocr_result || []).map((t, idx) => (
                    <div key={idx}>
                      [{(t.confidence * 100).toFixed(0)}%] {t.text}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}