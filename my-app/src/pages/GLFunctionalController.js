import React, { useState } from 'react';
import ReconcileZoneLayout from './ReconcileZoneLayout';

// ══════════════════════════════════════════════════════════════════════════
// GLFunctionalController.js — Module Controller ของ GL Functional
// ══════════════════════════════════════════════════════════════════════════
// โครงสร้างเดียวกับ VatController.js/IEController.js — รับ activeSubTab แล้ว
// Route เนื้อหาภายในเอง (ไม่ต้องเพิ่ม case ใหม่ใน App.js ทุกครั้งที่เพิ่ม Sub-menu
// ในอนาคต — แก้ Switch ที่นี่ที่เดียวพอ เหมือน Pattern เดิมของ VAT)
//
// ตอนนี้มีแค่ 1 Sub-menu: gl-ap-recon (Account Payable Recon.)
// ใช้ ReconcileZoneLayout (Shared Component ที่ก๊อป Layout จาก VatReconcileDashboard.js
// มาตรงๆ แล้ว) — โมดูลอื่นในอนาคต (VAT/GL อื่นๆ) เอาไปใช้ซ้ำได้โดยส่ง Config ต่างกันแค่ Props
//
// MARKER_GL_FUNCTIONAL_CONTROLLER_V2 — ปรับ Prop ให้ตรงกับ ReconcileZoneLayout V3
// (accountOptions เป็น String ล้วนแล้ว, group เป็น null เพราะ AP ไม่มีแนวคิด Asset/Expense
// แบบ VAT, Period ยกขึ้นมาคุมที่ชั้นนี้แทน)
//
// สถานะ: Mockup — ข้อมูล BU/Account ด้านล่างเป็น Static ก่อน รอ Backend Endpoint
// จริงจากฝั่ง ap_cutting_staging (ที่ออกแบบ Schema กันไว้ก่อนหน้า) ค่อยเปลี่ยนเป็น Fetch จริงทีหลัง
// ══════════════════════════════════════════════════════════════════════════

const AP_RECON_STATUS_COLUMNS = [
  { key: 'apCutting', label: 'AP Cutting' },
  { key: 'tb',        label: 'TB' },
];

// รหัสบัญชีตาม Whitelist จริงที่เจอในโค้ด VBA (Z_Option_TB_Cutting_for_Reconcile)
// เฉพาะกลุ่ม AP (219300xx) — อีก 8 รหัสที่เหลือ (116xxxxx/422xxxxx/214xxxxx) เป็นของ Flow อื่น ไม่ใส่ที่นี่
// หมายเหตุ: Dropdown จริง (ก๊อปจาก VatReconcileDashboard.js) โชว์แค่รหัสล้วนๆ ไม่มี Label
// เก็บ Label คู่ไว้ที่นี่เผื่อใช้ตอนต่อ Preview จริง (ยังไม่ได้ใช้ตอนนี้)
const AP_ACCOUNT_LABELS = {
  '21930052': 'AP Trade Payable',
  '21930054': 'AP Trade Payable 2',
  '21930100': 'AP Other Payable',
  '21930084': 'Cancel Cheque',
  '21930085': 'Cancel Cheque 2',
  '21930220': 'AP Misc',
};
const AP_ACCOUNT_OPTIONS = Object.keys(AP_ACCOUNT_LABELS);

const AP_REPORT_OPTIONS = ['Detail Report', 'Summary Report'];
const AP_PERIOD_OPTIONS = ['2026-08', '2026-07', '2026-06'];

// Mock ข้อมูล BU ชั่วคราว (รอ Backend Endpoint จริง) — ใช้ชื่อ BU เดียวกับตัวอย่าง Dashboard ที่คุยกันไว้
// group: null เสมอ เพราะ AP ไม่มีแนวคิด Asset/Expense แบบ VAT -- ให้ขึ้น Chip "ทุกกลุ่ม" (สีเทา) ทุกแถว
const MOCK_BU_ROWS = [
  { bu: 'B2S',  group: null, statuses: { apCutting: false, tb: false }, ready: false },
  { bu: 'BNBN', group: null, statuses: { apCutting: false, tb: false }, ready: false },
  { bu: 'BR50', group: null, statuses: { apCutting: true,  tb: false }, ready: false },
  { bu: 'BRW',  group: null, statuses: { apCutting: false, tb: false }, ready: false },
  { bu: 'BTM',  group: null, statuses: { apCutting: true,  tb: true  }, ready: true  },
  { bu: 'CDS',  group: null, statuses: { apCutting: true,  tb: true  }, ready: true  },
  { bu: 'CFM',  group: null, statuses: { apCutting: false, tb: false }, ready: false },
  { bu: 'CFRE', group: null, statuses: { apCutting: false, tb: true  }, ready: false },
];

export default function GLFunctionalController({ activeSubTab, onSubTabChange, flyoutOpen }) {
  const [period, setPeriod] = useState(AP_PERIOD_OPTIONS[0]);

  switch (activeSubTab) {
    case 'gl-ap-recon':
    default:
      return (
        <ReconcileZoneLayout
          statusColumns={AP_RECON_STATUS_COLUMNS}
          accountOptions={AP_ACCOUNT_OPTIONS}
          reportOptions={AP_REPORT_OPTIONS}
          periodOptions={AP_PERIOD_OPTIONS}
          period={period}
          onPeriodChange={setPeriod}
          buRows={MOCK_BU_ROWS}
        />
      );
  }
}