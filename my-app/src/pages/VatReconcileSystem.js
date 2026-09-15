// VatReconcileSystem.js
// ============================================================================
// FASTAPN Link3ase — Component กลางสำหรับ Reconcile รายงานภาษีซื้อ (VAT Reconcile)
// ออกแบบให้ Reusable: รับ Prop `bu` เข้ามา ไม่ Hardcode ว่าเรียกจาก AP หรือ IE
// (CPC ในข้อมูลเองแยก AP=99999 / IE=46115 อยู่แล้ว ไม่ต้องแยก Logic ในนี้)
//
// ใช้งาน:
//   import VatReconcileSystem from './VatReconcileSystem';
//   <VatReconcileSystem bu={currentBu} onCommitSuccess={() => {...}} />
//
// รองรับ 2 ชนิดไฟล์: TB (Trial Balance) และ Input Summary
// ตรวจชนิดไฟล์อัตโนมัติจากเนื้อหา (Client-side) ก่อนเลือกว่าจะยิงไป Endpoint ไหน
// ยังไม่รองรับ Simple 100 / Simple AVG (รอคิวถัดไป)
//
// ⚠️ TODO ที่ยังไม่ Complete ในเวอร์ชันนี้:
//   - ยังไม่ทดสอบ Detect Type กับไฟล์ Simple 100/AVG จริง (เพราะยังไม่ได้ทำ Endpoint ฝั่งนั้น)
//   - ไฟล์ .xlsx (Excel) ยังตรวจชนิดไม่ได้ (Detect ตอนนี้ทำงานกับ Text/.out เท่านั้น
//     เพราะอ่านเนื้อหาไฟล์ตรงๆ ด้วย FileReader.readAsText -- ไฟล์ Excel เป็น Binary อ่านแบบนี้ไม่ได้)
// ============================================================================

import React, { useRef, useState, useCallback } from 'react';

// ── Base URL Pattern เดียวกับ api.js — REACT_APP_API_URL มี /api ต่อท้ายอยู่แล้ว ──
// ── (เช่น http://10.101.87.126:4000/api) ไม่ต้องเติม /api ซ้ำตอนต่อ Path ──
const VAT_RECONCILE_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

// ── ใช้ fetch ตรงๆ เอง (ไม่ใช้ apiFetch) เพราะต้องส่ง multipart/form-data ไม่ใช่ JSON ──
async function callReconcileApi(path, formData) {
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `เรียก API ไม่สำเร็จ (HTTP ${res.status})`);
  }
  return data;
}

function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusLabel(status) {
  switch (status) {
    case 'new': return { text: 'ใหม่', color: '#1a7f37' };
    case 'updated': return { text: 'อัปเดต', color: '#0969da' };
    case 'protected_kept': return { text: 'Protected · คงยอดเดิม', color: '#9a6700' };
    case 'unchanged': return { text: 'ไม่เปลี่ยนแปลง', color: '#57606a' };
    default: return { text: status || '—', color: '#57606a' };
  }
}

// ── ตรวจชนิดไฟล์จากเนื้อหา (ไม่ใช่จากนามสกุล เพราะทั้ง TB และ Input Summary ดิบเป็น .out เหมือนกัน) ──
// อ่านแค่ 4000 ตัวอักษรแรกพอ (Header อยู่ต้นไฟล์เสมอ)
function detectFileType(headText) {
  if (headText.includes('Company Range:') && headText.includes('GLCRC064')) {
    return 'tb';
  }
  if (headText.includes('End Receive Date') || headText.includes('Merchandise')) {
    return 'input_summary';
  }
  return 'unknown';
}

function readFileHead(file, maxChars = 4000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => reject(reader.error);
    // slice ก่อนอ่าน กันไฟล์ใหญ่เกินไปทำให้ช้า
    reader.readAsText(file.slice(0, maxChars), 'windows-1252');
  });
}

const ENDPOINTS = {
  tb: { preview: '/tb/preview', commit: '/tb/commit' },
  input_summary: { preview: '/input-summary/preview', commit: '/input-summary/commit' },
};

export default function VatReconcileSystem({ bu, onCommitSuccess }) {
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const pendingFileRef = useRef(null); // เก็บ File Object ที่ใช้ตอน Preview ไว้ใช้ซ้ำตอน Commit

  const [stage, setStage] = useState('idle'); // idle | scanning | preview | committing | done | error
  const [sourceLabel, setSourceLabel] = useState('');
  const [fileType, setFileType] = useState(null); // 'tb' | 'input_summary'
  const [previewData, setPreviewData] = useState(null); // { summary, records, unmatchedLines }
  const [errorMessage, setErrorMessage] = useState('');

  const resetAll = useCallback(() => {
    setStage('idle');
    setSourceLabel('');
    setFileType(null);
    setPreviewData(null);
    setErrorMessage('');
    pendingFileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const runPreview = useCallback(async (file, label) => {
    setStage('scanning');
    setSourceLabel(label);
    setErrorMessage('');
    pendingFileRef.current = file; // เก็บไว้ใช้ตอนกดยืนยัน Commit
    try {
      const headText = await readFileHead(file);
      const type = detectFileType(headText);
      if (type === 'unknown') {
        throw new Error(
          'ไม่รู้จักชนิดไฟล์นี้ — รองรับเฉพาะ TB (.out จาก GLCRC064) และ Input Summary (.out จาก APCRC201) เท่านั้น ' +
          '(Simple 100/AVG ยังไม่รองรับในเวอร์ชันนี้)'
        );
      }
      setFileType(type);

      const formData = new FormData();
      formData.append('file', file);
      const data = await callReconcileApi(ENDPOINTS[type].preview, formData);
      setPreviewData(data);
      setStage('preview');
    } catch (err) {
      console.error('VatReconcileSystem preview error:', err);
      setErrorMessage(err?.message || 'เกิดข้อผิดพลาดระหว่างตรวจสอบไฟล์');
      setStage('error');
    }
  }, []);

  const handleFileSelect = useCallback((files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    runPreview(file, file.name);
  }, [runPreview]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current && (dropZoneRef.current.style.background = '');
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) dropZoneRef.current.style.background = '#f7f7f7';
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) dropZoneRef.current.style.background = '';
  }, []);

  // ── Paste (Ctrl+V) — รองรับทั้งวางไฟล์ และวาง Text ดิบ (Copy จาก Notepad) ──
  const handlePaste = useCallback((e) => {
    const clipboardFiles = e.clipboardData?.files;
    if (clipboardFiles && clipboardFiles.length > 0) {
      e.preventDefault();
      handleFileSelect(clipboardFiles);
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.trim().length > 0) {
      e.preventDefault();
      const blob = new Blob([text], { type: 'text/plain' });
      const file = new File([blob], 'pasted-data.out', { type: 'text/plain' });
      runPreview(file, 'ข้อมูลจากคลิปบอร์ด');
    }
  }, [handleFileSelect, runPreview]);

  const handleConfirmCommit = useCallback(async () => {
    if (!pendingFileRef.current || !fileType) {
      setErrorMessage('ไม่พบไฟล์ต้นฉบับ กรุณาอัปโหลดใหม่อีกครั้ง');
      setStage('error');
      return;
    }
    setStage('committing');
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('file', pendingFileRef.current);
      const data = await callReconcileApi(ENDPOINTS[fileType].commit, formData);
      setStage('done');
      if (typeof onCommitSuccess === 'function') onCommitSuccess(data);
    } catch (err) {
      console.error('VatReconcileSystem commit error:', err);
      setErrorMessage(err?.message || 'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล');
      setStage('error');
    }
  }, [onCommitSuccess, fileType]);

  return (
    <div style={{ maxWidth: 720 }}>
      {stage === 'idle' && (
        <div
          ref={dropZoneRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          tabIndex={0}
          style={{
            border: '1.5px dashed #ccc',
            borderRadius: '12px',
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".out,.txt"
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <p style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 4px' }}>
            ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์
          </p>
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 10px' }}>
            รองรับ TB (.out) และ Input Summary (.out) — ระบบตรวจชนิดไฟล์ให้อัตโนมัติ
            (Simple 100/AVG ยังไม่รองรับ)
          </p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px',
            color: '#666', background: '#f2f2f2', borderRadius: '8px', padding: '4px 10px',
          }}>
            <span>หรือกด Ctrl+V เพื่อวางข้อมูลจากคลิปบอร์ดโดยตรง</span>
          </div>
        </div>
      )}

      {stage === 'scanning' && (
        <div style={{ padding: '12px 14px', background: '#f7f7f7', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px' }}>กำลังตรวจสอบไฟล์: {sourceLabel}...</span>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ padding: '14px', background: '#fdecec', borderRadius: '8px', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#a30d16', margin: 0 }}>{errorMessage}</p>
          <button type="button" onClick={resetAll} style={{ marginTop: '10px', fontSize: '13px' }}>
            ลองใหม่
          </button>
        </div>
      )}

      {stage === 'preview' && previewData && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '1.5rem',
            width: 720, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>ยืนยันข้อมูลก่อนบันทึก</p>
              <button
                type="button"
                aria-label="ปิด"
                onClick={resetAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#666' }}
              >
                ✕
              </button>
            </div>

            {fileType === 'tb' && (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#e6f4ea', borderRadius: '8px', marginBottom: '16px',
                }}>
                  <span style={{ fontSize: '13px', color: '#1a7f37' }}>
                    ตรวจพบ Trial Balance (TB) · BU {previewData.summary.bu} · Period {previewData.summary.period}
                  </span>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: '20px',
                }}>
                  {[
                    { label: 'Record ใหม่', value: previewData.summary.new_count },
                    { label: 'ยอดเปลี่ยน', value: previewData.summary.updated_count },
                    { label: 'Protected (คงยอดเดิม)', value: previewData.summary.protected_kept_count },
                    { label: 'ไม่พบ/Parse ไม่ได้', value: previewData.summary.unmatched_lines_count, warn: true },
                  ].map((item, i) => (
                    <div key={i} style={{ background: '#f7f7f7', borderRadius: '8px', padding: '1rem' }}>
                      <p style={{ fontSize: '13px', color: '#666', margin: '0 0 4px' }}>{item.label}</p>
                      <p style={{ fontSize: '24px', fontWeight: 500, margin: 0, color: item.warn && item.value > 0 ? '#9a6700' : undefined }}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                <div style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: '20px' }}>
                  <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 }}>สาขา</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 }}>Account</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '6px 8px', color: '#666', fontWeight: 500 }}>ยอดเดิม</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '6px 8px', color: '#666', fontWeight: 500 }}>ยอดใหม่</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500 }}>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.records.map((r, i) => {
                        const st = statusLabel(r.status);
                        return (
                          <tr key={i} style={{ borderBottom: '0.5px solid #eee' }}>
                            <td style={{ padding: '6px 8px' }}>{r.branch}</td>
                            <td style={{ padding: '6px 8px' }}>{r.account}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#666' }}>
                              {formatNumber(r.old_period_activity)}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                              {formatNumber(r.effective_period_activity)}
                            </td>
                            <td style={{ padding: '6px 8px', color: st.color }}>{st.text}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={resetAll} style={{ fontSize: '13px' }}>ยกเลิก</button>
                  <button
                    type="button"
                    onClick={handleConfirmCommit}
                    style={{ fontSize: '13px', borderColor: '#0969da', color: '#0969da' }}
                  >
                    ยืนยันบันทึกลง DB
                  </button>
                </div>
              </div>
            )}

            {fileType === 'input_summary' && (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#e6f4ea', borderRadius: '8px', marginBottom: '16px',
                }}>
                  <span style={{ fontSize: '13px', color: '#1a7f37' }}>
                    ตรวจพบ Input Summary · BU {previewData.summary.bu_list?.join(', ') || '—'} ·
                    Period {previewData.summary.period} · Tax Type {previewData.summary.tax_type}
                    (Account {previewData.summary.reconcile_account})
                  </span>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: '20px',
                }}>
                  {[
                    { label: 'Invoice ที่ Parse ได้', value: previewData.summary.parsed_count },
                    { label: 'Match BU สำเร็จ', value: previewData.summary.matched_count },
                    { label: 'ข้อมูลเดิมที่จะถูกแทนที่', value: previewData.summary.existing_rows_to_replace, warn: true },
                    { label: 'สาขาที่ Match ไม่ได้', value: previewData.summary.unmatched_branch_count, warn: true },
                  ].map((item, i) => (
                    <div key={i} style={{ background: '#f7f7f7', borderRadius: '8px', padding: '1rem' }}>
                      <p style={{ fontSize: '13px', color: '#666', margin: '0 0 4px' }}>{item.label}</p>
                      <p style={{ fontSize: '24px', fontWeight: 500, margin: 0, color: item.warn && item.value > 0 ? '#9a6700' : undefined }}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                {previewData.summary.unmatched_branch_count > 0 && (
                  <div style={{ padding: '10px 14px', background: '#fff8e6', borderRadius: '8px', marginBottom: '16px' }}>
                    <p style={{ fontSize: '13px', color: '#9a6700', margin: 0 }}>
                      ⚠️ มีสาขาที่ Match BU ไม่ได้ {previewData.summary.unmatched_branch_count} รายการ
                      (จะไม่ถูกบันทึกถ้ากด Commit) — ตรวจสอบ branch_list / Group Range เพิ่มเติม
                    </p>
                  </div>
                )}

                <div style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: '16px' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '0.5px solid #ddd' }}>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '5px 6px', color: '#666', fontWeight: 500 }}>สาขา</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '5px 6px', color: '#666', fontWeight: 500 }}>เลขที่ใบกำกับภาษี</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'left', padding: '5px 6px', color: '#666', fontWeight: 500 }}>ชื่อผู้ค้า</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '5px 6px', color: '#666', fontWeight: 500 }}>มูลค่าสินค้า</th>
                        <th style={{ position: 'sticky', top: 0, background: '#fff', textAlign: 'right', padding: '5px 6px', color: '#666', fontWeight: 500 }}>ภาษี</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.records.map((r, i) => (
                        <tr key={i} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                          <td style={{ padding: '5px 6px' }}>{r.branch}</td>
                          <td style={{ padding: '5px 6px' }}>{r.tax_invoice_no}</td>
                          <td style={{ padding: '5px 6px' }}>{r.vendor_name}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{formatNumber(r.claimed100_amount)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{formatNumber(r.claimed100_vat)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p style={{ fontSize: '12px', color: '#a30d16', marginBottom: '16px' }}>
                  ⚠️ การ Commit จะ<strong>ลบข้อมูลเดิมทั้งหมด</strong>ของ BU/เดือน/ประเภทภาษีนี้ก่อน
                  แล้วบันทึกชุดใหม่แทนที่ (Replace ทั้งก้อน ไม่ใช่ Merge)
                </p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={resetAll} style={{ fontSize: '13px' }}>ยกเลิก</button>
                  <button
                    type="button"
                    onClick={handleConfirmCommit}
                    style={{ fontSize: '13px', borderColor: '#0969da', color: '#0969da' }}
                  >
                    ยืนยันบันทึกลง DB
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {stage === 'committing' && (
        <div style={{ padding: '12px 14px', background: '#f7f7f7', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px' }}>กำลังบันทึกข้อมูล...</span>
        </div>
      )}

      {stage === 'done' && (
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <p style={{ fontSize: '14px', margin: '10px 0 0', color: '#1a7f37' }}>
            บันทึก{fileType === 'tb' ? ' vat_reconcile_tb ' : ' vat_reconcile_input_summary '}เรียบร้อย
          </p>
          <button type="button" onClick={resetAll} style={{ marginTop: '12px', fontSize: '13px' }}>
            อัปโหลดไฟล์อื่นต่อ
          </button>
        </div>
      )}
    </div>
  );
}