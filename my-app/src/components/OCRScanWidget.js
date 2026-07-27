/**
 * OCRScanWidget.js (v2 — Batch-based)
 * ================================================================
 * รองรับ Flow ใหม่: Upload 1 ไฟล์ = 1 Batch ที่อาจแบ่งเป็นหลาย "ชุด" (Set)
 * แต่ละชุดจะ ready_for_review ทยอยออกมาเรื่อยๆ ไม่ต้องรอทั้งไฟล์เสร็จ
 * (Concept: "เสร็จชุดไหน ปล่อยชุดนั้นออกมาเลย")
 * ================================================================
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { callGeminiSplitMerge, checkGeminiToggle } from "../utils/geminiSplitMerge";
import { useAuth } from "../contexts/AuthContext";

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

// ---------------- Thumbnail: ไอคอนแนบไฟล์ กดแล้วเด้ง Popup รูปเต็มขนาด ----------------
function SetThumbnail({ pageIds, onOpenPreview }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    const ids = Array.isArray(pageIds) ? pageIds : [];
    if (ids.length === 0 || loading) return;
    setError(false);
    setLoading(true);
    try {
      // ดึงทุกหน้าของชุดนี้มาพร้อมกัน (ไม่ใช่แค่หน้าแรก) ให้ Popup เลื่อนดู
      // ได้ครบทุกหน้าจริง — ปกติชุดละ 2-3 หน้า โหลดพร้อมกันไม่หนักเกินไป
      const blobUrls = await Promise.all(ids.map((id) => fetchImageBlobUrl(id)));
      onOpenPreview(blobUrls);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={handleClick}
      title="คลิกดูตัวอย่างเอกสาร (ทุกหน้า)"
      style={{
        width: 36, height: 46, flexShrink: 0, borderRadius: 4, background: "#f1f3f5",
        border: "0.5px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 15, color: error ? "#d9534f" : "#8b94a0",
      }}
    >
      {loading ? (
        <span style={{ fontSize: 10 }}>...</span>
      ) : error ? (
        <span style={{ fontSize: 10 }}>พลาด</span>
      ) : (
        "📎"
      )}
    </div>
  );
}

// ---------------- Popup แสดงรูปเต็มขนาด (Lightbox แบบเลื่อนดูได้หลายหน้า) ----------------
function ImagePreviewModal({ urls, onClose }) {
  const [index, setIndex] = useState(0);

  // Reset กลับไปหน้าแรกทุกครั้งที่เปิด Popup ใหม่ (ชุดใหม่)
  useEffect(() => {
    setIndex(0);
  }, [urls]);

  if (!urls || urls.length === 0) return null;
  const total = urls.length;
  const safeIndex = Math.min(index, total - 1);

  const goPrev = (e) => {
    e.stopPropagation();
    setIndex((i) => (i - 1 + total) % total);
  };
  const goNext = (e) => {
    e.stopPropagation();
    setIndex((i) => (i + 1) % total);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
        <img
          src={urls[safeIndex]}
          alt={`ตัวอย่างเอกสารเต็มขนาด หน้า ${safeIndex + 1} จาก ${total}`}
          style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 6, boxShadow: "0 4px 24px rgba(0,0,0,0.4)", display: "block" }}
        />
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: -14, right: -14, width: 30, height: 30, borderRadius: "50%",
            background: "#fff", border: "0.5px solid #ddd", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >
          ×
        </button>

        {total > 1 && (
          <>
            <button
              onClick={goPrev}
              title="หน้าก่อนหน้า"
              style={{
                position: "absolute", top: "50%", left: -18, transform: "translateY(-50%)",
                width: 36, height: 36, borderRadius: "50%", background: "#fff", border: "0.5px solid #ddd",
                cursor: "pointer", fontSize: 16,
              }}
            >
              ‹
            </button>
            <button
              onClick={goNext}
              title="หน้าถัดไป"
              style={{
                position: "absolute", top: "50%", right: -18, transform: "translateY(-50%)",
                width: 36, height: 36, borderRadius: "50%", background: "#fff", border: "0.5px solid #ddd",
                cursor: "pointer", fontSize: 16,
              }}
            >
              ›
            </button>
            <div style={{
              position: "absolute", bottom: -32, left: "50%", transform: "translateX(-50%)",
              fontSize: 12, color: "#fff", background: "rgba(0,0,0,0.5)", padding: "3px 10px", borderRadius: 10,
            }}>
              หน้า {safeIndex + 1} จาก {total}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- ส่วน Monitor: คิวแบบ Flat ตามชุดเอกสาร (Set) ไม่ใช่ตามไฟล์ ----------------
// เหตุผล: "ชุด" (1 invoice) คือหน่วยของงานจริง ไม่ใช่ "ไฟล์" — ไฟล์หนึ่งอาจ
// แบ่งเป็นหลายสิบชุด แต่ละชุดควรเข้าคิว/หลุดคิว/เลื่อน priority ได้อิสระ
// ต่อกัน ไม่ต้องมีชื่อไฟล์ครอบเป็น container อีกต่อไป
// เวลาเฉลี่ยต่อหน้า (จาก log จริงที่สังเกตได้ ~29.91s ต่อหน้า ปัดเป็น 30)
// ใช้แค่ "ประมาณการ" ให้ Progress Bar ขยับต่อเนื่องระหว่างรอหน้าถัดไปเสร็จ
// จริง — ไม่ใช่ตัวเลขจริงจาก Backend เพราะ % จริงกระโดดเป็นขั้นบันได
// (0% -> 50% -> 100% สำหรับ Set 2 หน้า) ซึ่งดูเหมือนค้างจนกว่าจะเสร็จทันที
const AVG_SECONDS_PER_PAGE = 30;

// ---------------- Progress Bar ที่ประมาณการเวลาต่อเนื่อง (ไม่รอ Backend อย่างเดียว) ----------------
function EstimatedSetProgress({ pagesDone, totalPages, isStarted, isPriority }) {
  const [, forceTick] = useState(0);
  const lastPagesDoneRef = useRef(pagesDone);
  const sinceRef = useRef(Date.now());

  // ทุกครั้งที่ pages_done จริงจาก Backend เปลี่ยน (เสร็จอีกหน้า) รีเซ็ต
  // จุดเริ่มนับเวลาใหม่ ให้ประมาณการ "หน้าถัดไป" ต่อจากจุดนี้
  useEffect(() => {
    if (pagesDone !== lastPagesDoneRef.current) {
      lastPagesDoneRef.current = pagesDone;
      sinceRef.current = Date.now();
    }
  }, [pagesDone]);

  // Tick ทุก 1 วินาทีตอนกำลังทำงานจริง เพื่อขยับแถบต่อเนื่อง (ไม่ต้องรอ Poll 3 วิ)
  useEffect(() => {
    if (!isStarted) return undefined;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isStarted]);

  let pct;
  let label;
  if (!isStarted) {
    pct = isPriority ? 100 : 0;
    label = isPriority ? "รอคิวถัดไป" : "รอคิว";
  } else {
    const basePct = totalPages > 0 ? (pagesDone / totalPages) * 100 : 0;
    const nextPct = totalPages > 0 ? Math.min(100, ((pagesDone + 1) / totalPages) * 100) : 100;
    const elapsedSec = (Date.now() - sinceRef.current) / 1000;
    const estimatedFraction = Math.min(1, elapsedSec / AVG_SECONDS_PER_PAGE);
    pct = basePct + (nextPct - basePct) * estimatedFraction;
    label = `~${Math.round(pct)}%`;
  }

  return (
    <>
      <span style={{ fontSize: 11, color: "#8b94a0" }}>{label}</span>
      <div style={{ width: "100%", height: 5, background: "#eef0f2", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            height: "100%",
            background: isStarted ? "#5b9279" : (isPriority ? "#c98a2c" : "#d8dde3"),
            transition: "width 1s linear",
          }}
        />
      </div>
    </>
  );
}

function BatchHistory({ onSelectBatch }) {
  const { userRole } = useAuth();
  const isOwner = String(userRole || "").toLowerCase() === "owner";
  // Default เป็น All Queue สำหรับ Owner — งานทั้งหมดรันบน Server ที่ใช้ร่วมกัน
  // จริงๆ อยู่แล้ว (ไม่มี Local OCR แยกต่อเครื่อง) จึงควรเห็นภาพรวมทุกคนก่อน
  // เป็นค่าเริ่มต้น ส่วนคนที่ไม่ใช่ Owner ไม่มี tab All Queue ให้เลือกอยู่แล้ว
  // เลย default เป็น "mine" เหมือนเดิมไป
  const [queueTab, setQueueTab] = useState(isOwner ? "all" : "mine"); // "mine" | "all"

  // แก้ race condition: useState เริ่มต้นด้านบนคำนวณค่าแค่ครั้งเดียวตอน
  // mount — ถ้าตอนนั้น isOwner ยังไม่ resolve (userRole จาก useAuth() ยัง
  // โหลดไม่เสร็จ) ค่าจะล็อกเป็น "mine" ตลอดไป แม้ isOwner จะกลายเป็น true
  // ในเฟรมถัดไปก็ตาม (เห็น tab "All Queue" โผล่มา แต่ tab ที่ active ไม่ขยับ
  // ตาม) ใช้ useEffect เซ็ตซ้ำอีกทีตอนที่รู้แน่ชัดว่าเป็น Owner แล้ว
  // (ครั้งเดียวเท่านั้น กัน gate ไม่ให้ทับ ถ้าเจ้าตัวกดสลับ tab เองไปแล้ว)
  const defaultTabAppliedRef = useRef(false);
  useEffect(() => {
    if (isOwner && !defaultTabAppliedRef.current) {
      setQueueTab("all");
      defaultTabAppliedRef.current = true;
    }
  }, [isOwner]);
  const [activeSets, setActiveSets] = useState([]);
  const [groupingBatches, setGroupingBatches] = useState([]); // Batch ที่ยังหาจุดตัดอยู่ (ยังไม่มี ocr_sets)
  const [loading, setLoading] = useState(true);
  const [prioritizing, setPrioritizing] = useState(null); // setId ที่กำลังกดเลื่อนอยู่
  const [previewImages, setPreviewImages] = useState(null); // array ของ blob URL ทุกหน้าของชุดที่กำลัง Popup อยู่ (ถ้ามี)

  const loadActiveSets = useCallback(async () => {
    try {
      const scopeParam = queueTab === "all" && isOwner ? "?scope=all" : "";
      const [setsData, groupingData] = await Promise.all([
        apiFetch(`${API_BASE}/active-sets${scopeParam}`),
        apiFetch(`${API_BASE}/grouping-in-progress${scopeParam}`),
      ]);
      setActiveSets(setsData.activeSets || []);
      setGroupingBatches(groupingData.batches || []);
    } catch (err) {
      console.error("load active sets error:", err);
    } finally {
      setLoading(false);
    }
  }, [queueTab, isOwner]);

  useEffect(() => {
    loadActiveSets();
    const interval = setInterval(loadActiveSets, 3000); // ให้ % และลำดับ priority ขยับสด
    return () => clearInterval(interval);
  }, [loadActiveSets]);

  const handlePrioritize = async (e, setId) => {
    e.stopPropagation();
    setPrioritizing(setId);
    try {
      await apiFetch(`${API_BASE}/set/${setId}/prioritize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: 1 }),
      });
      loadActiveSets(); // รีเฟรชทันทีให้เห็นลำดับใหม่ ไม่ต้องรอ poll รอบถัดไป
    } catch (err) {
      alert(`เลื่อนคิวไม่สำเร็จ: ${err.message}`);
    } finally {
      setPrioritizing(null);
    }
  };

  if (loading) return <p style={{ color: "#888", marginTop: 24 }}>กำลังโหลดคิว...</p>;

  // เรียง: กำลังทำงานจริง (pages_done > 0) ก่อนเสมอ, ถัดมาตาม priority (สูงก่อน),
  // เท่ากันแล้วเรียงตามลำดับที่ backend ส่งมา (created_at ASC อยู่แล้ว)
  const sorted = [...activeSets].sort((a, b) => {
    const aStarted = a.pages_done > 0 ? 1 : 0;
    const bStarted = b.pages_done > 0 ? 1 : 0;
    if (aStarted !== bStarted) return bStarted - aStarted;
    return (b.priority || 0) - (a.priority || 0);
  });

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "0.5px solid #eef0f2" }}>
        <div
          onClick={() => { defaultTabAppliedRef.current = true; setQueueTab("mine"); }}
          style={{
            padding: "6px 14px", fontSize: 13, cursor: "pointer",
            fontWeight: queueTab === "mine" ? 500 : 400,
            color: queueTab === "mine" ? "#1a3a5c" : "#8b94a0",
            borderBottom: queueTab === "mine" ? "2px solid #1a3a5c" : "2px solid transparent",
          }}
        >
          My Queue
        </div>
        {isOwner && (
          <div
            onClick={() => { defaultTabAppliedRef.current = true; setQueueTab("all"); }}
            style={{
              padding: "6px 14px", fontSize: 13, cursor: "pointer",
              fontWeight: queueTab === "all" ? 500 : 400,
              color: queueTab === "all" ? "#1a3a5c" : "#8b94a0",
              borderBottom: queueTab === "all" ? "2px solid #1a3a5c" : "2px solid transparent",
            }}
          >
            All Queue
          </div>
        )}
      </div>

      <p style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>
        คิว — {sorted.length} ชุดกำลังรอ
        {groupingBatches.length > 0 && ` (+${groupingBatches.length} ไฟล์กำลังแบ่งกลุ่ม)`}
      </p>

      {sorted.length === 0 && groupingBatches.length === 0 && (
        <p style={{ fontSize: 13, color: "#b0b6bd", padding: "20px 0", textAlign: "center" }}>
          ไม่มีงานในคิว — ทุกไฟล์ประมวลผลเสร็จแล้ว ดูผลได้ที่ตาราง OCR Result
        </p>
      )}

      {/* ไฟล์ที่ยังหาจุดตัดเอกสารอยู่ (ยังไม่มี ocr_sets เลยสักชุด) — โชว์แบบ
          indeterminate (ไม่รู้ % เพราะยังไม่รู้ว่าจะแบ่งเป็นกี่ชุด) แทนที่จะ
          ปล่อยให้คิวดูว่างเปล่าทั้งที่กำลังทำงานอยู่จริง */}
      {groupingBatches.map((g) => (
        <div
          key={g.batch_id}
          style={{
            display: "flex", gap: 10, alignItems: "center",
            padding: "10px 14px", border: "1px solid #ddd", borderRadius: 6,
            marginBottom: 8, background: "#eef2fb",
          }}
        >
          <div style={{
            width: 36, height: 46, flexShrink: 0, borderRadius: 4, background: "#dde6f7",
            border: "0.5px solid #c9d6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}>
            📄
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#1a3a5c" }}>
                {g.source_file_name || "(ไม่ทราบชื่อไฟล์)"}
                <span style={{ fontSize: 11, color: "#8b94a0", fontWeight: 400, marginLeft: 6 }}>
                  ({g.pages_grouping} หน้า)
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {queueTab === "all" && g.uploaded_by_name && (
                  <span style={{ fontSize: 11, color: "#8b94a0" }}>{g.uploaded_by_name}</span>
                )}
                <span style={{ fontSize: 11, color: "#3b5aa8" }}>กำลังแบ่งกลุ่มเอกสาร...</span>
              </span>
            </div>
            <div style={{ width: "100%", height: 5, background: "#dde6f7", borderRadius: 3, overflow: "hidden" }}>
              <div className="ocr-indeterminate-bar" style={{ height: "100%", width: "40%", background: "#3b5aa8" }} />
            </div>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes ocr-indeterminate-slide {
          0% { margin-left: -40%; }
          100% { margin-left: 100%; }
        }
        .ocr-indeterminate-bar {
          animation: ocr-indeterminate-slide 1.2s ease-in-out infinite;
        }
      `}</style>

      {sorted.map((s) => {
        const isStarted = s.pages_done > 0 || s.pages_processing > 0;
        const isPriority = s.priority > 0;
        return (
          <div
            key={s.set_id}
            onClick={() => onSelectBatch(s.batch_id)}
            style={{
              display: "flex", gap: 10, alignItems: "center",
              padding: "10px 14px", border: "1px solid #ddd", borderRadius: 6,
              marginBottom: 8, cursor: "pointer",
              background: isStarted ? "#fff8ec" : "#fff",
            }}
          >
            <SetThumbnail pageIds={s.page_ids} onOpenPreview={setPreviewImages} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "#1a3a5c" }}>
                  {s.invoice_no ? `ชุด ${s.invoice_no}` : (s.source_file_name || "(ไม่ทราบชื่อไฟล์)")}
                  <span style={{ fontSize: 11, color: "#8b94a0", fontWeight: 400, marginLeft: 6 }}>
                    ({s.pages_done}/{s.total_pages} หน้า)
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {queueTab === "all" && s.uploaded_by_name && (
                    <span style={{ fontSize: 11, color: "#8b94a0" }}>{s.uploaded_by_name}</span>
                  )}
                  {isPriority && !isStarted && (
                    <span style={{ fontSize: 10, background: "#faeeda", color: "#854f0b", padding: "2px 7px", borderRadius: 8 }}>
                      priority
                    </span>
                  )}
                  {isOwner && !isStarted && !isPriority && (
                    <button
                      onClick={(e) => handlePrioritize(e, s.set_id)}
                      disabled={prioritizing === s.set_id}
                      style={{
                        fontSize: 11, padding: "3px 9px", borderRadius: 5, border: "0.5px solid #d8dde3",
                        background: "#fafbfc", color: "#1a3a5c", cursor: prioritizing === s.set_id ? "wait" : "pointer",
                      }}
                    >
                      {prioritizing === s.set_id ? "..." : "เลื่อนคิว"}
                    </button>
                  )}
                </span>
              </div>
              <EstimatedSetProgress
                pagesDone={s.pages_done}
                totalPages={s.total_pages}
                isStarted={isStarted}
                isPriority={isPriority}
              />
            </div>
          </div>
        );
      })}
      <ImagePreviewModal urls={previewImages} onClose={() => setPreviewImages(null)} />
    </div>
  );
}

export default function OCRScanWidget({ documentType = "ap_invoice", onReadyToReview }) {
  const { userRole } = useAuth();
  const isOwner = String(userRole || "").toLowerCase() === "owner";
  const [batchId, setBatchId] = useState(null);
  useEffect(() => {
    setSelectedSetIds(new Set());
  }, [batchId]);
  const [phase, setPhase] = useState("upload"); // upload | processing
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null); // ไฟล์ที่เลือกไว้ รอกด Start Processing
  const [showJobQueue, setShowJobQueue] = useState(false); // toggle แสดง/ซ่อน BatchHistory
  const [activeTab, setActiveTab] = useState("ocr"); // "ocr" | "bucket"
  const [batchStatus, setBatchStatus] = useState(null); // { batch, pageProgress, sets }
  const [error, setError] = useState(null);
  const [previewSetId, setPreviewSetId] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [selectedSetIds, setSelectedSetIds] = useState(new Set()); // Set ของ set.id ที่ติ๊กเลือกไว้ในตาราง OCR Result
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [formValues, setFormValues] = useState({}); // { fieldName: currentValue } — แก้ไขได้ก่อน Approve
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null); // { message, existingSetId }
  const [batchHistory, setBatchHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [geminiEnabled, setGeminiEnabled] = useState(true); // Default เปิดไว้ก่อน รอโหลดค่าจริงจาก Backend
  const [geminiToggleLoading, setGeminiToggleLoading] = useState(false);
  const [queueBadgeCount, setQueueBadgeCount] = useState(0);

  // ---------------- Badge ตัวเลขบนปุ่ม "Job queue" ----------------
  // ใช้แหล่งข้อมูลเดียวกับที่ Modal (BatchHistory) ใช้จริง (/active-sets +
  // /grouping-in-progress) แทนที่จะคำนวณแยกจาก /batches เอง — ก่อนหน้านี้
  // Badge นับที่ระดับ "ไฟล์" ในขณะที่ Modal นับที่ระดับ "ชุด" ทำให้ตัวเลข
  // ไม่ตรงกัน (เช่น Modal มี 8 ชุด แต่ Badge ไม่ขึ้นเลข) ต้อง Poll เองแยก
  // จาก BatchHistory เพราะ BatchHistory component ถูก mount เฉพาะตอน
  // Modal เปิดอยู่เท่านั้น — Badge ต้องรู้ค่าแม้ Modal จะปิดอยู่ก็ตาม
  useEffect(() => {
    let cancelled = false;
    const loadQueueBadge = async () => {
      try {
        const scopeParam = isOwner ? "?scope=all" : "";
        const [setsData, groupingData] = await Promise.all([
          apiFetch(`${API_BASE}/active-sets${scopeParam}`),
          apiFetch(`${API_BASE}/grouping-in-progress${scopeParam}`),
        ]);
        if (cancelled) return;
        const setsCount = (setsData.activeSets || []).length;
        const groupingCount = (groupingData.batches || []).length;
        setQueueBadgeCount(setsCount + groupingCount);
      } catch (err) {
        console.error("load queue badge count error:", err);
      }
    };
    loadQueueBadge();
    const interval = setInterval(loadQueueBadge, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOwner]);

  // ---------------- โหลดสถานะ Toggle Gemini ตอนเปิดหน้า ----------------
  useEffect(() => {
    checkGeminiToggle()
      .then((data) => setGeminiEnabled(data.enabled))
      .catch((err) => console.error("โหลดสถานะ Gemini Toggle ไม่สำเร็จ:", err));
  }, []);

  const handleToggleGemini = async () => {
    if (!isOwner) {
      alert("เฉพาะ Owner เท่านั้นที่มีสิทธิ์เปลี่ยนโหมด Gemini OCR / OCR extract");
      return;
    }
    if (geminiToggleLoading) return;
    const newValue = !geminiEnabled;
    setGeminiToggleLoading(true);
    try {
      await apiFetch(`${API_BASE}/gemini/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newValue }),
      });
      setGeminiEnabled(newValue);
    } catch (err) {
      console.error("เปลี่ยนสถานะ Gemini ไม่สำเร็จ:", err);
      alert(`เปลี่ยนสถานะไม่สำเร็จ: ${err.message}`);
    } finally {
      setGeminiToggleLoading(false);
    }
  };

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

  // ---------------- Auto-select Batch ล่าสุด ให้ตาราง OCR Result เป็น Default เสมอ ----------------
  // Patch 91: เดิมเช็คแค่ !batchId (ทำงานครั้งเดียวตอนยังไม่เคยเลือก) ทำให้
  // พอมี batchId ค้างจาก Batch เก่าแล้ว จะไม่ Auto-switch ไป Batch ใหม่อีกเลย
  // แม้ batchHistory (poll ทุก 10 วิ) จะมี Batch ใหม่ขึ้นมาบนสุดแล้วก็ตาม --
  // ผู้ใช้ต้องกด Refresh หน้าเว็บเองถึงจะเห็นงานที่เพิ่งเสร็จ (root cause ของ
  // "ส่งงานมาแล้วไม่ขึ้นเอง") เปลี่ยนเป็นเทียบ batch_id ล่าสุดแทน ให้ Auto-switch
  // ไป Batch ใหม่สุดเสมอทุกครั้งที่มีงานใหม่เข้ามา
  useEffect(() => {
    if (batchHistory.length > 0 && batchHistory[0].batch_id !== batchId) {
      setBatchId(batchHistory[0].batch_id);
    }
  }, [batchHistory]);

  // ---------------- เลือกไฟล์ (ยังไม่ Upload — รอกด Start Processing) ----------------
  const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

  // ---------------- ตรวจสอบ+ตั้งไฟล์ที่เลือก (ใช้ร่วมกันทั้งคลิกเลือกและลากวาง) ----------------
  const processFile = (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("รองรับเฉพาะไฟล์ PDF เท่านั้น");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("ไฟล์ใหญ่เกิน 15MB");
      return;
    }
    setSelectedFile(file);
    setError(null);
  };

  const handleFileSelect = (e) => {
    processFile(e.target.files[0]);
  };

  // ---------------- Drag & Drop ----------------
  // preventDefault() ต้องเรียกทั้ง onDragOver และ onDrop เสมอ ไม่งั้น browser
  // จะ default ไปเปิดไฟล์แทนการยอมให้ drop (onDrop จะไม่ทำงานเลยถ้าลืมจุดนี้
  // ใน onDragOver) — นี่คือสาเหตุที่ "ลาก PDF มาวางที่นี่" ไม่เคยทำงานมาก่อน
  // เพราะไม่เคยมี Event Handler พวกนี้อยู่ในโค้ดเลยสักบรรทัดเดียว
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    processFile(file);
  };

  // ---------------- Upload จริง: Trigger ตอนกดปุ่ม Start Processing ----------------
  const handleStartProcessing = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
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
      setSelectedFile(null);
      setShowJobQueue(true); // เปิด Job Queue ให้เห็นไฟล์ที่เพิ่ง Upload ไปวิ่งอยู่ทันที
      loadBatchHistory(); // รีเฟรช Badge ตัวเลขบนปุ่ม Job Queue ทันที ไม่ต้องรอ Poll รอบถัดไป
      // หมายเหตุ: ไม่ setBatchId / ไม่ setPhase("processing") แล้ว — อยู่หน้า Upload ต่อได้
      // งานวิ่งพื้นหลัง ดูผลได้จาก Panel Job Queue (BatchHistory) แทน

      // ให้ Gemini ช่วย Split & Merge (หรือ Fallback ถ้าใช้ไม่ได้) — รันเป็น
      // Background Task ไม่ Block UI ตรงนี้ (ไม่ await)
      resolveGrouping(data.batchId, data.pages || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ---------------- Gemini Split & Merge (หรือ Fallback) หลัง Upload เสร็จ ----------------
  const resolveGrouping = async (batchId, pages) => {
    try {
      const token = getAuthToken();
      const pageBlobs = await Promise.all(
        pages.map(async (p) => {
          const imgRes = await fetch(`${API_BASE}/page-image/${p.pageId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const blob = await imgRes.blob();
          return { pageNumber: p.pageNumber, imageBlob: blob };
        })
      );

      const result = await callGeminiSplitMerge(pageBlobs, batchId);

      if (result.usedFallback) {
        console.warn("[OCR] Gemini ใช้ไม่ได้ -> Fallback (Worker เดา Boundary เอง):", result.reason);
        await apiFetch(`${API_BASE}/skip-grouping/${batchId}`, { method: "POST" });
      } else {
        await apiFetch(`${API_BASE}/apply-groups/${batchId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groups: result.groups }),
        });
      }
    } catch (err) {
      // ไม่ว่าจะพังตรงไหนก็ตาม -> Fallback ไป skip-grouping เสมอ กันหน้าค้างที่
      // 'pending_grouping' ตลอดไปโดยไม่มีใครมาปลดล็อก
      console.error("[OCR] resolveGrouping ล้มเหลว fallback ไป skip-grouping:", err);
      try {
        await apiFetch(`${API_BASE}/skip-grouping/${batchId}`, { method: "POST" });
      } catch (err2) {
        console.error("[OCR] skip-grouping fallback ก็ล้มเหลวด้วย:", err2);
      }
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
    if (!batchId) return;
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [batchId, poll]);

  // ---------------- ลบทีละชุดเอกสาร (Set) ----------------
  const handleDeleteSet = async (setId, invoiceNo) => {
    const ok = window.confirm(
      `ลบชุดเอกสาร "${invoiceNo || "(ไม่มีเลข Invoice)"}" ออกจากตารางนี้?\n\nการลบนี้ไม่สามารถย้อนกลับได้`
    );
    if (!ok) return;
    try {
      await apiFetch(`${API_BASE}/set/${setId}`, { method: "DELETE" });
      // Patch 86: ถ้าชุดที่ลบตรงกับชุดที่ Panel "ผล OCR" กำลังโชว์ค้างอยู่
      // ต้อง Clear State ปิด Panel ไปด้วยเสมอ ไม่งั้นจะเห็นข้อมูลค้าง (Stale)
      // ทั้งที่ข้อมูลจริงถูกลบไปจาก Database แล้ว (previewSetId ยังกระทบ
      // การคำนวณ Stepper ขั้นที่ 4 "Verify" ด้วย ถ้าไม่ Clear จะค้างผิด Step)
      if (setId === previewSetId) {
        setPreviewSetId(null);
        setPreviewResult(null);
      }
      poll(); // รีเฟรชตารางทันทีหลังลบสำเร็จ
    } catch (err) {
      alert(`ลบไม่สำเร็จ: ${err.message}`);
    }
  };

  // ---------------- ลบหลายชุดพร้อมกัน (Select + Select All) ----------------
  // ใช้ endpoint DELETE /set/:setId ตัวเดิมที่มีอยู่แล้ว แค่ยิงวนตามรายการ
  // ที่เลือกไว้ ไม่ต้องสร้าง Endpoint ใหม่ฝั่ง Backend เลย
  const handleDeleteSelected = async (selectedIds) => {
    const count = selectedIds.length;
    if (count === 0) return;
    const ok = window.confirm(`ลบชุดเอกสารที่เลือกไว้ทั้งหมด ${count} รายการ?\n\nการลบนี้ไม่สามารถย้อนกลับได้`);
    if (!ok) return;
    setBulkDeleting(true);
    const failed = [];
    for (const setId of selectedIds) {
      try {
        await apiFetch(`${API_BASE}/set/${setId}`, { method: "DELETE" });
      } catch (err) {
        failed.push(setId);
      }
    }
    setBulkDeleting(false);
    setSelectedSetIds(new Set());
    // Patch 86: เหมือนกับ handleDeleteSet — ถ้า Panel "ผล OCR" กำลังโชว์ชุด
    // ที่เพิ่งถูกลบไป (อยู่ในรายการที่เลือกลบครั้งนี้) ต้อง Clear ปิด Panel ด้วย
    if (previewSetId && selectedIds.includes(previewSetId)) {
      setPreviewSetId(null);
      setPreviewResult(null);
    }
    poll();
    if (failed.length > 0) {
      alert(`ลบไม่สำเร็จ ${failed.length} จาก ${count} รายการ`);
    }
  };

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

  // ---------------- Stepper: คำนวณขั้นปัจจุบัน (1-5) จาก State จริง ----------------
  const STEP_LABELS = ["Upload", "OCR extract", "Job end", "Verify", "Batch preview"];
  const approvedCount = sets.filter((s) => s.status === "approved").length;
  let currentStep = 1;
  if (phase === "upload") {
    currentStep = 1;
  } else if (phase === "processing") {
    if (donePages < totalPages) {
      currentStep = 2; // OCR extract (รวมช่วงรอคิว)
    } else if (sets.length > 0 && approvedCount === sets.length) {
      currentStep = 5; // Batch preview (Approve ครบทุกชุดแล้ว)
    } else if (previewSetId) {
      currentStep = 4; // Verify (กำลังเปิด Preview อยู่ ณ ขณะนั้นจริงๆ เท่านั้น — Transient)
    } else {
      currentStep = 3; // Job end (OCR ครบทุกหน้าแล้ว รอเริ่มตรวจ)
    }
  }

  return (
    <div className="ocr-widget-root" style={{ width: "100%", maxWidth: "var(--ocr-max-width)", margin: "8px auto", padding: "0 10px", boxSizing: "border-box" }}>
      <style>{`
        .ocr-widget-root {
          --ocr-max-width: 960px;
          --ocr-banner-pad: 12px 20px;
          --ocr-icon-size: 32px;
          --ocr-stepper-pad: 6px 24px 6px;
          --ocr-step-circle: 22px;
          --ocr-step-font: 12px;
          --ocr-step-label-font: 11px;
          --ocr-body-pad: 12px;
          --ocr-dz-icon: 24px;
        }
        @media (min-width: 1400px) {
          .ocr-widget-root {
            --ocr-max-width: 1400px;
            --ocr-banner-pad: 16px 24px;
            --ocr-icon-size: 40px;
            --ocr-stepper-pad: 10px 28px 10px;
            --ocr-step-circle: 28px;
            --ocr-step-font: 14px;
            --ocr-step-label-font: 13px;
            --ocr-body-pad: 16px;
            --ocr-dz-icon: 30px;
          }
        }
        /* จอ Desktop ใหญ่ (>= 1800px) — 1400px เดิมเหลือขอบว่างข้างเยอะเกินไป
           ขยายเพิ่มอีกชั้น ให้ตารางใช้พื้นที่ได้เต็มขึ้น โดยยังเว้นขอบซ้าย-ขวา
           ไว้บ้างพอสมควร (ไม่ยืดเต็ม 100% เพราะแถวยาวเกินจะอ่านยาก) */
        @media (min-width: 1800px) {
          .ocr-widget-root {
            --ocr-max-width: 1800px;
          }
        }
      `}</style>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: "0.5px solid #d8dde3", marginBottom: 12 }}>
          {/* Header Banner */}
          <div style={{ background: "#1a3a5c", padding: "var(--ocr-banner-pad)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: "var(--ocr-icon-size)", height: "var(--ocr-icon-size)", borderRadius: 8, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                📄
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#fff" }}>Import document</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#b9c9da" }}>Document import · OCR-powered</p>
              </div>
            </div>
            <button
              onClick={handleToggleGemini}
              disabled={geminiToggleLoading}
              title={
                !isOwner
                  ? "เฉพาะ Owner เท่านั้นที่มีสิทธิ์เปลี่ยนโหมดนี้"
                  : geminiEnabled
                  ? "Gemini OCR เปิดอยู่ — คลิกเพื่อปิด (กลับไปใช้ OCR extract ปกติ)"
                  : "OCR extract (PaddleOCR ปกติ) — คลิกเพื่อเปิด Gemini OCR"
              }
              style={{
                background: geminiEnabled ? "#5b9279" : "rgba(255,255,255,0.15)",
                color: "#fff", fontSize: 12, padding: "5px 10px", borderRadius: 20,
                border: "none", cursor: !isOwner ? "not-allowed" : geminiToggleLoading ? "wait" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
                opacity: !isOwner ? 0.5 : geminiToggleLoading ? 0.6 : 1,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: geminiEnabled ? "#c9f2da" : "#8b94a0", flexShrink: 0 }} />
              {geminiEnabled ? "Gemini OCR" : "OCR extract"}
            </button>
          </div>

          {/* Stepper: Indicator แสดงสถานะอย่างเดียว กดย้อนขั้นไม่ได้ */}
      <div style={{ borderBottom: "0.5px solid #eef0f2", padding: "var(--ocr-stepper-pad)" }}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {STEP_LABELS.map((label, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum <= currentStep;
            return (
              <div key={label} style={{ flex: 1, textAlign: "center", position: "relative" }}>
                {idx > 0 && (
                  <div
                    style={{
                      position: "absolute", top: 11, left: 0, width: "100%", height: 2,
                      background: stepNum <= currentStep ? "#1a3a5c" : "#d8dde3", zIndex: 0,
                    }}
                  />
                )}
                <div
                  style={{
                    position: "relative", zIndex: 1, width: "var(--ocr-step-circle)", height: "var(--ocr-step-circle)", borderRadius: "50%",
                    background: isActive ? "#1a3a5c" : "#e3e7eb", color: isActive ? "#fff" : "#8b94a0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "var(--ocr-step-font)", fontWeight: 500, margin: "0 auto 5px",
                  }}
                >
                  {stepNum}
                </div>
                <p style={{ margin: 0, fontSize: "var(--ocr-step-label-font)", fontWeight: isActive ? 500 : 400, color: isActive ? "#1a3a5c" : "#8b94a0" }}>
                  {label}
                </p>
              </div>
            );
          })}
        </div>
      </div>

          {/* Body */}
          <div style={{ padding: "var(--ocr-body-pad)" }}>
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: isDragging ? "2px dashed #5b9279" : "1px dashed #7fa0b8",
                background: isDragging ? "#e3f0e9" : "#e9f1f7",
                borderRadius: 10, padding: "8px 16px", marginBottom: 12,
                transition: "border 0.15s ease, background 0.15s ease",
              }}
            >
              <label style={{ cursor: uploading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                <input type="file" accept="application/pdf" onChange={handleFileSelect} disabled={uploading} style={{ display: "none" }} />
                <div style={{ width: "var(--ocr-dz-icon)", height: "var(--ocr-dz-icon)", borderRadius: "50%", background: "#5b9279", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: "#fff" }}>
                  ⬆
                </div>
                <span style={{ fontSize: 13, color: "#1a3a5c", flex: 1 }}>
                  {isDragging
                    ? "ปล่อยไฟล์ตรงนี้ได้เลย"
                    : selectedFile
                      ? selectedFile.name
                      : (<>ลาก PDF มาวางที่นี่ หรือ <span style={{ color: "#5b9279", fontWeight: 500 }}>คลิกเพื่อเลือกไฟล์</span></>)}
                </span>
                <span style={{ fontSize: 11, color: "#7c8894", whiteSpace: "nowrap" }}>PDF · Max 15MB</span>
              </label>
            </div>

            {uploading && <p style={{ color: "#1a3a5c", fontSize: 13 }}>กำลังอัพโหลด + แยกหน้า...</p>}
            {error && <p style={{ color: "#d9534f", fontSize: 13 }}>เกิดข้อผิดพลาด: {error}</p>}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {(() => {
                return (
                  <button
                    onClick={() => setShowJobQueue((v) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1a3a5c", border: "0.5px solid #d8dde3", background: "#fafbfc", padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}
                  >
                    Job queue
                    {queueBadgeCount > 0 && (
                      <span style={{ background: "#e1eaf0", color: "#1a3a5c", fontSize: 11, padding: "1px 7px", borderRadius: 10 }}>
                        {queueBadgeCount}
                      </span>
                    )}
                  </button>
                );
              })()}
              <button
                onClick={handleStartProcessing}
                disabled={!selectedFile || uploading}
                style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: "#fff",
                  background: "#5b9279", border: "none", padding: "10px 18px", borderRadius: 8,
                  cursor: !selectedFile || uploading ? "not-allowed" : "pointer",
                  opacity: !selectedFile || uploading ? 0.6 : 1,
                }}
              >
                Start processing →
              </button>
            </div>
          </div>
        </div>

      {/* Tab Bar: OCR Result / Batch Bucket */}
      <div style={{ display: "flex", borderBottom: "0.5px solid #d8dde3", marginBottom: 12 }}>
        <div
          onClick={() => setActiveTab("ocr")}
          style={{
            padding: "10px 18px", fontSize: 14, cursor: "pointer",
            fontWeight: activeTab === "ocr" ? 500 : 400,
            color: activeTab === "ocr" ? "#1a3a5c" : "#8b94a0",
            borderBottom: activeTab === "ocr" ? "2px solid #1a3a5c" : "2px solid transparent",
          }}
        >
          OCR Result
        </div>
        <div
          onClick={() => setActiveTab("bucket")}
          style={{
            padding: "10px 18px", fontSize: 14, cursor: "pointer",
            fontWeight: activeTab === "bucket" ? 500 : 400,
            color: activeTab === "bucket" ? "#1a3a5c" : "#8b94a0",
            borderBottom: activeTab === "bucket" ? "2px solid #1a3a5c" : "2px solid transparent",
          }}
        >
          Batch Bucket
        </div>
      </div>

      {activeTab === "bucket" && (
        <div style={{ background: "#fff", borderRadius: 12, border: "0.5px dashed #d8dde3", padding: "40px 20px", textAlign: "center", color: "#b0b6bd", fontSize: 13 }}>
          Batch Bucket — ยังไม่มีเนื้อหา (รอออกแบบ Column/Data ต่อภายหลัง)
        </div>
      )}

      {activeTab === "ocr" && (
      <>
      {showJobQueue && (
        <div
          onClick={() => setShowJobQueue(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, padding: 20, width: "90%", maxWidth: 720,
              maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <strong style={{ fontSize: 15, color: "#1a3a5c" }}>Job queue</strong>
              <button
                onClick={() => setShowJobQueue(false)}
                style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" }}
              >
                ×
              </button>
            </div>
            <BatchHistory
              onSelectBatch={(selectedBatchId) => {
                setBatchId(selectedBatchId);
                setPhase("processing");
                setShowJobQueue(false);
              }}
            />
          </div>
        </div>
      )}

      <div>
        {batchHistory.length > 0 && (
          <p style={{ fontSize: 12, color: "#8b94a0", marginBottom: 8 }}>
            แสดงผลจาก Batch ล่าสุด: {batchHistory[0]?.source_file_name || "-"}
          </p>
        )}

        {/* รายการชุดเอกสาร — Table เต็มความกว้าง เป็น Default เสมอ (ไม่ต้องรอ Process) */}
        {(() => {
          // OCR Result table = "ผลลัพธ์" เท่านั้น (ready_for_review ขึ้นไป) —
          // ชุดที่ยัง processing (OCR เต็มรูปแบบยังไม่เสร็จ) อยู่ในคิว ไม่ใช่
          // ผลลัพธ์ ให้ดูความคืบหน้าที่ Job Queue modal (มี progress bar
          // อยู่แล้ว) แทน ไม่งั้นตารางนี้จะปนกันทั้ง "เสร็จแล้ว" กับ "กำลังทำ"
          const resultSets = sets.filter((s) => s.status !== "processing");
          const numberedSets = resultSets.map((s, i) => ({ ...s, _num: i + 1 }));
          const activeSets = numberedSets.filter((s) => s.status !== "approved");
          const completedSets = numberedSets.filter((s) => s.status === "approved");

          const thStyle = {
            textAlign: "left", padding: "10px 16px", fontSize: 12, fontWeight: 500,
            color: "#8b94a0", borderBottom: "0.5px solid #eef0f2", whiteSpace: "nowrap",
            background: "#fafbfc", position: "sticky", top: 0,
          };
          const tdStyle = { padding: "12px 16px", fontSize: 13, verticalAlign: "middle" };

          const STATUS_BADGE_COLOR = {
            ready_for_review: { bg: "#faeeda", color: "#854f0b" },
            approved: { bg: "#eaf3de", color: "#27500a" },
            pending: { bg: "#f1eee8", color: "#5f5e5a" },
            processing: { bg: "#e6f1fb", color: "#0c447c" },
          };
          const statusBadge = (status) => {
            const c = STATUS_BADGE_COLOR[status] || { bg: "#f1eee8", color: "#5f5e5a" };
            return (
              <span style={{ background: c.bg, color: c.color, fontSize: 11, padding: "3px 10px", borderRadius: 20 }}>
                {SET_STATUS_LABEL[status] || status}
              </span>
            );
          };
          const buBadge = (bu) =>
            bu ? (
              <span style={{ background: "#e6f1fb", color: "#0c447c", fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 500 }}>
                {bu}
              </span>
            ) : (
              <span style={{ color: "#b0b6bd" }}>-</span>
            );

          const allVisibleIds = [...activeSets, ...completedSets].map((s) => s.id);
          const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedSetIds.has(id));

          const toggleSelectOne = (id) => {
            setSelectedSetIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          };

          const toggleSelectAll = () => {
            setSelectedSetIds((prev) => {
              if (allSelected) return new Set();
              return new Set(allVisibleIds);
            });
          };

          const renderRow = (s, isCompleted) => (
            <tr
              key={s.id}
              style={{
                background: selectedSetIds.has(s.id) ? "#eef2f5" : (isCompleted ? "#fafcfa" : "#fff"),
                borderBottom: "0.5px solid #f3f4f6",
              }}
            >
              <td style={{ ...tdStyle, width: 36 }}>
                <input
                  type="checkbox"
                  checked={selectedSetIds.has(s.id)}
                  onChange={() => toggleSelectOne(s.id)}
                  style={{ cursor: "pointer" }}
                />
              </td>
              <td style={{ ...tdStyle, color: isCompleted ? "#888" : "#1a3a5c", fontWeight: 500 }}>{s.invoice_no || "-"}</td>
              <td style={{ ...tdStyle, color: isCompleted ? "#888" : "#1a3a5c" }}>{s.supplier_name || "-"}</td>
              <td style={{ ...tdStyle, color: "#4b5563" }}>{s.invoice_date || "-"}</td>
              <td style={{ ...tdStyle, color: "#4b5563" }}>{s.document_type || "-"}</td>
              <td style={tdStyle}>{buBadge(s.bu)}</td>
              <td style={{ ...tdStyle, color: "#4b5563" }}>{s.confidence != null ? `${s.confidence}%` : "-"}</td>
              <td style={{ ...tdStyle, color: "#4b5563" }}>{s.total_pages}</td>
              <td style={tdStyle}>{statusBadge(s.status)}</td>
              <td style={tdStyle}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {!isCompleted && s.status === "ready_for_review" && (
                    <>
                      <button
                        onClick={() => handleViewResult(s.id)}
                        style={{ fontSize: 12, color: "#1a3a5c", border: "0.5px solid #d8dde3", background: "#fff", padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
                      >
                        ดูผล OCR
                      </button>
                      {onReadyToReview && (
                        <button
                          onClick={() => onReadyToReview(s.id)}
                          style={{ fontSize: 12, color: "#1a3a5c", border: "0.5px solid #d8dde3", background: "#fff", padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
                        >
                          ไปกรอกฟอร์ม
                        </button>
                      )}
                    </>
                  )}
                  {isCompleted && <span style={{ color: "#b0b6bd" }}>-</span>}
                  <button
                    onClick={() => handleDeleteSet(s.id, s.invoice_no)}
                    title="ลบชุดเอกสารนี้"
                    style={{ fontSize: 12, color: "#c0392b", border: "1px solid #f0c4c0", background: "#fdf0ef", padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
                  >
                    ลบ
                  </button>
                </div>
              </td>
            </tr>
          );

          return (
            <div style={{ width: "100%", background: "#fff", borderRadius: 12, border: "0.5px solid #d8dde3", overflow: "hidden" }}>
              {selectedSetIds.size > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 16px", background: "#fff8ec", borderBottom: "0.5px solid #eef0f2",
                }}>
                  <span style={{ fontSize: 12.5, color: "#1a3a5c" }}>เลือกไว้ {selectedSetIds.size} รายการ</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setSelectedSetIds(new Set())}
                      style={{ fontSize: 12, color: "#8b94a0", border: "0.5px solid #d8dde3", background: "#fff", padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
                    >
                      ยกเลิกเลือก
                    </button>
                    <button
                      onClick={() => handleDeleteSelected([...selectedSetIds])}
                      disabled={bulkDeleting}
                      style={{
                        fontSize: 12, color: "#c0392b", border: "1px solid #f0c4c0", background: "#fdf0ef",
                        padding: "5px 10px", borderRadius: 6, cursor: bulkDeleting ? "wait" : "pointer",
                      }}
                    >
                      {bulkDeleting ? "กำลังลบ..." : `ลบที่เลือก (${selectedSetIds.size})`}
                    </button>
                  </div>
                </div>
              )}
              <div style={{ maxHeight: "60vh", overflowY: "auto", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: 36 }}>
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                      </th>
                      <th style={thStyle}>Invoice No.</th>
                      <th style={thStyle}>Supplier Name</th>
                      <th style={thStyle}>Doc Date</th>
                      <th style={thStyle}>Doc Type</th>
                      <th style={thStyle}>BU</th>
                      <th style={thStyle}>Confidence</th>
                      <th style={thStyle}>Page</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sets.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "40px 16px", color: "#b0b6bd" }}>
                          ยังไม่มีข้อมูล — อัพโหลดไฟล์เพื่อเริ่มต้น
                        </td>
                      </tr>
                    )}
                    {sets.length > 0 && resultSets.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "40px 16px", color: "#b0b6bd" }}>
                          กำลังประมวลผลอยู่ — ดูความคืบหน้าที่ Job queue
                        </td>
                      </tr>
                    )}
                    {activeSets.map((s) => renderRow(s, false))}
                    {completedSets.map((s) => renderRow(s, true))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>

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

              {(() => {
                const allFields = (previewResult.fields || []).filter(f => f.field_name !== "line_items");
                const fieldMap = Object.fromEntries(allFields.map(f => [f.field_name, f]));

                const FIELD_GROUPS = [
                  { title: "ผู้ขาย (Vendor)", keys: ["tax_id", "supplier_name", "vendor_name_ocr", "vendor_branch_code"] },
                  { title: "ผู้ซื้อ (Buyer)", keys: ["buyer_tax_id", "buyer_name", "buyer_branch_code"] },
                  { title: "ข้อมูลเอกสาร (Document)", keys: ["invoice_no", "invoice_date", "document_type", "total_amount", "subtotal", "vat_amount"] },
                ];

                const renderField = (f) => {
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
                };

                const groupedKeys = new Set(FIELD_GROUPS.flatMap(g => g.keys));
                const ungroupedFields = allFields.filter(f => !groupedKeys.has(f.field_name));

                return (
                  <>
                    {FIELD_GROUPS.map((group) => {
                      const groupFields = group.keys.map(k => fieldMap[k]).filter(Boolean);
                      if (groupFields.length === 0) return null;
                      return (
                        <div key={group.title} style={{ marginBottom: 16 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8, textTransform: "uppercase" }}>
                            {group.title}
                          </p>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            {groupFields.map(renderField)}
                          </div>
                        </div>
                      );
                    })}
                    {ungroupedFields.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8, textTransform: "uppercase" }}>
                          อื่นๆ
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          {ungroupedFields.map(renderField)}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

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
      </>
      )}
    </div>
  );
}