/**
 * OCRScanWidget.js
 * ================================================================
 * Component ใช้ร่วมกันได้ทุกเมนู (AP, VAT, ...) ผ่าน prop documentType
 * ไม่มีฟอร์มกรอก Invoice ของตัวเอง — แค่ Upload + Queue + แสดงผล OCR ดิบ
 * แล้วส่ง setId ต่อให้หน้าอื่น (เช่น APController.js) ไปกรอกฟอร์มจริง
 *
 * วิธีใช้:
 *   <OCRScanWidget documentType="ap_invoice" onReadyToReview={(setId) => {...}} />
 * ================================================================
 */
import React, { useState, useEffect, useCallback } from "react";

const API_BASE = "/api/ocr";

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

export default function OCRScanWidget({ documentType = "ap_invoice", onReadyToReview }) {
  const [setId, setSetId] = useState(null);
  const [phase, setPhase] = useState("upload"); // upload | processing | ready
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [error, setError] = useState(null);

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
      setSetId(data.setId);
      setPhase("processing");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ---------------- Poll สถานะ ----------------
  const poll = useCallback(async () => {
    if (!setId) return;
    try {
      const data = await apiFetch(`${API_BASE}/status/${setId}`);
      setStatus(data);

      if (data.set.status === "ready_for_review") {
        setPhase("ready");
        return;
      }
      if (data.set.status === "pending") {
        const posData = await apiFetch(`${API_BASE}/queue-position/${setId}`);
        setQueuePosition(posData.queuePosition);
      }
    } catch (err) {
      console.error("poll status error:", err);
    }
  }, [setId]);

  useEffect(() => {
    if (phase !== "processing") return;
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [phase, poll]);

  // ---------------- ไป Review ----------------
  const handleGoReview = () => {
    if (onReadyToReview) onReadyToReview(setId);
  };

  const handleReset = () => {
    setSetId(null);
    setPhase("upload");
    setStatus(null);
    setQueuePosition(null);
    setError(null);
  };

  return (
    <div style={{ maxWidth: 500, margin: "2rem auto", textAlign: "center" }}>
      {phase === "upload" && (
        <div style={{ padding: "2rem", border: "2px dashed #ccc", borderRadius: 8 }}>
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            disabled={uploading}
          />
          {uploading && <p>กำลังอัพโหลด + แยกหน้า...</p>}
          {error && <p style={{ color: "#d9534f" }}>เกิดข้อผิดพลาด: {error}</p>}
        </div>
      )}

      {phase === "processing" && status && (
        <div style={{ padding: "1.5rem", background: "#f5f5f5", borderRadius: 8 }}>
          <p>กำลังประมวลผล OCR...</p>
          <p>
            {status.pages.filter((p) => p.status === "done").length} / {status.pages.length} หน้า
          </p>
          {queuePosition != null && queuePosition > 0 && (
            <p>อยู่คิวลำดับที่ {queuePosition}</p>
          )}
        </div>
      )}

      {phase === "ready" && (
        <div style={{ padding: "1.5rem", background: "#eaf6ea", borderRadius: 8 }}>
          <p style={{ color: "#3c763d" }}>OCR เสร็จแล้ว พร้อมตรวจสอบ</p>
          <button
            onClick={handleGoReview}
            style={{
              marginTop: 12,
              padding: "10px 24px",
              background: "#5cb85c",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            ไปกรอกฟอร์ม / ตรวจสอบ
          </button>
        </div>
      )}

      {phase !== "upload" && (
        <button
          onClick={handleReset}
          style={{ marginTop: 12, background: "none", border: "none", color: "#888", cursor: "pointer" }}
        >
          ยกเลิก / อัพโหลดใหม่
        </button>
      )}
    </div>
  );
}