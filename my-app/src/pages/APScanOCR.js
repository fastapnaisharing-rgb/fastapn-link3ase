/**
 * APScanOCR.js
 * ================================================================
 * หน้า "Scan OCR" ภายใต้เมนู AP Controller
 * ใช้ OCRScanWidget (component กลาง) แล้วส่งต่อไปที่ APController
 * พร้อม setId เพื่อ pre-fill ฟอร์มที่มีอยู่แล้ว
 * ================================================================
 */
import React from "react";
import OCRScanWidget from "../components/OCRScanWidget";

/**
 * Props:
 *   onNavigateToAP(setId) — ฟังก์ชันจาก App.js สำหรับเปลี่ยนไปหน้า AP Controller
 *                            พร้อมส่ง setId ไปด้วย (ระบบนี้ใช้ activePage state
 *                            ไม่ใช่ React Router จึงต้องรับฟังก์ชันจาก parent แทน)
 */
export default function APScanOCR({ onNavigateToAP }) {
  const handleReadyToReview = (setId) => {
    if (onNavigateToAP) {
      onNavigateToAP(setId);
    } else {
      console.warn("APScanOCR: onNavigateToAP prop ไม่ได้ถูกส่งมาจาก App.js");
    }
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Scan OCR</h2>
      <p style={{ color: "#888", marginBottom: 24 }}>
        อัพโหลดใบ Invoice เพื่อให้ระบบอ่านข้อมูลอัตโนมัติ
      </p>
      <OCRScanWidget documentType="ap_invoice" onReadyToReview={handleReadyToReview} />
    </div>
  );
}