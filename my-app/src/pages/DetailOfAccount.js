// MARKER_GL_DETAIL_OF_ACCOUNT_PAGE_V1
// Detail of Account (GL Functional) -- Layout เท่านั้น: บน 35% (ซ้าย 70 : ขวา 30) / ล่าง 65% เต็มความกว้าง
// ยังไม่ผูกข้อมูลจริง: Account = ตาม Config ของแต่ละ User ที่พบใน TB | คอลัมน์: TB, Detail, Simple | Backup | Confirm | Action | Sharedrive
import React from 'react';
import * as XLSX from 'xlsx'; // MARKER_GL_DOA_TB_INPUT_V1
import { db } from '../lib/db';
import { useDataCache } from '../contexts/DataCacheContext';
import { useAuth } from '../contexts/AuthContext';
import { listDoaConfig, myDoaConfig, addDoaConfig as _addDoaConfig, removeDoaConfig as _removeDoaConfig, listDoaBackups, getDoaBackup, saveDoaBackup as _saveDoaBackup, removeDoaBackup as _removeDoaBackup, listDoaClear, saveDoaClear as _saveDoaClear, reverseDoaClear as _reverseDoaClear, listDoaClearDetail } from '../doaConfig'; // MARKER_GL_DOA_CONFIG_FE_V1
import { loadSignoffProfile, saveSignoffProfile } from '../signoffs';
import { useRealtimeRefresh } from '../useRealtimeRefresh'; // MARKER_GL_DOA_CONFIG_REALTIME_V1 -- Auto Refresh เมื่อมีการเปลี่ยน Config
import { broadcastWs } from '../wsManager';
// MARKER_GL_DOA_BROADCAST_ALL_V1 -- ทุกจุดที่แก้ Config / TB / Detail / Simple ส่ง Broadcast ให้ทุกหน้าจอ-ทุก User รีเฟรช (doa_config_changed / doa_tb_changed)
const _bc = (ev) => { try { broadcastWs(ev, { at: Date.now() }); } catch (e) { /* ignore */ } };
const addDoaConfig = async (...a) => { const r = await _addDoaConfig(...a); _bc('doa_config_changed'); return r; };
const removeDoaConfig = async (...a) => { const r = await _removeDoaConfig(...a); _bc('doa_config_changed'); return r; };
const saveDoaBackup = async (...a) => { const r = await _saveDoaBackup(...a); _bc('doa_tb_changed'); return r; };
/* MARKER_GL_DOA_BACKUP_BY_ACCOUNT_FE_V1 -- Backup Detail แยกไฟล์ต่อ Account (BU+งวด+Account) */
const bkCmp = (x, y) => String(y.period).localeCompare(String(x.period)) || ((y.account ? 1 : 0) - (x.account ? 1 : 0));
const bkPick = (it, per) => { const f = it.filter(x => x.period < per).sort(bkCmp); const seen = new Set(); const out = []; let lg = 0; f.forEach(x => { if (x.account) { if (seen.has(x.account)) return; seen.add(x.account); out.push(x); } else if (lg++ < 12) out.push(x); }); return out.slice(0, 170); };
const bkSel = (it, per, c) => { const f = it.find(x => x.period === per && String(x.account) === String(c)) || it.find(x => x.period === per && !x.account); return f ? String(f.id) : ''; };

const saveDoaClear = async (...a) => { const r = await _saveDoaClear(...a); _bc('doa_tb_changed'); return r; }; // MARKER_GL_DOA_CLEAR_BROADCAST_V1 -- Stamp Clear / Auto Clear ส่ง Broadcast ให้ทุกหน้าจอ-ทุก User รีเช็กทันที
const reverseDoaClear = async (...a) => { const r = await _reverseDoaClear(...a); _bc('doa_tb_changed'); return r; };
const removeDoaBackup = async (...a) => { const r = await _removeDoaBackup(...a); _bc('doa_tb_changed'); return r; };

const C = { navy: '#1F3A5F', line: '#D5DCE6', mute: '#5A6B80', bg: '#F1F4F8', green: '#2E7D5B' };
const card = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: '14px 18px', boxSizing: 'border-box', minWidth: 0 };
const lbl = { fontSize: 12, color: C.mute };
const inp = { height: 36, border: '1px solid #B9C4D2', borderRadius: 6, padding: '0 8px', fontSize: 14, background: '#fff', boxSizing: 'border-box', width: '100%' };
const btn = (primary, green) => ({
  height: 38, padding: '0 14px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${green ? C.green : C.navy}`, background: primary ? C.navy : '#fff',
  color: primary ? '#fff' : (green ? '#1F6B4A' : C.navy),
});
const th = { padding: '8px 10px', fontWeight: 700, background: '#E8F0FB', color: '#1B2A3D', textAlign: 'center', borderBottom: `1px solid ${C.line}` };


// MARKER_GL_DOA_TB_INPUT_V1 -- โยนไฟล์ TB (.xlsx/.xls/.csv/.txt) หรือ Paste Text (คัดลอกจาก Excel) -> อ่านหา Account ที่พบใน TB (ประมวลผลในเครื่อง ยังไม่ส่งขึ้น Server)
const detectDelim = (t) => (t.includes('\t') ? '\t' : (t.split(',').length > t.split(';').length ? ',' : ';'));
function textToMatrix(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const d = detectDelim(lines[0]);
  return lines.map(l => l.split(d).map(c => c.trim().replace(/^"|"$/g, '')));
}
// MARKER_GL_DOA_SEGKEY_V1 -- TB แบบคีย์รวม: "<ชื่อบัญชี>-1-05-<Segment3=COM>-<Branch>-<CPC>-<Account>-<SubAcc>" (คอลัมน์ B) -> แยก COM (Segment 3) / Branch / CPC / Account / SubAcc ใช้พิสูจน์ COM + คัดตาม Config
const SEGKEY_RE = /(?:^|-)(\d{1,2})-(\d{2})-(\d{4})-(\w+)-(\w+)-(\d{5,})-(\w+)\s*$/;
function parseSegKey(v) { const x = SEGKEY_RE.exec(String(v == null ? '' : v).trim()); return x ? { seg3: x[3], branch: x[4], cpc: x[5], account: x[6], sub: x[7] } : null; }
function segKeyCol(m) { // คอลัมน์ที่มีคีย์ (ตรวจ 4 คอลัมน์แรก, ต้องพบอย่างน้อย 3 แถวใน 300 แถวแรก)
  for (let j = 0; j < 4; j++) { let n = 0; for (let i = 0; i < Math.min((m || []).length, 300); i++) { if (parseSegKey(((m[i] || [])[j]))) { n++; if (n >= 3) return j; } } }
  return -1;
}
function segKeyCom(m) { const kc = segKeyCol(m); if (kc < 0) return ''; const cnt = {}; for (let i = 0; i < Math.min(m.length, 2000); i++) { const k = parseSegKey((m[i] || [])[kc]); if (k) cnt[k.seg3] = (cnt[k.seg3] || 0) + 1; } return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || ''; }
// MARKER_GL_DOA_TB_TEXT_REPORT_V1 -- TB ดิบจาก Oracle เป็นรายงานตัวหนังสือ (Detail Trial Balance) อยู่คอลัมน์ A คอลัมน์เดียว: "Acc  Description  1-05-COM-Branch-CPC-Account-Sub  Beginning  Activity  Ending" -> แตกเป็นคอลัมน์ (ตัดหัวหน้า/เส้นขีด/Grand total)
const TBTXT_RE = /^\s*(\S+)\s+(.*?)\s*(\d{1,2}-\d{2}-\d{4}-\w+-\w+-\w+-\w+)\s+(\(?-?[\d,]+\.\d\d\)?)\s+(\(?-?[\d,]+\.\d\d\)?)\s+(\(?-?[\d,]+\.\d\d\)?)\s*$/;
function tbReportToMatrix(m) {
  if (!Array.isArray(m) || m.length < 5) return m;
  let hit = 0; for (let i = 0; i < Math.min(m.length, 60); i++) if (TBTXT_RE.test(String((m[i] || [])[0] == null ? '' : m[i][0]))) hit++;
  if (hit < 3) return m;
  const out = []; let hdrDone = false;
  for (let i = 0; i < m.length; i++) {
    const t = String((m[i] || [])[0] == null ? '' : m[i][0]).replace(/_x000C_|\f/g, '');
    const x = TBTXT_RE.exec(t);
    if (x) {
      if (!hdrDone) { out.push(['Account', 'Description', 'Accounting Flexfield', 'Beginning Balance', 'Period Activity', 'Ending Balance']); hdrDone = true; }
      out.push([x[1], x[2].trim(), x[3], x[4], x[5], x[6]]); continue;
    }
    if (!hdrDone && t.trim() && !/^\s*Acc\s+Description/i.test(t) && !/^[\s-]+$/.test(t)) out.push([t.trimEnd()]);
  }
  return out;
}
function rowsPerAcc(m) { // MARKER_GL_DOA_DETAIL_SUMMARY_V1 -- จำนวนแถวต่อ Account (ใช้ Summary ตอนโยน Detail)
  const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0;
  for (let i = 0; i < Math.min((m || []).length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
  const o = {}; for (let i = hi + 1; i < (m || []).length; i++) { const code = String((m[i] || [])[ac] == null ? '' : m[i][ac]).trim(); if (!code || !/\d/.test(code)) continue; o[code] = (o[code] || 0) + 1; } return o;
}
function accList(m) { const a = matrixToAccounts(m).accounts; const x = a.map(z => z.code); x.names = Object.fromEntries(a.map(z => [z.code, z.name])); x.m = m; try { x.sums = Object.fromEntries(tbAccSums(m).map(o => [o.code, o])); } catch (e) { x.sums = {}; } return x; } // MARKER_GL_DOA_TB_SUMS_V1 -- ยอดต่อ Account (ใช้แสดงในรายการ ยังไม่มี Config)
// MARKER_GL_DOA_TB_DOWNLOAD_FORMAT_V1 -- TB Download รูปแบบ "DETAIL OF ACCOUNT": หัวรายงาน (Company/Branch/Account code/Account name/Period) แถว 1-7, หัวตารางแถว 9 (Branch, CPC, Account, SubAcc, Description, Beginning, Period Activity, Ending) + แถว Total
// MARKER_GL_DOA_DETAIL_FORMAT_V1 -- Detail of Overhead: แยกคอลัมน์ตามหัวตาราง + สร้างรูปแบบ "DETAIL OF ACCOUNT" (หัวรายงานแถว 1-8, หัวตารางแถว 9)
const DET_HEAD = ['Branch Code', 'Branch Name', 'Cost Center', 'Account Code', 'Account Name', 'Sub Account Code', 'Transaction Date', 'Journal name', 'Invoice Number', 'Vendor Name', 'Description', 'Amount', 'Contact From..To', 'Remark'];
const DET_KEYS = ['branch_code', 'branch_name', 'cost_center', 'account_code', 'account_name', 'sub_account', 'txn_date', 'journal_name', 'invoice_no', 'vendor_name', 'description', 'amount', 'contact', 'remark'];
function detailCols(m) {
  for (let i = 0; i < Math.min((m || []).length, 15); i++) {
    const t = (m[i] || []).map(c => String(c == null ? '' : c).trim().toLowerCase());
    const f = (re) => t.findIndex(x => re.test(x));
    const bc = f(/^branch(\s*code)?$/); const jn = f(/^journal\s*name$/); const ac = f(/^account\s*code$/);
    const acX = f(/^account$/); let acC = ac; let acN = f(/^account\s*name$/); /* MARKER_GL_DOA_DET_ACC_HDR_SWAP_V1 -- ไฟล์ที่หัวคอลัมน์เป็น "Account" (รหัส) + "Account Code" (ที่จริงเป็นชื่อ): สลับให้ถูก */
    if (acX >= 0 && ac >= 0 && acX !== ac) { const sm = (m || []).slice(i + 1, i + 12).map(r => r || []); const isNum = (v) => /^\d{4,}$/.test(String(v == null ? '' : v).trim()); const nx = sm.filter(r => isNum(r[acX])).length; const nc = sm.filter(r => isNum(r[ac])).length; if (nx > nc) { acC = acX; acN = ac; } }
    if (bc >= 0 && jn >= 0 && ac >= 0) return { hi: i, idx: [bc, f(/^branch\s*name$/), f(/^(cost\s*center|cost|cpc)$/), acC, acN, f(/^sub\s*account(\s*code)?$/), f(/^transaction(\s*date)?$/), jn, f(/^invoice(\s*number|\s*no\.?)?$/), f(/^vendor(\s*name)?$/), f(/^description$/), f(/^amount$/), f(/^contact/), f(/^remark/)] };
  }
  return null;
}
const DMON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function detDate(v) { /* MARKER_GL_DOA_DATE_CLEAN_V1 -- Clean format วันที่: dd-Mon-yy(yy) | dd/mm/yy(yy) | dd.mm.yyyy | dd-mm-yyyy | yyyy-mm-dd | Excel serial | ปี พ.ศ. */
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') { if (isFinite(v) && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return null; }
  const t = String(v == null ? '' : v).trim(); if (!t) return null;
  if (/^\d{5}$/.test(t)) return detDate(Number(t)); /* Excel serial ที่เป็นข้อความ */
  const mk = (y, mo, d) => { if (y < 100) y += 2000; if (y > 2400) y -= 543; if (!(mo >= 0 && mo <= 11 && d >= 1 && d <= 31)) return null; const dt = new Date(Date.UTC(y, mo, d)); return dt.getUTCMonth() === mo ? dt : null; };
  let x = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{2,4})$/); if (x && DMON[x[2].toUpperCase()] != null) return mk(Number(x[3]), DMON[x[2].toUpperCase()], Number(x[1]));
  x = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[\sT].*)?$/); if (x) return mk(Number(x[3]), Number(x[2]) - 1, Number(x[1]));
  x = t.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[\sT].*)?$/); if (x) return mk(Number(x[1]), Number(x[2]) - 1, Number(x[3]));
  return null; }
function detNum(v) { if (typeof v === 'number') return v; const t = String(v == null ? '' : v).trim(); if (!t) return null; const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const x = t.replace(/[(),\s-]/g, '').replace(/,/g, ''); return /^\d+(\.\d+)?$/.test(x) ? (neg ? -Number(x) : Number(x)) : null; }
function detailRows(m) { // ตาราง -> [{branch_code,...}]
  const c = detailCols(m); if (!c) return [];
  const g = (r, k) => { const j = c.idx[k]; return j >= 0 ? (r || [])[j] : ''; };
  const out = []; for (let i = c.hi + 1; i < m.length; i++) { const r = m[i] || []; const ac = String(g(r, 3) == null ? '' : g(r, 3)).trim(); if (!ac) continue; const o = {}; DET_KEYS.forEach((k, n) => { let v = g(r, n); if (v == null) v = ''; if (k === 'txn_date') { const d = detDate(v); v = d ? `${String(d.getUTCDate()).padStart(2, '0')}-${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]}-${d.getUTCFullYear()}` : String(v); } else if (k === 'amount') { const n2 = detNum(v); v = n2 == null ? '' : n2; } else v = String(v).trim(); o[k] = v; }); out.push(o); }
  return out;
}
function detKey(o) { return [o.branch_code, o.cost_center, o.sub_account, o.txn_date, o.journal_name, o.invoice_no, (Math.round(Number(o.amount || 0) * 100) / 100).toFixed(2)].map(x => String(x == null ? '' : x).trim()).join('|') + '|' + String(o.account_code == null ? '' : o.account_code).trim(); } /* MARKER_GL_DOA_STAMP_CLEAR_V1 -- คีย์แถว Detail */
function detSigByAcc(rows) { /* MARKER_GL_DOA_ACC_SIGNATURE_V1 -- ลายเซ็นต่อ Account: จำนวนแถว | ยอดรวม | แฮชของคีย์แถวที่เรียงแล้ว (ใช้ดูว่า Update หรือเท่าเดิม) */
  const g = {}; (rows || []).forEach(o => { const c = String(o.account_code == null ? '' : o.account_code).trim(); if (c) (g[c] = g[c] || []).push(o); });
  const out = {}; Object.keys(g).forEach(c => { const ks = g[c].map(detKey).sort(); let h = 5381; const t = ks.join('\n'); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; out[c] = { n: ks.length, sum: Math.round(g[c].reduce((a, o) => a + (Number(o.amount) || 0), 0) * 100) / 100, h, rows: g[c] }; });
  return out;
}
function simGroups(m) { /* MARKER_GL_DOA_SIMPLE_MERGE_V1 -- Simple แยกเป็นกลุ่มต่อ Account (A..: แถวหัวรายการ + แถวลูก + Total by branch/Account ของ Account นั้น) */
  let hi = -1; for (let i = 0; i < Math.min((m || []).length, 40) && hi < 0; i++) if (/^oracle\s*branch/i.test(String((m[i] || [])[0] || '').trim())) hi = i;
  if (hi < 0) return null; const g = new Map(); let cur = ''; const tail = [];
  for (let i = hi + 1; i < m.length; i++) { const r = m[i] || []; if (!r.some(x => x !== '' && x != null)) continue; const a0 = String(r[0] == null ? '' : r[0]).trim();
    if (/^(total|gran[dt])/i.test(a0)) { const t = /(\d{4,})\s*$/.exec(a0); if (t && g.has(t[1])) g.get(t[1]).push(r); else tail.push(r); continue; }
    const c = String(r[2] == null ? '' : r[2]).trim(); if (c) cur = c; if (!cur) continue; if (!g.has(cur)) g.set(cur, []); g.get(cur).push(r); }
  return { pre: m.slice(0, hi + 1), g, tail };
}
function simSig(rows) { const t = JSON.stringify((rows || []).map(r => (r || []).map(x => (x == null ? '' : String(x).trim())))); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h + ':' + (rows || []).length; }
function detailMatrixFromRows(rows) { // [{...}] จาก DB -> ตารางเดิม (หัวรายงานบรรทัดแรก + หัวตารางแถว 6)
  const m = [['Detail of Overhead for account 1,2 Report (custom)'], [], [], [], [], DET_HEAD.slice()];
  (rows || []).forEach(o => m.push(DET_KEYS.map(k => (k === 'amount' ? (o[k] == null || o[k] === '' ? '' : Number(o[k])) : (o[k] == null ? '' : String(o[k]))))));
  return m;
}
function buildDetailDoa(m0, code, ctx = {}) { // รูปแบบ DETAIL OF ACCOUNT สำหรับ Preview/Download
  const rowsAll = detailRows(m0).filter(o => !code || String(o.account_code) === String(code));
  const brs = [...new Set(rowsAll.map(o => o.branch_code).filter(Boolean))].sort(); const com = (brs[0] || '').slice(0, 4);
  const nm = String(ctx.comName || '').trim();
  let per = ''; const pm = /^(\d{4})\.(\d{2})$/.exec(ctx.period || ''); if (pm) { const d = new Date(Date.UTC(Number(pm[1]), Number(pm[2]), 0)); per = `${String(d.getUTCDate()).padStart(2, '0')}-${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`; }
  const accName = code && rowsAll.length ? rowsAll[0].account_name : '';
  const top = [['DETAIL OF ACCOUNT'], [], ['Company', `${com}${nm ? ' ' + nm : ''}`], ['Branch', `${brs.length ? brs[0] + (brs.length > 1 ? '-' + brs[brs.length - 1] : '') : ''}${nm ? ' ' + nm : ''}`], ['Account code', code ? String(code) : 'ทุก Account'], ['Account name', accName], ['Period', per], []];
  const body = rowsAll.map(o => DET_KEYS.map(k => (k === 'txn_date' ? (detDate(o[k]) || o[k]) : (k === 'amount' ? (o[k] === '' ? null : Number(o[k])) : o[k]))));
  return { matrix: [...top, DET_HEAD.slice(), ...body], hi: 8 };
}
function buildTbDetail(m0, code) {
  const kc = segKeyCol(m0); const a = m0.findIndex(r => (r || []).some(c => /^account$/i.test(String(c || '').trim()))); const hd = m0[a] || [];
  const jd = hd.findIndex(c => /^desc/i.test(String(c || ''))), jb = hd.findIndex(c => /^begin/i.test(String(c || ''))), jp = hd.findIndex(c => /^period\s*act/i.test(String(c || ''))), je = hd.findIndex(c => /^ending/i.test(String(c || '')));
  const rows = []; m0.slice(a + 1).forEach(r => { const k = parseSegKey((r || [])[kc]); if (k) rows.push([k.branch, k.cpc, k.account, k.sub, jd >= 0 ? r[jd] : '', jb >= 0 ? r[jb] : '', jp >= 0 ? r[jp] : '', je >= 0 ? r[je] : '']); });
  const th = parseTbHeader(m0) || {}; const sel = code ? rows.filter(r => String(r[2]) === String(code)) : rows;
  const brs = sel.map(r => r[0]).filter(Boolean).sort(); const comName = String(th.company || '').replace(/^\s*\d+\s*/, '').trim(); const comCode = th.comCode || segKeyCom(m0) || '';
  const pm = /^(\d{4})\.(\d{2})$/.exec(th.period || ''); let per = ''; if (pm) { const d = new Date(Date.UTC(Number(pm[1]), Number(pm[2]), 0)); per = `${String(d.getUTCDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}-${d.getUTCFullYear()}`; }
  const accShown = code ? String(code) : 'ทุก Account'; const accName = code && sel.length ? String(sel[0][4] || '') : '';
  const top = [['DETAIL OF ACCOUNT'], [], ['Company', `${comCode}${comName ? ' ' + comName : ''}`], ['Branch', `${brs.length ? brs[0] + (brs.length > 1 ? '-' + brs[brs.length - 1] : '') : ''}${comName ? ' ' + comName : ''}`], ['Account code', accShown], ['Account name', accName], ['Period', per], []];
  return { matrix: [...top, ['Branch', 'CPC', 'Account', 'SubAcc', 'Description', 'Beginnging Balance', 'Period Activity', 'Ending Balance'], ...rows], hi: 8 };
}
// MARKER_GL_DOA_PERSIST_SCREEN_V1 -- ข้อมูลที่โยนไว้ค้างอยู่จนกว่าผู้ใช้จะกดล้างเอง: เก็บไฟล์ดิบแยกตามงวดในเบราว์เซอร์ (localStorage ต่อ User) แล้วคัดตาม Config ใหม่ทุกครั้งที่เปิดหน้า
const SCR_KEY = (em) => `doa_screen_v1:${String(em || '').toLowerCase()}`;
function loadScreenMap(em) { try { const t = window.localStorage.getItem(SCR_KEY(em)); const o = t ? JSON.parse(t) : {}; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function saveScreenMap(em, map) { try { const t = JSON.stringify(map); if (t.length > 4000000) return false; window.localStorage.setItem(SCR_KEY(em), t); return true; } catch (e) { return false; } }
// MARKER_GL_DOA_TB_DIFF_V1 -- เทียบ TB เดิมกับที่โยนใหม่ต่อ Account: เพิ่ม / ลบ / เปลี่ยน (แสดงเฉพาะรายการที่เปลี่ยนแปลง)
function tbRowMap(m) {
  const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0;
  for (let i = 0; i < Math.min((m || []).length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
  const nz = (v) => { const t = String(v == null ? '' : v).trim(); const n = Number(t.replace(/,/g, '')); return t !== '' && !Number.isNaN(n) ? String(Math.round(n * 100) / 100) : t; };
  const out = new Map();
  for (let i = hi + 1; i < (m || []).length; i++) { const r = m[i] || []; const code = String(r[ac] == null ? '' : r[ac]).trim(); if (!code || !/\d/.test(code) || !/^[0-9A-Za-z.\-_/]+$/.test(code)) continue; const cells = r.map(nz); while (cells.length && cells[cells.length - 1] === '') cells.pop(); out.set(code, (out.get(code) ? out.get(code) + '|' : '') + cells.join('\u0001')); }
  return out;
}
function tbDiff(oldM, newM) {
  const a = tbRowMap(oldM), b = tbRowMap(newM); const added = [], removed = [], changed = [];
  b.forEach((v, k) => { if (!a.has(k)) added.push(k); else if (a.get(k) !== v) changed.push(k); }); a.forEach((v, k) => { if (!b.has(k)) removed.push(k); });
  return { added, removed, changed };
}
// MARKER_GL_DOA_TB_SUMS_V1 -- ยอด Beginning / Period Activity / Ending รวมต่อ Account จาก TB ที่คัดตาม Config แล้ว (ใช้แสดงใน Popup ตอนโยน TB)
function tbAccSums(m) {
  const hi = (m || []).findIndex(r => (r || []).some(c => /^account$/i.test(String(c || '').trim()))); if (hi < 0) return [];
  const hd = m[hi] || []; const ix = (re) => hd.findIndex(c => re.test(String(c || '').trim()));
  const ja = ix(/^account$/i), jb = ix(/^begin/i), jp = ix(/^period\s*act/i), je = ix(/^ending/i), jd = ix(/^desc/i); const kc = segKeyCol(m);
  const num = (v) => { const t = String(v == null ? '' : v).trim(); if (!t) return 0; const neg = /^\(.*\)$/.test(t); const n = Number(t.replace(/[(),\s]/g, '')); return Number.isNaN(n) ? 0 : (neg ? -n : n); };
  const out = new Map();
  for (let i = hi + 1; i < m.length; i++) { const r = m[i] || []; const k = kc >= 0 ? parseSegKey(r[kc]) : null; const code = k ? k.account : String(r[ja] == null ? '' : r[ja]).trim(); if (!code || !/\d/.test(code)) continue;
    const o = out.get(code) || { code, name: '', b: 0, p: 0, e: 0, n: 0 }; o.b += jb >= 0 ? num(r[jb]) : 0; o.p += jp >= 0 ? num(r[jp]) : 0; o.e += je >= 0 ? num(r[je]) : 0; o.n += 1; if (!o.name && jd >= 0) o.name = String(r[jd] || '').trim(); out.set(code, o); }
  return [...out.values()];
}
// MARKER_GL_DOA_SUMS_BY_CPC_V1 -- ยอด Beginning / Activity / Ending แยกตาม CPC + Sub Acc ต่อ Account (แถว Total ที่ไม่มี Account ไม่นับ) ใช้แสดงในรายการ Config ทีละบรรทัด
function tbCpcSums(m, okCom) {
  const hi = (m || []).findIndex(r => (r || []).some(c => /^account$/i.test(String(c || '').trim()))); const kc = segKeyCol(m); if (hi < 0 && kc < 0) return [];
  const hd = (m[hi] || []).map(c => String(c || '').trim()); const ix = (re) => hd.findIndex(c => re.test(c));
  const ja = ix(/^account$/i), jbr = ix(/^branch$/i), jc = ix(/^(cpc|cost\s*(center|centre)|cc)\b/i), js = ix(/sub\s*-?\s*acc|sub\s*account|subacc/i), jb = ix(/^begin/i), jp = ix(/^period\s*act/i), je = ix(/^ending/i);
  const num = (v) => { const t = String(v == null ? '' : v).trim(); if (!t) return 0; const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const n = Number(t.replace(/[(),\s-]/g, '')); return Number.isNaN(n) ? 0 : (neg ? -n : n); };
  const out = new Map();
  for (let i = (hi < 0 ? 0 : hi + 1); i < m.length; i++) { const r = m[i] || []; const k = kc >= 0 ? parseSegKey(r[kc]) : null;
    const code = k ? k.account : String(r[ja] == null ? '' : r[ja]).trim(); if (!code || !/\d/.test(code)) continue;
    if (okCom) { const cv = k ? k.seg3 : (jbr >= 0 ? String(r[jbr] == null ? '' : r[jbr]).replace(/\D/g, '').slice(0, 4) : ''); if (cv && !okCom(cv)) continue; } // MARKER_GL_DOA_TB_STANDBY_V1
    const cpc = k ? k.cpc : (jc >= 0 ? String(r[jc] == null ? '' : r[jc]).trim() : ''); const sub = k ? k.sub : (js >= 0 ? String(r[js] == null ? '' : r[js]).trim() : '');
    const key = code + '|' + cpc + '|' + sub; const o = out.get(key) || { code, cpc, sub, b: 0, p: 0, e: 0 };
    o.b += jb >= 0 ? num(r[jb]) : 0; o.p += jp >= 0 ? num(r[jp]) : 0; o.e += je >= 0 ? num(r[je]) : 0; out.set(key, o); }
  return [...out.values()];
}
// MARKER_GL_DOA_CONFIG_DRILL_V1 -- Detail ของบรรทัด Config: แสดงขั้นตอนการคัดจากไฟล์ดิบ (ทุกแถวของ Account -> คัด COM/Branch -> คัด CPC -> คัด Sub Acc) แล้วแตกยอดรายสาขา
function tbDrill(m, r, bu, com) {
  const hi = (m || []).findIndex(x => (x || []).some(c => /^account$/i.test(String(c || '').trim()))); const kc = segKeyCol(m); if (hi < 0 && kc < 0) return null;
  const hd = (m[hi] || []).map(c => String(c || '').trim()); const ix = (re) => hd.findIndex(c => re.test(c));
  const ja = ix(/^account$/i), jbr = ix(/^branch$/i), jc = ix(/^(cpc|cost\s*(center|centre)|cc)\b/i), js = ix(/sub\s*-?\s*acc|sub\s*account|subacc/i), jb = ix(/^begin/i), jp = ix(/^period\s*act/i), je = ix(/^ending/i);
  const num = (v) => { const t = String(v == null ? '' : v).trim(); if (!t) return 0; const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const n = Number(t.replace(/[(),\s-]/g, '')); return Number.isNaN(n) ? 0 : (neg ? -n : n); };
  const z0 = (x) => String(x == null ? '' : x).replace(/^0+/, ''); const mt = (cfg, v, all) => { const c = String(cfg || '').trim().toUpperCase(); return c === all || c === String(v || '').toUpperCase() || z0(c) === z0(v); };
  const ex = (mode, ok) => (mode === 'exclude' ? !ok : ok);
  const rows = []; for (let i = (hi < 0 ? 0 : hi + 1); i < m.length; i++) { const x = m[i] || []; const k = kc >= 0 ? parseSegKey(x[kc]) : null; const code = k ? k.account : String(x[ja] == null ? '' : x[ja]).trim(); if (String(code) !== String(r.account)) continue;
    rows.push({ br: k ? k.branch : (jbr >= 0 ? String(x[jbr] == null ? '' : x[jbr]).trim() : ''), com: k ? k.seg3 : '', cpc: k ? k.cpc : (jc >= 0 ? String(x[jc] == null ? '' : x[jc]).trim() : ''), sub: k ? k.sub : (js >= 0 ? String(x[js] == null ? '' : x[js]).trim() : ''), b: jb >= 0 ? num(x[jb]) : 0, p: jp >= 0 ? num(x[jp]) : 0, e: je >= 0 ? num(x[je]) : 0 }); }
  const sum = (a) => a.reduce((t, d) => ({ b: t.b + d.b, p: t.p + d.p, e: t.e + d.e }), { b: 0, p: 0, e: 0 });
  const hasBr = rows.some(d => d.br || d.com); const comOk = (d) => { const v = d.com || String(d.br || '').replace(/\D/g, '').slice(0, 4); return !v || z0(v) === z0(bu) || z0(v) === z0(com || '~'); };
  const s1 = rows, s2 = hasBr ? s1.filter(comOk) : s1, s3 = s2.filter(d => ex(r.cpc_mode, mt(r.cpc, d.cpc, 'BBBBB'))), s4 = s3.filter(d => ex(r.sub_mode, mt(r.sub_acc, d.sub, 'BBBBBB')));
  const by = new Map(); s4.forEach(d => { const o = by.get(d.br || '—') || { br: d.br || '—', n: 0, b: 0, p: 0, e: 0 }; o.n += 1; o.b += d.b; o.p += d.p; o.e += d.e; by.set(d.br || '—', o); });
  const byC = new Map(); s4.forEach(d => { if (!d.cpc) return; const o = byC.get(d.cpc) || { cpc: d.cpc, n: 0, b: 0, p: 0, e: 0 }; o.n += 1; o.b += d.b; o.p += d.p; o.e += d.e; byC.set(d.cpc, o); }); // MARKER_GL_DOA_DRILL_SPLIT_CPC_V1 -- ยอดแยกตาม CPC (ใช้ติ๊กบันทึกเป็น Config เมื่อ CPC = BBBBB)
  return { rows: s4, cpcs: [...byC.values()].sort((a, b) => String(a.cpc).localeCompare(String(b.cpc))), steps: [{ t: 'แถวของ Account นี้ในไฟล์ (ทุก COM / CPC / สาขา)', n: s1.length, s: sum(s1) }, { t: hasBr ? `คัด COM (Branch 4 หลักแรก = ${com || bu})` : 'คัด COM — ไม่พบคอลัมน์ Branch จึงข้ามขั้นนี้', n: s2.length, s: sum(s2) }, { t: `คัด CPC = ${r.cpc_mode === 'exclude' ? 'ยกเว้น ' : ''}${r.cpc}`, n: s3.length, s: sum(s3) }, { t: `คัด Sub Acc = ${r.sub_mode === 'exclude' ? 'ยกเว้น ' : ''}${r.sub_acc}`, n: s4.length, s: sum(s4) }], branches: [...by.values()].sort((a, b) => String(a.br).localeCompare(String(b.br))), hasBr };
}
// MARKER_GL_DOA_DETAIL_SIMPLE_BY_TB_V1 -- Detail / Simple เข้าตาม TB เป็นหลัก: เหลือเฉพาะแถวของ Account ที่อยู่ใน TB ของงวด (แถวลูกที่ Account ว่างตามแถวแม่)
function keepAccs(m, set) {
  const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0;
  for (let i = 0; i < Math.min((m || []).length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
  if (hi < 0) return m; const out = m.slice(0, hi + 1); let keep = true;
  for (let i = hi + 1; i < m.length; i++) { const r = m[i] || []; const code = String(r[ac] == null ? '' : r[ac]).trim(); if (code) keep = set.has(code); if (keep) out.push(r); }
  return out;
}
function matrixToAccounts(m) {
  const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i;
  let hi = -1, ac = 0, nc = -1;
  for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) {
    const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim()));
    if (j >= 0) { hi = i; ac = j; }
  }
  if (hi >= 0) nc = (m[hi] || []).findIndex((c, j) => j !== ac && /name|ชื่อ|desc|คำอธิบาย/i.test(String(c || '')));
  const out = new Map();
  for (let i = hi + 1; i < m.length; i++) {
    const r = m[i] || [];
    const code = String(r[ac] == null ? '' : r[ac]).trim();
    if (!code || !/\d/.test(code) || !/^[0-9A-Za-z.\-_/]+$/.test(code)) continue;
    let name = nc >= 0 ? String(r[nc] || '').trim() : '';
    if (nc < 0 && r[ac + 1] != null && Number.isNaN(Number(String(r[ac + 1]).replace(/,/g, '')))) name = String(r[ac + 1]).trim();
    if (!out.has(code)) out.set(code, { code, name });
  }
  return { accounts: [...out.values()], header: hi >= 0 };
}
// MARKER_GL_DOA_SIMPLE_REFORM_V1 -- Reform "Outstanding  Simple upload – ADI (Custom)" ตาม Macro GL_SystemControl.xlam (Option_Cutting_Outstanding_for_AllGL)
// Macro: หัวรายงานแถว 1-18, ข้อมูลเริ่มแถว 19 (คอลัมน์ A-K), คีย์จับคู่บรรทัด = คอลัมน์ L; แถวที่ L เท่าแถวถัดไป + A ไม่ว่าง + ไม่ใช่ Total = "Z" (บรรทัดแรกของรายการ) → ดึงค่า A-K ไปใส่บรรทัดถัดไปแล้วทิ้งแถว Z;
// เก็บคอลัมน์ A-U, AA, AC (ตัด V:Z, AB, AD:BM); ตัดแถวหัว 6-12; ไฟล์ Final ชื่อ "MM.YYYY Outstanding Report Custom.<B4>.<B3>" (B3 = BU)
function periodFromCell(v) { // D3 "26-Sep" (yy-mmm) / Date / Excel serial / "Sep-26" → "YYYY.MM"
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }; const pad = (n) => String(n).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}.${pad(v.getMonth() + 1)}`;
  if (typeof v === 'number' && v > 20000) { const d = new Date(Math.round((v - 25569) * 86400000)); return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}`; }
  const t = String(v == null ? '' : v).trim(); let x;
  if ((x = t.match(/^(\d{2})-([A-Za-z]{3})$/)) && MON[x[2].toUpperCase()]) return `20${x[1]}.${pad(MON[x[2].toUpperCase()])}`;
  if ((x = t.match(/^([A-Za-z]{3})-(\d{2,4})$/)) && MON[x[1].toUpperCase()]) return `${x[2].length === 2 ? '20' + x[2] : x[2]}.${pad(MON[x[1].toUpperCase()])}`;
  if ((x = t.match(/^(\d{4})[.\/-](\d{1,2})/))) return `${x[1]}.${pad(x[2])}`;
  return '';
}
function isSimpleOutstanding(m) { return (m || []).slice(0, 3).some(r => (r || []).some(c => /outstanding\s+simple\s+upload/i.test(String(c || '')))); } // ชื่อรายงานอาจอยู่ A1 หรือ B1 (เซลล์ Merge)
function reformSimple(m) {
  if (!isSimpleOutstanding(m)) return null;
  const K = 11; const g = (r, c) => String((r || [])[c] == null ? '' : r[c]).trim(); const isTot = (r) => /total/i.test(g(r, 0));
  // หาแถวหัวคอลัมน์จากคำว่า Oracle Branch (ไม่ล็อกเลขแถว) → รองรับทั้งไฟล์ดิบ (ข้อมูลเริ่มแถว 19) และไฟล์ที่ตัดส่วน Parameters แล้ว (ข้อมูลเริ่มแถว 12)
  let hdr = m.findIndex(r => (r || []).some(c => /^oracle\s*branch/i.test(String(c || '').trim()))); if (hdr < 0) hdr = 15;
  let S = m.findIndex((r, i) => i > hdr && /^\d{4,}/.test(g(r, 0))); if (S < 0) S = hdr + 3;
  // ตาม Macro (Option_Cutting_Outstanding_for_AllGL): บรรทัดบน (A-K) ที่ L เท่ากับบรรทัดถัดไป = "Z" → ดึงค่า A-K ลงมาใส่บรรทัดล่าง แล้วลบบรรทัดบนทิ้ง (แถวลูกที่เหลือคงเดิม)
  const rows = m.slice(S); const flag = rows.map((r, i) => (g(r, K) !== '' && i + 1 < rows.length && g(r, K) === g(rows[i + 1], K) && g(r, 0) !== '' && !isTot(r)) ? 'Z' : 'A');
  const out = []; let merged = 0;
  rows.forEach((r, i) => {
    if (flag[i] === 'Z') return;
    const n = (r || []).slice();
    if (i > 0 && flag[i - 1] === 'Z' && !isTot(r)) { const pv = rows[i - 1] || []; for (let c = 0; c <= 10; c++) n[c] = pv[c] == null ? '' : pv[c]; merged++; }
    out.push(n);
  });
  // MARKER_GL_DOA_SIMPLE_COLS_MACRO_V1 -- ตัดคอลัมน์ตาม Macro: ลบ V:Z, AB, AD:BM -> เหลือ A–U + AA (Invoice Number) + AC (Expense period) = 23 คอลัมน์ เท่ากับ Simple Final
  const KEEP_C = [...Array.from({ length: 21 }, (_, i) => i), 26, 28]; const keep = (r) => KEEP_C.map(j => { const v = (r || [])[j]; return v == null ? '' : v; });
  const PARAM = /^(branch from|cost center accrue|acc code accrue|sub acc code accrue|acc code expense|sub acc code expense|supplier number)/i; // ตัดส่วน Parameters (แถว 6-12) ออกเหมือน Macro
  const head = m.slice(0, S).filter(r => !PARAM.test(g(r, 0))).map(keep);
  const bu = g(m[2], 1), b4 = g(m[3], 1); const period = periodFromCell((m[2] || [])[3]); // Period Name (D3) → งวด
  const fb = out.find(r => /^\d{4,}/.test(g(r, 0))); const comCode = fb ? g(fb, 0).slice(0, 4) : ''; // Oracle Branch 057201 → COM 0572
  const fileName = `${period ? period.slice(5) + '.' + period.slice(0, 4) : g(m[2], 3)} Outstanding Report Custom.${b4}.${bu}`;
  return { matrix: head.concat(out.map(keep)), merged, rows: out.length, bu, period, comCode, fileName };
}
// MARKER_GL_DOA_TB_HEADER_V1 -- TB ของ GL เก็บ Header รายงาน (ชื่อรายงาน/งวด/บริษัท) ไว้กับข้อมูล และหายไปพร้อมกันเมื่อลบ
function parseTbHeader(m) {
  if (!Array.isArray(m) || !m.length) return null;
  const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1;
  for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) if ((m[i] || []).some(c => re.test(String(c || '').trim()))) hi = i;
  const lines = m.slice(0, hi < 0 ? 0 : hi).map(r => (r || []).map(c => String(c == null ? '' : c).trim()).filter(Boolean).join('  ')).filter(Boolean);
  if (!lines.length) return null;
  const all = lines.join('\n'); const g = (rx) => { const x = all.match(rx); return x ? x[1].trim() : ''; };
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const pm = all.match(/period[^\n]*?\b([A-Za-z]{3})-(\d{2})\b/i); let period = '';
  if (pm && MON[pm[1].toUpperCase()]) period = `20${pm[2]}.${String(MON[pm[1].toUpperCase()]).padStart(2, '0')}`;
  return { lines, book: lines[0].split(/\s{2,}/)[0] || '', title: g(/(detail trial balance|trial balance)/i) || '', reportDate: g(/report date:\s*([^\n]*?)(?:\s{2,}|$)/im), period, periodText: g(/(period[^\n]*?[A-Za-z]{3}-\d{2})/i), company: g(/company:\s*([^\n]+)/i), comCode: (all.match(/company:\s*(\d+)/i) || [])[1] || '' };
}
// MARKER_GL_DOA_FILTER_BY_CONFIG_V1 -- คัดแถวตาม Config ที่ตั้งไว้ (BU + Account + CPC Accept/Exclude + Sub Acc Accept/Exclude) ถ้าไฟล์มีคอลัมน์นั้น | BBBBB = ทุก CPC, BBBBBB = ทุก Sub Acc, Exclude ชนะ Accept
function filterByConfig(m, cfgRows, bu, com, inherit = false) { // inherit: แถวลูก (Account ว่าง) ตามแถวแม่ที่ผ่านการคัด (Outstanding Simple)
  const reAcc = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i;
  let hi = -1, ac = 0;
  for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => reAcc.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
  const rules = new Map();
  cfgRows.filter(r => r.bu === bu).forEach(r => {
    const o = rules.get(r.account) || { ca: new Set(), ce: new Set(), sa: new Set(), se: new Set() };
    (r.cpc_mode === 'exclude' ? o.ce : o.ca).add(r.cpc); (r.sub_mode === 'exclude' ? o.se : o.sa).add(r.sub_acc);
    rules.set(r.account, o);
  });
  const kcol = segKeyCol(m); // TB แบบคีย์รวม: คัดตาม Config จาก COM (Segment 3) / CPC / Sub Acc ในคีย์
  if (kcol >= 0 && rules.size) {
    const zk = (x) => String(x).replace(/^0+/, ''); const okk = (set, v, all) => (set.has(all) || set.has(v) || [...set].some(x => zk(x) === zk(v)));
    let first = -1; const outK = []; let totalK = 0, keptK = 0;
    for (let i = 0; i < m.length; i++) {
      const r = m[i] || []; const k = parseSegKey(r[kcol]);
      if (!k) { if (first < 0) outK.push(r); continue; }
      if (first < 0) first = i; totalK++;
      const o = rules.get(k.account); if (!o) continue;
      if (zk(k.seg3) !== zk(com || '~') && zk(k.seg3) !== zk(bu)) continue;
      if (!okk(o.ca, k.cpc, 'BBBBB') || okk(o.ce, k.cpc, '\u0000')) continue;
      if (!okk(o.sa, k.sub, 'BBBBBB') || okk(o.se, k.sub, '\u0000')) continue;
      outK.push(r); keptK++;
    }
    return { matrix: outK, total: totalK, kept: keptK, cpcCol: true, subCol: true, buCol: true, filtered: true };
  }
  if (hi < 0 || !rules.size) return { matrix: m, total: Math.max(0, m.length - 1), kept: Math.max(0, m.length - 1), cpcCol: false, subCol: false, buCol: false, filtered: false };
  const hdr = (m[hi] || []).map(c => String(c || '').trim());
  const find = (re) => hdr.findIndex((c, j) => j !== ac && re.test(c));
  const ci = find(/^(cpc|cost\s*(center|centre)|cc)\b/i), si = find(/sub\s*-?\s*acc|sub\s*account|subacc/i), bi = find(/^(bu|com|company|business\s*unit|segment\s*3|(oracle\s*)?branch)\b/i); const brCol = bi >= 0 && /branch/i.test(hdr[bi]);
  const z = (x) => String(x).replace(/^0+/, '');
  const ok = (set, v, all) => (set.has(all) || set.has(v) || [...set].some(x => z(x) === z(v)));
  let st0 = hi + 1; if (inherit) { let nb = 0; while (nb < 10 && st0 < m.length && (m[st0] || []).every(c => String(c == null ? '' : c).trim() === '')) { st0++; nb++; } } // MARKER_GL_DOA_KEEP_HDR_BLANK_V1 -- Simple: เก็บแถวว่างใต้หัวคอลัมน์ (หัวตารางสูง 3 แถวเหมือน Final)
  const out = m.slice(0, st0); let total = 0; let keepKids = false;
  for (let i = st0; i < m.length; i++) {
    const r = m[i] || []; const code = String(r[ac] == null ? '' : r[ac]).trim();
    if (inherit && /^(total|gran[dt])/i.test(String(r[0] == null ? '' : r[0]).trim())) { keepKids = false; continue; } // MARKER_GL_DOA_RECOMPUTE_TOTALS_V1 -- ไม่คัดลอก Total จากไฟล์ต้นฉบับ (ยอดจะไม่ตรงหลังคัดตาม Config) แต่คำนวณใหม่ท้ายฟังก์ชัน
    if (!code) { if (inherit && keepKids) out.push(r); continue; }
    total++; keepKids = false;
    const o = rules.get(code); if (!o) continue;
    if (bi >= 0) { let v = String(r[bi] == null ? '' : r[bi]).trim(); if (brCol) v = v.slice(0, 4); if (v && z(v) !== z(bu) && z(v) !== z(com || '~')) continue; } // Oracle Branch 057201 → COM 0572
    if (ci >= 0) { const v = String(r[ci] == null ? '' : r[ci]).trim(); if (!ok(o.ca, v, 'BBBBB') || (v && ok(o.ce, v, '\u0000'))) continue; }
    if (si >= 0) { const v = String(r[si] == null ? '' : r[si]).trim(); if (!ok(o.sa, v, 'BBBBBB') || (v && ok(o.se, v, '\u0000'))) continue; }
    out.push(r); keepKids = true;
  }
  if (inherit) { // สรุป Total ใหม่: "Total by branch <Branch>-<CPC>-<Account>" (รวมยอด Total Amount (Rate) by Period ต่อ Branch+CPC+Account) และ "Total by Account <Account>"
    let ae = hdr.findIndex(c => /^total\s*amount\s*\(rate\)/i.test(c)); if (ae < 0) ae = ac + 4;
    const nv = (v) => { const x = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return isFinite(x) ? x : 0; };
    const fmt = (x) => { const t = (Math.round(x * 100) / 100).toFixed(2); return t.replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/(\d),(\d{3})\.(\d\d)$/, '$1,$2.$3'); };
    const blank = (txt, amt) => { const w = Math.max(...out.map(x => (x || []).length), ae + 1); const row = Array.from({ length: w }).map(() => ''); row[0] = txt; row[ae] = fmt(amt); return row; };
    const res = out.slice(0, hi + 1); let key = '', accCur = '', bs = 0, as = 0, bTxt = '';
    const flushB = () => { if (key) { res.push(blank(bTxt, bs)); as += bs; } key = ''; bs = 0; };
    const flushA = () => { flushB(); if (accCur) res.push(blank('Total by Account ' + accCur, as)); accCur = ''; as = 0; };
    out.slice(hi + 1).forEach(r => {
      const code = String(r[ac] == null ? '' : r[ac]).trim();
      if (code) {
        const br = bi >= 0 ? String(r[bi] == null ? '' : r[bi]).trim() : ''; const cp = ci >= 0 ? String(r[ci] == null ? '' : r[ci]).trim() : '';
        const k = br + '|' + cp + '|' + code;
        if (code !== accCur) { flushA(); accCur = code; }
        if (k !== key) { flushB(); key = k; bTxt = `Total by branch ${br}-${cp}-${code}`; }
        bs += nv(r[ae]);
      }
      res.push(r);
    });
    flushA(); out.length = 0; res.forEach(x => out.push(x));
  }
  return { matrix: out, total, kept: out.filter((x, k) => k > hi && String((x || [])[ac] == null ? '' : x[ac]).trim()).length, cpcCol: ci >= 0, subCol: si >= 0, buCol: bi >= 0, filtered: true };
}
// MARKER_GL_DOA_AUTO_DETECT_FORM_V1 -- ระบบรู้เองว่าไฟล์/ข้อมูลที่โยนเป็นฟอร์มอะไร (TB / Detail / Simple): ดูชื่อไฟล์ → หัวคอลัมน์ → ลักษณะข้อมูล (TB = 1 Account ต่อ 1 แถว, Detail = Account เดียวกันซ้ำหลายแถว)
// MARKER_GL_DOA_DETAIL_INFO_V1 -- ไฟล์ Detail ไม่มี Header COM/งวด: COM = 4 หลักแรกของ Branch Code (057201 -> 0572) | งวด = จากชื่อไฟล์ (…09.2026 / 2026.09) ไม่เจอใช้เดือนของ Transaction Date ล่าสุด
function detailInfo(m, label) {
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  let hi = -1, bc = -1, tc = -1;
  for (let i = 0; i < Math.min((m || []).length, 15) && hi < 0; i++) { const t = (m[i] || []).map(c => String(c == null ? '' : c).trim().toLowerCase()); const b = t.findIndex(x => /^branch(\s*code)?$/.test(x)); if (b >= 0 && t.some(x => /^journal\s*name$/.test(x))) { hi = i; bc = b; tc = t.findIndex(x => /^transaction(\s*date)?$/.test(x)); } }
  let com = ''; let per = '';
  if (hi >= 0) {
    for (let i = hi + 1; i < m.length && !com; i++) { const v = String((m[i] || [])[bc] == null ? '' : m[i][bc]).replace(/\D/g, ''); if (v.length >= 4) com = v.slice(0, 4); }
  }
  const nm = String(label || ''); let mt = nm.match(/(?:^|[^0-9])(0[1-9]|1[0-2])[._-](20\d{2})(?:[^0-9]|$)/); if (mt) per = `${mt[2]}.${mt[1]}`; else { mt = nm.match(/(?:^|[^0-9])(20\d{2})[._-](0[1-9]|1[0-2])(?:[^0-9]|$)/); if (mt) per = `${mt[1]}.${mt[2]}`; }
  if (!per && hi >= 0 && tc >= 0) { let best = ''; for (let i = hi + 1; i < m.length; i++) { const d = String((m[i] || [])[tc] == null ? '' : m[i][tc]).match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/); if (d && MON[d[2].toUpperCase()]) { const k = `${d[3]}.${String(MON[d[2].toUpperCase()]).padStart(2, '0')}`; if (k > best) best = k; } } per = best; }
  return { com, period: per };
}
function tbBranchCom(m) { // MARKER_GL_DOA_PASTE_TB_BRANCH_V1 -- TB ที่วางมาไม่มีหัวรายงาน: COM = 4 หลักแรกของ Branch (057201 -> 0572) จากคอลัมน์ Branch ของหัวตาราง
  for (let i = 0; i < Math.min((m || []).length, 15); i++) { const t = (m[i] || []).map(c => String(c == null ? '' : c).trim().toLowerCase()); const b = t.findIndex(x => /^branch$/.test(x)); if (b >= 0 && t.some(x => /^account$/.test(x))) { for (let k = i + 1; k < m.length; k++) { const v = String((m[k] || [])[b] == null ? '' : m[k][b]).replace(/\D/g, ''); if (v.length >= 4) return v.slice(0, 4); } return ''; } }
  return '';
}
function detectForm(m, label) {
  const name = String(label || '');
  const a1 = String(((m || [])[0] || [])[0] || ''); // ลายเซ็นฟอร์มตาม Macro (Dispatcher ใน GL_SystemControl.xlam)
  if (segKeyCol(m) >= 0 && !isSimpleOutstanding(m)) return { type: 'TB', why: 'คีย์ Segment ในคอลัมน์ B (…-1-05-COM-Branch-CPC-Account-SubAcc)' };
  if ((m || []).slice(0, 12).some(r => { const t = (r || []).map(c => String(c == null ? '' : c).trim().toLowerCase()); return t.some(x => /^branch$/.test(x)) && t.some(x => /^cpc$/.test(x)) && t.some(x => /^account$/.test(x)) && t.some(x => /^sub\s*acc/.test(x)) && t.some(x => /^ending\s*bal/.test(x)); })) return { type: 'TB', why: 'หัวคอลัมน์ TB (Branch/CPC/Account/SubAcc/Ending Balance)' }; // MARKER_GL_DOA_PASTE_TB_BRANCH_V1 -- วาง TB จาก Excel (ชีต TB: Branch, CPC, Account, SubAcc, Description, Beginning, Period Activity, Ending) รู้เองว่าเป็น TB
  if (isSimpleOutstanding(m)) return { type: 'Simple', why: 'A1 = Outstanding Simple upload – ADI (Custom)' };
  if ((m || []).slice(0, 12).some(r => { const t = (r || []).map(c => String(c == null ? '' : c).trim().toLowerCase()); return t.some(x => /^branch(\s*code)?$/.test(x)) && t.some(x => /^account\s*code$/.test(x)) && t.some(x => /^journal\s*name$/.test(x)); })) return { type: 'Detail', why: 'หัวคอลัมน์ Detail (Branch/Account Code/Journal name)' }; // MARKER_GL_DOA_DETAIL_SIG_V1
  if (/branch/i.test(a1) && /accname/i.test(a1) && /account\s*code/i.test(a1) && /journal\s*name/i.test(a1)) return { type: 'Detail', why: 'หัวคอลัมน์ Detail (Branch/AccName/Journal name)' };
  if (String(((m || [])[8] || [])[0] || '').trim() === 'Branch' && /ending balance/i.test(String(((m || [])[8] || [])[7] || ''))) return { type: 'TB', why: 'A9 = Branch, H9 = Ending Balance' };
  const top = (m || []).slice(0, 12).map(r => (r || []).map(c => String(c || '')).join(' ')).join(' ');
  if (/trial\s*balance/i.test(top) && !/simple/i.test(name)) return { type: 'TB', why: 'หัวรายงาน Trial Balance' };
  if (/simple/i.test(name)) return { type: 'Simple', why: 'ชื่อไฟล์' };
  if (/detail|journal|\bjv\b|\bdt\b/i.test(name)) return { type: 'Detail', why: 'ชื่อไฟล์' };
  if (/\btb\b|trial/i.test(name)) return { type: 'TB', why: 'ชื่อไฟล์' };
  const head = (m || []).slice(0, 8).map(r => (r || []).map(c => String(c || '')).join(' ')).join(' ');
  if (/simple/i.test(head)) return { type: 'Simple', why: 'หัวคอลัมน์' };
  const hits = (head.match(/journal|batch|source|line\s*(no|num)|reference|document|posting|entered|\bje\b|\bjv\b/gi) || []).length;
  if (hits >= 2) return { type: 'Detail', why: 'หัวคอลัมน์แบบรายการ' };
  if (/beginning|opening|ending|closing|trial|balance|ยอดยกมา|ยอดคงเหลือ/i.test(head)) return { type: 'TB', why: 'หัวคอลัมน์แบบยอดคงเหลือ' };
  const r = matrixToAccounts(m); const codes = new Set(r.accounts.map(a => a.code));
  let rows = 0; const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0;
  for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
  for (let i = hi + 1; i < m.length; i++) { const v = String((m[i] || [])[ac] == null ? '' : (m[i] || [])[ac]).trim(); if (v && /\d/.test(v)) rows++; }
  if (codes.size && rows / codes.size > 1.5) return { type: 'Detail', why: 'Account ซ้ำหลายแถว' };
  return { type: 'TB', why: 'Account ละ 1 แถว' };
}
async function fileToMatrix(file, want) {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) return tbReportToMatrix(textToMatrix(await file.text()));
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const toM = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
  if (want === 'Detail') { /* MARKER_GL_DOA_DETAIL_MULTISHEET_V1 -- Detail ที่ Customize ได้ (เช่น แยกหลายชีต): ไล่ทุกชีต เอาเฉพาะชีตที่มีหัวคอลัมน์ Detail (Branch / Account Code / Journal name) แล้วต่อแถวเข้าด้วยกันตามหัวคอลัมน์ | ชีต Cover/Summary ที่ไม่ใช่ Detail ข้าม | ไม่พบชีต Detail เลย = ใช้ชีตแรกเหมือนเดิม */
    const parts = wb.SheetNames.map(n => { const m = tbReportToMatrix(toM(n)); return { n, m, c: detailCols(m), k: detailRows(m).length }; }).filter(x => x.c && x.k > 0);
    if (parts.length) {
      const base = parts[0].m.map(r => (r || []).slice()); const bi = parts[0].c.idx; const w = base.reduce((a, r) => Math.max(a, r.length), 14);
      parts.slice(1).forEach(x => { detailRows(x.m).forEach(o => { const r = new Array(w).fill(''); DET_KEYS.forEach((k, i) => { if (bi[i] >= 0) r[bi[i]] = o[k]; }); base.push(r); }); });
      base.__sheets = parts.map(x => `${x.n} (${x.k})`); return base;
    }
  }
  // MARKER_GL_DOA_SHEET_PICK_V1 -- ไฟล์ที่มีหลายชีต (เช่น Cover / 99999-21835000 / Outstanding Simple 21835000 / TB): ชีต "Outstanding Simple {Account}" ใช้เป็น Simple (หลายชีต = ต่อแถวข้อมูลเข้าด้วยกัน) | ไม่มีชีตชื่อนี้ใช้ชีตแรกเหมือนเดิม
  const simSheets = wb.SheetNames.filter(n => /^outstanding\s+simple/i.test(String(n).trim()));
  if (simSheets.length) {
    const base = toM(simSheets[0]);
    const start = (m) => { const h = m.findIndex(r => (r || []).some(c => /^oracle\s*branch/i.test(String(c || '').trim()))); const i = m.findIndex((r, k) => k > (h < 0 ? 15 : h) && /^\d{4,}/.test(String((r || [])[0] == null ? '' : r[0]).trim())); return i < 0 ? m.length : i; };
    simSheets.slice(1).forEach(n => { const m = toM(n); base.push(...m.slice(start(m))); });
    base.__sheets = simSheets; return base;
  }
  return tbReportToMatrix(toM(wb.SheetNames[0]));
}

// MARKER_GL_DOA_BU_PICKER_V1 -- ตัวเลือก BU แบบค้นหาได้ (รหัสเป็นคอลัมน์ ชื่อตัดบรรทัดเดียว) แทน <select> รายการยาว
function BuPicker({ value, options, onChange, height = 36, width = '100%', placeholder = 'เลือก BU' }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [pos, setPos] = React.useState({ top: 0, left: 0, w: 380 });
  const btnRef = React.useRef(null);
  const cur = options.find(o => o.value === value) || null;
  const nameOf = (o) => String(o.label || '').slice(String(o.value).length).trim();
  const list = options
    .filter(o => !q.trim() || (o.value + ' ' + nameOf(o)).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.value.localeCompare(b.value));
  const openIt = () => {
    const r = btnRef.current && btnRef.current.getBoundingClientRect();
    if (r) { const w = Math.max(r.width, 380); setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), w }); }
    setQ(''); setOpen(true);
  };
  return (
    <>
      <button ref={btnRef} type="button" onClick={openIt} title={cur ? cur.label : ''}
        style={{ width, height, boxSizing: 'border-box', border: '1px solid #B9C4D2', borderRadius: 6, background: '#fff', padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, textAlign: 'left', minWidth: 0 }}>
        {cur ? (<><b style={{ color: C.navy, flexShrink: 0 }}>{cur.value}</b><span style={{ color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{nameOf(cur)}</span></>) : <span style={{ color: '#8a96a6' }}>{placeholder}</span>}
        <span style={{ marginLeft: 'auto', color: C.mute, fontSize: 11, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.w, maxWidth: 'calc(100vw - 16px)', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(15,30,50,.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหารหัส / ชื่อ BU"
              style={{ border: 'none', borderBottom: `1px solid ${C.line}`, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {value && <div onClick={() => { onChange(''); setOpen(false); }} style={{ padding: '7px 12px', fontSize: 13, color: C.mute, cursor: 'pointer', borderBottom: '1px solid #EAEFF5' }}>ล้างการเลือก</div>}
              {list.length === 0 && <div style={{ padding: 14, fontSize: 13, color: '#8a96a6', textAlign: 'center' }}>ไม่พบ BU</div>}
              {list.map(o => (
                <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); }} title={o.label}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 12px', fontSize: 13, cursor: 'pointer', background: o.value === value ? '#E8F0FB' : 'transparent', borderBottom: '1px solid #F1F4F8' }}
                  onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = '#F5F8FC'; }} onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = 'transparent'; }}>
                  <b style={{ width: 70, flexShrink: 0, color: C.navy }}>{o.value}</b>
                  <span style={{ color: '#1B2A3D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{nameOf(o)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// MARKER_GL_DOA_CONFIG_FE_V1 -- หน้าต่าง Config: เลือก BU -> แสดง Config ทั้งหมดของ BU นั้น (Account ↔ User) เพิ่ม/ลบได้
const fmtDt = (v) => { if (!v) return '-'; const d = new Date(v); if (isNaN(d)) return '-'; const p2 = (n) => String(n).padStart(2, '0'); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
// MARKER_GL_DOA_COMBO_V1 -- ช่องกรอก + Dropdown แบบกำหนดเอง (พิมพ์เองได้ / เลือกจากรายการ)
function ComboInput({ value, options, onChange, placeholder, h = 36, up = false }) {
  const [open, setOpen] = React.useState(false);
  const q = String(value || '').trim().toLowerCase();
  const shown = options.filter(o => !q || String(o.value).toLowerCase().includes(q) || String(o.hint || '').toLowerCase().includes(q));
  return (
    <div style={{ position: 'relative' }}>
      <input style={{ ...inp, height: h, paddingRight: 28 }} value={value} placeholder={placeholder} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} />
      <span onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }} style={{ position: 'absolute', right: 0, top: 0, width: 28, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.mute, fontSize: 10 }}>▼</span>
      {open && shown.length > 0 && (
        <div style={{ position: 'absolute', ...(up ? { bottom: h + 4 } : { top: h + 4 }), left: 0, right: 0, zIndex: 30, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(15,30,50,.18)', maxHeight: 220, overflowY: 'auto' }}>
          {shown.map(o => (
            <div key={o.value} onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
              style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 12px', fontSize: 14, cursor: 'pointer', borderBottom: '1px solid #F0F3F7' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#EEF3FA'; }} onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}>
              <b style={{ color: C.navy }}>{o.value}</b>{o.hint && <span style={{ fontSize: 12, color: C.mute }}>{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DoaConfigModal({ buOptions, users, mods, defaultBu, meEmail, canDeleteAll, onClose, onChanged }) { // MARKER_GL_DOA_ALLLIST_DELETE_ADMIN_V1 -- All List: ลบได้เฉพาะ Owner/Admin
  const [bu, setBu] = React.useState(''); // กรอง BU ในแท็บ List (ว่าง = ทั้งหมด)
  const [addBu, setAddBu] = React.useState(defaultBu || ''); // MARKER_GL_DOA_CONFIG_TABS_V1 -- BU ของแท็บ Add
  const [tab, setTab] = React.useState('list');
  const [scope, setScope] = React.useState('my'); // MARKER_GL_DOA_CONFIG_MYALL_V1 -- My List / All List
  const [rows, setRows] = React.useState([]);
  const [acc, setAcc] = React.useState('');
  const [usr, setUsr] = React.useState(meEmail || ''); // MARKER_GL_DOA_CONFIG_USER_DEFAULT_V1 -- User เริ่มต้น = ผู้ใช้ที่ล็อกอิน (เดียวกับ Prepare by)
  const [msg, setMsg] = React.useState('');
  const load = React.useCallback(async () => {
    try { setRows(await listDoaConfig(bu || '')); setMsg(''); } // MARKER_GL_DOA_CONFIG_LIST_ALL_V1 -- ไม่เลือก BU = แสดง Config ทั้งหมด
     catch (e) { setMsg('โหลด Config ไม่ได้: ' + e.message); }
  }, [bu]);
  React.useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['doa_config_changed'], () => { load(); }, 60000); // มีคนเพิ่ม/ลบ Config -> โหลดใหม่ทันที + Poll สำรองทุก 60 วิ
  const notifyChanged = () => { broadcastWs('doa_config_changed', { by: meEmail }); }; // Broadcast ให้ทุกหน้าจอ/ทุก User รีเฟรช
  const isMine = (r) => String(r.user_email).toLowerCase() === String(meEmail).toLowerCase();
  // MARKER_GL_DOA_CONFIG_ALL_FILTER_V1 -- All List: Filter จำกัดผลลัพธ์ (User / ค้นหา Account, CPC, Sub Acc) + แสดงสูงสุด 50 กลุ่ม
  const [fUser, setFUser] = React.useState('');
  const [fQ, setFQ] = React.useState('');
  const ALL_LIMIT = 50;
  const userOpts = Array.from(new Set(rows.map(r => String(r.user_email).toLowerCase()))).sort();
  const filteredAll = rows.filter(r => (!fUser || String(r.user_email).toLowerCase() === fUser) && (!fQ.trim() || [r.account, r.cpc, r.sub_acc, r.bu].some(v => String(v || '').toLowerCase().includes(fQ.trim().toLowerCase()))));
  const shownRows = scope === 'my' ? rows.filter(isMine) : filteredAll;
  const [openKey, setOpenKey] = React.useState('');
  const groupsAll = (() => { const m = new Map(); shownRows.forEach(r => { const k = r.bu + '|' + String(r.user_email).toLowerCase(); let g = m.get(k); if (!g) { g = { key: k, bu: r.bu, user: r.user_email, items: [], last: null }; m.set(k, g); } g.items.push(r); if (r.created_at && (!g.last || new Date(r.created_at) > new Date(g.last))) g.last = r.created_at; }); return Array.from(m.values()); })();
  const groups = scope === 'all' ? groupsAll.slice(0, ALL_LIMIT) : groupsAll;
  const groupsHidden = scope === 'all' ? Math.max(0, groupsAll.length - ALL_LIMIT) : 0;
  // MARKER_GL_DOA_CONFIG_CLONE_V1 -- All List: Clone Config ของ User อื่น (ทั้ง BU) มาเป็นของตัวเอง; Account ที่ตัวเองมีอยู่แล้วใน BU เดิมจะข้าม (ไม่ทับ)
  const cloneGroup = async (g) => {
    if (!usr) { setMsg('ไม่พบ User ที่ล็อกอิน'); return; }
    if (!buOptions.some(o => String(o.value) === String(g.bu))) { setMsg('คุณไม่มีสิทธิ์ GL ใน BU ' + g.bu + ' — Clone ไม่ได้'); return; }
    const me = String(usr).toLowerCase();
    const mine = new Set(rows.filter(r => String(r.user_email).toLowerCase() === me && r.bu === g.bu).map(r => r.account));
    const take = g.items.filter(r => !mine.has(r.account));
    const accs = Array.from(new Set(take.map(r => r.account)));
    const skipN = new Set(g.items.map(r => r.account)).size - accs.length;
    if (!accs.length) { setMsg('Account ทั้งหมดของ BU ' + g.bu + ' มีใน Config ของคุณอยู่แล้ว — ไม่มีอะไรให้ Clone'); return; }
    if (!await askDoa(`Clone Config BU ${g.bu} ของ ${nameOf(g.user)} มาเป็นของคุณ ${accs.length} Account${skipN ? ` (ข้าม ${skipN} Account ที่คุณมีอยู่แล้ว)` : ''}?`)) return;
    try {
      await addDoaConfig(usr, take.map(r => ({ bu: r.bu, cpc: r.cpc, cpc_mode: r.cpc_mode || 'accept', account: r.account, sub_acc: r.sub_acc, sub_mode: r.sub_mode || 'accept' })));
      await load(); onChanged && onChanged(); notifyChanged();
      setMsg(`✓ Clone แล้ว BU ${g.bu} · ${accs.length} Account${skipN ? ` (ข้าม ${skipN})` : ''} — เพิ่มบรรทัดของ ${nameOf(usr)} ใน All List แล้ว`); // MARKER_GL_DOA_CLONE_NEWROW_V1
    } catch (e) { setMsg('Clone ไม่สำเร็จ: ' + e.message); }
  };
  const delGroup = async (g) => { if (scope === 'all' && !canDeleteAll) { setMsg('All List: เฉพาะ Admin เท่านั้นที่ลบได้'); return; } if (!await askDoa(`ลบ Config ทั้งหมดของ BU ${g.bu} (${g.items.length} Account)?`)) return; try { for (const r of g.items) await removeDoaConfig(r.id); await load(); onChanged && onChanged(); notifyChanged(); } catch (e) { setMsg('ลบไม่สำเร็จ: ' + e.message); } };
  const nameOf = (em) => { const u = users.find(x => String(x.email).toLowerCase() === String(em).toLowerCase()); return u && u.username ? `${u.username} (${em})` : em; };
  // MARKER_GL_DOA_CONFIG_FIELDS_V1 -- กรอกเป็นช่อง: BU / Account / CPC / Sub Acc (BBBBB = ทุก CPC, BBBBBB = ทุก Sub Acc ของ Account นั้น) -> เพิ่มเข้า List Preview -> กด + เพิ่ม เพื่อบันทึก
  const ALL_CPC = 'BBBBB', ALL_SUB = 'BBBBBB';
  const ST = { position: 'sticky', bottom: 0, background: '#F7FAFE', zIndex: 5, boxShadow: '0 -2px 0 #D5DEEA' }; // แถวกรอกค้างอยู่ล่างสุดของตารางแม้มีหลายรายการ
  const [accIn, setAccIn] = React.useState('');
  const [ent, setEnt] = React.useState({ ca: '', ce: '', sa: '', se: '' }); // MARKER_GL_DOA_CONFIG_ENTRY_ROW_V1 -- แถวกรอกในตาราง (เห็นตลอด)
  const [draft, setDraft] = React.useState([]); // MARKER_GL_DOA_CONFIG_TABLE_CELLS_V1 -- แถวละ Account: พิมพ์ CPC / Sub Acc ลงช่อง Accept / Exclude ในตารางเอง
  const seqRef = React.useRef(0);
  const startEdit = (bu0, items) => {
    const m = new Map();
    items.forEach(r => {
      const o = m.get(r.account) || { account: r.account, ca: [], ce: [], sa: [], se: [], ids: [] };
      o.ids.push(r.id);
      const put = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
      put(r.cpc_mode === 'exclude' ? o.ce : o.ca, r.cpc); put(r.sub_mode === 'exclude' ? o.se : o.sa, r.sub_acc);
      m.set(r.account, o);
    });
    setAddBu(bu0);
    setDraft(Array.from(m.values()).map(o => ({ key: 'r' + (++seqRef.current), bu: bu0, account: o.account, ca: o.ca.join(','), ce: o.ce.join(','), sa: o.sa.join(','), se: o.se.join(','), ids: o.ids })));
    setTab('add'); setMsg('กำลังแก้ไข BU ' + bu0 + ' — แก้ค่าในตารางได้เลย ระบบบันทึกให้อัตโนมัติ');
  };
  const cpcOpts = [{ value: ALL_CPC, hint: 'ทุก CPC ใน Account นั้น' }, ...Array.from(new Set(rows.map(r => r.cpc).filter(v => v && v !== ALL_CPC))).map(v => ({ value: v }))];
  const subOpts = [{ value: ALL_SUB, hint: 'ทุก Sub Acc ใน Account นั้น' }, ...Array.from(new Set(rows.map(r => r.sub_acc).filter(v => v && v !== ALL_SUB))).map(v => ({ value: v }))];
  const splitV = (v) => String(v || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
  // MARKER_GL_DOA_CONFIG_AUTOSAVE_V1 -- บันทึกอัตโนมัติ: กด ↓ / Enter / Import / แก้ค่าในตาราง = บันทึกลง DB ทันที (ไม่ต้องกดปุ่ม + เพิ่ม)
  const draftRef = React.useRef([]); draftRef.current = draft;
  const timers = React.useRef({}); const busy = React.useRef({});
  const persistRow = async (key) => {
    const r = draftRef.current.find(x => x.key === key); if (!r) return;
    if (!usr) { setMsg('ไม่พบ User ที่ล็อกอิน'); return; }
    if (busy.current[key]) { busy.current[key] = 'again'; return; }
    const { out, bad } = expandDraft([r]);
    if (bad.length) { setMsg(bad[0]); return; }
    busy.current[key] = true;
    try {
      for (const id of (r.ids || [])) await removeDoaConfig(id);
      await addDoaConfig(usr, out);
      const me = String(usr).toLowerCase();
      const ids = (await listDoaConfig(r.bu)).filter(x => x.account === r.account && String(x.user_email).toLowerCase() === me).map(x => x.id);
      setDraft(d => d.map(x => x.key === key ? { ...x, ids } : x));
      await load(); onChanged && onChanged(); notifyChanged(); setMsg('✓ บันทึกอัตโนมัติแล้ว (' + r.bu + ' · ' + r.account + ')');
    } catch (e) { setDraft(d => d.map(x => x.key === key ? { ...x, ids: [] } : x)); setMsg('บันทึกไม่สำเร็จ: ' + e.message); }
    const again = busy.current[key] === 'again'; delete busy.current[key];
    if (again) persistRow(key);
  };
  const scheduleSave = (key) => { clearTimeout(timers.current[key]); timers.current[key] = setTimeout(() => { delete timers.current[key]; persistRow(key); }, 700); };
  const flushSaves = () => { Object.keys(timers.current).forEach(k => { clearTimeout(timers.current[k]); delete timers.current[k]; persistRow(k); }); };
  const stage = () => {
    if (!addBu) { setMsg('ต้องเลือก BU ก่อน'); return; }
    const list = splitV(accIn);
    if (!list.length) { setMsg('กรอก Account (หลายตัวคั่นด้วย , หรือเว้นวรรค)'); return; }
    const have = new Set(draft.map(x => x.bu + '|' + x.account)); const fresh = [];
    list.forEach(a => { if (!have.has(addBu + '|' + a)) { have.add(addBu + '|' + a); fresh.push({ key: 'r' + (++seqRef.current), bu: addBu, account: a, ca: ent.ca, ce: ent.ce, sa: ent.sa, se: ent.se, ids: [] }); } });
    if (!fresh.length) { setMsg('Account นี้อยู่ในรายการแล้ว — แก้ค่าในตารางได้เลย'); return; }
    setDraft(d => [...d, ...fresh]); setAccIn(''); setMsg('');
    setTimeout(() => fresh.forEach(f => persistRow(f.key)), 60);
  };
  const setCell = (key, f, v) => { setDraft(d => d.map(x => x.key === key ? { ...x, [f]: v } : x)); scheduleSave(key); };
  const dropPreview = async (r) => {
    if ((r.ids || []).length && !await askDoa(`ลบ Account ${r.account} ออกจาก BU ${r.bu}?`)) return;
    clearTimeout(timers.current[r.key]); delete timers.current[r.key];
    try { for (const id of (r.ids || [])) await removeDoaConfig(id); setDraft(d => d.filter(x => x.key !== r.key)); if ((r.ids || []).length) { await load(); onChanged && onChanged(); notifyChanged(); setMsg('✓ ลบ Account ' + r.account + ' แล้ว'); } } catch (e) { setMsg('ลบไม่สำเร็จ: ' + e.message); }
  };
  const expandDraft = (src = draft) => { // แตกเป็นรายการละ (CPC x Sub Acc) พร้อมโหมด accept/exclude
    const out = []; const bad = [];
    src.forEach((r, i) => {
      const cs = [...splitV(r.ca).map(v => ({ v, m: 'accept' })), ...splitV(r.ce).map(v => ({ v, m: 'exclude' }))];
      const ss = [...splitV(r.sa).map(v => ({ v, m: 'accept' })), ...splitV(r.se).map(v => ({ v, m: 'exclude' }))];
      if (!cs.length || !ss.length) { bad.push(`แถว ${i + 1} (${r.account}) ยังไม่ระบุ CPC/Sub Acc`); return; }
      if (cs.some(x => x.m === 'exclude' && x.v === ALL_CPC) || ss.some(x => x.m === 'exclude' && x.v === ALL_SUB)) { bad.push(`แถว ${i + 1} (${r.account}) ใช้ BBBBB/BBBBBB ในช่อง Exclude ไม่ได้`); return; }
      cs.forEach(c => ss.forEach(sb => out.push({ bu: r.bu, cpc: c.v, cpc_mode: c.m, account: r.account, sub_acc: sb.v, sub_mode: sb.m })));
    });
    return { out, bad };
  };
  // MARKER_GL_DOA_CONFIG_TEMPLATE_IMPORT_V1 -- Template / Import (Excel, CSV): BU | CPC Accept | CPC Exclude | Account | Sub Acc Accept | Sub Acc Exclude
  const TPL_HEAD = ['COM/BU', 'CPC Accept', 'CPC Exclude', 'Account', 'Sub Acc Accept', 'Sub Acc Exclude'];
  // MARKER_GL_DOA_CONFIG_TPL_EXAMPLE_SPLIT_V1 -- Template = เฉพาะหัวคอลัมน์ (ไม่มีตัวอย่าง) | Example = ไฟล์ Config_Template_Example.xlsx (มีแถวตัวอย่าง + ชีตวิธีกรอก)
  const downloadTemplate = (withExample = false) => {
    const ws = XLSX.utils.aoa_to_sheet(withExample ? [TPL_HEAD, ['0572', 'BBBBB', '26100', '21835000', 'BBBBBB', ''], ['REV', '99999', '', '21805000', '999999', '']] : [TPL_HEAD]);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    // MARKER_GL_DOA_CONFIG_TPL_HOWTO_SHEET_V1 -- Example: วิธีกรอกวางไว้ในชีต Config ตั้งแต่แถว 12 (คอลัมน์ A เท่านั้น, Account ว่าง = Import ข้ามแถวเหล่านี้)
    const HOW = withExample ? [
      '=== วิธีกรอก (ลบแถวคำอธิบายนี้ออกหรือปล่อยไว้ก็ได้ — Import จะข้ามแถวที่ไม่มี Account) ===',
      'COM/BU : ใส่รหัส COM (เช่น 0572) หรือรหัส BU (เช่น REV) ก็ได้ ระบบหา BU ที่ถูกต้องให้เอง — หลายค่าคั่นด้วย , ได้ — ถ้าเว้นว่างใช้ BU ที่เลือกไว้ในหน้า Config',
      'CPC Accept : CPC ที่ต้องการทำ Reconcile',
      '     - ใส่ BBBBB = เลือกทุก CPC มาทำทั้งหมด',
      '     - ถ้าต้องการเลือกเฉพาะ CPC ให้กรอกรหัส CPC นั้นเข้าไปได้เลย เช่น 99999 (1 CPC = กรอก 1 ค่า)',
      '     - ถ้าระบุหลาย CPC ให้คั่นด้วย , เช่น 99999,26100',
      'CPC Exclude : CPC ที่ยกเว้น (ใช้คู่กับ BBBBB) — หลายค่าคั่นด้วย ,',
      'Account : เลขบัญชี 1 แถวต่อ 1 Account',
      'Sub Acc Accept : Sub Acc ที่รับ — BBBBBB = ทุก Sub Acc ใน Account นั้น',
      'Sub Acc Exclude : Sub Acc ที่ยกเว้น (ใช้คู่กับ BBBBBB)',
      'ตัวอย่างแถว 2 : Account 21835000 รับทุก CPC ยกเว้น 26100 และรับทุก Sub Acc',
      'ตัวอย่างแถว 3 : Account 21805000 เฉพาะ CPC 99999 และ Sub Acc 999999',
    ] : [];
    const HOW0 = 12;
    for (let r = 1; r <= 500; r++) for (let c = 0; c < 6; c++) { if (c > 0 && r >= HOW0 - 1 && r < HOW0 - 1 + HOW.length) continue; if (r >= HOW0 - 1 && r < HOW0 - 1 + HOW.length) continue; const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '', z: '@' }; else { ws[a].t = 's'; ws[a].z = '@'; ws[a].v = String(ws[a].v); } }
    HOW.forEach((t, i) => { ws[XLSX.utils.encode_cell({ r: HOW0 - 1 + i, c: 0 })] = { t: 's', v: t, z: '@' }; });
    ws['!ref'] = 'A1:F501'; // ตั้งทุกช่องเป็น Text กัน Excel ตัดศูนย์นำหน้า (เช่น BU 057201)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Config');
    if (!withExample) { XLSX.writeFile(wb, 'Config_Template.xlsx'); return; }
    const ex = XLSX.utils.aoa_to_sheet([
      ['วิธีกรอก (Example)'], [''],
      ['COM/BU', 'ใส่รหัส COM (Segment 3) หรือรหัส BU ก็ได้ ระบบหา BU ที่ถูกต้องให้เอง (COM 1 ตัวที่ครอบหลาย BU จะแตกเป็นหลาย BU) — ใส่หลายค่าคั่นด้วย , ได้ — ถ้าเว้นว่าง ใช้ BU ที่เลือกไว้ในหน้า Config'],
      ['CPC Accept', 'CPC ที่ต้องการทำ Reconcile — ใส่ BBBBB = เลือกทุก CPC มาทำทั้งหมด | ถ้าต้องการเลือกเฉพาะ CPC ให้กรอกรหัส CPC นั้นเข้าไปได้เลย (1 CPC = กรอก 1 ค่า เช่น 99999) | ถ้าระบุหลาย CPC ให้คั่นด้วย , (เช่น 99999,26100)'],
      ['  - BBBBB', 'ทุก CPC ใน Account นั้น (ถ้าต้องการตัดบาง CPC ออก ให้ใส่ใน CPC Exclude)'],
      ['  - ระบุ CPC', 'เฉพาะ CPC ที่กรอกเท่านั้นที่จะถูกนำมา Reconcile'],
      ['CPC Exclude', 'CPC ที่ยกเว้น (ใช้คู่กับ BBBBB) | หลายค่าคั่นด้วย ,'],
      ['Account', 'เลขบัญชี 1 แถวต่อ 1 Account'],
      ['Sub Acc Accept', 'Sub Acc ที่รับ — BBBBBB = ทุก Sub Acc ใน Account นั้น'],
      ['Sub Acc Exclude', 'Sub Acc ที่ยกเว้น (ใช้คู่กับ BBBBBB)'], [''],
      ['ตัวอย่าง 1', 'Account 21835000 รับทุก CPC ยกเว้น 26100 และรับทุก Sub Acc → CPC Accept = BBBBB, CPC Exclude = 26100, Sub Acc Accept = BBBBBB'],
      ['ตัวอย่าง 2', 'Account 21805000 เฉพาะ CPC 99999 และ Sub Acc 999999 → CPC Accept = 99999, Sub Acc Accept = 999999'],
    ]);
    ex['!cols'] = [{ wch: 18 }, { wch: 110 }]; XLSX.utils.book_append_sheet(wb, ex, 'Example');
    XLSX.writeFile(wb, 'Config_Template_Example.xlsx');
  };
  const importFile = async (file) => {
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      if (!aoa.length) { setMsg('ไฟล์ว่าง'); return; }
      const norm = (x) => String(x).replace(/\s+/g, ' ').trim().toLowerCase();
      const hi = aoa.findIndex(r => r.some(c => norm(c) === 'account'));
      if (hi < 0) { setMsg('ไม่พบหัวคอลัมน์ Account — ใช้ไฟล์ Template'); return; }
      const col = (name) => aoa[hi].findIndex(c => norm(c) === name.toLowerCase());
      const ix = { bu: [col('COM/BU'), col('COM'), col('BU')].find(i => i >= 0) ?? -1, ca: col('CPC Accept'), ce: col('CPC Exclude'), ac: col('Account'), sa: col('Sub Acc Accept'), se: col('Sub Acc Exclude') };
      const buSet = new Set(buOptions.map(o => String(o.value)));
      const stripZ = (x) => String(x).replace(/^0+/, '');
      const byBu = new Map(buOptions.map(o => [stripZ(o.value), String(o.value)]));
      const resolve = (tok) => { if (buSet.has(tok)) return [tok]; const z = stripZ(tok); if (byBu.has(z)) return [byBu.get(z)]; return buOptions.filter(o => o.com && (o.com === tok || stripZ(o.com) === z)).map(o => String(o.value)); }; // BU ก่อน, ไม่ใช่ BU = ถือเป็น COM (Segment 3) แล้วแตกเป็นทุก BU ใต้ COM นั้น
      const unk = new Set();
      let ok = 0, skip = 0; const rowsIn = [];
      aoa.slice(hi + 1).forEach(r => {
        const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] == null ? '' : r[ix[k]]).trim() : '');
        const acc = g('ac'); if (!acc) return;
        const buV = g('bu') || addBu;
        // MARKER_GL_DOA_CONFIG_COM_RESOLVE_V1 -- ช่อง COM/BU: ถ้าเป็นรหัส BU ใช้ตรงๆ, ถ้าเป็น COM (Segment 3) แปลงเป็นทุก BU ภายใต้ COM นั้น
        // MARKER_GL_DOA_CONFIG_TPL_BOTH_V2 -- รับได้ทั้ง COM และ BU (ใส่หลายค่าคั่นด้วย , ได้) / ศูนย์นำหน้าที่ Excel ตัดทิ้งก็จับคู่ให้ / ไม่รู้จัก = ข้ามและแจ้งค่าที่ไม่รู้จัก
        const toks = splitV(buV); const bus = [];
        toks.forEach(t => { const hit = resolve(t); if (!hit.length) unk.add(t); hit.forEach(b => { if (!bus.includes(b)) bus.push(b); }); });
        if (!bus.length) { skip++; return; }
        bus.forEach(b => rowsIn.push({ bu: b, account: acc, ca: g('ca'), ce: g('ce'), sa: g('sa'), se: g('se') }));
      });
      setDraft(d => { const m = new Map(d.map(x => [x.bu + '|' + x.account, x])); rowsIn.forEach(x => { const k = x.bu + '|' + x.account; m.set(k, { ...x, key: (m.get(k) && m.get(k).key) || ('r' + (++seqRef.current)) }); ok++; }); return Array.from(m.values()); });
      setTimeout(() => draftRef.current.filter(x => rowsIn.some(r => r.bu === x.bu && r.account === x.account)).forEach(x => persistRow(x.key)), 80);
      setMsg(`✓ นำเข้า ${rowsIn.length} แถว${skip ? ` (ข้าม ${skip} แถว — ไม่รู้จัก COM/BU: ${Array.from(unk).slice(0, 5).join(', ')}${unk.size > 5 ? ' …' : ''})` : ''} — บันทึกอัตโนมัติ`);
    } catch (e) { setMsg('อ่านไฟล์ไม่สำเร็จ: ' + e.message); }
  };
  const impRef = React.useRef(null);
  const [showEx] = React.useState(false); // MARKER_GL_DOA_CONFIG_EXAMPLE_V1
  // MARKER_GL_DOA_CONFIG_CLOSE_GUARD_V1 -- (บันทึกอัตโนมัติ) ก่อนปิดให้บันทึกแถวที่ค้างรอ debounce ให้เสร็จก่อน
  const tryClose = () => { flushSaves(); onClose(); };
  const del = async (id) => { try { await removeDoaConfig(id); await load(); onChanged && onChanged(); notifyChanged(); } catch (e) { setMsg('ลบไม่สำเร็จ: ' + e.message); } };
  return (
    <div onClick={tryClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1500px, 100%)', height: '92vh', maxHeight: '92vh', background: '#fff', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: C.navy }}>⚙ Config รับข้อมูล — User + Account + BU</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, background: '#F3F6FA', border: `1px solid ${C.line}`, borderRadius: 6, padding: '5px 10px', color: C.navy }} title="List ของตัวเอง"> {/* MARKER_GL_DOA_CONFIG_USER_TOPRIGHT_V1 */}
              <span style={{ color: C.mute }}>User :</span><b>{usr ? nameOf(usr) : '-'}</b>
            </div>
            <button type="button" onClick={tryClose} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: C.mute }}>×</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}` }}>
          {[['list', `List Config (${groupsAll.length})`], ['add', '+ Add']].map(([k, t]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setMsg(''); }}
              style={{ padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: tab === k ? 700 : 500, color: tab === k ? C.navy : C.mute, borderBottom: tab === k ? `2px solid ${C.navy}` : '2px solid transparent', marginBottom: -1, fontFamily: 'inherit' }}>{t}</button>
          ))}
        </div>
        {tab === 'add' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ flex: '0 1 340px' }}><div style={lbl}>BU * (ต้องเลือกก่อนเพิ่ม)</div>
              <BuPicker value={addBu} options={buOptions} onChange={setAddBu} /></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" style={btn(false)} onClick={() => downloadTemplate(true)} title="ดาวน์โหลดไฟล์ตัวอย่าง Config_Template_Example.xlsx (มีแถวตัวอย่าง + วิธีกรอก)">💡 Example</button>
              <button type="button" style={btn(false)} onClick={() => downloadTemplate(false)} title="ดาวน์โหลดไฟล์ Template เปล่า (Config_Template.xlsx)">⬇ Template</button>
              <button type="button" style={btn(false)} onClick={() => impRef.current && impRef.current.click()} title="นำเข้าจากไฟล์ Excel / CSV ตาม Template">⬆ Import</button>
              <input ref={impRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { importFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>
        )}
        {tab === 'add' && showEx && (
          <div style={{ border: `1px solid ${C.line}`, background: '#FFFCF0', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.7, color: '#3A4556' }}>
            <b style={{ color: C.navy }}>วิธีกรอก</b> — เลือก BU ด้านบน → กรอกแถวแรกของตาราง → กด ↓ (หรือ Enter ที่ช่อง Account) → ระบบบันทึกให้อัตโนมัติ
            <table style={{ borderCollapse: 'collapse', margin: '6px 0', background: '#fff', fontSize: 12.5 }}>
              <thead><tr>{['BU', 'CPC Accept', 'CPC Exclude', 'Account', 'Sub Acc Accept', 'Sub Acc Exclude', 'ความหมาย'].map(h => <th key={h} style={{ border: '1px solid #E3E8EF', padding: '3px 10px', background: '#F3F6FA', textAlign: 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {[['057201', 'BBBBB', '26100', '21835000', 'BBBBBB', '', 'ทุก CPC ยกเว้น 26100, ทุก Sub Acc'], ['057201', '99999', '', '21805000', '999999', '', 'เฉพาะ CPC 99999 / Sub Acc 999999'], ['057201', 'BBBBB', '', '21810000, 21816000', 'BBBBBB', '', 'ใส่หลาย Account พร้อมกัน ทุก CPC ทุก Sub Acc']].map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} style={{ border: '1px solid #E3E8EF', padding: '3px 10px', color: k === 2 && c ? '#B42318' : undefined }}>{c || '-'}</td>)}</tr>)}
              </tbody>
            </table>
            <div><b>BBBBB</b> = ทุก CPC · <b>BBBBBB</b> = ทุก Sub Acc · ช่อง <span style={{ color: '#B42318' }}>Exclude</span> = ยกเว้นค่านั้น (ใช้คู่กับ BBBBB) · ใส่หลายค่าคั่นด้วย , · ทำเป็นไฟล์: กด ⬇ Template แล้ว ⬆ Import</div>
          </div>
        )}
        {tab === 'add' && (
          <div style={{ flex: '1 1 auto', minHeight: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>List Preview ({draft.length} Account) <span style={{ fontWeight: 400, color: C.mute }}>— บันทึกอัตโนมัติ (แก้ค่าในตารางได้เลย)</span></div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 6 }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 13, height: '100%' }}>
                <colgroup><col style={{ width: 44 }} /><col style={{ width: '9%' }} /><col style={{ width: '16%' }} /><col style={{ width: '14%' }} /><col style={{ width: '19%' }} /><col style={{ width: '16%' }} /><col style={{ width: '14%' }} /><col style={{ width: 64 }} /></colgroup>
                <thead>
                  <tr><th rowSpan={2} style={th}>#</th><th rowSpan={2} style={{ ...th, textAlign: 'left' }}>BU</th><th colSpan={2} style={{ ...th, borderBottom: '1px solid #D5DEEA' }}>CPC</th><th rowSpan={2} style={{ ...th, textAlign: 'left' }}>Account</th><th colSpan={2} style={{ ...th, borderBottom: '1px solid #D5DEEA' }}>Sub Acc</th><th rowSpan={2} style={th}>Action</th></tr>
                  <tr><th style={{ ...th, textAlign: 'left' }}>Accept</th><th style={{ ...th, textAlign: 'left', color: '#B42318' }}>Exclude</th><th style={{ ...th, textAlign: 'left' }}>Accept</th><th style={{ ...th, textAlign: 'left', color: '#B42318' }}>Exclude</th></tr>
                </thead>
                <tbody>
                  {draft.length === 0 && <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center', color: '#8a96a6' }}>เลือก BU แล้วกรอกแถวแรกของตาราง (Account / CPC / Sub Acc) กด ↓ หรือ Enter เพื่อใส่ List — BBBBB = ทุก CPC, BBBBBB = ทุก Sub Acc</td></tr>}
                  {draft.map((r, i) => (
                    <tr key={r.key} style={{ borderTop: '1px solid #EAEFF5' }}>
                      <td style={{ padding: '5px 10px', textAlign: 'center', color: C.mute }}>{i + 1}</td>
                      <td style={{ padding: '5px 10px', color: C.mute }}>{r.bu}</td>
                      <td style={{ padding: '4px 6px' }}><ComboInput h={30} value={r.ca} options={cpcOpts} onChange={v => setCell(r.key, 'ca', v)} placeholder="เลือก / พิมพ์" /></td>
                      <td style={{ padding: '4px 6px' }}><input style={{ ...inp, height: 30, borderColor: r.ce ? '#B42318' : '#B9C4D2' }} value={r.ce} onChange={e => setCell(r.key, 'ce', e.target.value)} placeholder="ยกเว้น (, คั่น)" /></td>
                      <td style={{ padding: '5px 10px', fontWeight: 600, color: C.navy }}>{r.account}</td>
                      <td style={{ padding: '4px 6px' }}><ComboInput h={30} value={r.sa} options={subOpts} onChange={v => setCell(r.key, 'sa', v)} placeholder="เลือก / พิมพ์" /></td>
                      <td style={{ padding: '4px 6px' }}><input style={{ ...inp, height: 30, borderColor: r.se ? '#B42318' : '#B9C4D2' }} value={r.se} onChange={e => setCell(r.key, 'se', e.target.value)} placeholder="ยกเว้น (, คั่น)" /></td>
                      <td style={{ padding: '5px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}><button type="button" title="ลบ Account นี้" onClick={() => dropPreview(r)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15 }}>✕</button></td>
                    </tr>
                  ))}
                  <tr aria-hidden="true"><td colSpan={8} style={{ height: '100%', padding: 0 }} /></tr>{/* MARKER_GL_DOA_CONFIG_ENTRY_PIN_BOTTOM_V1 -- ดันแถวกรอกลงไปติดล่างสุดของกรอบ */}
                  <tr style={{ background: '#F7FAFE', borderTop: '2px solid #D5DEEA' }}> {/* MARKER_GL_DOA_CONFIG_ENTRY_BOTTOM_V1 -- แถวกรอกอยู่ล่างสุด (sticky) */}
                    <td style={{ ...ST, padding: '5px 10px', textAlign: 'center', color: C.mute }}>＋</td>
                    <td style={{ ...ST, padding: '5px 10px', color: addBu ? C.mute : '#B42318', fontSize: 12 }}>{addBu || 'เลือก BU'}</td>
                    <td style={{ ...ST, padding: '4px 6px' }}><ComboInput up h={30} value={ent.ca} options={cpcOpts} onChange={v => setEnt(e => ({ ...e, ca: v }))} placeholder="CPC (เลือก / พิมพ์ · มากกว่า 1 ให้ , คั่น)" /></td>
                    <td style={{ ...ST, padding: '4px 6px' }}><input style={{ ...inp, height: 30, borderColor: ent.ce ? '#B42318' : '#B9C4D2' }} value={ent.ce} onChange={e => { const v = e.target.value; setEnt(x => ({ ...x, ce: v })); }} placeholder="CPC ยกเว้น (มากกว่า 1 ให้ , คั่น)" /></td>
                    <td style={{ ...ST, padding: '4px 6px' }}><input style={{ ...inp, height: 30 }} value={accIn} onChange={e => setAccIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') stage(); }} placeholder="Account (หลายตัวคั่นด้วย , )" /></td>
                    <td style={{ ...ST, padding: '4px 6px' }}><ComboInput up h={30} value={ent.sa} options={subOpts} onChange={v => setEnt(e => ({ ...e, sa: v }))} placeholder="Sub Acc (เลือก / พิมพ์ · มากกว่า 1 ให้ , คั่น)" /></td>
                    <td style={{ ...ST, padding: '4px 6px' }}><input style={{ ...inp, height: 30, borderColor: ent.se ? '#B42318' : '#B9C4D2' }} value={ent.se} onChange={e => { const v = e.target.value; setEnt(x => ({ ...x, se: v })); }} placeholder="Sub Acc ยกเว้น (มากกว่า 1 ให้ , คั่น)" /></td>
                    <td style={{ ...ST, padding: '4px 6px', textAlign: 'center' }}><button type="button" disabled={!addBu} title={addBu ? 'ใส่เข้า List' : 'ต้องเลือก BU ก่อน'} onClick={stage} style={{ ...btn(true), height: 30, padding: '0 10px', opacity: addBu ? 1 : 0.45, cursor: addBu ? 'pointer' : 'not-allowed' }}>↓</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'list' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', height: 36, flexShrink: 0 }}>
              {[['my', 'My List'], ['all', 'All List']].map(([k, t]) => (
                <button key={k} type="button" onClick={() => setScope(k)} style={{ padding: '0 16px', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: scope === k ? 700 : 500, background: scope === k ? C.navy : '#fff', color: scope === k ? '#fff' : C.mute }}>{t}</button>
              ))}
            </div>
            <div style={{ flex: '0 1 320px' }}><div style={lbl}>กรอง BU (ว่าง = ทั้งหมด)</div>
              <BuPicker value={bu} options={buOptions} onChange={setBu} placeholder="ทั้งหมด" /></div>
            {scope === 'all' && (<>
              <div style={{ flex: '0 1 280px' }}><div style={lbl}>User</div>
                <select style={inp} value={fUser} onChange={e => setFUser(e.target.value)}>
                  <option value="">ทั้งหมด</option>
                  {userOpts.map(em => <option key={em} value={em}>{nameOf(em)}</option>)}
                </select></div>
              <div style={{ flex: '1 1 220px' }}><div style={lbl}>ค้นหา Account / CPC / Sub Acc / BU</div>
                <input style={inp} value={fQ} onChange={e => setFQ(e.target.value)} placeholder="พิมพ์เพื่อกรอง" /></div>
              <button type="button" style={btn(false)} onClick={() => { setFUser(''); setFQ(''); setBu(''); }}>ล้าง Filter</button>
            </>)}
          </div>
        )}
        {tab === 'list' && scope === 'all' && groupsHidden > 0 && <div style={{ fontSize: 12, color: '#B26A00' }}>แสดง {ALL_LIMIT} จาก {groupsAll.length} กลุ่ม — ใช้ Filter ด้านบนเพื่อจำกัดรายการ</div>}
        {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? '#1F6B4A' : '#B42318' }}>{msg}</div>}
        {tab === 'list' && (
          <div style={{ flex: '1 1 auto', minHeight: 120, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, background: '#FAFCFE', boxSizing: 'border-box' }}>{/* MARKER_GL_DOA_CONFIG_BOX_LIST_V1 -- List Config แสดงเป็นกล่อง 1 BU ต่อ 1 กล่อง: หัวกล่อง = BU | Last Update | User | Action, ในกล่อง = Account / CPC Accept-Exclude / Sub Acc Accept-Exclude */}
            <div style={{ display: 'grid', gridTemplateColumns: '30% 17% 28% 15% 10%', background: '#EAF1FB', border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 10, position: 'sticky', top: 0, zIndex: 3 }}>{/* MARKER_GL_DOA_CONFIG_BOX_HEADER_V1 -- หัวคอลัมน์ BU | Last Update | User | Action (คงอยู่แม้ยังไม่มี Config) */}
              {['BU', 'Last Update', 'User', 'Module', 'Action'].map((h, i) => <div key={h} style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, color: C.navy, textAlign: i === 4 ? 'center' : 'left' }}>{h}</div>)}{/* MARKER_GL_DOA_CONFIG_MODULE_COL_V1 */}
            </div>
            {groups.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: '#8a96a6' }}>{scope === 'my' ? 'คุณยังไม่มี Config' : (bu ? 'BU นี้ยังไม่มี Config' : 'ยังไม่มี Config')}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, alignItems: 'start' }}>
              {groups.map(g => {
                const m = new Map();
                g.items.forEach(r => {
                  const o = m.get(r.account) || { account: r.account, ca: [], ce: [], sa: [], se: [], ids: [] };
                  const put = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
                  put(r.cpc_mode === 'exclude' ? o.ce : o.ca, r.cpc); put(r.sub_mode === 'exclude' ? o.se : o.sa, r.sub_acc);
                  o.ids.push(r.id); m.set(r.account, o);
                });
                const accs = Array.from(m.values());
                return (
                  <div key={g.key} style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 3px rgba(26,58,92,.06)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '30% 17% 28% 15% 10%', alignItems: 'center', background: '#fff' }}>
                      <div style={{ padding: '8px 12px', minWidth: 0 }}>
                        <b style={{ color: C.navy, fontSize: 14 }}>{g.bu}</b>
                        <span style={{ marginLeft: 8, fontSize: 12, color: C.mute, background: '#fff', borderRadius: 10, padding: '1px 8px' }}>{accs.length} Account</span>
                      </div>
                      <div style={{ padding: '8px 12px', fontSize: 12, color: C.mute, whiteSpace: 'nowrap' }}>{fmtDt(g.last)}</div>
                      <div style={{ padding: '8px 12px', fontSize: 12, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(g.user)}</div>
                      <div style={{ padding: '8px 12px', fontSize: 12, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(mods && mods[String(g.user || '').toLowerCase()]) || '-'}</div>
                      <div style={{ padding: '4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {(!g.user || g.user === usr) && <button type="button" title="แก้ไข (ดึงค่าทั้งหมดของ BU นี้ไปหน้า Add)" onClick={() => startEdit(g.bu, g.items)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: C.navy }}>✎</button>}
                      {g.user && g.user !== usr && String(g.user).toLowerCase() !== String(meEmail).toLowerCase() && <button type="button" title="Clone Config นี้มาเป็นของฉัน" onClick={() => cloneGroup(g)} style={{ border: '1px solid #1B3A5C', background: '#fff', cursor: 'pointer', fontSize: 11, color: C.navy, borderRadius: 4, padding: '1px 6px', marginRight: 4 }}>⧉ Clone</button>}
                      {(scope !== 'all' || canDeleteAll) && <button type="button" title="ลบทั้งกล่อง (ทั้ง BU นี้)" onClick={() => delGroup(g)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15 }}>🗑</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// MARKER_GL_DOA_RECONCILE_PREVIEW_V1 -- Preview Reconcile ต่อ Account: Cover + TB (ยอดต่อ Branch/CPC/SubAcc จาก TB, Detail, Simple, Other กรอกเอง) -> รวม Detail / Diff
function simAmounts(m, code) { // Simple (Outstanding Simple upload): แถวหัวรายการ A=Oracle Branch, B=Cost Center, C=Acc Code, D=Sub Acc, E=Total Amount
  const out = []; let hi = -1; for (let i = 0; i < Math.min((m || []).length, 40) && hi < 0; i++) if (/^oracle\s*branch/i.test(String((m[i] || [])[0] || '').trim())) hi = i;
  if (hi < 0) return out;
  for (let i = hi + 1; i < m.length; i++) { const r = m[i] || []; const a = String(r[0] == null ? '' : r[0]).trim(); if (/^total/i.test(a)) continue; if (String(r[2] == null ? '' : r[2]).trim() !== String(code)) continue; const v = detNum(r[4]); if (v == null) continue; out.push({ branch: a, cpc: String(r[1] == null ? '' : r[1]).trim(), sub: String(r[3] == null ? '' : r[3]).trim(), amt: v }); }
  return out;
}
function simSheetRows(m, code) { // แถว Simple ของ Account นี้ (หัวรายการ + แถวลูกที่ตามมา) สำหรับแสดงเป็น Sheet
  let hi = -1; for (let i = 0; i < Math.min((m || []).length, 40) && hi < 0; i++) if (/^oracle\s*branch/i.test(String((m[i] || [])[0] || '').trim())) hi = i;
  if (hi < 0) return null; const rows = []; let cur = '';
  for (let i = hi + 1; i < m.length; i++) { const r = m[i] || []; const a = String(r[0] == null ? '' : r[0]).trim(); if (/^total/i.test(a)) continue; const c = String(r[2] == null ? '' : r[2]).trim(); if (c) cur = c; if (cur === String(code) && r.some(x => x !== '' && x != null)) rows.push(r); }
  return { head: (m[hi] || []).slice(0, 23), rows: rows.map(r => r.slice(0, 23)) };
}
// Grid แบบ Sheet Excel (ตัวอักษรคอลัมน์ A B C / เลขแถว / เส้นตาราง / แท็บ Sheet ด้านล่าง) เหมือน Preview ไฟล์ของ AP Reconcile
function DoaSheetGrid({ rows, widths }) {
  const L = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
  const nc = Math.max(widths.length, ...rows.map(r => r.length)); const hdr = { background: '#f3f3f3', border: '1px solid #d4d4d4', color: '#555', fontSize: 11, textAlign: 'center', padding: '1px 4px', position: 'sticky', zIndex: 2 };
  const fmt = (v) => { if (typeof v !== 'number') return v; const a = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${a})` : a; };
  return (
    <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 44 + Array.from({ length: nc }).reduce((t, _, j) => t + (widths[j] || 80), 0), fontFamily: 'Calibri, Tahoma, sans-serif', fontSize: 13, color: '#000' }}>
      <colgroup><col style={{ width: 44 }} />{Array.from({ length: nc }).map((_, j) => <col key={j} style={{ width: widths[j] || 80 }} />)}</colgroup>
      <thead><tr><th style={{ ...hdr, top: 0, left: 0, zIndex: 3 }} />{Array.from({ length: nc }).map((_, j) => <th key={j} style={{ ...hdr, top: 0, fontWeight: 500 }}>{L(j + 1)}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} style={{ height: 20 }}>
          <td style={{ ...hdr, left: 0 }}>{i + 1}</td>
          {(() => { let skip = 0; return Array.from({ length: nc }).map((_, j) => { if (skip > 0) { skip--; return null; } const c = r[j]; const nx = r[j + 1]; const nxE = nx == null || nx === '' || (typeof nx === 'object' && (nx.v == null || nx.v === '') && !nx.edit); const o = (c && typeof c === 'object' && !(c instanceof Date)) ? c : { v: c }; const v = o.v == null ? '' : o.v; const isN = typeof v === 'number';
            const sty = { border: '1px solid #e1e1e1', padding: '0 4px', overflow: (!isN && v !== '' && nxE) ? 'visible' : 'hidden', whiteSpace: 'nowrap', textOverflow: 'clip', verticalAlign: 'bottom', textAlign: isN ? 'right' : undefined, color: isN && v < 0 ? '#C00000' : undefined, fontVariantNumeric: 'tabular-nums', ...(o.s || {}), ...(isN && v < 0 ? { color: '#C00000' } : {}) }; /* MARKER_GL_DOA_NEG_RED_ALL_SHEETS_V1 -- ตัวเลขติดลบเป็นสีแดงทุก Sheet (รวม Cover) แม้ Cell กำหนดสีไว้ */
            if (o.span && o.span > 1) skip = o.span - 1; return <td key={j} style={sty} colSpan={o.span || undefined}>{o.edit ? <input value={o.edit.value} onChange={e => o.edit.set(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', background: 'transparent', textAlign: o.edit.num ? 'right' : 'left', font: 'inherit', padding: 0, height: 18 }} /> : fmt(v)}</td>; }); })()}
        </tr>))}</tbody>
    </table>
  );
}
function simpleSheetToWb(wb, m, code, period) { /* MARKER_GL_DOA_SIMPLE_SHEET_FN_V1 -- สร้างชีต Simple ตามรูปแบบเดียวกับ Download จาก Preview (ใช้ร่วมกับ Reconcile Download) */
  const kind = 'Simple'; const tbK = false; const detK = false;
    const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0; for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
    const isBlankR = (r) => !r || r.every(c => String(c == null ? '' : c).trim() === '');
    let hb = 0; if (kind === 'Simple' && hi >= 0) while (hb < 10 && hi + 1 + hb < m.length && isBlankR(m[hi + 1 + hb])) hb++; // จำนวนแถวว่างใต้หัวตารางไม่ตายตัว นับตามไฟล์จริง // MARKER_GL_DOA_SIMPLE_LAYOUT_V1 -- หัวตาราง Simple สูง 3 แถว (แถวว่างใต้หัวคอลัมน์ 2 แถว) เหมือน Simple Final
    const out = hi < 0 ? m.slice() : m.slice(0, hi + 1 + hb); const merges = []; let keep = false, start = -1;
    const closeGroup = () => { start = -1; }; // ไม่ Merge A–K (Simple Final ไม่ Merge)
    if (hi >= 0) for (let i = hi + 1 + hb; i < m.length; i++) { const r = m[i] || []; const lead = String(r[0] == null ? '' : r[0]).trim(); if (kind === 'Simple' && /^(total|gran[dt])/i.test(lead)) { if (/^total/i.test(lead) && (!code || lead.slice(-String(code).length) === String(code))) { out.push(r); keep = false; } continue; } const c = String(r[ac] == null ? '' : r[ac]).trim(); if (c) { closeGroup(); const isT = /^total/i.test(c); keep = !code || (isT ? c.indexOf(String(code)) >= 0 : c === String(code)); if (keep) { out.push(r); start = isT ? -1 : out.length - 1; } } else if (keep) out.push(r); }
    closeGroup();
    const nCols = Math.max(...out.map(r => (r || []).length), 1);
  const sheet = `Outstanding Simple ${code || ''}`.trim().slice(0, 31); const ws = wb.addWorksheet(sheet);
        // MARKER_GL_DOA_DOWNLOAD_FORMAT_FINAL_V2 -- Format ตาม Simple Final: ทุกเซลล์ A–W Top Align + เส้นขอบบาง + พื้นขาว, หัวตารางฟ้า/ส้ม, Total เทา, รูปแบบตัวเลข/วันที่ตามคอลัมน์, ความสูงแถวหัวรายงาน
        const fill = (rgb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rgb } });
        const thin = { style: 'thin', color: { argb: 'FF000000' } }; /* เส้นขอบดำบางเหมือน Simple Final */ const BORD = { top: thin, left: thin, bottom: thin, right: thin };
        const isSim = kind === 'Simple'; const W = isSim ? Math.min(nCols, 23) : nCols;
        const AMT = new Set([4, 7, 17]); const TXT = new Set([0, 1, 2, 3, 5, 6, 10]);
        const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
        const pm = String(period || '').match(/^(\d{4})\.(\d{2})$/); const pY = pm ? Number(pm[1]) : new Date().getFullYear(), pM = pm ? Number(pm[2]) - 1 : 11;
        const hdrR = (!isSim && hi >= 0) ? (out[hi] || []).map(c => String(c == null ? '' : c).trim()) : []; const AMT2 = new Set(hdrR.map((c, j) => (/balance|activity|amount|debit|credit/i.test(c) ? j : -1)).filter(j => j >= 0)); // MARKER_GL_DOA_DOWNLOAD_TB_CLEAN_V1 -- TB/Detail: ตัวเลขเป็นตัวเลขจริง (ไม่ใช่ข้อความ), ตัดช่องว่างหัวรายงาน, ความกว้างคอลัมน์ตามตาราง
        const numP = (v) => { const t = String(v).trim(); const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const x = t.replace(/[(),\s-]/g, ''); return /^\d+(\.\d+)?$/.test(x) ? (neg ? -Number(x) : Number(x)) : null; };
        const num = (v) => { const t = String(v).replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
        const dDM = (v) => { const x = String(v).trim().match(/^(\d{1,2})-([A-Za-z]{3})$/); if (!x || MON[x[2].toLowerCase()] == null) return null; const mo = MON[x[2].toLowerCase()]; return new Date(Date.UTC(mo <= pM ? pY : pY - 1, mo, Number(x[1]))); }; // d-mmm (วันที่ Period Create) : ปี = ปีของงวด (เดือนหลังงวด = ปีก่อน)
        const dMY = (v) => { const x = String(v).trim().match(/^([A-Za-z]{3})-(\d{2})$/); if (!x || MON[x[1].toLowerCase()] == null) return null; return new Date(Date.UTC(2000 + Number(x[2]), MON[x[1].toLowerCase()], 1)); }; // mmm-yy (Expense period)
        out.forEach((r, i) => {
          const isHead = i === hi || (hb > 0 && i > hi && i <= hi + hb); const isData = i > hi + hb; const isTot = i > hi && (/^total/i.test(String((r || [])[kind === 'Simple' ? 0 : ac] || '').trim()) || (tbK && String((r || [])[0] || '').trim() === 'Total'));
          const row = ws.addRow(Array.from({ length: W }).map((_, j) => {
            const v = (r || [])[j]; if (v == null || v === '') return null;
            if (!isSim && hi >= 0 && i < hi && typeof v === 'string') return v.replace(/\s{2,}/g, '  ').trim();
            if (!isSim && isData && AMT2.has(j)) { const n = numP(v); if (n != null) return n; }
            if (isSim && isData && !isTot) { if (AMT.has(j)) { const n = num(v); if (n != null) return n; } if (j === 8) { const d = dDM(v); if (d) return d; } if (j === 22) { const d = dMY(v); if (d) return d; } }
            if (isSim && i === 2 && j === 3) { const d = dDM(v); if (d) return d; } if (isSim && i === 2 && j === 6) { const n = num(v); if (n != null) return n; }
            if (isSim && isTot && AMT.has(j)) { const n = num(v); if (n != null) return n; }
            return v;
          }));
          row.eachCell({ includeEmpty: true }, (cell, cn) => {
            const j = cn - 1; const lbl = isSim && i < hi - 1 && typeof cell.value === 'string' && /:/.test(cell.value);
            cell.font = { name: 'Calibri', size: (isSim && i === 0) ? 16 : ((isSim && i === hi - 1) ? 12 : 9), bold: isHead || isTot || lbl || ((tbK || detK) && i === 0) || (isSim && (i === 0 || i === 1 || i === hi - 1)) };
            cell.alignment = { vertical: 'top', wrapText: isHead || (isSim && i < hi), horizontal: (isSim && i === 0) ? 'center' : undefined };
            if (isSim && i < hi - 1) { cell.fill = fill('FFFFFF'); }
            if (isHead) { cell.fill = fill(isSim ? (j >= 12 && j <= 17 ? 'F7CAAC' : 'B4C6E7') : '002060'); cell.border = BORD; if (!isSim) { cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; } } // MARKER_GL_DOA_DOWNLOAD_TB_THEME_V1 -- หัวตาราง TB/Detail = กรมท่า 002060 ตัวอักษรขาว (ตรงกับ Preview)
            else if (isTot) { cell.fill = fill(tbK ? 'DDEBF7' : 'D9D9D9'); cell.border = BORD; }
            else if (isData) {
              cell.fill = fill('FFFFFF'); cell.border = BORD;
              if (isSim && j <= 10) { // MARKER_GL_DOA_GROUP_BORDER_V1 -- A–K ของกลุ่ม: เส้นบนเฉพาะแถวแรก เส้นล่างเฉพาะแถวสุดท้ายของกลุ่ม (ดูเหมือน Merge เหมือน Simple Final)
                const isStart = String((r || [])[ac] == null ? '' : r[ac]).trim() !== ''; const nx = out[i + 1]; const nxStart = !nx || String(nx[ac] == null ? '' : nx[ac]).trim() !== '' || /^(total|gran[dt])/i.test(String(nx[0] == null ? '' : nx[0]).trim());
                cell.border = { left: thin, right: thin, top: isStart ? thin : undefined, bottom: nxStart ? thin : undefined };
              }
            }
            if (isSim && i === hi - 1) { cell.fill = fill('FFFFFF'); cell.border = { bottom: thin }; }
            if (!isSim && isData && cell.value instanceof Date) { cell.numFmt = 'dd-mmm-yy'; cell.alignment = { vertical: 'top', horizontal: 'center' }; }
            if (!isSim && isData && AMT2.has(j) && typeof cell.value === 'number') { cell.numFmt = '#,##0.00_);[Red](#,##0.00)'; /* MARKER_GL_DOA_NEG_RED_V1 ยอดติดลบเป็นสีแดง */ cell.alignment = { vertical: 'top', horizontal: 'right' }; }
            if (isSim && isData) { if (AMT.has(j)) cell.numFmt = '#,##0.00'; else if (TXT.has(j)) cell.numFmt = '@'; else if (j === 8) cell.numFmt = 'd-mmm'; else if (j === 22) cell.numFmt = 'mmm-yy'; }
            if (isSim && i === 2 && j === 3 && cell.value instanceof Date) cell.numFmt = 'd-mmm';
          });
        });
        if (isSim && hi >= 0) { // Layout เหมือน Simple Final: A1:G1 ชื่อรายงาน / แถว BU Code Merge ทั้งแถว / หัวตาราง Merge แนวตั้งตามจำนวนแถวว่างจริง
          const lastC = W;
          try { ws.mergeCells(1, 1, 1, lastC); } catch (e) { /* ignore */ }
          if (hi >= 1) { try { ws.mergeCells(hi, 1, hi, lastC); } catch (e) { /* ignore */ } }
          if (hb > 0) for (let cc = 1; cc <= lastC; cc++) { try { ws.mergeCells(hi + 1, cc, hi + 1 + hb, cc); } catch (e) { /* ignore */ } }
          const H = { 1: 21, 2: 10.4, 3: 11.9, 4: 13.5, 5: 13.65, 6: 10.75, 8: 15.5 }; Object.keys(H).forEach(k => { if (Number(k) <= hi) ws.getRow(Number(k)).height = H[k]; });
          for (let rr = hi + 1; rr <= hi + 1 + hb; rr++) ws.getRow(rr).height = 13.75;
        }
        const FINAL_W = [33.6, 9.6, 27.5, 7.2, 24.2, 11.8, 11.6, 18.3, 17.8, 10.2, 35.2, 19.9, 12.4, 12.7, 16.3, 14.8, 13.9, 10.7, 35.2, 33.7, 35.2, 12.8, 22.1];
        for (let j = 0; j < W; j++) { // MARKER_GL_DOA_DOWNLOAD_FIT_COLS_V1 -- Detail/TB: ทุกคอลัมน์ Fit ตามเนื้อหา (หัว+ข้อมูลทุกแถว) ยกเว้นคอลัมน์ K (Description) กว้างคงที่
          if (isSim && FINAL_W[j]) { ws.getColumn(j + 1).width = FINAL_W[j]; continue; }
          if (kind === 'Detail' && j === 10) { ws.getColumn(j + 1).width = 35; continue; }
          const fitLen = (r) => { const v = (r || [])[j]; if (v == null || v === '') return 0; const t = typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v); return t.length; };
          const body = out.slice(Math.max(hi, 0)).reduce((mx, r) => Math.max(mx, fitLen(r)), 0);
          ws.getColumn(j + 1).width = Math.max(8, Math.min(60, Math.round((body + 3) * 1.05)));
        }
        ws.views = [{ state: isSim ? 'normal' : 'frozen', zoomScale: isSim ? 55 : 100, ySplit: (!isSim && hi >= 0) ? hi + 1 : undefined }];
  return ws;
}
const txnYM = (o) => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String((o || {}).txn_date || '').trim()); if (!m) return 0; const mi = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(m[2].toUpperCase()); return mi < 0 ? 0 : Number(m[3]) * 100 + mi + 1; }; /* MARKER_GL_DOA_BACKUP_SPLIT_V1 -- งวดของรายการ (YYYYMM) */
function splitByPeriod(rows, per) { const pm = /^(\d{4})\.(\d{2})$/.exec(per || ''); const pYM = pm ? Number(pm[1]) * 100 + Number(pm[2]) : 0; const below = []; const cur = []; (rows || []).forEach(o => { const y = txnYM(o); (y && pYM && y < pYM ? below : cur).push(o); }); return { below, cur }; }
function prevPerOf(per) { const pm = /^(\d{4})\.(\d{2})$/.exec(per || ''); if (!pm) return ''; let y = Number(pm[1]); let m = Number(pm[2]) - 1; if (m < 1) { m = 12; y -= 1; } return `${y}.${String(m).padStart(2, '0')}`; }
function DoaBackupSplitModal({ rows, curRows, srcNote, period, fileName, ctx, onDone }) { /* MARKER_GL_DOA_BACKUP_SPLIT_V1 -- Preview ก่อนสร้าง Backup งวดปัจจุบัน: Tab Below (เก็บเป็น Backup) / Tab งวดปัจจุบัน (Lookup กับ Detail ใน DB: Match / Unmatch) */
  const [tab, setTab] = React.useState('cur');
  const parts = React.useMemo(() => splitByPeriod(rows, period), [rows, period]);
  const label = (/^(\d{4})\.(\d{2})$/.exec(period || '') ? period.slice(5) + '.' + period.slice(0, 4) : period);
  /* MARKER_GL_DOA_BACKUP_SPLIT_DETAIL_BASE_V1 -- แท็บงวดปัจจุบัน = Detail จริงของงวดนั้น (จาก DB + ที่โหลดอยู่) เฉพาะ Account ที่อยู่ในไฟล์ Backup แล้ว Lookup กับ Backup: Match = ยังค้างอยู่ใน Backup | Unmatch = ไม่อยู่ใน Backup (เคลียร์แล้ว -> Stamp Auto Clear) | แถวที่มีเฉพาะใน Backup แต่ไม่มีใน Detail แสดงต่อท้าย (เทา) */
  const cur = React.useMemo(() => {
    const accB = new Set((rows || []).map(o => String(o.account_code))); const keyB = new Set((rows || []).map(detKey));
    const det = (curRows || []).filter(o => accB.has(String(o.account_code))); const keyD = new Set(det.map(detKey));
    const only = parts.cur.filter(o => !keyD.has(detKey(o)));
    const pmI = /^(\d{4})\.(\d{2})$/.exec(period || ''); const pYMI = pmI ? Number(pmI[1]) * 100 + Number(pmI[2]) : 0; /* MARKER_GL_DOA_PREVIEW_INCLUDE_STAT_V1 -- แถวใน Detail ที่ Transaction Date ต่ำกว่างวดปัจจุบัน = Include (ข้อมูลเดิมที่ถูกรวมแล้ว) ไม่แสดงเป็น Match */
    const isBelow = (o) => { const d = detDate(o.txn_date); const y = d ? d.getFullYear() * 100 + d.getMonth() + 1 : txnYM(o); return !!(pYMI && y > 0 && y < pYMI); };
    return { list: [...det, ...only], stat: [...det.map(o => (keyB.has(detKey(o)) ? (isBelow(o) ? 'Include' : 'Match') : 'Unmatch')), ...only.map(() => 'มีเฉพาะใน Backup')], nDet: det.length, nOnly: only.length };
  }, [rows, curRows, parts]);
  const stat = cur.stat; const nUn = stat.filter(x => x === 'Unmatch').length; const nMa = stat.filter(x => x === 'Match').length; const nInc = stat.filter(x => x === 'Include').length;
  const list = tab === 'below' ? parts.below : cur.list; const mat = React.useMemo(() => detailMatrixFromRows(list), [list]);
  const TB = (k, t, n) => (<button type="button" onClick={() => setTab(k)} style={{ border: 'none', borderBottom: tab === k ? '3px solid #1F6B4A' : '3px solid transparent', background: tab === k ? '#fff' : '#F3F6FA', color: tab === k ? '#1F6B4A' : '#44546A', fontWeight: tab === k ? 700 : 400, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>{t} <span style={{ fontSize: 11, color: '#6B778C' }}>({n})</span></button>);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.5)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(1500px, 96vw)', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #E1E6EE', display: 'flex', alignItems: 'center', gap: 12 }}>
          <b style={{ color: '#1a3a5c' }}>👁 Preview Backup Detail · {fileName}</b>
          <span style={{ fontSize: 12, color: '#6B778C' }}>Below {label} = เก็บเป็น Backup (ไม่เทียบ) · งวด {label} = Detail จริง {cur.nDet} แถว เทียบกับ Backup: Include {nInc} (ข้อมูลเดิมที่รวมแล้ว) · Match {nMa} (ยังค้าง) · Unmatch {nUn} (ไม่อยู่ใน Backup → Stamp Auto Clear){cur.nOnly ? ` · มีเฉพาะใน Backup ${cur.nOnly}` : ''} · {srcNote}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {list.length ? <DoaDetSheet matrix={mat} code="" only={false} ctx={ctx} stat={tab === 'cur' ? stat : undefined} /> : <div style={{ padding: 24, color: '#6B778C' }}>ไม่มีรายการในแท็บนี้</div>}
        </div>
        <div style={{ display: 'flex', background: '#F3F6FA', borderTop: '1px solid #E1E6EE' }}>{TB('below', `Below ${label}`, parts.below.length)}{TB('cur', label, cur.list.length)}</div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #E1E6EE', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#44546A', flex: 1 }}>กดตกลง → เก็บแท็บ Below เป็น Backup (ไม่ Stamp งวดของ Detail){nUn ? ` · Stamp Auto Clear ${nUn} รายการที่ Unmatch` : ''}</span>
          <button type="button" onClick={() => onDone(null)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 32, padding: '0 16px', cursor: 'pointer' }}>ยกเลิก</button>
          <button type="button" onClick={() => onDone({ parts, curList: cur.list, stat })} style={{ border: 'none', background: '#1a3a5c', color: '#fff', borderRadius: 6, height: 32, padding: '0 20px', cursor: 'pointer', fontWeight: 700 }}>ตกลง</button>
        </div>
      </div>
    </div>
  );
}
function DoaReconcileModal({ code, tbMatrix, detMatrix, simMatrix, onClose, bu, period, autoSend, hidden }) {
  const [incRows, setIncRows] = React.useState([]); const [incReady, setIncReady] = React.useState(false); /* MARKER_GL_DOA_RECON_READ_INCLUDE_V1 */ React.useEffect(() => { let off = false; setIncReady(false); if (!bu || !code) { setIncReady(true); return undefined; } listDoaClearDetail(bu, String(code)).then(it => { if (!off) { setIncRows((it || []).filter(x => x.status === 'Include' && x.row && (!period || String(x.period) === String(period))).map(x => x.row)); setIncReady(true); } }).catch(() => { if (!off) { setIncRows([]); setIncReady(true); } }); return () => { off = true; }; }, [bu, period, code]);
  const [sp, setSp] = React.useState({}); const [spReady, setSpReady] = React.useState(false); /* MARKER_GL_DOA_CONFIRM_WAIT_PROFILE_V1 -- Confirm ส่งไฟล์อัตโนมัติต้องรอโหลดชื่อผู้จัดทำ/ผู้สอบทานก่อน ไม่งั้นชื่อเป็น — */
  const [other, setOther] = React.useState({}); const [rmk, setRmk] = React.useState({}); const [tab, setTab] = React.useState(0);
  React.useEffect(() => { let off = false; loadSignoffProfile().then(d => { if (!off) { setSp(d || {}); setSpReady(true); } }).catch(() => { if (!off) setSpReady(true); }); return () => { off = true; }; }, []);
  const D = React.useMemo(() => {
    const tbK = (tbMatrix || []).length > 0 && segKeyCol(tbMatrix) >= 0; if (!tbK) return null;
    const t = buildTbDetail(tbMatrix, code); const head = t.matrix.slice(0, 8); const g = (k) => { const r = head.find(x => x[0] === k); return r ? String(r[1] || '') : ''; };
    const key = (b, c, s) => `${String(b).trim()}|${String(c).trim()}|${String(s).trim()}`;
    const rows = new Map(); t.matrix.slice(9).filter(r => String(r[2]).trim() === String(code)).forEach(r => { const k = key(r[0], r[1], r[3]); const o = rows.get(k) || { k, branch: r[0], cpc: r[1], acc: r[2], sub: r[3], desc: r[4], beg: 0, act: 0, end: 0, det: 0, sim: 0, inTb: true }; o.beg += detNum(r[5]) || 0; o.act += detNum(r[6]) || 0; o.end += detNum(r[7]) || 0; rows.set(k, o); });
    const add = (k, b, c, s, f, v) => { let o = rows.get(k); if (!o) { o = { k, branch: b, cpc: c, acc: String(code), sub: s, desc: '', beg: 0, act: 0, end: 0, det: 0, sim: 0, inTb: false }; rows.set(k, o); } o[f] += v; };
    let detAll = []; let sim = null;
    try { detAll = (() => { const base = detailRows(detMatrix || []).filter(o => String(o.account_code) === String(code)); const have = new Map(); base.forEach(o => { const k = detKey(o); have.set(k, (have.get(k) || 0) + 1); }); const extra = []; incRows.filter(o => String(o.account_code) === String(code)).forEach(o => { const k = detKey(o); const v = have.get(k) || 0; if (v > 0) have.set(k, v - 1); else extra.push(o); }); return base.concat(extra); })(); detAll.forEach(o => { const v = detNum(o.amount); if (v != null) add(key(o.branch_code, o.cost_center, o.sub_account), o.branch_code, o.cost_center, o.sub_account, 'det', v); }); } catch (e) { detAll = []; }
    try { simAmounts(simMatrix || [], code).forEach(o => add(key(o.branch, o.cpc, o.sub), o.branch, o.cpc, o.sub, 'sim', o.amt)); sim = simSheetRows(simMatrix || [], code); } catch (e) { sim = null; }
    const list = [...rows.values()].sort((a, b) => String(a.cpc).localeCompare(String(b.cpc)) || String(a.branch).localeCompare(String(b.branch)) || String(a.sub).localeCompare(String(b.sub)));
    const byCpc = {}; detAll.forEach(o => { const c = String(o.cost_center || '').trim() || '-'; (byCpc[c] = byCpc[c] || []).push(o); });
    const dBr = [...new Set(detAll.map(o => o.branch_code).filter(Boolean))].sort(); /* MARKER_GL_DOA_RECON_HEAD_FALLBACK_V1 -- หัวรายงานว่างจาก TB -> เติมจาก Detail */
    return { list, byCpc, detAll, sim, company: g('Company') || (dBr[0] ? String(dBr[0]).slice(0, 4) : ''), branch: g('Branch') || (dBr.length ? dBr[0] + (dBr.length > 1 ? '-' + dBr[dBr.length - 1] : '') : ''), accName: g('Account name') || String((detAll[0] || {}).account_name || '').trim(), period: g('Period') };
  }, [tbMatrix, detMatrix, simMatrix, code, incRows]);
  const ov = (r) => Number(String(other[r.k] == null ? '' : other[r.k]).replace(/,/g, '')) || 0;
  const tot = D ? D.list.reduce((t, r) => { const o = ov(r); const sum = r.det + r.sim + o; return { beg: t.beg + r.beg, act: t.act + r.act, end: t.end + r.end, det: t.det + r.det, sim: t.sim + r.sim, oth: t.oth + o, sum: t.sum + sum, diff: t.diff + (r.end - sum) }; }, { beg: 0, act: 0, end: 0, det: 0, sim: 0, oth: 0, sum: 0, diff: 0 }) : null;
  const ok = tot && Math.abs(tot.diff) < 0.005; const R2 = (n) => Math.round(n * 100) / 100;
  const sheets = React.useMemo(() => {
    if (!D) return [];
    const B = { fontWeight: 700 }; const HD = { background: '#002060', color: '#fff', fontWeight: 700, textAlign: 'center' }; const HO = { background: '#B26A00', color: '#fff', fontWeight: 700, textAlign: 'center' }; const TT = { background: '#D9D9D9', fontWeight: 700 };
    const fit = (rows, min = 60, max = 340, fixed = {}) => { const n = Math.max(...rows.map(r => r.length), 1); return Array.from({ length: n }).map((_, j) => { if (fixed[j]) return fixed[j]; let mx = 0; rows.forEach(r => { const c = r[j]; const v = c && typeof c === 'object' ? c.v : c; if (v == null || v === '') return; const t = typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2 }) : String(v); mx = Math.max(mx, t.length); }); return Math.max(min, Math.min(max, mx * 7.4 + 16)); }); };
    const top = (title) => [[title], [], ['Company ', D.company], ['Branch ', D.branch], ['Account code ', code], ['Account name', D.accName], ['Period', D.period], []];
    const out = [];
    // Cover
    const cpcKeys = Object.keys(D.byCpc).sort(); const noDet = !D.detAll.length; // MARKER_GL_DOA_COVER_BY_CPC_V1 -- Cover แยกยอดตาม CPC เท่านั้น (ไม่แยก Branch / SubAcc)
    const byC = {}; D.list.forEach(r => { const c = String(r.cpc || '').trim() || '-'; const o = ov(r); const x = byC[c] || (byC[c] = { end: 0, det: 0, sim: 0, oth: 0 }); x.end += r.end; x.det += r.det; x.sim += r.sim; x.oth += o; });
    // MARKER_GL_DOA_COVER_BOX_V2 -- Cover 7 คอลัมน์ (A..G) กว้างเท่า Cover ต้นฉบับ: แถบหัวน้ำเงิน B..G, กรอบข้อมูล, ตาราง By CPC (C=ชื่อ CPC, D=Per TB, E=Per Detail, F=Diff, G=Remark), แถบน้ำเงิน, กรอบ Prepare by / Review by
    const NV = { background: '#002060', color: '#fff', fontWeight: 700, textAlign: 'center' }; const LB = { background: '#B8CCE4', fontWeight: 700 }; const lab = (t) => ({ v: t, s: B }); const cpcs = Object.keys(byC).sort(); const multi = cpcs.length > 1; const BC = Math.max(5, 3 + cpcs.length); const NC = BC + 2; const BL = '2px solid #333'; const LAST = NC - 1; // MARKER_GL_DOA_COVER_MULTI_COLS_V1 -- หลาย CPC: แบ่ง TB / Detail เป็นคอลัมน์ต่อ CPC + คอลัมน์ Balance รวม
    const cv = []; const put = (cells) => { const r = Array.from({ length: NC }, () => ({ v: '' })); cells.forEach(([j, c]) => { r[j] = (c && typeof c === 'object' && !(c instanceof Date)) ? c : { v: c }; }); cv.push(r); return cv.length - 1; };
    const blank = () => put([]);
    blank(); blank();
    const rTitle = put([[1, { v: 'DETAIL OF ACCOUNT', s: NV, span: LAST }]]);
    blank();
    put([[1, lab('Company')], [2, { v: D.company, span: 3 }]]); put([[1, lab('Branch')], [2, { v: D.branch, span: 3 }]]); put([[1, lab('Account code')], [2, String(code)]]); put([[1, lab('Account name')], [2, { v: D.accName, span: 3 }]]); put([[1, lab('Period')], [2, D.period]]);
    const rB1 = blank(); const box1 = [rTitle, rB1];
    blank();
    const rH = put([...Array.from({ length: BC - 2 }, (_, k) => [2 + k, { v: '', s: NV }]), ...(multi ? cpcs.map((c, k) => [3 + k, { v: c, s: NV }]) : []), [BC, { v: 'Balance', s: NV }]]); /* MARKER_GL_DOA_COVER_REVIEW_AT_BALANCE_V1 -- Balance อยู่คอลัมน์ BC เสมอ และ Review by อยู่ตรง Balance */
    const BT = { fontWeight: 700, borderTop: BL }; const DB = { ...LB, borderTop: BL, borderBottom: BL }; const dcol = () => '#000'; const K0 = { color: '#000' }; /* MARKER_GL_DOA_COVER_SAMPLE_COLORS_V1 -- สีตัวเลข Cover เป็นสีดำตามตัวอย่าง */
    /* MARKER_GL_DOA_COVER_SAMPLE_LAYOUT_V1 -- 1 CPC / หลาย CPC โครงเดียวกัน: Per Trial balance (ค่าอยู่บรรทัดเดียวกัน) / Per detail / Detail / เว้น 3 / Diff */
    const gap = (sty) => Array.from({ length: BC - 3 - (multi ? cpcs.length : 0) }, (_, k) => [3 + (multi ? cpcs.length : 0) + k, { v: '', s: sty }]);
    const rowOf = (label, ls, vals, tv, sty) => put([[2, { v: label, s: ls }], ...gap(sty), ...(multi ? vals.map((v, k) => [3 + k, { v: R2(v), s: sty }]) : []), [BC, { v: R2(tv), s: sty }]]);
    rowOf('Per Trial balance', { fontWeight: 700 }, cpcs.map(c => byC[c].end), tot.end, K0);
    put([[2, lab('Per detail')]]);
    rowOf('Detail', { fontStyle: 'italic' }, cpcs.map(c => byC[c].det + byC[c].sim + byC[c].oth), tot.sum, K0);
    blank(); blank(); blank();
    const dv = cpcs.map(c => byC[c].end - (byC[c].det + byC[c].sim + byC[c].oth));
    put([[2, { v: 'Diff', s: DB }], ...gap(DB), ...(multi ? dv.map((v, k) => [3 + k, { v: R2(v), s: { ...DB, fontWeight: 400, color: dcol(v) } }]) : []), [BC, { v: R2(tot.diff), s: { ...DB, fontWeight: 400, color: dcol(tot.diff) } }], ...(!multi && ok ? [[BC + 1, { v: '✓ ตรงกัน', s: { color: '#000', fontWeight: 700 } }]] : [])]);
    if (noDet) put([[2, { v: '⚠ ยังไม่มีข้อมูล Detail ของ Account นี้ในหน้านี้ (โยน Detail แล้วกดยืนยันบันทึก)', s: { color: '#B42318', fontWeight: 700 }, span: 5 }]]);
    const rB2 = blank(); const box2 = [rH - 1, rB2];
    put([[1, { v: '', s: NV, span: LAST }]]);
    blank(); put([[1, 'APN']]);
    const rP0 = put([[1, lab('Prepare by :')], [2, { v: sp.my_name || '—', s: { background: '#DAEEF3' } }], [BC, lab('Review by :')], [LAST, { v: sp.report_to_name || '—', s: { background: '#DAEEF3' } }]]);
    put([[2, sp.my_job || ''], [LAST, sp.report_to_job || '']]);
    put([[1, lab('Date :')], [2, { v: '', s: { borderBottom: '1px solid #222' } }], [BC, lab('Date :')], [LAST, { v: '', s: { borderBottom: '1px solid #222' } }]]);
    const rP1 = blank(); const box3 = [rP0 - 1, rP1];
    [box1, box2, box3].forEach(([a, b]) => { for (let i = a; i <= b; i++) { let j = 1; while (j <= LAST) { const c = cv[i][j]; const sp2 = Math.max(1, c.span || 1); const st = { ...(c.s || {}) }; if (j === 1) st.borderLeft = BL; if (j + sp2 - 1 >= LAST) st.borderRight = BL; if (i === a) st.borderTop = BL; if (i === b) st.borderBottom = BL; cv[i][j] = { ...c, s: st }; j += sp2; } } });
    out.push({ name: 'Cover', rows: cv, widths: [50, 152, 300, ...Array.from({ length: NC - 3 }, (_, k) => (k === NC - 4 ? 250 : 130))] });
    // TB
    const hdrs = ['Branch', 'CPC', 'Account', 'SubAcc', 'Description', 'Beginnging Balance', 'Period Activity', 'Ending Balance', 'Detail Outstanding', 'Simple ADI Outstanding', 'Other Outstanding', 'รวม Detail', 'Diff', 'หมายเหตุ'];
    const tb = [...top('DETAIL OF ACCOUNT'), hdrs.map((h) => ({ v: h, s: HD }))]; // MARKER_GL_DOA_HDR_ONE_COLOR_V1 -- หัวคอลัมน์สีเดียว
    const subIdx = new Set(); let gAcc = null; const flushSub = () => { if (!gAcc) return; subIdx.add(tb.length); tb.push([`${gAcc.cpc} Total`, '', '', '', '', R2(gAcc.beg), R2(gAcc.act), R2(gAcc.end), R2(gAcc.det), R2(gAcc.sim), R2(gAcc.oth), R2(gAcc.sum), R2(gAcc.diff), ''].map(v => ({ v, s: TT }))); gAcc = null; }; /* MARKER_GL_DOA_TB_CPC_SUBTOTAL_V1 -- Sub Total ต่อ CPC ในชีต TB */
    D.list.forEach(r => { const o = ov(r); const sum = r.det + r.sim + o; const df = r.end - sum; if (gAcc && String(gAcc.cpc) !== String(r.cpc)) flushSub(); if (!gAcc) gAcc = { cpc: r.cpc, beg: 0, act: 0, end: 0, det: 0, sim: 0, oth: 0, sum: 0, diff: 0 }; gAcc.beg += r.beg; gAcc.act += r.act; gAcc.end += r.end; gAcc.det += r.det; gAcc.sim += r.sim; gAcc.oth += o; gAcc.sum += sum; gAcc.diff += df; tb.push([{ v: r.branch, s: r.inTb ? null : { background: '#FFF8E6' } }, r.cpc, r.acc, r.sub, r.desc || (r.inTb ? '' : (Math.abs(r.det + r.sim) < 0.005 ? 'Detail สุทธิ 0.00 (TB ไม่มียอดค้าง)' : 'ไม่พบใน TB')), R2(r.beg), R2(r.act), R2(r.end), r.det ? R2(r.det) : '', r.sim ? R2(r.sim) : '', { v: '', edit: { value: other[r.k] == null ? '' : other[r.k], set: (x) => setOther(m => ({ ...m, [r.k]: x.replace(/[^0-9.,\-]/g, '') })), num: true } }, R2(sum), { v: R2(df), s: { fontWeight: 700, color: Math.abs(df) >= 0.005 ? '#C00000' : '#1F6B4A' } }, { v: '', edit: { value: rmk[r.k] || '', set: (x) => setRmk(m => ({ ...m, [r.k]: x })) } }]); });
    flushSub();
    tb.push(['Total', '', '', '', '', R2(tot.beg), R2(tot.act), R2(tot.end), R2(tot.det), R2(tot.sim), R2(tot.oth), R2(tot.sum), R2(tot.diff), ''].map(v => ({ v, s: TT })));
    /* MARKER_GL_DOA_TB_REF_THEME_V1 -- ธีมเดียวกับ TB_of_Reconcile.xlsx: หัวน้ำเงินไม่ตัวหนา, ข้อมูล Tahoma ตัวเลขสีดำ เส้นจาง, Total พื้น #DAEEF3 ตัวหนา เส้นบน/ล่าง */
    tb.forEach((row, i) => { if (i < 8) return; const isH = i === 8; const isT = i === tb.length - 1 || subIdx.has(i); tb[i] = row.map((c) => { const o = (c && typeof c === 'object' && !(c instanceof Date)) ? c : { v: c }; const st = { ...(o.s || {}) }; delete st.background; delete st.color; delete st.fontWeight; if (isH) return { ...o, s: { ...st, background: '#002060', color: '#fff', textAlign: 'center' } }; const base = { fontFamily: 'Tahoma, sans-serif', color: (typeof o.v === 'number' && o.v < 0) ? '#C00000' : '#000', borderBottom: '1px dotted #9aa' }; return { ...o, s: isT ? { ...st, ...base, background: '#DAEEF3', fontWeight: 700, borderTop: '1px solid #333', borderBottom: '1px solid #333' } : { ...st, ...base } }; }); });
    const themeRows = (rs, h0, hasTot) => { rs.forEach((row, i) => { if (i < h0) return; const isH = i === h0; const isT = hasTot && i === rs.length - 1; rs[i] = row.map((c) => { const o = (c && typeof c === 'object' && !(c instanceof Date)) ? c : { v: c }; const st = { ...(o.s || {}) }; delete st.background; delete st.color; delete st.fontWeight; if (isH) return { ...o, s: { ...st, background: '#002060', color: '#fff', textAlign: 'center' } }; const base = { fontFamily: 'Tahoma, sans-serif', color: (typeof o.v === 'number' && o.v < 0) ? '#C00000' : '#000', borderBottom: '1px dotted #9aa' }; return { ...o, s: isT ? { ...st, ...base, background: '#DAEEF3', fontWeight: 700, borderTop: '1px solid #333', borderBottom: '1px solid #333' } : { ...st, ...base } }; }); }); return rs; }; /* MARKER_GL_DOA_DETAIL_BORDERS_V1 -- Detail/Simple ใช้ธีมเดียวกับ TB (มีเส้นคั่นแถว) */
    out.push({ name: 'TB', subRows: [...subIdx], rows: tb, widths: fit(tb.slice(8, 8 + 80), 70, 260, { 0: 120, 10: 130, 13: 180 }) });
    // Detail ต่อ CPC
    Object.keys(D.byCpc).sort().forEach(c => { out.push({ name: `${c}-${code}`.slice(0, 31), cpc: c, rows: [], node: <DoaPreviewModal embed kind="Detail" matrix={detailMatrixFromRows(D.byCpc[c])} code={code} fileName="" ctx={{ period: (/^\d{4}\.\d{2}$/.test(period || '') ? period : ''), comName: String(D.company || '').replace(/^\s*\d+\s*/, '') }} onClose={() => {}} /> }); }); /* MARKER_GL_DOA_RECON_DETAIL_BY_CPC_V1 -- Detail แยก Sheet ตาม CPC (Detail <CPC>) */
    if (D.sim && D.sim.rows && D.sim.rows.length) { /* MARKER_GL_DOA_RECON_SIMPLE_ONLY_IF_ROWS_V1 -- มีชีต Simple เฉพาะเมื่อ Account นี้มีแถวใน Simple */ out.push({ name: `Outstanding Simple ${code}`.slice(0, 31), rows: [], node: <DoaPreviewModal embed kind="Simple" matrix={simMatrix || []} code={code} fileName="" onClose={() => {}} /> }); }
    return out;
  }, [D, other, rmk, sp, code, tot, ok, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = sheets[Math.min(tab, Math.max(sheets.length - 1, 0))];
  const dlExcel = async (opts) => { /* MARKER_GL_DOA_RECON_DOWNLOAD_V1 -- ปุ่ม Download Excel ของ Reconcile: Cover / TB (มีสี/ตัวหนา/Merge ตามหน้าจอ) + Detail / Simple (ตารางข้อมูล) */
    try {
      const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook();
      const argb = (c) => { let t = String(c || '').trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(x => x + x).join(''); return /^[0-9a-f]{6}$/i.test(t) ? 'FF' + t.toUpperCase() : null; }; /* MARKER_GL_DOA_RECON_XLSX_STYLE_V1 -- รองรับสีย่อ #fff (หัวตารางน้ำเงินตัวหนังสือขาว) */
      sheets.forEach((sh) => {
        if (sh.node && sh.cpc == null) { simpleSheetToWb(wb, simMatrix, code, period); return; } /* MARKER_GL_DOA_RECON_SIMPLE_SAME_AS_PREVIEW_DL_V1 -- ชีต Simple ใช้ตัวสร้างเดียวกับ Download จาก Preview Simple (format ตรงต้นฉบับ) */
        const ws = wb.addWorksheet(String(sh.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)); ws.views = [{ zoomScale: 70, zoomScaleNormal: 70 }]; /* MARKER_GL_DOA_RECON_ZOOM70_V1 -- เปิดไฟล์ที่ Zoom 70% */
        if (sh.node) {
          const isDet = sh.cpc != null; /* MARKER_GL_DOA_RECON_ISDET_FIX_V1 -- ชีต Detail รู้จากค่า cpc (ชื่อชีตเป็น <CPC>-<Account> แล้ว) */ /* MARKER_GL_DOA_RECON_XLSX_STYLE_V1 -- Detail/Simple ใส่สีเหมือน Preview */
          const thin = { style: 'thin', color: { argb: 'FF999999' } }; const blk = { style: 'thin', color: { argb: 'FF000000' } }; const NUMF = '#,##0.00_);[Red](#,##0.00)';
          const fill = (c, hex) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } }; };
          const numV = (v) => (typeof v === 'number' ? v : (/^-?[\d,]+\.\d{2}$/.test(String(v == null ? '' : v).trim()) ? Number(String(v).replace(/,/g, '')) : null));
          if (isDet) {
            const mat = buildDetailDoa(detailMatrixFromRows(D.byCpc[sh.cpc] || []), code, { period: (/^\d{4}\.\d{2}$/.test(period || '') ? period : ''), comName: String((D && D.company) || '').replace(/^\s*\d+\s*/, '') }).matrix; /* MARKER_GL_DOA_RECON_DETAIL_HEAD_V1 -- Period / ชื่อบริษัทในหัว Detail */
            if (mat[6] && !mat[6][1]) mat[6][1] = (D && D.period) || '';
            const totIdx = new Map(); let gS = 0; let gE = 0; let fS = 0; const matT = mat.slice(0, 9); detWithTotals(mat.slice(9)).forEach(e => { if (e.tot != null) { totIdx.set(matT.length, !!e.grand); matT.push(DET_KEYS.map((k, j) => (j === 0 ? e.tot : (j === 11 ? e.v : null)))); } else matT.push(e.r); }); /* MARKER_GL_DOA_BRANCH_TOTAL_V1 */
            matT.forEach((r, i) => { const row = ws.addRow((r || []).map(v => (v == null || v === '' ? null : v))); if (i >= 9 && !totIdx.has(i)) { if (!gS) gS = row.number; gE = row.number; if (!fS) fS = row.number; row.outlineLevel = 2; } row.eachCell({ includeEmpty: i >= 8 }, (c, cn) => { c.font = { name: 'Tahoma', size: i === 0 ? 14 : 10, bold: i < 7 && cn === 1 }; /* MARKER_GL_DOA_DETAIL_TITLE14_V1 */ if (i === 8) { c.font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; fill(c, 'FF002060'); c.border = { top: blk, bottom: blk, left: blk, right: blk }; c.alignment = { horizontal: 'center', vertical: 'middle' }; return; } if (i > 8) { const dt = { style: 'dotted', color: { argb: 'FF000000' } }; c.border = { top: dt, bottom: dt, left: blk, right: blk }; /* MARKER_GL_DOA_DETAIL_XLSX_BLACK_LINES_V1 -- เส้นตั้งดำทึบ เส้นแนวนอนจุดดำ */ if (typeof c.value === 'number') c.numFmt = NUMF; if (c.value instanceof Date) c.numFmt = 'dd-mmm-yy'; if (!totIdx.has(i) && [1, 3, 4, 6, 7].includes(cn)) c.alignment = { horizontal: 'center' }; /* MARKER_GL_DOA_DETAIL_CENTER_V1 */ if (totIdx.has(i)) { c.font = { name: 'Tahoma', size: 10, bold: true }; fill(c, 'FFDAEEF3'); c.border = { top: blk, bottom: blk, left: cn === 1 ? blk : undefined, right: cn === DET_KEYS.length ? blk : undefined }; } } }); if (totIdx.has(i)) { const isG = totIdx.get(i); const v0 = row.getCell(12).value; const fc = row.getCell(12); fc.value = { formula: isG ? `SUBTOTAL(9,L${fS}:L${row.number - 1})` : `SUBTOTAL(9,L${gS}:L${gE})`, result: typeof v0 === 'number' ? v0 : 0 }; fc.numFmt = NUMF; fc.alignment = { horizontal: 'right' }; if (!isG) { row.outlineLevel = 1; gS = 0; gE = 0; } } });
            ws.properties.outlineProperties = { summaryBelow: true, summaryRight: true }; if (matT.length > 9) ws.autoFilter = { from: { row: 9, column: 1 }, to: { row: 9, column: DET_KEYS.length } }; /* MARKER_GL_DOA_EXCEL_SUBTOTAL_TOOLS_V1 */
            const stt = mat.slice(9).reduce((t, r) => t + (typeof (r || [])[11] === 'number' ? r[11] : 0), 0); /* MARKER_GL_DOA_DETAIL_SUBTOTAL_V1 */
            ws.views = [{ state: 'frozen', ySplit: 9, zoomScale: 70, zoomScaleNormal: 70 }]; /* MARKER_GL_DOA_RECON_DETAIL_FREEZE_V1 -- Freeze ตั้งแต่บรรทัดที่ 10 (แถว 1-9 = หัวรายงาน + หัวตาราง คงอยู่ตอนเลื่อน) */
            ws.columns.forEach((c, j) => { c.width = [14, 18, 16, 14, 22, 18, 18, 30, 16, 26].map(x => x)[j] || 16; }); return;
          }
          const sm = simMatrix || []; let hi = -1; for (let i = 0; i < Math.min(sm.length, 40) && hi < 0; i++) if (/^oracle\s*branch/i.test(String((sm[i] || [])[0] || '').trim())) hi = i;
          const pre = hi >= 0 ? sm.slice(0, hi + 1) : sm; const body = []; /* MARKER_GL_DOA_RECON_SIMPLE_TOTALS_V1 -- แถวของ Account นี้ + แถว Total by branch / Total by Account ของ Account นี้ (คงรูปแบบเดิมของไฟล์) */
          if (hi >= 0) { let cur = ''; for (let q = hi + 1; q < sm.length; q++) { const r = sm[q] || []; if (!r.some(x => x !== '' && x != null)) continue; const a0 = String(r[0] == null ? '' : r[0]).trim(); if (/^total/i.test(a0)) { if (a0.endsWith(String(code))) body.push(r.slice(0, 23)); continue; } const c2 = String(r[2] == null ? '' : r[2]).trim(); if (c2) cur = c2; if (cur === String(code)) body.push(r.slice(0, 23)); } }
          const all = [...pre.map(r => (r || []).slice(0, 23)), ...body]; const FW = [33.6, 9.6, 27.5, 7.2, 24.2, 11.8, 11.6, 18.3, 17.8, 10.2, 35.2, 19.9, 12.4, 12.7, 16.3, 14.8, 13.9, 10.7, 35.2, 33.7, 35.2, 12.8, 22.1];
          all.forEach((r, i) => { const row = ws.addRow((r || []).map(v => (v == null || v === '' ? null : v))); const isHead = hi >= 0 && i === hi; const t0 = String((r || [])[0] == null ? '' : (r || [])[0]).trim();
            row.eachCell({ includeEmpty: isHead }, (c, cn) => { c.font = { name: 'Calibri', size: 11 };
              if (/^total/i.test(t0)) { c.font = { name: 'Calibri', size: 11, bold: true }; fill(c, 'FFD9D9D9'); return; }
              if (isHead) { c.font = { name: 'Calibri', size: 11, bold: true }; fill(c, (cn >= 13 && cn <= 18) ? 'FFF8CBAD' : 'FFB4C6E7'); c.border = { top: blk, bottom: blk, left: blk, right: blk }; c.alignment = { vertical: 'top' }; return; }
              /* MARKER_GL_DOA_RECON_SIMPLE_KEEP_FORMAT_V1 -- Simple คงรูปแบบเดิมของไฟล์: ค่าเดิม ไม่แปลงตัวเลข ไม่เพิ่มเส้น */ }); });
          ws.columns.forEach((c, j) => { c.width = FW[j] || 14; }); ws.views = [{ zoomScale: 55, zoomScaleNormal: 55 }]; /* MARKER_GL_DOA_RECON_SIMPLE_ZOOM55_V1 */ return;
        }
        (sh.widths || []).forEach((w, j) => { ws.getColumn(j + 1).width = Math.max(6, Math.round((w || 80) / 7)); });
        sh.rows.forEach((r, i) => {
          const row = ws.getRow(i + 1); let j = 0; let mEnd = -1; /* MARKER_GL_DOA_RECON_MERGE_FIX_V1 -- เซลล์ที่ถูก Merge: ข้ามช่องลูก ไม่งั้นค่าว่างไปทับช่องแม่ */
          (r || []).forEach((c, jj) => {
            if (jj <= mEnd) return;
            const o = (c && typeof c === 'object' && !(c instanceof Date)) ? c : { v: c }; const st = o.s || {}; const cell = row.getCell(jj + 1);
            let v = o.edit ? o.edit.value : o.v; if (v === '' || v == null) v = null; cell.value = v;
            const f = { name: 'Tahoma', size: 10 }; if (st.fontWeight) f.bold = true; if (st.fontStyle === 'italic') f.italic = true; const fc = argb(st.color); if (fc) f.color = { argb: fc }; cell.font = f;
            const bg = argb(st.background); if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            if (st.textAlign) cell.alignment = { horizontal: st.textAlign === 'center' ? 'center' : (st.textAlign === 'right' ? 'right' : 'left'), vertical: 'middle' };
            if (typeof v === 'number') { cell.numFmt = '#,##0.00_);[Red](#,##0.00)'; cell.alignment = { horizontal: 'right', vertical: 'middle' }; }
            const bd = {}; ['Top', 'Bottom', 'Left', 'Right'].forEach(sd => { const b = st['border' + sd]; if (b) bd[sd.toLowerCase()] = { style: /dotted/.test(b) ? 'dotted' : 'thin', color: { argb: 'FF333333' } }; }); if (Object.keys(bd).length) cell.border = bd;
            if (o.span && o.span > 1) { try { ws.mergeCells(i + 1, jj + 1, i + 1, jj + o.span); mEnd = jj + o.span - 1; } catch (e) { /* ignore */ } }
            j = jj;
          });
        });
        if (sh.name === 'TB') { /* MARKER_GL_DOA_RECON_TB_GRID_V1 -- TB เป็นตารางมีเส้น: เส้นตั้ง/นอนบางสีเทา, หัวน้ำเงินตัวขาว กลางข้อความ, Description กว้าง, ตรึงแถวหัวตาราง */
          const gl = { style: 'thin', color: { argb: 'FFBFBFBF' } }; const bk = { style: 'thin', color: { argb: 'FF000000' } }; const NC2 = 14; const HR = 9; const lastR = sh.rows.length;
          [10, 8, 12, 9, 38, 18, 18, 18, 18, 18, 18, 18, 18, 30].forEach((w, k) => { ws.getColumn(k + 1).width = w; });
          for (let r = HR; r <= lastR; r++) { const row = ws.getRow(r); for (let cn = 1; cn <= NC2; cn++) { const c = row.getCell(cn); c.border = r === HR ? { top: bk, bottom: bk, left: bk, right: bk } : (r === lastR ? { top: bk, bottom: bk, left: gl, right: gl } : { top: gl, bottom: gl, left: gl, right: gl }); if (r === HR) { c.font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; } } }
          (sh.subRows || []).forEach(ix => { const row = ws.getRow(ix + 1); for (let cn = 1; cn <= NC2; cn++) { const c = row.getCell(cn); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAEEF3' } }; c.font = { name: 'Tahoma', size: 10, bold: true }; c.border = { top: bk, bottom: bk, left: cn === 1 ? bk : undefined, right: cn === NC2 ? bk : undefined }; if (typeof c.value === 'number') c.numFmt = '#,##0.00_);[Red](#,##0.00)'; } }); /* MARKER_GL_DOA_TB_CPC_SUBTOTAL_XLSX_V1 */
          ws.getRow(HR).height = 30; ws.getCell(1, 1).font = { name: 'Tahoma', size: 14, bold: true }; for (let r = 3; r <= 7; r++) ws.getCell(r, 1).font = { name: 'Tahoma', size: 10, bold: true };
          ws.views = [{ state: 'frozen', ySplit: HR, showGridLines: false, zoomScale: 70, zoomScaleNormal: 70 }];
        }
      });
      const buf = await wb.xlsx.writeBuffer(); const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a2 = document.createElement('a'); a2.href = url; a2.download = (opts && opts.name) ? opts.name : (() => { const com = (detailInfo(detMatrix || [], '').com || String((D && D.company) || '').replace(/\D.*$/, '') || ''); const nmA = String((D && D.accName) || '').replace(/[\s-]+$/, ''); return [com, bu, nmA, code, period].filter(Boolean).join('_').replace(/[\\/:*?"<>|]/g, '_') + '.xlsx'; })(); /* MARKER_GL_DOA_RECON_FILENAME_V1 -- ชื่อไฟล์ = com_bu_AccountName_Account_Period */ a2.style.display = 'none'; document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); if (opts && opts.onDownloaded) opts.onDownloaded(a2.download); /* MARKER_GL_DOA_CONFIRM_DL_NAME_V1 -- ส่งชื่อไฟล์จริงของ Download Excel กลับไปให้ Confirm */
    } catch (e) { if (opts && opts.onFail) opts.onFail(e); else window.alert('Download ไม่สำเร็จ: ' + e.message); }
  };
  const autoRan = React.useRef(false); /* MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1 -- Confirm = สร้างไฟล์ Reconcile (ตัวเดียวกับปุ่ม Download Excel) แบบไม่แสดงหน้าต่าง แล้วดาวน์โหลดเพื่อให้ Handler ส่งต่อ SharePoint */
  React.useEffect(() => { if (!autoSend || autoRan.current || !spReady || !incReady) return undefined; if (!D) { const t = setTimeout(() => { if (!autoRan.current) { autoRan.current = true; autoSend.res(false); onClose(); } }, 4000); return () => clearTimeout(t); } autoRan.current = true; setTimeout(() => { dlExcel({ onDownloaded: (nm) => { autoSend.res(nm || true); setTimeout(onClose, 50); }, onFail: () => { autoSend.res(false); onClose(); } }); }, 600); return undefined; }, [D, autoSend, spReady, incReady]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div onClick={onClose} style={{ visibility: hidden ? 'hidden' : undefined, position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '99vw', height: '98vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid #E3E8EF', flex: '0 0 auto' }}>
          <b style={{ color: '#334155', fontSize: 15 }}>🔗 Reconcile Preview · {code}{D && D.accName ? ' · ' + D.accName : ''}</b>
          {tot && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 12, background: ok ? '#E7F5EE' : '#FDECEA', color: ok ? '#1F6B4A' : '#B42318' }}>{ok ? '✓ Diff = 0' : `Diff ${tot.diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>}
          <span style={{ fontSize: 12, color: '#57606a' }}>(ช่องสีเหลืองกรอกได้: Other Outstanding / หมายเหตุ)</span>
          {D && <button type="button" onClick={dlExcel} title="Download Reconcile เป็นไฟล์ Excel" style={{ marginLeft: 'auto', border: '1px solid #B9C4D2', background: '#fff', color: '#1a3a5c', borderRadius: 6, height: 30, padding: '0 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⬇ Download Excel</button>}
          <button type="button" onClick={onClose} style={{ marginLeft: D ? 0 : 'auto', border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: '#666' }}>✕</button>
        </div>
        <div className="doa-noscroll" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', background: '#fff', scrollbarWidth: 'none' }}>
          <style>{'.doa-noscroll::-webkit-scrollbar{display:none}'}</style>
          {!D ? <div style={{ padding: 40, textAlign: 'center', color: '#B42318' }}>ไม่มี TB ของงวดนี้ (หรือรูปแบบ TB ไม่ถูกต้อง) — Reconcile ต้องมี TB</div> : (cur && (cur.node ? <div style={{ height: 'calc(98vh - 130px)' }}>{cur.node}</div> : <DoaSheetGrid rows={cur.rows} widths={cur.widths} />))}
        </div>
        {D && <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 14px', background: '#f3f3f3', borderTop: '1px solid #E3E8EF', flex: '0 0 auto', overflowX: 'auto' }}>
          {sheets.map((x, i) => { const on = i === Math.min(tab, sheets.length - 1); return <button key={x.name} type="button" onClick={() => setTab(i)} style={{ padding: '6px 16px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', borderTop: on ? '2px solid #1a7f37' : '2px solid transparent', background: on ? '#fff' : 'transparent', color: on ? '#1a7f37' : '#475569' }}>{x.name}</button>; })}
        </div>}
      </div>
    </div>
  );
}
// MARKER_GL_DOA_TB_BACKUP_FE_V1 -- หน้าต่างโหลดข้อมูลเก่าจาก Backup (ใน DB ชั่วคราว)
// MARKER_GL_DOA_CONFIRM_DIALOG_V1 -- Dialog ยืนยันแบบเดียวกับ Popup ของหน้านี้ (แทน window.confirm ของเบราว์เซอร์ "localhost:3000 says")
let _askHost = null;
const askDoa = (msg) => new Promise(res => { if (_askHost) _askHost(String(msg), res); else res(window.confirm(msg)); });
function DoaConfirmHost() {
  const [d, setD] = React.useState(null);
  React.useEffect(() => { _askHost = (msg, res) => setD({ msg, res }); return () => { _askHost = null; }; }, []);
  if (!d) return null;
  const lines = d.msg.split('\n').filter(Boolean); const danger = /ล้าง|ลบ/.test(lines[0] || ''); const col = danger ? '#B42318' : '#1a3a5c';
  const done = (v) => { const r = d.res; setD(null); r(v); };
  return (
    <div onClick={() => done(false)} onKeyDown={e => { if (e.key === 'Escape') done(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(480px, 92vw)', boxShadow: '0 12px 40px rgba(0,0,0,.3)', borderTop: `5px solid ${col}`, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 6px', fontSize: 16, fontWeight: 700, color: col }}>{danger ? '🗑 ' : '❓ '}{lines[0]}</div>
        <div style={{ padding: '2px 20px 12px' }}>{lines.slice(1).map((t, i) => <div key={i} style={{ padding: '3px 0', fontSize: 13, color: '#344054' }}>{t}</div>)}</div>
        <div style={{ padding: '8px 20px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => done(false)} style={{ border: '1px solid #B9C4D2', background: '#fff', color: '#344054', borderRadius: 6, height: 32, padding: '0 18px', cursor: 'pointer' }}>ยกเลิก</button>
          <button type="button" autoFocus onClick={() => done(true)} style={{ border: 'none', background: col, color: '#fff', borderRadius: 6, height: 32, padding: '0 22px', cursor: 'pointer', fontWeight: 600 }}>{danger ? 'ยืนยันล้าง/ลบ' : 'ตกลง'}</button>
        </div>
      </div>
    </div>
  );
}
// MARKER_GL_DOA_RESULT_POPUP_V1 -- แจ้งผลเป็น Popup (โยนไฟล์/ล้าง/Backup) แทนข้อความแถวเล็กๆ: ลงไฟล์อะไร เท่าไหร่
function DoaNoticeModal({ n, onClose }) {
  const [cs, setCs] = React.useState({}); const [csBusy, setCsBusy] = React.useState(''); /* MARKER_GL_DOA_DRILL_SPLIT_CPC_V1 */
  const [pg, setPg] = React.useState(1); const hasTabs = false; /* MARKER_GL_DOA_POPUP_ONEPAGE_V2 -- ยอด/สถานะย้ายไปอยู่ในแถวของรายการ Config ซ้าย แล้ว จึงกลับเป็นหน้าเดียว */ const p1 = !hasTabs || pg === 1; const p2 = !hasTabs || pg === 2; // MARKER_GL_DOA_POPUP_2PAGES_V1 -- Popup โยน TB แบ่ง 2 หน้า: ① สรุป + ยอด/การเปลี่ยนแปลง ② Config ซ้าย/ขวา
  const [lastAdd, setLastAdd] = React.useState(''); const [ed, setEd] = React.useState({}); const [rules, setRules] = React.useState(() => (n.pick ? n.pick.rules : [])); const [le, setLe] = React.useState({}); const [dr, setDr] = React.useState({}); const [man, setMan] = React.useState(null); const [manAcc, setManAcc] = React.useState([]); const [addedLab, setAddedLab] = React.useState({}); const [q, setQ] = React.useState(''); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const [lists, setLists] = React.useState(() => n.pick ? { have: [...n.pick.have], none: [...n.pick.none] } : null);
  const col = n.tone === 'ok' ? '#1F6B4A' : (n.tone === 'warn' ? '#B54708' : '#B42318');
  const closeNo = () => { try { if (n.save && n.save.discard) n.save.discard(); } catch (e) { /* ไม่ขัดการปิด */ } onClose(); }; // MARKER_GL_DOA_DISCARD_V1
  return (
    <div onClick={n.save ? closeNo : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="doa-noscroll" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: n.pick ? 'min(1880px, calc(100vw - 24px))' : 'min(560px, 92vw)', maxHeight: '94vh', overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', boxShadow: '0 12px 40px rgba(0,0,0,.3)', borderTop: `5px solid ${col}` }}><style>{'.doa-noscroll::-webkit-scrollbar{display:none}.doa-slim{scrollbar-width:thin;scrollbar-color:#C3CCD9 transparent}.doa-slim::-webkit-scrollbar{width:6px;height:6px}.doa-slim::-webkit-scrollbar-track{background:transparent}.doa-slim::-webkit-scrollbar-thumb{background:#C3CCD9;border-radius:6px}.doa-slim::-webkit-scrollbar-thumb:hover{background:#9AA7BA}.doa-row{transition:background .1s}.doa-row:hover{background:#E3EEFB !important;box-shadow:inset 3px 0 0 #1B3A5C}'}</style>
        <div style={{ padding: '16px 20px 8px', fontSize: 16, fontWeight: 700, color: col }}>{n.tone === 'ok' ? '✓ ' : (n.tone === 'warn' ? '⚠ ' : '✗ ')}{n.title}</div>
        {hasTabs && <div style={{ display: 'flex', gap: 8, padding: '0 20px 4px' }}>{[[1, '① สรุป · ยอด · การเปลี่ยนแปลง'], [2, `② Config (ซ้าย ${n.pick.have.length} · ขวา ${n.pick.none.length})`]].map(([k, t]) => <button key={k} type="button" onClick={() => setPg(k)} style={{ border: '1px solid ' + (pg === k ? '#1a3a5c' : '#D5DEEA'), background: pg === k ? '#1a3a5c' : '#fff', color: pg === k ? '#fff' : '#344054', borderRadius: 999, height: 28, padding: '0 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{t}</button>)}</div>}
        <div style={{ padding: '4px 20px 12px' }}>
          {p1 && n.pick && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', columnGap: 32 }}>{(n.rows || []).map(([k, v], i) => (<div key={i} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid #EEF2F7', fontSize: 13 }}><span style={{ width: 110, flex: '0 0 110px', color: '#6B778C' }}>{k}</span><span style={{ color: '#1a3a5c', fontWeight: 600, wordBreak: 'break-word' }}>{v}</span></div>))}</div>}
          {p1 && !n.pick && (n.rows || []).map(([k, v], i) => (<div key={i} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid #EEF2F7', fontSize: 13 }}><span style={{ width: 150, flex: '0 0 150px', color: '#6B778C' }}>{k}</span><span style={{ color: '#1a3a5c', fontWeight: 600, wordBreak: 'break-word' }}>{v}</span></div>))}
          {p1 && n.sums && n.sums.length > 0 && (() => { const S = n.sums; const nf = (v) => { const x = Number(v) || 0; const t = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return x < 0 ? `(${t})` : t; }; const cnt = { new: 0, upd: 0, same: 0 }; S.forEach(o => { cnt[o.st] += 1; });
            const P = { new: ['ใหม่', '#E6F4EA', '#1a7f37'], upd: ['ยอดเปลี่ยน', '#DDF0FF', '#0969da'], same: ['ไม่เปลี่ยนแปลง', '#F3F4F6', '#57606a'] }; const th0 = { padding: '6px 10px', fontSize: 11.5, fontWeight: 700, color: '#6B778C', background: '#FAFBFD', position: 'sticky', top: 0, borderBottom: '1px solid #EEF2F7' };
            return (<div style={{ border: '1px solid #D7DEE8', borderRadius: 10, marginTop: 10, overflow: 'hidden' }}>
              <div style={{ padding: '7px 12px', background: '#F4F7FB', fontWeight: 700, fontSize: 13, color: '#1a3a5c', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>ยอดต่อ Account (ตาม Config)<span style={{ fontWeight: 600, fontSize: 12, color: cnt.new + cnt.upd ? '#0969da' : '#57606a' }}>{cnt.new + cnt.upd ? `มีการเปลี่ยนแปลง ${cnt.new + cnt.upd} Account` : 'ไม่มีการเปลี่ยนแปลง'}</span><span style={{ fontWeight: 500, fontSize: 12, color: '#6B778C' }}>ใหม่ {cnt.new} · ยอดเปลี่ยน {cnt.upd} · ไม่เปลี่ยน {cnt.same}</span></div>
              {!n.pick && <div style={{ maxHeight: 220, overflow: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr><th style={{ ...th0, textAlign: 'left' }}>Account</th><th style={{ ...th0, textAlign: 'left' }}>Description</th><th style={{ ...th0, textAlign: 'right' }}>Beginning</th><th style={{ ...th0, textAlign: 'right' }}>Period Activity</th><th style={{ ...th0, textAlign: 'right' }}>Ending</th><th style={{ ...th0, textAlign: 'center' }}>สถานะ</th></tr></thead>
                <tbody>{S.map(o => { const p = P[o.st]; const red = (v) => ({ textAlign: 'right', padding: '5px 10px', color: v < 0 ? '#C0392B' : undefined }); return (<tr key={o.code} style={{ borderTop: '1px solid #F2F4F7', color: o.st === 'same' ? '#656d76' : undefined }}><td style={{ padding: '5px 10px', fontWeight: 600 }}>{o.code}</td><td style={{ padding: '5px 10px', color: '#6B778C' }}>{o.name}</td><td style={red(o.b)}>{nf(o.b)}</td><td style={red(o.p)}>{nf(o.p)}</td><td style={red(o.e)}>{nf(o.e)}</td><td style={{ textAlign: 'center', padding: '5px 10px' }}><span style={{ background: p[1], color: p[2], borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{p[0]}</span></td></tr>); })}</tbody></table></div>}
            </div>); })()}
          {p2 && n.pick && lists && (() => { const pk = n.pick; const nm = (c) => pk.names[c] || ''; const ql = q.trim().toLowerCase(); const vis = lists.none.filter(c => !ql || c.toLowerCase().includes(ql) || nm(c).toLowerCase().includes(ql));
            const box = { border: '1px solid #D7DEE8', borderRadius: 8, marginTop: 10, overflow: 'hidden' }; const hd = { padding: '6px 10px', background: '#F4F7FB', fontWeight: 700, fontSize: 13, color: '#1a3a5c', display: 'flex', alignItems: 'center', gap: 8 };
            const val = (c) => ({ cpc: ((ed[c] || {}).cpc || 'BBBBB').trim().toUpperCase() || 'BBBBB', sub: ((ed[c] || {}).sub || 'BBBBBB').trim().toUpperCase() || 'BBBBBB' });
            const add = async (codes) => { if (!codes.length || busy) return; setBusy(codes.length > 1 ? '*' : codes[0]); setErr(''); try { await pk.add(codes.map(c => ({ account: c, ...val(c) }))); setLastAdd(codes.length === 1 ? codes[0] : ''); setAddedLab(m => { const t = { ...m }; codes.forEach(c => { const v = val(c); t[c] = `${v.cpc}-${c}-${v.sub}`; }); return t; }); setLists(l => ({ have: [...l.have, ...codes].sort(), none: l.none.filter(c => !codes.includes(c)) })); try { setRules((await pk.reload()).filter(r => pk.inFile.includes(r.account) || manAcc.includes(r.account))); } catch (e2) { /* คงรายการเดิม */ } } catch (e) { setErr('ผูก Config ไม่สำเร็จ: ' + e.message); } setBusy(''); };
            const bt = { whiteSpace: 'nowrap', border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', borderRadius: 5, height: 24, padding: '0 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
            const GRID = '78px 8px 88px 8px 82px minmax(0,1fr) 92px'; const GRIDL = '68px 6px 82px 6px 76px minmax(90px,1fr) 98px 98px 98px 60px'; const stMap = Object.fromEntries((n.sums || []).map(o => [o.code, o])); const STP = { new: ['ใหม่', '#E6F4EA', '#1a7f37'], upd: ['ยอดเปลี่ยน', '#DDF0FF', '#0969da'], same: ['คงที่', '#F3F4F6', '#57606a'] }; const GRIDR = GRIDL; const nf0 = (v) => { const x = Number(v) || 0; const t = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return x < 0 ? `(${t})` : t; }; const pane = { border: '1px solid #D7DEE8', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff' };
            const ph = (bg, col) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: bg, color: col, fontWeight: 700, fontSize: 13.5, minHeight: 34, borderBottom: '1px solid #E4E9F1' });
            const colh = { display: 'grid', gridTemplateColumns: GRID, gap: 4, padding: '5px 12px', background: '#FAFBFD', borderBottom: '1px solid #EEF2F7', fontSize: 11.5, fontWeight: 700, color: '#6B778C', textTransform: 'uppercase', letterSpacing: .3 };
            const rowS = { display: 'grid', gridTemplateColumns: GRID, gap: 4, alignItems: 'center', padding: '5px 12px', borderBottom: '1px solid #F2F4F7', fontSize: 13, color: '#344054' };
            const fld = { width: '100%', boxSizing: 'border-box', height: 26, border: '1px solid #CBD5E1', borderRadius: 6, padding: '0 6px', fontSize: 12.5, fontWeight: 700, textAlign: 'center', color: '#1a3a5c', background: '#fff' };
            const dash = { textAlign: 'center', color: '#98A2B3', fontWeight: 700 }; const nameS = { color: '#6B778C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 6 };
            const badge = (bg, col) => ({ background: bg, color: col, borderRadius: 10, padding: '1px 9px', fontSize: 12, fontWeight: 700 });
            const lvis = rules.filter(r => !ql || String(r.account).toLowerCase().includes(ql) || String(r.cpc).toLowerCase().includes(ql) || String(r.sub_acc).toLowerCase().includes(ql) || nm(r.account).toLowerCase().includes(ql));
            const lst = { maxHeight: 'calc(94vh - 480px)', minHeight: 200, overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }; // MARKER_GL_DOA_NO_INNER_SCROLL_V1 -- ไม่มี Scroll ในรายการ: ให้ทั้ง Popup เลื่อนเอง
            return (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '8px 12px', border: '1px solid #D7DEE8', borderRadius: 10, background: '#F7F9FC' }}>
                <span style={{ fontSize: 15 }}>🔍</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา Account / ชื่อบัญชี / CPC / Sub Acc (ค้นทั้งสองฝั่ง)" style={{ flex: 1, height: 30, border: '1px solid #CBD5E1', borderRadius: 7, padding: '0 10px', fontSize: 13, background: '#fff' }} />
                {q && <button type="button" onClick={() => setQ('')} style={{ ...bt, height: 28 }}>ล้าง</button>}
                <span style={{ fontSize: 12, color: '#6B778C', whiteSpace: 'nowrap' }}>ซ้าย {lvis.length} · ขวา {vis.length}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, marginTop: 10 }}>
                <div style={pane}>
                  <div style={ph('#E7F5EE', '#1F6B4A')}><span>✓ มี Config แล้ว</span><span style={badge('#CDEBDC', '#1F6B4A')}>{lists.have.length} Account · {rules.length} รายการ</span><button type="button" onClick={() => setMan(man ? null : { cpc: 'BBBBB', ac: '', sub: 'BBBBBB' })} style={{ ...bt, marginLeft: 'auto', height: 26 }}>{man ? '× ปิด' : '+ เพิ่ม Config'}</button></div>
                  {man && <div style={{ ...rowS, background: '#F0FAF4', borderBottom: '1px solid #CDEBDC' }}>
                    <input value={man.cpc} onChange={e => setMan(m => ({ ...m, cpc: e.target.value }))} style={fld} title="CPC (BBBBB = ทุก CPC)" /><span style={dash}>-</span>
                    <input value={man.ac} onChange={e => setMan(m => ({ ...m, ac: e.target.value.replace(/\s/g, '') }))} placeholder="Account" style={fld} /><span style={dash}>-</span>
                    <input value={man.sub} onChange={e => setMan(m => ({ ...m, sub: e.target.value }))} style={fld} title="Sub Acc (BBBBBB = ทุก Sub Acc)" />
                    <span style={nameS}>{man.ac ? nm(man.ac) : 'พิมพ์เลข Account ที่ต้องการเพิ่ม (ไม่ต้องมีในไฟล์ก็ได้)'}</span>
                    <button type="button" disabled={!!busy || !man.ac} onClick={async () => { const ac2 = man.ac.trim(); const c2 = (man.cpc || '').trim().toUpperCase() || 'BBBBB', s2 = (man.sub || '').trim().toUpperCase() || 'BBBBBB'; setBusy('man'); setErr(''); try { await pk.add([{ account: ac2, cpc: c2, sub: s2 }]); const na = [...manAcc, ac2]; setManAcc(na); setLastAdd(ac2); setLists(l => ({ have: [...new Set([...l.have, ac2])].sort(), none: l.none.filter(c => c !== ac2) })); setRules((await pk.reload()).filter(x => pk.inFile.includes(x.account) || na.includes(x.account))); setMan({ cpc: 'BBBBB', ac: '', sub: 'BBBBBB' }); } catch (e) { setErr('เพิ่ม Config ไม่สำเร็จ: ' + e.message); } setBusy(''); }} style={{ ...bt, width: '100%', background: man.ac ? '#1a3a5c' : '#EAECF0', color: man.ac ? '#fff' : '#98A2B3' }}>{busy === 'man' ? '…' : '+ Add'}</button>
                  </div>}
                  <div style={{ ...colh, gridTemplateColumns: GRIDL }}><span style={{ textAlign: 'center' }}>CPC</span><span /><span style={{ textAlign: 'center' }}>Account</span><span /><span style={{ textAlign: 'center' }}>Sub Acc</span><span style={{ paddingLeft: 6 }}>ชื่อบัญชี</span><span style={{ textAlign: 'right' }}>Beginning</span><span style={{ textAlign: 'right' }}>Activity</span><span style={{ textAlign: 'right' }}>Ending</span><span style={{ textAlign: 'center' }}>สถานะ</span></div>
                  <div className="doa-noscroll" style={lst}>{lvis.length ? lvis.map(r => { const k = String(r.id); const cur = le[k] || {}; const vc = cur.cpc ?? r.cpc, vs = cur.sub ?? r.sub_acc; const dirty = (vc !== r.cpc) || (vs !== r.sub_acc);
                    const so = (() => { const det = (n.sums || {}).det; if (!det) return stMap[String(r.account)]; if (r.cpc_mode === 'exclude' || r.sub_mode === 'exclude') return null; const z0 = (x) => String(x == null ? '' : x).replace(/^0+/, ''); const mt = (cfg, v, all) => { const c = String(cfg || '').trim().toUpperCase(); return c === all || c === String(v || '').toUpperCase() || z0(c) === z0(v); }; const hit = det.filter(d => String(d.code) === String(r.account) && mt(r.cpc, d.cpc, 'BBBBB') && mt(r.sub_acc, d.sub, 'BBBBBB')); return hit.length ? hit.reduce((a, d) => ({ ...a, b: a.b + d.b, p: a.p + d.p, e: a.e + d.e }), { b: 0, p: 0, e: 0, st: (stMap[String(r.account)] || {}).st || 'new' }) : null; })(); /* MARKER_GL_DOA_SUMS_BY_CPC_V1 -- ยอดแยกตาม CPC/Sub Acc ของบรรทัดนั้น */ return (<React.Fragment key={k}><div className="doa-row" style={{ ...rowS, gridTemplateColumns: GRIDL, background: String(r.account) === lastAdd ? '#F0FAF4' : undefined }}>
                      <input value={vc} onChange={e => setLe(m => ({ ...m, [k]: { ...(m[k] || {}), cpc: e.target.value } }))} style={{ ...fld, borderColor: r.cpc_mode === 'exclude' ? '#F04438' : '#CBD5E1' }} title={r.cpc_mode === 'exclude' ? 'CPC (Exclude)' : 'CPC (BBBBB = ทุก CPC)'} /><span style={dash}>-</span>
                      <b style={{ textAlign: 'center' }}>{r.account}</b><span style={dash}>-</span>
                      <input value={vs} onChange={e => setLe(m => ({ ...m, [k]: { ...(m[k] || {}), sub: e.target.value } }))} style={{ ...fld, borderColor: r.sub_mode === 'exclude' ? '#F04438' : '#CBD5E1' }} title={r.sub_mode === 'exclude' ? 'Sub Acc (Exclude)' : 'Sub Acc (BBBBBB = ทุก Sub Acc)'} />
                      <span style={nameS} title={nm(r.account)}><button type="button" onClick={() => setDr(d => ({ ...d, [k]: !d[k] }))} title="ดูแถวข้อมูลที่ผ่านการคัด (Branch / CPC / Sub Acc)" style={{ border: '1px solid #1a3a5c', background: dr[k] ? '#1a3a5c' : '#fff', color: dr[k] ? '#fff' : '#1a3a5c', borderRadius: 5, fontSize: 11, padding: '0 6px', height: 20, marginRight: 6, cursor: 'pointer' }}>{dr[k] ? '▾' : '▸'} Detail</button>{nm(r.account)}</span>
                      {['b', 'p', 'e'].map(f2 => { const v = so ? so[f2] : null; return <span key={f2} style={{ textAlign: 'right', fontSize: 12, color: v != null && v < 0 ? '#C0392B' : '#344054', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{v == null ? '' : nf0(v)}</span>; })}
                      {dirty ? <button type="button" disabled={!!busy} onClick={async () => { const c2 = (vc || '').trim().toUpperCase() || 'BBBBB', s2 = (vs || '').trim().toUpperCase() || 'BBBBBB'; setBusy(k); setErr(''); try { await pk.upd(r, c2, s2); setRules((await pk.reload()).filter(x => pk.inFile.includes(x.account) || manAcc.includes(x.account))); setLe(m => { const t = { ...m }; delete t[k]; return t; }); } catch (e) { setErr('แก้ Config ไม่สำเร็จ: ' + e.message); } setBusy(''); }} style={{ ...bt, width: '100%', background: '#1a3a5c', color: '#fff' }}>{busy === k ? '…' : '💾 Save'}</button> : (String(r.account) === lastAdd ? <span style={{ color: '#1F6B4A', fontSize: 12, textAlign: 'center' }}>✓ เพิ่มแล้ว</span> : (so ? <span style={{ justifySelf: 'center', background: STP[so.st][1], color: STP[so.st][2], borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{STP[so.st][0]}</span> : <span />))}
                    </div>{dr[k] && (() => { const dd = pk.rawM ? tbDrill(pk.rawM, r, pk.bu, pk.com) : null; const th2 = { textAlign: 'right', fontSize: 11.5, color: '#6B778C', fontWeight: 700 }; const c2 = (v) => ({ textAlign: 'right', fontSize: 12, color: v < 0 ? '#C0392B' : '#344054', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' });
                      if (!dd) return <div style={{ padding: '8px 14px', background: '#F8FAFC', fontSize: 12, color: '#6B778C', borderBottom: '1px solid #EEF2F7' }}>ไม่มีข้อมูลดิบให้แสดงรายละเอียด (โยนไฟล์ TB ใหม่)</div>;
                      const G2 = '1fr 60px 108px 108px 108px'; const last = dd.steps[dd.steps.length - 1];
                      const closeDr = () => setDr(d => ({ ...d, [k]: false })); return (<div onClick={closeDr} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 5500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(980px, 95vw)', maxHeight: '88vh', overflow: 'auto', padding: '16px 20px 14px', fontSize: 12.5, boxShadow: '0 12px 40px rgba(0,0,0,.3)', borderTop: '5px solid #1a3a5c' }}>{/* MARKER_GL_DOA_DRILL_POPUP_V1 -- Detail แยกตาม Branch แสดงเป็น Popup */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><div style={{ fontWeight: 700, color: '#1a3a5c', fontSize: 15 }}>Detail — แถวข้อมูลที่ผ่านการคัด</div><span style={{ color: '#344054', fontWeight: 600 }}>{r.cpc}-{r.account}-{r.sub_acc}</span><span style={{ color: '#6B778C' }}>{nm(r.account)}</span><span style={{ marginLeft: 'auto' }} /><button type="button" onClick={closeDr} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#888' }}>✕</button></div>
                        {/* MARKER_GL_DOA_DRILL_NO_STEPS_V1 -- ซ่อนส่วน 'ขั้นตอนการคัด' (①-④) เหลือเฉพาะยอดแยกตาม Branch */}
                        {/* MARKER_GL_DOA_DRILL_ROWS_TABLE_V1 -- Popup Detail: ตารางแถวที่ผ่านการคัด Branch / CPC / Account / Sub Acc / Account Name / Beginning / Activity / Ending */}
                        {(() => { const GR = '74px 64px 84px 78px minmax(120px,1fr) 108px 108px 108px'; const rr = (dd.rows || []).slice().sort((a, b) => String(a.br).localeCompare(String(b.br)) || String(a.cpc).localeCompare(String(b.cpc)) || String(a.sub).localeCompare(String(b.sub)));
                          return (<div style={{ marginTop: 4 }}><div style={{ display: 'grid', gridTemplateColumns: GR, gap: 6, padding: '3px 0', borderBottom: '1px solid #E4E9F0' }}><span style={{ ...th2, textAlign: 'left' }}>Branch</span><span style={{ ...th2, textAlign: 'left' }}>CPC</span><span style={{ ...th2, textAlign: 'left' }}>Account</span><span style={{ ...th2, textAlign: 'left' }}>Sub Acc</span><span style={{ ...th2, textAlign: 'left' }}>Account Name</span><span style={th2}>Beginning</span><span style={th2}>Activity</span><span style={th2}>Ending</span></div>
                            {rr.length ? rr.map((d, ix) => <div key={ix} style={{ display: 'grid', gridTemplateColumns: GR, gap: 6, padding: '1px 0', borderBottom: '1px solid #F3F5F8' }}><span>{d.br || '—'}</span><span>{d.cpc}</span><span>{r.account}</span><span>{d.sub}</span><span style={{ color: '#6B778C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={nm(r.account)}>{nm(r.account)}</span><span style={c2(d.b)}>{nf0(d.b)}</span><span style={c2(d.p)}>{nf0(d.p)}</span><span style={c2(d.e)}>{nf0(d.e)}</span></div>) : <div style={{ color: '#6B778C', padding: '6px 0' }}>ไม่มีแถวที่ผ่านการคัด</div>}
                            <div style={{ display: 'grid', gridTemplateColumns: GR, gap: 6, padding: '4px 0 0', borderTop: '1px solid #E4E9F0', marginTop: 3, fontWeight: 700 }}><span>รวม</span><span>{rr.length} แถว</span><span /><span /><span /><span style={c2(last.s.b)}>{nf0(last.s.b)}</span><span style={c2(last.s.p)}>{nf0(last.s.p)}</span><span style={c2(last.s.e)}>{nf0(last.s.e)}</span></div></div>); })()}
                      {(String(r.cpc).toUpperCase() === 'BBBBB' && r.cpc_mode !== 'exclude' && dd.cpcs && dd.cpcs.length > 0) && (() => { const GC = '24px 1fr 60px 108px 108px 108px'; const picked = dd.cpcs.filter(c => cs[k + '|' + c.cpc]).map(c => c.cpc); const tot = dd.cpcs.filter(c => cs[k + '|' + c.cpc]).reduce((a, c) => ({ b: a.b + c.b, p: a.p + c.p, e: a.e + c.e }), { b: 0, p: 0, e: 0 });
                        return (<div style={{ marginTop: 12, borderTop: '1px solid #E4E9F0', paddingTop: 8 }}>
                          <div style={{ fontWeight: 700 }}>แยกตาม CPC <span style={{ fontWeight: 400, color: '#6B778C' }}>— Config นี้เป็น BBBBB (ทุก CPC) ติ๊ก CPC ที่ต้องการบันทึกเป็น Config</span></div>
                          <div style={{ display: 'grid', gridTemplateColumns: GC, gap: 6, padding: '3px 0', borderBottom: '1px solid #E4E9F0' }}><span><input type="checkbox" checked={picked.length === dd.cpcs.length} onChange={e => setCs(m0 => { const t0 = { ...m0 }; dd.cpcs.forEach(c => { t0[k + '|' + c.cpc] = e.target.checked; }); return t0; })} title="เลือกทั้งหมด" /></span><span style={{ ...th2, textAlign: 'left' }}>CPC</span><span style={th2}>แถว</span><span style={th2}>Beginning</span><span style={th2}>Activity</span><span style={th2}>Ending</span></div>
                          {dd.cpcs.map(c => <div key={c.cpc} style={{ display: 'grid', gridTemplateColumns: GC, gap: 6, padding: '1px 0', background: cs[k + '|' + c.cpc] ? '#EAF3FF' : undefined }}><span><input type="checkbox" checked={!!cs[k + '|' + c.cpc]} onChange={e => setCs(m0 => ({ ...m0, [k + '|' + c.cpc]: e.target.checked }))} /></span><span style={{ fontWeight: 600 }}>{c.cpc}</span><span style={c2(0)}>{c.n}</span><span style={c2(c.b)}>{nf0(c.b)}</span><span style={c2(c.p)}>{nf0(c.p)}</span><span style={c2(c.e)}>{nf0(c.e)}</span></div>)}
                          {picked.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: GC, gap: 6, padding: '3px 0 0', borderTop: '1px solid #E4E9F0', marginTop: 3, fontWeight: 700 }}><span /><span>เลือก {picked.length} CPC</span><span /><span style={c2(tot.b)}>{nf0(tot.b)}</span><span style={c2(tot.p)}>{nf0(tot.p)}</span><span style={c2(tot.e)}>{nf0(tot.e)}</span></div>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}><span style={{ fontSize: 11.5, color: '#6B778C' }}>บันทึกแล้วจะ<b>แทนแถว BBBBB เดิม</b>ด้วย CPC ที่เลือก (CPC ที่ไม่ติ๊กจะไม่ถูกนำเข้า) · Sub Acc คงเดิม ({r.sub_acc})</span><span style={{ marginLeft: 'auto' }} /><button type="button" disabled={!picked.length || !!csBusy} onClick={async () => { setCsBusy(k); setErr(''); try { await pk.split(r, picked); setRules((await pk.reload()).filter(x => pk.inFile.includes(x.account) || manAcc.includes(x.account))); setCs({}); closeDr(); } catch (e) { setErr('บันทึก Config ไม่สำเร็จ: ' + e.message); } setCsBusy(''); }} style={{ border: 'none', background: picked.length ? '#1a3a5c' : '#B9C4D2', color: '#fff', borderRadius: 6, height: 30, padding: '0 16px', fontWeight: 600, cursor: picked.length ? 'pointer' : 'default' }}>{csBusy === k ? '…' : `💾 บันทึก ${picked.length || ''} CPC เป็น Config`}</button></div>
                          {err && <div style={{ color: '#B42318', fontSize: 12, marginTop: 6 }}>{err}</div>}
                        </div>); })()}
                      </div></div>); })()}</React.Fragment>); }) : <div style={{ padding: 14, color: '#6B778C', textAlign: 'center' }}>{rules.length ? 'ไม่พบที่ค้นหา' : '—'}</div>}</div>
                </div>
                <div style={pane}>
                  <div style={ph('#FFF6E5', '#B54708')}><span>ยังไม่มี Config</span><span style={badge('#FDE6BE', '#B54708')}>{lists.none.length} Account</span>{vis.length > 1 && <button type="button" disabled={!!busy} onClick={() => add(vis)} style={{ ...bt, marginLeft: 'auto', height: 26 }}>{busy === '*' ? '…' : `+ Add ${ql ? 'ที่ค้นหา' : 'ทั้งหมด'} (${vis.length})`}</button>}</div>
                  <div style={{ ...colh, gridTemplateColumns: GRIDR }}><span style={{ textAlign: 'center' }}>CPC</span><span /><span style={{ textAlign: 'center' }}>Account</span><span /><span style={{ textAlign: 'center' }}>Sub Acc</span><span style={{ paddingLeft: 6 }}>ชื่อบัญชี</span><span style={{ textAlign: 'right' }}>Beginning</span><span style={{ textAlign: 'right' }}>Activity</span><span style={{ textAlign: 'right' }}>Ending</span><span /></div>
                  <div className="doa-noscroll" style={lst}>{vis.length ? vis.map(c => <div className="doa-row" key={c} style={{ ...rowS, gridTemplateColumns: GRIDR }}>
                    <input value={(ed[c] || {}).cpc ?? 'BBBBB'} onChange={e => setEd(m => ({ ...m, [c]: { ...(m[c] || {}), cpc: e.target.value } }))} title="CPC (BBBBB = ทุก CPC)" style={fld} /><span style={dash}>-</span>
                    <b style={{ textAlign: 'center' }}>{c}</b><span style={dash}>-</span>
                    <input value={(ed[c] || {}).sub ?? 'BBBBBB'} onChange={e => setEd(m => ({ ...m, [c]: { ...(m[c] || {}), sub: e.target.value } }))} title="Sub Acc (BBBBBB = ทุก Sub Acc)" style={fld} />
                    <span style={nameS} title={nm(c)}>{nm(c)}</span>
                    {['b', 'p', 'e'].map(f => { const sv = (pk.sums || {})[c]; const v = sv ? sv[f] : null; return <span key={f} style={{ textAlign: 'right', fontSize: 12, color: v != null && v < 0 ? '#C0392B' : '#344054', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{v == null ? '' : nf0(v)}</span>; })}
                    <button type="button" disabled={!!busy} onClick={() => add([c])} title="Add → เข้า Config ของคุณ" aria-label="Add" style={{ ...bt, justifySelf: 'center', width: 28, height: 26, padding: 0, fontSize: 15, lineHeight: '20px' }}>{busy === c ? '…' : '＋'}</button>
                  </div>) : <div style={{ padding: 14, color: '#6B778C', textAlign: 'center' }}>{lists.none.length ? 'ไม่พบที่ค้นหา' : 'ผูกครบทุก Account แล้ว'}</div>}</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#6B778C', marginTop: 8 }}>ค่าเริ่มต้น BBBBB-Account-BBBBBB (BBBBB = ทุก CPC · BBBBBB = ทุก Sub Acc) · แก้ CPC / Sub Acc ได้ทั้งสองฝั่ง: ขวากด + Add → เข้า Config ของคุณ (BU {pk.bu}) · ซ้ายกด 💾 Save · กรอบแดง = Exclude</div>{err && <div style={{ color: '#B42318', fontSize: 12.5, marginTop: 4 }}>{err}</div>}
            </>); })()}
          {(n.lines || []).map((t, i) => (<div key={'l' + i} style={{ padding: '5px 0', fontSize: 13, color: '#344054' }}>{t}</div>))}
        </div>
        <div style={{ padding: '8px 20px 12px', textAlign: 'right', position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #EEF2F7', zIndex: 5 }}>{/* MARKER_GL_DOA_FOOTER_STICKY_V1 */}{n.action && <button type="button" onClick={() => n.action.run()} style={{ border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', borderRadius: 6, height: 32, padding: '0 16px', cursor: 'pointer', fontWeight: 600, marginRight: 8 }}>{n.action.label}</button>}{n.save ? <React.Fragment><button type="button" onClick={closeNo} style={{ border: '1px solid #B9C4D2', background: '#fff', color: '#344054', borderRadius: 6, height: 32, padding: '0 18px', cursor: 'pointer', marginRight: 8 }}>ไม่บันทึก</button><button type="button" autoFocus onClick={() => n.save.run()} style={{ border: 'none', background: '#1F6B4A', color: '#fff', borderRadius: 6, height: 32, padding: '0 22px', cursor: 'pointer', fontWeight: 600 }}>ยืนยัน {n.save.label}</button></React.Fragment> : <button type="button" autoFocus onClick={onClose} style={{ border: 'none', background: '#1a3a5c', color: '#fff', borderRadius: 6, height: 32, padding: '0 22px', cursor: 'pointer', fontWeight: 600 }}>ตกลง</button>}</div>
      </div>
    </div>
  );
}
// MARKER_GL_DOA_TB_PREVIEW_FORMAT_V1 -- Preview TB ในรูปแบบ "DETAIL OF ACCOUNT": หัวรายงาน (Company/Branch/Account code/Account name/Period) + ตาราง Branch,CPC,Account,SubAcc,Description,Beginning,Period Activity,Ending + แถว Total
function DoaTbSheet({ matrix: matrix0, code, only }) {
  const matrix = React.useMemo(() => { // TB แบบคีย์รวม -> แตกเป็น Branch / CPC / Account / SubAcc / Description / Beginning / Activity / Ending
    const kc = segKeyCol(matrix0); if (kc < 0) return matrix0;
    const a = matrix0.findIndex(r => (r || []).some(c => /^account$/i.test(String(c || '').trim()))); const hd = matrix0[a] || [];
    const jd = hd.findIndex(c => /^desc/i.test(String(c || ''))); const jb = hd.findIndex(c => /^begin/i.test(String(c || ''))), jp = hd.findIndex(c => /^period\s*act/i.test(String(c || ''))), je = hd.findIndex(c => /^ending/i.test(String(c || '')));
    const o = matrix0.slice(0, Math.max(a, 0)).map(r => r);
    o.push(['Branch', 'CPC', 'Account', 'SubAcc', 'Description', 'Beginning Balance', 'Period Activity', 'Ending Balance']);
    matrix0.slice(a + 1).forEach(r => { const k = parseSegKey((r || [])[kc]); if (k) o.push([k.branch, k.cpc, k.account, k.sub, jd >= 0 ? r[jd] : '', jb >= 0 ? r[jb] : '', jp >= 0 ? r[jp] : '', je >= 0 ? r[je] : '']); });
    return o;
  }, [matrix0]);
  const hdr = (() => { for (let i = 0; i < Math.min(matrix.length, 30); i++) { const r = matrix[i] || []; if (r.some(c => /^branch$/i.test(String(c || '').trim())) && r.some(c => /ending\s*balance/i.test(String(c || '')))) return i; } return -1; })();
  const h = hdr >= 0 ? (matrix[hdr] || []).map(c => String(c || '').trim()) : [];
  const ix = (re, d) => { const j = h.findIndex(c => re.test(c)); return j >= 0 ? j : d; };
  const C = { br: ix(/^branch$/i, 0), cpc: ix(/^cpc$/i, 1), ac: ix(/^account$/i, 2), sub: ix(/^sub\s*acc/i, 3), ds: ix(/^description/i, 4), bg: ix(/^beginn?n?ing/i, 5), pa: ix(/^period\s*activity/i, 6), en: ix(/^ending/i, 7) };
  const g = (r, j) => String((r || [])[j] == null ? '' : r[j]).trim();
  const body = hdr < 0 ? [] : matrix.slice(hdr + 1).filter(r => g(r, C.ac) && !/^total/i.test(g(r, 0)));
  const rows = (only && code) ? body.filter(r => g(r, C.ac) === String(code)) : body;
  const nv = (v) => { const t = String(v == null ? '' : v).trim(); if (!t || t === '-') return 0; const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const x = Number(t.replace(/[(),\s-]/g, '')); return isFinite(x) ? (neg ? -Math.abs(x) : x) : 0; };
  const fmt = (x) => { if (!x) return '-'; const t = Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return x < 0 ? `(${t})` : t; };
  const th = parseTbHeader(matrix0) || {};
  const brs = rows.map(r => g(r, C.br)).filter(Boolean).sort();
  const comName = String(th.company || '').replace(/^\s*\d+\s*/, '').trim(); const comCode = th.comCode || (brs[0] || '').slice(0, 4);
  const per = (() => { const m = /^(\d{4})\.(\d{2})$/.exec(th.period || ''); if (!m) return ''; const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)); return `${String(d.getUTCDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`; })();
  const accShown = (only && code) ? String(code) : (rows.length ? g(rows[0], C.ac) : '');
  const accName = rows.length ? g(rows.find(r => g(r, C.ac) === accShown) || rows[0], C.ds) : '';
  const tot = rows.reduce((a, r) => ({ b: a.b + nv(r[C.bg]), p: a.p + nv(r[C.pa]), e: a.e + nv(r[C.en]) }), { b: 0, p: 0, e: 0 });
  const FONT = 'Calibri, "Segoe UI", Tahoma, sans-serif'; const td = { padding: '1px 6px', whiteSpace: 'nowrap', fontSize: 15, borderBottom: '1px dotted #000', verticalAlign: 'top', color: '#000' };
  const lab = { padding: '1px 6px', fontSize: 15, whiteSpace: 'nowrap', color: '#000' };
  if (hdr < 0) return <div style={{ padding: 24, color: '#B42318' }}>ไม่พบหัวตาราง TB (Branch … Ending Balance) ในข้อมูลที่โยน</div>;
  return (
    <table style={{ borderCollapse: 'collapse', fontFamily: FONT, minWidth: 1100 }}>
      <colgroup><col style={{ width: 110 }} /><col style={{ width: 80 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 230 }} /><col style={{ width: 160 }} /><col style={{ width: 150 }} /><col style={{ width: 150 }} /></colgroup>
      <tbody>
        <tr><td colSpan={8} style={lab}>DETAIL OF ACCOUNT</td></tr>
        <tr><td colSpan={8} style={{ height: 18 }} />
        </tr>
        {[['Company', `${comCode}${comName ? ' ' + comName : ''}`], ['Branch', `${brs.length ? brs[0] + (brs.length > 1 ? '-' + brs[brs.length - 1] : '') : ''}${comName ? ' ' + comName : ''}`], ['Account code', accShown], ['Account name', accName], ['Period', per]].map(([k, v]) => (
          <tr key={k}><td style={lab}>{k}</td><td colSpan={7} style={lab}>{v}</td></tr>))}
        <tr><td colSpan={8} style={{ height: 22 }} /></tr>
        <tr>{['Branch', 'CPC', 'Account', 'SubAcc', 'Description', 'Beginnging Balance', 'Period Activity', 'Ending Balance'].map(t => <td key={t} style={{ background: '#002060', color: '#fff', fontWeight: 600, textAlign: 'center', padding: '3px 6px', fontSize: 14, border: '1px solid #000' }}>{t}</td>)}</tr>
        {rows.map((r, i) => (<tr key={i}>
          <td style={td}>{g(r, C.br)}</td><td style={td}>{g(r, C.cpc)}</td><td style={td}>{g(r, C.ac)}</td><td style={td}>{g(r, C.sub)}</td><td style={td}>{g(r, C.ds)}</td>
          {[C.bg, C.pa, C.en].map(j => <td key={j} style={{ ...td, textAlign: 'right', color: nv(r[j]) < 0 ? '#C00000' : '#000' }}>{fmt(nv(r[j]))}</td>)}</tr>))}
        <tr style={{ background: '#DDEBF7', fontWeight: 700 }}>
          <td style={{ ...td, fontSize: 16, borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>Total</td><td style={{ ...td, borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>&gt;</td><td colSpan={3} style={{ ...td, borderTop: '1px solid #000', borderBottom: '1px solid #000' }} />
          {[tot.b, tot.p, tot.e].map((x, k) => <td key={k} style={{ ...td, textAlign: 'right', color: x < 0 ? '#C00000' : '#000', fontSize: 16, borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>{fmt(x)}</td>)}</tr>
        {!rows.length ? <tr><td colSpan={8} style={{ padding: 10, color: '#B42318', fontSize: 13 }}>ไม่มีแถวของ Account นี้ใน TB</td></tr> : null}
      </tbody>
    </table>
  );
}
// MARKER_GL_DOA_DETAIL_PREVIEW_V1 -- Preview Detail ในรูปแบบ "DETAIL OF ACCOUNT" เหมือนไฟล์ Download (หัวรายงาน + หัวตารางกรมท่า + ยอดติดลบสีแดง)
function detWithTotals(body) { /* MARKER_GL_DOA_BRANCH_TOTAL_V1 -- แทรกแถว '<Branch> Total' ท้ายแต่ละสาขา + Grand Total */
  const out = []; let sub = 0; let all = 0; const r2 = (x) => Math.round(x * 100) / 100;
  body.forEach((r, i) => { const v = typeof r[11] === 'number' ? r[11] : 0; sub += v; all += v; out.push({ r, i });
    const nx = body[i + 1]; if (!nx || String(nx[0]) !== String(r[0])) { out.push({ tot: `${r[0]} Total`, v: r2(sub), br: String(r[0]) }); sub = 0; } });
  if (body.length) out.push({ tot: 'Grand Total', v: r2(all), grand: true });
  return out;
}
function DoaDetSheet({ matrix, code, only, ctx, sel, onTog, onAll, totals, stat, incKeys, q, curPeriod }) { /* MARKER_GL_DOA_PREVIEW_SELECT_CLEAR_V1 -- มีช่องติ๊กเลือกแถว (ใช้ Stamp Clear จาก Preview Detail) */
  const [lv, setLv] = React.useState(3); const [cl, setCl] = React.useState(() => new Set()); const [flt, setFlt] = React.useState({}); const [fo, setFo] = React.useState(-1); /* MARKER_GL_DOA_PREVIEW_OUTLINE_V1 -- ปุ่มระดับ 1/2/3 และยุบ/ขยายต่อสาขาแบบ Excel Subtotal */
  const built = React.useMemo(() => buildDetailDoa(matrix, (only && code) ? code : '', ctx), [matrix, code, only, ctx]);
  const m = built.matrix; const top = m.slice(0, 8); const head = m[8] || DET_HEAD; const body = m.slice(9);
  const FONT = 'Calibri, "Segoe UI", Tahoma, sans-serif'; const lab = { padding: '1px 6px', fontSize: 14, whiteSpace: 'nowrap', color: '#000' };
  const td = { padding: '1px 6px', whiteSpace: 'nowrap', fontSize: 13, border: '1px solid #D9DEE6', verticalAlign: 'top', color: '#000' }; /* MARKER_GL_DOA_DETAIL_GRIDLINES_V1 -- เส้นตารางครบทุกช่องแบบไฟล์ตัวอย่าง */
  const pYM0 = (() => { const pm = /^(\d{4})\.(\d{2})$/.exec(curPeriod || ''); return pm ? Number(pm[1]) * 100 + Number(pm[2]) : 0; })();
  const pst = React.useMemo(() => (incKeys && !stat) ? body.map(r => { const o = (detailRows([DET_HEAD, r]) || [])[0]; return o && (incKeys.has(detKey(o)) || (pYM0 && txnYM(o) > 0 && txnYM(o) < pYM0)) ? 'Include' : 'Pending'; }) : null, [body, incKeys, stat, pYM0]); /* MARKER_GL_DOA_STATUS_INCLUDE_BY_DATE_V1 -- Include = อยู่ใน DB หรือ Transaction Date < งวดปัจจุบัน */ const stX = stat || pst; /* MARKER_GL_DOA_PREVIEW_STATUS_COL_V1 -- Preview Detail: คอลัมน์ Status Include (น้ำเงิน) / Pending (ส้ม) */
  const fmtD = (d) => (d instanceof Date ? `${String(d.getUTCDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}` : String(d == null ? '' : d));
  const fmtN = (x) => { if (x == null || x === '') return ''; const t = Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return x < 0 ? `(${t})` : t; };
  const LIM = 3000; const objs = React.useMemo(() => (sel ? detailRows(matrix).filter(o => !((only && code) ? code : '') || String(o.account_code) === String((only && code) ? code : '')) : []), [matrix, code, only, sel]); const okeys = objs.map(detKey); const allOn = !!sel && okeys.length > 0 && okeys.every(k => sel.has(k));
  const cellTxt = (r, j) => (j === 6 ? fmtD(r[j]) : (j === 11 ? fmtN(r[j]) : String(r[j] == null ? '' : r[j])));
  const qm = React.useMemo(() => { /* MARKER_GL_DOA_MODEEDIT_SEARCH_V1 -- Search ใน Mode Edit */
    const t = String(q || '').toLowerCase().replace(/,/g, '').split(/\s+/).filter(Boolean); if (!t.length || !sel) return null; const set = new Set();
    objs.forEach((o, i) => { const d = detDate(o.txn_date); const hay = [Object.values(o).join(' '), d ? fmtD(d) : '', Number(o.amount || 0).toFixed(2), stX ? stX[i] : ''].join(' ').toLowerCase().replace(/,/g, ''); if (t.every(x => hay.includes(x))) set.add(i); });
    return set; }, [q, objs, sel, stX]); // eslint-disable-line react-hooks/exhaustive-deps
  const visKeys = qm ? okeys.filter((k, i) => qm.has(i)) : okeys; const allVis = !!sel && visKeys.length > 0 && visKeys.every(k => sel.has(k));
  const fb = totals ? body.filter(r => Object.keys(flt).every(j => !flt[j] || !flt[j].has(cellTxt(r, Number(j))))) : body; /* MARKER_GL_DOA_EXCEL_TOOLS_V1 -- Gutter 1/2/3 + ⊟/⊞ + ตัวกรองหัวคอลัมน์แบบ Excel */
  const G = totals ? <td style={{ width: 34, minWidth: 34, background: '#F3F6FA', borderRight: '1px solid #C9D3E0' }} /> : null;
  const filtVals = (j) => { const st = new Set(); body.forEach(r => st.add(cellTxt(r, j))); return [...st].sort().slice(0, 300); };
  if (!detailCols(matrix)) return <div style={{ padding: 24, color: '#B42318' }}>ไม่พบหัวตาราง Detail (Branch Code … Journal name) ในข้อมูลที่โยน</div>;
  return (
    <table style={{ borderCollapse: 'collapse', fontFamily: FONT, minWidth: 1500 }}>
      <tbody>
        {!sel && (<>{/* MARKER_GL_DOA_EDIT_NO_REPORT_HEAD_V1 -- Mode Edit ไม่แสดงหัวรายงาน (Company/Branch/Account/Period) เหลือเฉพาะตาราง */}
        <tr>{G}<td colSpan={14} style={{ ...lab, fontWeight: 700 }}>DETAIL OF ACCOUNT</td></tr>
        <tr>{G}<td colSpan={14} style={{ height: 14 }} /></tr>
        {top.slice(2, 7).map((r, i) => (<tr key={i}>{G}<td style={lab}>{r[0]}</td><td colSpan={13} style={lab}>{r[1]}</td></tr>))}
        <tr>{G}<td colSpan={14} style={{ height: 14 }} /></tr></>)}
        <tr>{/* MARKER_GL_DOA_HEADER_GAP_V1 */}{totals && <td style={{ background: '#002060', border: '1px solid #000', textAlign: 'center', whiteSpace: 'nowrap', padding: '0 2px', position: 'sticky', top: 0, zIndex: 3, boxShadow: sel ? '0 2px 0 #002060' : undefined }}>{[1, 2, 3].map(n => <button key={n} type="button" onClick={() => { setLv(n); setCl(new Set()); }} style={{ width: 18, height: 18, fontSize: 11, lineHeight: '14px', padding: 0, margin: '0 1px', border: '1px solid #fff', background: lv === n ? '#fff' : '#002060', color: lv === n ? '#002060' : '#fff', cursor: 'pointer' }}>{n}</button>)}</td>}{sel && <td style={{ background: '#002060', border: '1px solid #000', textAlign: 'center', width: 26, minWidth: 26, maxWidth: 26, padding: 0, position: 'sticky', top: 0, zIndex: 3, boxShadow: sel ? '0 2px 0 #002060' : undefined }}><input type="checkbox" checked={allVis} onChange={() => onAll && onAll(visKeys, !allVis)} title="เลือกทั้งหมดในแท็บนี้" /></td>}{head.map((t, j) => (sel && (j === 1 || j === 4)) ? null : <td key={j} style={{ background: '#002060', color: '#fff', fontWeight: 700, textAlign: 'center', padding: sel ? '18px 6px' : '4px 6px', height: sel ? 52 : undefined, width: (sel && j === 10) ? 360 : undefined, maxWidth: (sel && j === 10) ? 360 : undefined, fontSize: sel ? 13 : 12, border: '1px solid #000', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3, boxShadow: sel ? '0 2px 0 #002060' : undefined }}>{/* MARKER_GL_DOA_MODEEDIT_HEAD_H_V1 */}{t}{totals && <span onClick={() => setFo(fo === j ? -1 : j)} title="ตัวกรอง" style={{ marginLeft: 6, cursor: 'pointer', background: '#fff', color: (flt[j] && flt[j].size) ? '#C00000' : '#333', borderRadius: 2, padding: '0 3px', fontSize: 10 }}>▾</span>}{totals && fo === j && (<div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: '#fff', color: '#000', border: '1px solid #888', boxShadow: '0 4px 12px rgba(0,0,0,.25)', padding: 6, minWidth: 200, maxHeight: 280, overflow: 'auto', textAlign: 'left', fontWeight: 400 }}><div style={{ marginBottom: 4 }}><button type="button" onClick={() => setFlt(p => ({ ...p, [j]: new Set() }))} style={{ fontSize: 11, marginRight: 6 }}>เลือกทั้งหมด</button><button type="button" onClick={() => setFo(-1)} style={{ fontSize: 11 }}>ปิด</button></div>{filtVals(j).map(v => (<label key={v} style={{ display: 'block', fontSize: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked={!(flt[j] && flt[j].has(v))} onChange={() => setFlt(p => { const n = new Set(p[j] || []); n.has(v) ? n.delete(v) : n.add(v); return { ...p, [j]: n }; })} /> {v || '(ว่าง)'}</label>))}</div>)}</td>)}{stX && <td style={{ background: '#002060', color: '#fff', fontWeight: 700, textAlign: 'center', padding: sel ? '18px 10px' : '4px 10px', height: sel ? 52 : undefined, fontSize: sel ? 13 : 12, border: '1px solid #000', position: 'sticky', top: 0, zIndex: 3, boxShadow: sel ? '0 2px 0 #002060' : undefined }}>Status</td>}</tr>
        {(totals ? detWithTotals(fb.slice(0, LIM)) : (qm ? body.map((r, i) => ({ r, i })).filter(e => qm.has(e.i)) : body.map((r, i) => ({ r, i }))).slice(0, LIM)).map((e, ei) => (e.tot != null ? ((e.grand || lv >= 2) && <tr key={'t' + ei}>{totals && <td style={{ background: '#F3F6FA', borderRight: '1px solid #C9D3E0', textAlign: 'center', fontSize: 13 }}>{!e.grand && lv >= 3 && <span style={{ cursor: 'pointer', border: '1px solid #666', padding: '0 3px', background: '#fff', fontSize: 11 }} onClick={() => setCl(p => { const n = new Set(p); n.has(e.br) ? n.delete(e.br) : n.add(e.br); return n; })}>{cl.has(e.br) ? '+' : '−'}</span>}</td>}{sel && <td style={{ background: '#DAEEF3' }} />}{DET_KEYS.map((k, j) => (<td key={j} style={{ background: '#DAEEF3', fontWeight: 700, borderTop: '1px solid #333', borderBottom: '1px solid #333', borderLeft: '1px solid #D9DEE6', borderRight: '1px solid #D9DEE6', padding: '2px 6px', fontSize: 13, textAlign: j === 11 ? 'right' : 'left', color: (j === 11 && e.v < 0) ? '#C00000' : '#000', whiteSpace: 'nowrap' }}>{j === 0 ? e.tot : (j === 11 ? fmtN(e.v) : '')}</td>))}</tr>) : (lv < 3 || cl.has(String(e.r[0])) ? null : (() => { const r = e.r; const i = e.i; return (<tr key={i} style={sel && sel.has(okeys[i]) ? { background: '#FFF3C4' } : (stat && stat[i] === 'Match' ? { background: '#D9F2E3' } : (stat && stat[i] === 'Include' ? { background: '#E6EEF8' } : (stat && stat[i] === 'Unmatch' ? { background: '#FDE0E0' } : undefined)))}>{totals && <td style={{ background: '#F3F6FA', borderRight: '1px solid #C9D3E0' }} />}{sel && <td style={{ ...td, textAlign: 'center', width: 26, minWidth: 26, maxWidth: 26, padding: 0 }}><input type="checkbox" checked={sel.has(okeys[i])} onChange={() => onTog && onTog(okeys[i])} /></td>}{DET_KEYS.map((k, j) => ((sel && (j === 1 || j === 4)) ? null : j === 11
          ? <td key={j} style={{ ...td, textAlign: 'right', color: (r[j] != null && r[j] < 0) ? '#C00000' : '#000' }}>{fmtN(r[j])}</td>
          : <td key={j} title={(sel && j === 10) ? String(r[j] == null ? '' : r[j]) : undefined} style={{ ...td, textAlign: [0, 2, 3, 5, 6].includes(j) ? 'center' : 'left', ...((sel && j === 10) ? { width: 360, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' } : {}) }}>{/* MARKER_GL_DOA_MODEEDIT_DESC_TIP_V1 */}{j === 6 ? fmtD(r[j]) : String(r[j] == null ? '' : r[j])}</td>))}{stX && <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: stX[i] === 'Match' ? '#1F6B4A' : (stX[i] === 'Unmatch' ? '#B42318' : (stX[i] === 'Include' ? '#1a3a5c' : (stX[i] === 'Pending' ? '#B35C00' : '#6B778C'))), background: stX[i] === 'Include' ? '#E6EEF8' : (stX[i] === 'Pending' ? '#FFF4E8' : undefined) }}>{stX[i] || ''}</td>}</tr>); })())))}
        {body.length > LIM ? <tr><td colSpan={14} style={{ padding: 8, color: '#6B778C', fontSize: 12 }}>แสดง {LIM} จาก {body.length} แถว (Download เพื่อดูครบ)</td></tr> : null}
        {!body.length ? <tr><td colSpan={14} style={{ padding: 10, color: '#B42318', fontSize: 13 }}>ไม่มีแถวของ Account นี้ใน Detail</td></tr> : null}
      </tbody>
    </table>
  );
}
// MARKER_GL_DOA_PREVIEW_FILE_V1 -- คลิกขวาที่จุด TB / Detail / Simple → Preview ข้อมูลของไฟล์ แสดงหน้าตาเหมือนชีต Excel (MARKER_GL_DOA_PREVIEW_EXCEL_LOOK_V1: หัวคอลัมน์ A,B,C / เลขแถว / เส้นตาราง / แถบหัวสีฟ้า / แท็บชีตด้านล่าง)
function DoaPreviewModal({ kind, matrix, code, fileName, ctx, onClose, embed, onClear, incKeys, curPeriod }) { /* MARKER_GL_DOA_PREVIEW_EMBED_V1 -- embed = แสดงเฉพาะตาราง (ใช้ใน Reconcile Preview: Sheet Simple หน้าตาเดียวกับ Preview Simple ต้นฉบับ) */
  const [only, setOnly] = React.useState(!!code);
  const [cpcSel, setCpcSel] = React.useState(''); /* MARKER_GL_DOA_PREVIEW_DETAIL_BY_CPC_V1 -- Preview Detail แยกแท็บตาม CPC-Account (<CPC>-<Account>) */
  const detSplit = React.useMemo(() => { if (embed || kind !== 'Detail' || !detailCols(matrix)) return null; const rs = detailRows(matrix).filter(o => !code || String(o.account_code) === String(code)); const g = new Map(); rs.forEach(o => { const k = `${String(o.cost_center || '').trim() || '-'}-${o.account_code}`; if (!g.has(k)) g.set(k, []); g.get(k).push(o); }); const keys = [...g.keys()].sort(); return keys.length > 1 ? { keys, g } : null; }, [matrix, code, kind, embed]);
  const detCur = detSplit ? (detSplit.keys.includes(cpcSel) ? cpcSel : detSplit.keys[0]) : '';
  const [selK, setSelK] = React.useState(() => new Set()); const [q, setQ] = React.useState(''); const [clrBusy, setClrBusy] = React.useState(false); const [edit, setEdit] = React.useState(false); const canSel = !embed && kind === 'Detail' && !!onClear && edit; /* MARKER_GL_DOA_PREVIEW_EDITBTN_V1 -- Preview แสดงแบบเดิม ไม่มี Checkbox; กดปุ่ม Mode Edit ถึงเต็มจอ + Checkbox + Stamp Clear */
  const togK = (k) => setSelK(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allK = (ks, on) => setSelK(prev => { const n = new Set(prev); ks.forEach(k => { if (on) n.add(k); else n.delete(k); }); return n; });
  const doClear = async () => { if (!selK.size || !onClear) return; const byKey = new Map(detailRows(matrix).map(o => [detKey(o), o])); const items = [...selK].filter(k => byKey.has(k)).map(k => ({ key: k, row: byKey.get(k) })); if (!items.length) { setSelK(new Set()); return; } setClrBusy(true); try { const ok = await onClear(items); if (ok) setSelK(new Set()); } finally { setClrBusy(false); } };
  const [full, setFull] = React.useState(false); // เต็มจอ / ขนาดปกติ (ลากมุมล่างขวาเพื่อปรับขนาดเองได้)
  const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred|oracle\s*branch)/i;
  let hi = -1, ac = 0; for (let i = 0; i < Math.min(matrix.length, 30) && hi < 0; i++) { const j = (matrix[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
  const accRe = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let accCol = ac; if (hi >= 0) { const j = (matrix[hi] || []).findIndex(c => accRe.test(String(c || '').trim())); if (j >= 0) accCol = j; }
  const hdrRows = hi < 0 ? 0 : hi + 1; // แถวหัวคอลัมน์ (Simple จริงสูง 3 แถว — แสดงเป็นแถบเดียวสูงเท่ากัน)
  const rowsAll = matrix.map((r, i) => ({ r: r || [], n: i + 1, i }));
  const blankR = (r) => !r || r.every(c => String(c == null ? '' : c).trim() === '');
  let hbP = 0; if (kind === 'Simple' && hi >= 0) while (hbP < 10 && hdrRows + hbP < matrix.length && blankR(matrix[hdrRows + hbP])) hbP++; // MARKER_GL_DOA_PREVIEW_FINAL_V1 -- แถวว่างใต้หัวตาราง (นับตามไฟล์จริง) รวมเป็นส่วนหัวตารางสูงเท่ากับ Final
  const body = rowsAll.slice(hdrRows + hbP);
  // จัดกลุ่ม: แถวที่มี Account = แถวแม่ (A-K) / แถวที่ Account ว่าง = แถวลูกของแม่ก่อนหน้า (Simple แสดงเซลล์แม่แบบ Merge ข้ามแถวลูกเหมือนไฟล์จริง)
  const groups = []; body.forEach(x => { const lead = kind === 'Simple' ? String(x.r[0] == null ? '' : x.r[0]).trim() : ''; const isT = /^(total|gran[dt])/i.test(lead); const c = isT ? lead : String(x.r[accCol] == null ? '' : x.r[accCol]).trim(); if (c || !groups.length) groups.push({ code: c, rows: [x] }); else groups[groups.length - 1].rows.push(x); }); // แถว Total (ข้อความอยู่คอลัมน์ A) แยกเป็นกลุ่มของตัวเอง ไม่ถูก Merge A–K ทับ
  const gShown = (only && code && hi >= 0) ? groups.filter(g => g.code === String(code) || (/^total/i.test(g.code) && g.code.indexOf(String(code)) >= 0)) : groups;
  const bodyShown = gShown.flatMap(g => g.rows);
  const LIM = 5000; const shown = []; const spanOf = {}; const skipMerge = new Set(); let cnt = 0;
  for (const g of gShown) { if (cnt >= LIM) break; g.rows.forEach((x) => { shown.push(x); }); cnt += g.rows.length; } // MARKER_GL_DOA_PREVIEW_NOMERGE_V1 -- ไม่ Merge A–K ข้ามแถวลูก (ไฟล์ Download / Simple Final ค่า A–K อยู่แถวแรก แถวลูกว่าง)
  const w = Math.min(40, Math.max(...matrix.slice(0, 80).map(r => (r || []).length), 1));
  const letter = (n) => { let x = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; x = String.fromCharCode(65 + m) + x; n = Math.floor((n - 1) / 26); } return x; };
  const cell = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v == null ? '' : String(v)));
  const isNum = (v) => typeof v === 'number' || (/^-?[\d,]+\.\d{2}$/.test(String(v || '').trim()));
  const colW = (j) => { let m = 6; for (let k = 0; k < Math.min(matrix.length, 120); k++) { const t = cell((matrix[k] || [])[j]); if (k < hdrRows - 0 || k >= hdrRows) m = Math.max(m, Math.min(t.length, 34)); } return Math.max(64, Math.min(300, m * 7 + 16)); };
  const FW = [33.6, 9.6, 27.5, 7.2, 24.2, 11.8, 11.6, 18.3, 17.8, 10.2, 35.2, 19.9, 12.4, 12.7, 16.3, 14.8, 13.9, 10.7, 35.2, 33.7, 35.2, 12.8, 22.1];
  const widths = Array.from({ length: w }).map((_, j) => (kind === 'Simple' && FW[j]) ? Math.round(FW[j] * 7.2) : colW(j));
  const GRID = '#D4D4D4', FONT = 'Calibri, "Segoe UI", Tahoma, sans-serif';
  const gut = { background: '#E6E6E6', color: '#444', textAlign: 'center', border: `1px solid ${GRID}`, fontSize: 11, padding: '1px 6px', position: 'sticky', left: 0, zIndex: 2, minWidth: 34 };
  const tabName = kind === 'Simple' ? `Outstanding Simple ${(only && code) ? code : (code || '')}`.trim() : (kind === 'TB' ? 'TB of Account' : kind);
  const preRow = (x) => { // แถวก่อนหัวคอลัมน์ (ชื่อรายงาน / Parameters / BU Code)
    const t0 = cell(x.r[0]); const title = x.i === 0; const bucode = /^BU Code:\s*\S+/.test(t0) && x.i > 0 && x.i >= hdrRows - 3;
    return (<tr key={'p' + x.i}><td style={gut}>{x.n}</td>{Array.from({ length: w }).map((_, j) => { if (title && kind === 'Simple' && j >= 1 && j <= 6) return null; const t = cell(x.r[j]); const lab = /:\s*\*?$/.test(t.trim()) || /^Parameters$/i.test(t.trim());
      return <td key={j} style={{ border: `1px solid #EEE`, padding: '1px 6px', whiteSpace: 'nowrap', fontSize: title ? 20 : (bucode && j === 0 ? 15 : 12), fontWeight: (title || lab || bucode) ? 700 : 400, height: title ? 30 : 20, color: '#000', textAlign: (title && kind === 'Simple') ? 'center' : 'left', overflow: 'visible' }} colSpan={(title && kind === 'Simple') ? 7 : undefined}>{t}</td>; })}</tr>); };
  const pageMode = !embed && kind === 'Detail' && edit; /* MARKER_GL_DOA_PREVIEW_EDIT_PAGE_V1 -- Preview Detail = Mode Edit แบบหน้าเต็ม (Dashboard Full Page) เครื่องมือ Reconcile จะเพิ่มทีหลัง */
  React.useEffect(() => { /* MARKER_GL_DOA_PREVIEW_FULLSCREEN_V1 -- เข้า Full Screen ของเบราว์เซอร์ตอนเปิด Mode Edit / ออกเมื่อปิด (ถ้าเบราว์เซอร์ไม่ให้ ยังเป็นหน้าเต็มในแท็บ) */
    if (!pageMode) return undefined;
    try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) { const pr = el.requestFullscreen(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) { /* ignore */ }
    return () => { try { if (document.fullscreenElement && document.exitFullscreen) { const pr = document.exitFullscreen(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) { /* ignore */ } };
  }, [pageMode]);
  React.useEffect(() => { /* MARKER_GL_DOA_MODEEDIT_ESC_BACK_V1 -- Esc ใน Mode Edit => กลับ Preview */
    if (!pageMode) return undefined; let wasFs = !!document.fullscreenElement;
    const back = () => { setEdit(false); setSelK(new Set()); setQ(''); };
    const onKey = (e) => { if (e.key === 'Escape') back(); };
    const onFs = () => { if (document.fullscreenElement) wasFs = true; else if (wasFs) back(); };
    document.addEventListener('keydown', onKey); document.addEventListener('fullscreenchange', onFs);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, [pageMode]);
  return (
    <div onClick={embed ? undefined : onClose} style={embed ? { height: '100%' } : { position: 'fixed', inset: 0, background: pageMode ? '#fff' : 'rgba(15,30,50,.45)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={embed ? { background: '#fff', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : pageMode ? { background: '#fff', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { background: '#fff', borderRadius: 10, width: full ? '99vw' : 'min(1500px, 96vw)', height: full ? '98vh' : '90vh', maxWidth: '99vw', maxHeight: '98vh', minWidth: 520, minHeight: 320, resize: 'both', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        {!embed && <div style={{ padding: '10px 16px', borderBottom: '1px solid #D5DEEA', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <b style={{ color: '#1a3a5c' }}>{pageMode ? '✎ Mode Edit · Preview Detail' : `👁 Preview ${kind}`}</b><span style={{ fontSize: 12, color: '#6B778C' }}>{fileName || ''}</span>
          {/* MARKER_GL_DOA_PREVIEW_NO_ONLY_CHK_V1 -- เอาช่องติ๊ก 'เฉพาะ Account' ออก: ดูเป็น Account อยู่แล้ว */}
          <span style={{ fontSize: 12, color: '#6B778C' }}>{gShown.length} รายการ · {bodyShown.length} แถว{shown.length < bodyShown.length ? ` (แสดง ${shown.length} แถวแรก)` : ''} · เฉพาะแถวที่คัดตาม Config</span>
          {canSel && <button type="button" disabled={!selK.size || clrBusy} onClick={doClear} title="ประทับ Clear แถวที่เลือก — ตัดออกจากรายงาน" style={{ marginLeft: 'auto', border: '1px solid #B54708', background: selK.size ? '#B54708' : '#fff', color: selK.size ? '#fff' : '#B54708', borderRadius: 6, height: 28, padding: '0 12px', cursor: selK.size ? 'pointer' : 'default', fontWeight: 700 }}>{clrBusy ? 'กำลังบันทึก…' : `Stamp Clear (${selK.size})`}</button>}
          {!embed && kind === 'Detail' && !!onClear && <button type="button" onClick={() => { setEdit(v => !v); setSelK(new Set()); }} title={edit ? 'กลับไปหน้า Preview ปกติ' : 'เข้า Mode Edit (เต็มจอ + เลือกแถวเพื่อ Stamp Clear)'} style={{ marginLeft: edit ? 8 : 'auto', border: '1px solid #1a3a5c', background: edit ? '#fff' : '#1a3a5c', color: edit ? '#1a3a5c' : '#fff', borderRadius: 6, height: 28, padding: '0 12px', cursor: 'pointer' }}>{edit ? '↩ กลับ Preview' : '✎ Mode Edit'}</button>}
          {!pageMode && <button type="button" onClick={() => setFull(v => !v)} title="ขยาย/ย่อ (ลากมุมล่างขวาเพื่อปรับขนาดเองได้)" style={{ marginLeft: (!embed && kind === 'Detail' && !!onClear) ? 8 : 'auto', border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 28, padding: '0 12px', cursor: 'pointer' }}>{full ? '🗗 ย่อ' : '⛶ ขยายเต็มจอ'}</button>}
          <button type="button" onClick={onClose} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 28, padding: '0 12px', cursor: 'pointer' }}>ปิด</button>
        </div>}
        {pageMode && <div id="doa-edit-tools" style={{ flex: '0 0 auto', height: 220, minHeight: 220, boxSizing: 'border-box', padding: '10px 16px', background: '#F7F9FC', borderBottom: '1px solid #D5DEEA', overflow: 'auto' }}>{/* MARKER_GL_DOA_MODEEDIT_TOOLS_AREA_V1 -- พื้นที่เครื่องมือ (เผื่อสูง 10 แถว ~ 22px x 10) -- ใส่ปุ่ม/ตัวกรอง/Restatus ในนี้ภายหลัง */}<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหา Journal / Description / Invoice / Vendor / Amount / วันที่ / Status …" style={{ width: 460, height: 32, border: '1px solid #B9C4D2', borderRadius: 6, padding: '0 10px', fontSize: 13 }} />{q ? <button type="button" onClick={() => setQ('')} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 32, padding: '0 12px', cursor: 'pointer' }}>ล้าง</button> : null}</div><div style={{ fontSize: 12, color: '#8A94A6', marginTop: 8 }}>เครื่องมือ (พื้นที่เผื่อไว้)</div></div>}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', fontFamily: FONT }}>
          {!matrix.length ? <div style={{ padding: 24, color: '#6B778C' }}>ยังไม่มีข้อมูล {kind} — โยนไฟล์ก่อน</div> : kind === 'TB' ? <DoaTbSheet matrix={matrix} code={code} only={only} /> : (kind === 'Detail' && detailCols(matrix)) ? <DoaDetSheet matrix={detSplit ? detailMatrixFromRows(detSplit.g.get(detCur)) : matrix} code={detSplit ? String((detSplit.g.get(detCur)[0] || {}).account_code || '') : code} only={detSplit ? true : only} ctx={ctx} totals={!!embed} sel={canSel ? selK : undefined} onTog={togK} onAll={allK} incKeys={embed ? undefined : incKeys} q={pageMode ? q : ''} curPeriod={curPeriod} /> : (
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
              <thead>
                <tr><th style={{ ...gut, top: 0, zIndex: 4, position: 'sticky' }} />{Array.from({ length: w }).map((_, j) => <th key={j} style={{ background: '#E6E6E6', color: '#444', fontWeight: 400, fontSize: 11, border: `1px solid ${GRID}`, position: 'sticky', top: 0, zIndex: 3, minWidth: widths[j], width: widths[j] }}>{letter(j)}</th>)}</tr>
              </thead>
              <tbody>
                {rowsAll.slice(0, Math.max(0, hdrRows - 1)).map(x => preRow(x))}
                {hdrRows > 0 ? (() => { const x = rowsAll[hdrRows - 1]; return (<tr key="hdr"><td style={{ ...gut, verticalAlign: 'top' }}>{x.n}</td>{Array.from({ length: w }).map((_, j) => <td key={j} style={{ background: (kind === 'Simple' && j >= 12 && j <= 17) ? '#F8CBAD' : '#B4C6E7', fontWeight: 700, border: '1px solid #000', padding: '2px 6px', height: 20 * (1 + hbP), verticalAlign: 'top', whiteSpace: 'nowrap', color: '#000', position: 'sticky', top: 20, zIndex: 1, fontSize: 12 }}>{cell(x.r[j])}</td>)}</tr>); })() : null}
                {shown.map((x, ix) => (<tr key={x.i}><td style={gut}>{hdrRows + hbP + 1 + ix}</td>{Array.from({ length: w }).map((_, j) => { const v = x.r[j]; const num = isNum(v); if (j <= 10 && skipMerge.has(x.i)) return null; const rs = (j <= 10 && spanOf[x.i]) ? spanOf[x.i] : undefined; const isTot = /^total/i.test(cell(x.r[0])); const nxr = (shown[ix + 1] || {}).r; const lastOfGrp = !nxr || String(nxr[accCol] == null ? '' : nxr[accCol]).trim() !== '' || /^(total|gran[dt])/i.test(cell(nxr[0])); return <td key={j} rowSpan={rs} style={{ fontWeight: isTot ? 700 : undefined, borderLeft: '1px solid #000', borderRight: j === w - 1 ? '1px solid #000' : 'none', borderBottom: (kind === 'Simple' && j <= 10 && !isTot && !lastOfGrp) ? 'none' : '1px solid #000', background: isTot ? '#D9D9D9' : '#fff', padding: '1px 6px', whiteSpace: 'nowrap', textAlign: num ? 'right' : 'left', verticalAlign: 'top', height: 24, minHeight: 24, color: (num && Number(String(v).replace(/,/g, '')) < 0) ? '#C00000' : '#000' }} title={cell(v)}>{typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : cell(v)}</td>; })}</tr>))}
                {!shown.length ? <tr><td style={gut} /><td colSpan={w} style={{ padding: 10, color: '#B42318', fontSize: 12 }}>ไม่มีแถวของ Account นี้ในไฟล์</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
        {!embed && <div style={{ background: '#F3F3F3', borderTop: '1px solid #C6C6C6', display: 'flex', alignItems: 'flex-end', height: 30, padding: '0 8px', gap: 2 }}>
          {detSplit ? detSplit.keys.map(k => (<button key={k} type="button" onClick={() => setCpcSel(k)} style={{ background: k === detCur ? '#fff' : 'transparent', color: k === detCur ? '#217346' : '#444', fontWeight: k === detCur ? 700 : 500, fontSize: 13, padding: '4px 16px', border: 'none', borderBottom: k === detCur ? '3px solid #217346' : '3px solid transparent', borderLeft: '1px solid #C6C6C6', borderRight: '1px solid #C6C6C6', cursor: 'pointer' }}>{k}</button>)) : <span style={{ background: '#fff', color: '#217346', fontWeight: 700, fontSize: 13, padding: '4px 16px', borderBottom: '3px solid #217346', borderLeft: '1px solid #C6C6C6', borderRight: '1px solid #C6C6C6' }}>{tabName || kind}</span>}
        </div>}
      </div>
    </div>
  );
}
function DoaBackupModal({ bu, onLoad, onClose }) {
  const [items, setItems] = React.useState([]);
  const [months, setMonths] = React.useState(null);
  const [msg, setMsg] = React.useState('');
  const load = React.useCallback(async () => {
    try { const j = await listDoaBackups(bu); setItems(j.items || []); setMonths(j.retention_months); setMsg(''); } catch (e) { setMsg('โหลดรายการไม่ได้: ' + e.message); }
  }, [bu]);
  React.useEffect(() => { load(); }, [load]);
  const fmt = (d) => { try { return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 100%)', maxHeight: '80vh', background: '#fff', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: C.navy }}>โหลดข้อมูลเก่าจาก Backup — BU {bu}</h3>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: C.mute }}>×</button>
        </div>
        {months && <div style={{ fontSize: 12, color: C.mute }}>Backup เก็บไว้ {months} เดือนนับจากวันที่บันทึก แล้วลบอัตโนมัติ</div>}
        {msg && <div style={{ fontSize: 12, color: '#B42318' }}>{msg}</div>}
        <div style={{ flex: 1, minHeight: 100, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={{ ...th, textAlign: 'left' }}>งวด</th><th style={th}>แถว</th><th style={{ ...th, textAlign: 'left' }}>บันทึกโดย</th><th style={th}>หมดอายุ</th><th style={{ ...th, width: 120 }}></th></tr></thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#8a96a6' }}>ยังไม่มี Backup ของ BU นี้ (หรือหมดอายุแล้ว)</td></tr>}
              {items.map(it => (
                <tr key={it.id} style={{ borderTop: '1px solid #EAEFF5' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 600, color: C.navy }}>{it.period}{(it.kind === 'Simple' || it.kind === 'Detail') ? <span style={{ marginLeft: 6, fontSize: 11, color: '#B54708', fontWeight: 600 }}>{it.kind}</span> : null}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>{it.row_count}</td>
                  <td style={{ padding: '7px 10px', color: C.mute }}>{it.created_by}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', color: C.mute }}>{fmt(it.expires_at)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button type="button" style={{ ...btn(true), height: 28, fontSize: 12 }} onClick={async () => { try { const d = await getDoaBackup(it.id); onLoad(d); onClose(); } catch (e) { setMsg(e.message); } }}>โหลด</button>
                    <button type="button" title="ลบ Backup" onClick={async () => { if (await askDoa(`ลบ Backup งวด ${it.period} ?`)) { try { await removeDoaBackup(it.id); await load(); } catch (e) { setMsg(e.message); } } }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15 }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// BU ที่ไม่ใช่ TB ของ GL (เป็น TB ของระบบอื่น) -- ไม่แสดงในรายการ BU ของหน้านี้ (Backend ปฏิเสธด้วย)
const NON_GL_BUS = new Set(['11610752','11610755','11610751','11630052','11630055','11630051','21930054','21930052','21930084','21930085']);

// MARKER_GL_MODULE_CHIP_V1 -- Module แสดงเป็นชิป คลิกเพื่อแก้ (Enter/ออกจากช่อง = บันทึก)
function ModuleChip({ value, onChange, onSave }) {
  const [edit, setEdit] = React.useState(false);
  if (edit) {
    return <input autoFocus value={value || ''} placeholder="ระบุ Module" onChange={e => onChange(e.target.value)}
      onBlur={() => { setEdit(false); onSave(); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ ...unsetBox, flexGrow: 0, width: 200, height: 28, border: '1px solid #1a3a5c', background: '#fff', fontWeight: 600 }} />;
  }
  return <button type="button" onClick={() => setEdit(true)} title="คลิกเพื่อแก้ Module"
    style={{ border: 'none', borderRadius: 14, padding: '3px 14px', background: value ? '#1a3a5c' : '#fff', color: value ? '#fff' : '#8a96a6', outline: value ? 'none' : '1px dashed #9AA6B8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{value || 'ยังไม่ได้ตั้งค่า'}</button>;
}
// MARKER_GL_SIGNOFF_UNSET_STATE_V1 -- ยังไม่ได้ตั้งค่าข้อมูลผู้ลงนาม: คีย์ชื่อ/ตำแหน่งตรงนี้ได้เลย แล้วกด "บันทึกเข้า Profile"
// (บันทึกผ่าน saveSignoffProfile ตัวเดียวกับหน้า System Console > Profile -- ใช้ที่เก็บเดียวกัน ไม่มี Schema ใหม่)
const unsetBox = { flexGrow: 1, minWidth: 0, height: 28, boxSizing: 'border-box', border: '1px dashed #9AA6B8', borderRadius: 6, padding: '0 10px', fontSize: 13, color: '#1B2A3D', background: '#fff', outline: 'none', fontFamily: 'inherit' };
const SIGNOFF_KEYS = ['my_name', 'my_job', 'report_to_name', 'report_to_job', 'module']; // MARKER_GL_SETUP_GATE_V1 -- ตั้งค่าไม่ครบ (ชื่อ Prepare/Review + Module) ให้อยู่หน้า Setup ก่อน
function SignoffUnset({ sp, onSaved, onCancel }) {
  const [d, setD] = React.useState(() => Object.fromEntries(SIGNOFF_KEYS.map(k => [k, sp?.[k] || ''])));
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');
  const dirty = SIGNOFF_KEYS.some(k => String(d[k] || '').trim());
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true); setErr('');
    try {
      const clean = Object.fromEntries(SIGNOFF_KEYS.map(k => [k, String(d[k] || '').trim()]));
      await saveSignoffProfile(clean);
      onSaved(clean);
    } catch (e) {
      setErr('บันทึกไม่สำเร็จ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };
  const field = (k) => (
    <input value={d[k]} placeholder="ยังไม่ได้ตั้งค่า" onChange={e => setD(x => ({ ...x, [k]: e.target.value }))}
      onKeyDown={e => { if (e.key === 'Enter') save(); }}
      style={{ ...unsetBox, ...(String(d[k]).trim() ? { border: '1px solid #B9C4D2', background: '#DCEBF5' } : {}) }} />
  );
  return (
    <>
      {[['Prepare by', 'ผู้จัดทำ', 'my'], ['Review by', 'ผู้สอบทาน', 'report_to']].map(([title, sub, pre], i) => (
        <div key={title} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 26 }}>
            <b style={{ fontSize: 14, color: C.navy }}>{title}</b>
            <span style={{ fontSize: 12, color: C.mute }}>{sub}</span>
            {i === 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{/* MARKER_GL_SIGNOFF_CANCEL_BESIDE_SAVE_V1 -- ปุ่มยกเลิกอยู่ข้างปุ่มบันทึก */}
                {onCancel && <button type="button" onClick={onCancel} style={{ height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid #c8d3e3', background: '#fff', color: C.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>ยกเลิก</button>}
                <button type="button" onClick={save} disabled={!dirty || saving} title="บันทึกข้อมูลผู้ลงนามเข้า Profile (ใช้ที่เก็บเดียวกับ System Console > Profile)"
                  style={{ height: 26, padding: '0 10px', borderRadius: 6, border: 'none', background: (!dirty || saving) ? '#9AA6B8' : C.navy, color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!dirty || saving) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>{saving ? 'กำลังบันทึก…' : 'บันทึกเข้า Profile'}</button>
              </div>
            )}
          </div>
          {[['ชื่อ', pre + '_name'], ['ตำแหน่ง', pre + '_job']].map(([f, k]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 52, flexShrink: 0, fontSize: 12, color: C.mute }}>{f}</span>
              {field(k)}
            </div>
          ))}
        </div>
      ))}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 14, color: C.navy, width: 62, flexShrink: 0 }}>Module</b>
        {field('module')}
      </div>
      {err && <div style={{ fontSize: 12, color: '#B42318' }}>{err}</div>}
    </>
  );
}

// MARKER_GL_DOA_STATUS_DOT_V1 -- จุดสถานะ: เทา = ยังไม่มีข้อมูล, เขียว = มีข้อมูล, แดง = ไม่พบ
const StatusDot = ({ kind, title }) => <span title={title} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: kind === 'ok' ? '#2E9E6B' : kind === 'miss' ? '#D64545' : '#C9D1DC' }} />;

export default function DetailOfAccount() {
  const { fetchCollection } = useDataCache();
  const { currentUser, userRole } = useAuth();
  const [bu, setBu] = React.useState('');
  const [buOptions, setBuOptions] = React.useState([]);
  const [users, setUsers] = React.useState([]);
  const [mods, setMods] = React.useState({});
  const [mine, setMine] = React.useState(null); // Config ของ User ที่ล็อกอิน [{bu, account}] | null = ยังโหลดไม่ได้
  const [showCfg, setShowCfg] = React.useState(false); const [showAdm, setShowAdm] = React.useState(false); const isAdm = userRole === 'Owner' || userRole === 'Admin'; /* MARKER_GL_DOA_ADMIN_OP_BTN_V1 -- ปุ่ม Admin Operation ข้าง Config (Owner/Admin เท่านั้น) */
  const [tbMode, setTbMode] = React.useState('file');
  const [detAcc, setDetAcc] = React.useState(() => new Set());
  const [simAcc, setSimAcc] = React.useState(() => new Set());
  const [myRules, setMyRules] = React.useState([]); // แถว Config ของ User (BU/CPC/Sub/mode) ใช้คัดไฟล์ที่โยนเข้า
  const [rev, setRev] = React.useState(0); const restoredRef = React.useRef(false);
  const rawRef = React.useRef({}); // ไฟล์ดิบล่าสุดของแต่ละชนิด เพื่อคัดใหม่เมื่อเปลี่ยน BU / Config
  const [pasteText, setPasteText] = React.useState('');
  const [tbAcc, setTbAcc] = React.useState([]);
  const [tbMsg, setTbMsg] = React.useState(''); const [tbMsgFull, setTbMsgFull] = React.useState(''); // MARKER_GL_DOA_SHORT_STATUS_V1 -- แถบสถานะสั้น (รายละเอียดเต็มอยู่ใน tooltip)
  const [drag, setDrag] = React.useState(false);
  const [accQ, setAccQ] = React.useState('');
  const [notice, setNotice] = React.useState(null);
  const [prevw, setPrevw] = React.useState(null); const [recAcc, setRecAcc] = React.useState(null); const [rcSend, setRcSend] = React.useState(null); const [detMatrix, setDetMatrix] = React.useState([]);
  const [simMatrix, setSimMatrix] = React.useState([]); const [simName, setSimName] = React.useState(''); // MARKER_GL_DOA_SIMPLE_BACKUP_V1 -- Outstanding Simple ที่ Reform แล้ว: Backup ไปพร้อม TB เก็บ 1 เดือน
  const [tbMatrix, setTbMatrix] = React.useState([]); // MARKER_GL_DOA_TB_BACKUP_FE_V1 -- TB ที่อ่านล่าสุด (ใช้ตอนกด Backup)
  const [tbName, setTbName] = React.useState('');
  const [period, setPeriod] = React.useState('');
  const [showBk, setShowBk] = React.useState(false);
  const [bkMsg, setBkMsg] = React.useState('');
  const periodOptions = React.useMemo(() => { const out = []; const d = new Date(); for (let i = 0; i < 3; i++) { // MARKER_GL_DOA_PERIOD_3M_V1 -- เก็บ Backup แค่ 3 เดือน จึงให้เลือกแค่ 3 งวดล่าสุด
 out.push(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); } return out; }, []);
  const tbHead = React.useMemo(() => parseTbHeader(tbMatrix), [tbMatrix]); // Header ผูกกับ tbMatrix → ล้าง TB / ลบ Backup แล้วหายพร้อมกัน
  const [lastBk, setLastBk] = React.useState(null); // MARKER_GL_DOA_BACKUP_FILE_COL_V1
  const loadLastBk = React.useCallback(() => {
    if (!bu) { setLastBk(null); return; }
    listDoaBackups(bu).then(j => { const it = (j.items || []).filter(x => (x.kind || 'TB') === 'TB'); const pick = (period ? it.filter(x => x.period === period) : it).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.period).localeCompare(String(a.period)))[0]; setLastBk(pick || null); }).catch(() => setLastBk(null));
  }, [bu, period]);
  // MARKER_GL_DOA_BACKUP_CONNECT_V1 -- ช่อง Backup แยก Filename / Status: เริ่มต้น "ไม่ Connect" แล้วกด Connect เพื่อดึงรายการไฟล์ → Default = ไฟล์ของ M-1 (ถ้ามี) + Dropdown เลือกไฟล์อื่นได้
  /* MARKER_GL_DOA_BACKUP_CONNECT_PER_ACC_V1 -- Connect เป็นราย Account: สถานะ/ไฟล์ที่เลือกแยกกันทุกแถว (รายการไฟล์ดึงครั้งเดียวต่อ BU แล้วใช้ร่วมกัน) */
  const [bkSplit, setBkSplit] = React.useState(null); const [dropPop, setDropPop] = React.useState(false); const [dropOver, setDropOver] = React.useState(false); /* MARKER_GL_DOA_CONNECT_EMPTY_POPUP_V1 -- Connect แล้วไม่มีไฟล์ Backup เลย = เปิด Popup ให้โยนไฟล์ */
  const [bkAcc, setBkAcc] = React.useState({}); // { [code]: { conn: 'off'|'busy'|'on', sel: '' } }
  const [bkFiles, setBkFiles] = React.useState([]);
  const bkLoaded = React.useRef(null);
  const [mkPer, setMkPer] = React.useState(''); const [mkBusy, setMkBusy] = React.useState(false); /* MARKER_GL_DOA_MAKE_BACKUP_POPUP_V1 -- Popup สร้าง Backup Detail: เลือกงวดของไฟล์ (ค่าเริ่มต้น M-1) แล้วโยนไฟล์ = บันทึกเป็น Backup ของงวดนั้น (ไม่ใช่ข้อมูลงวดปัจจุบัน) */
  const [bkHaveMap, setBkHaveMap] = React.useState({}); const [bkKeyMap, setBkKeyMap] = React.useState({}); /* MARKER_GL_DOA_FILENAME_INSIDE_V1 -- เก็บ detKey ของแถวที่อยู่ในไฟล์ Backup จริง เพื่อเช็คข้างในไฟล์ (ไม่ใช่แค่มีไฟล์/มี Account) */ const bkDefFor = (it, code) => { const hv = bkHaveMap[String(code)]; return (hv && it.find(x => String(x.id) === String(hv.id))) || it.find(x => x.period === prevPeriod && String(x.account) === String(code)) || it.find(x => x.period === prevPeriod && !x.account) || null; }; /* MARKER_GL_DOA_INCLUDE_BELOW_PERIOD_V1 */ const bkIcon = (on) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto' }} aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />{!on && <line x1="3" y1="3" x2="21" y2="21" />}</svg>); /* MARKER_GL_DOA_CONNECT_ICON_V1 */ /* MARKER_GL_DOA_BELOW_ROWS_CONNECT_V1 */
  const belowByAcc = React.useMemo(() => { const m = new Map(); try { splitByPeriod(detailRows(detMatrix), period).below.forEach(o => { const c = String(o.account_code); if (!m.has(c)) m.set(c, []); m.get(c).push(o); }); } catch (e) { /* ignore */ } return m; }, [detMatrix, period]);
  const [rstBusy, setRstBusy] = React.useState(''); /* MARKER_GL_DOA_RESTORE_INCLUDE_V1 -- Restore: เก็บ Data Include ของ Account (จาก DB doa_detail_clear) กลับเข้า Backup Detail อีกรอบ แบบรวมสะสม ไม่ทับของเดิม */
  const drvName = (acc) => { const comR = detailInfo(detMatrix, '').com; const spR = /^[0-9][0-9A-Za-z]{2,7}$/.test(String(comR || '')) ? String(comR) : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); return { spR, nmR: [comR, bu, 'Detail_backup', prevPeriod, acc].filter(Boolean).join('_') + '.xlsx' }; };
  const drvPull = async (acc) => { /* MARKER_GL_DOA_RESTORE_PULL_MERGE_SAVE_V1 -- Restore: ดึงไฟล์เดิมจาก Drive D (<COM>_<BU>_Detail_backup_<งวดก่อน>.xlsx) -> เพิ่มข้อมูล (union ไม่ลบแถวเดิม) -> Save กลับ Drive D + DB */
    const { spR, nmR } = drvName(acc); const { root, tk } = spApi(); if (!spR || !tk) return { st: 'err', rows: [] };
    try { const rq = spNewReq(); spLaunch(`fastapn-sp://list?dest=dod&path=&req=${rq}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`); const jl = await spPoll(`${root}/api/file-storage/sp-handler/local/result?req=${rq}`, tk, 15); if (!jl) return { st: 'nolist', rows: [] };
      const hit = (jl.items || []).find(x => !x.dir && String(x.name || String(x.path).split('/').pop()).toLowerCase() === nmR.toLowerCase()); if (!hit) return { st: 'absent', rows: [] };
      const rq2 = spNewReq(); spLaunch(`fastapn-sp://pull?dest=dod&path=${encodeURIComponent(hit.path)}&req=${rq2}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`); const j = await spPoll(`${root}/api/file-storage/sp-handler/local/pull-result?req=${rq2}`, tk, 30); if (!j || !j.b64) return { st: 'nopull', rows: [] };
      const bin = atob(j.b64); const u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); const mt = await fileToMatrix(new File([u8], nmR), 'Detail'); return { st: 'pulled', rows: detailRows(mt) };
    } catch (e) { return { st: 'err', rows: [] }; } };
  const sendDriveD = (matrix, st, acc) => { /* ส่งไฟล์ที่รวมแล้วกลับไป Save ที่ Drive D (ชื่อเดิม) — ทำเมื่อ list/pull ได้ผลชัดเจนเท่านั้น (ไม่ทับไฟล์ที่ยังไม่เห็น) */
    if (st !== 'pulled' && st !== 'absent') return ' · ไม่ได้ Save กลับ Drive D (' + (st === 'nolist' ? 'Handler ไม่ตอบ' : st === 'nopull' ? 'ดึงไฟล์เดิมไม่สำเร็จ' : 'ไม่พร้อม') + ' — กันไม่ให้ทับไฟล์เดิม)';
    try { const { spR, nmR } = drvName(acc); const wbR = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbR, XLSX.utils.aoa_to_sheet(matrix), 'Detail'); const urlR = URL.createObjectURL(new Blob([XLSX.write(wbR, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); setTimeout(() => { const dR = document.createElement('a'); dR.href = urlR; dR.download = nmR; dR.style.display = 'none'; document.body.appendChild(dR); dR.click(); dR.remove(); setTimeout(() => URL.revokeObjectURL(urlR), 4000); }, 300); setTimeout(() => { spLaunch(`fastapn-sp://backup?name=${encodeURIComponent(nmR)}&bu=${encodeURIComponent(spR)}&period=${encodeURIComponent(prevPeriod)}&dest=doh`); }, 1300); return ' · Save กลับ Drive D แล้ว: ' + nmR + (st === 'pulled' ? ' (ดึงไฟล์เดิมมารวม)' : ' (ไม่เคยมีไฟล์ — สร้างใหม่)'); } catch (eR) { return ' · Save กลับ Drive D ไม่สำเร็จ'; } };
  const restoreInc = async (code) => {
    if (rstBusy || !bu) return;
    /* MARKER_GL_DOA_RESTORE_WHOLEFILE_V1 -- Restore ดึงทั้งไฟล์: OK = เปิดรายการไฟล์ใน Drive D (ของ BU + Account นี้) เลือกไฟล์ต้นฉบับ แล้วรวมเข้า Backup เดิมแบบสะสม | Cancel = เก็บเฉพาะ Data Include จาก DB */
    /* MARKER_GL_DOA_RESTORE_FROM_DB_V1 -- Restore = สร้าง/เพิ่ม Backup จากข้อมูลใน DB เลย ไม่ต้องโยนไฟล์: Include ใน DB + แถวใน Detail งวดนี้ที่ Transaction Date ต่ำกว่างวด */
    setRstBusy(String(code)); setDbMsg('');
    try {
      const items = (await listDoaClearDetail(bu, String(code))).filter(x => x.status === 'Include' && x.row);
      const seenK = new Set(); const rows = []; [...items.map(x => x.row), ...(belowByAcc.get(String(code)) || [])].forEach(o => { const k = detKey(o); if (!seenK.has(k)) { seenK.add(k); rows.push(o); } });
      if (!rows.length) { setDbMsg(`ไม่มีข้อมูล Include / แถว Below ของ Account ${code} ใน DB ให้เก็บ`); return; }
      const drv = await drvPull(String(code)); /* MARKER_GL_DOA_RESTORE_NOPOPUP_V1 -- ไม่เด้ง Popup ระหว่างรอ (ปุ่มเป็น … อยู่แล้ว) เพื่อไม่ให้บังข้อความผลลัพธ์ */ { const cnt = new Map(); drv.rows.forEach(r => { const k = detKey(r); cnt.set(k, (cnt.get(k) || 0) + 1); }); const addR = []; rows.forEach(r => { const k = detKey(r); const v = cnt.get(k) || 0; if (v > 0) cnt.set(k, v - 1); else addR.push(r); }); rows.length = 0; drv.rows.forEach(r => rows.push(r)); addR.forEach(r => rows.push(r)); }
      const j = await listDoaBackups(bu); const ex = (j.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === prevPeriod && String(x.account) === String(code)) || (j.items || []).find(x => (x.kind || 'TB') === 'Detail' && x.period === prevPeriod && !x.account);
      /* MARKER_GL_DOA_RESTORE_GUARD_V1 -- ไม่เห็นไฟล์ Backup เดิมของงวดนี้ (อาจหมดอายุแล้วถูก Backend ซ่อน) = ถ้าเก็บต่อจะสร้างใหม่แล้วทับไฟล์เดิมที่ซ่อนอยู่ จึงถามก่อน ไม่เก็บเงียบๆ */
      if (!ex && !await askDoa(`⚠ ไม่เห็นไฟล์ Backup Detail เดิมของงวด ${prevPeriod} ใน DB\n\nอาจหมดอายุและถูก Backend ซ่อนไว้ — ถ้าเก็บต่อ ระบบจะสร้างไฟล์ใหม่จาก Data Include ${rows.length} แถวนี้ และ **ทับไฟล์เดิมที่ซ่อนอยู่**\n\nแนะนำ: ให้ Backend ขยายอายุไฟล์ Detail ก่อน (patch_doa_detail_expiry_v2.py) แล้วค่อยกด Restore\n\nเก็บต่อเลยหรือไม่?`)) { setDbMsg('ยกเลิก Restore — ไม่เห็น Backup เดิมของงวด ' + prevPeriod + ' (ให้ Backend ขยายอายุไฟล์ก่อน)'); return; }
      const mg = await prepBackupMerge(prevPeriod, detailMatrixFromRows(rows));
      if (!mg.changed) { let dm0 = ''; try { const d0 = ex ? await getDoaBackup(ex.id) : null; if (d0 && Array.isArray(d0.data)) dm0 = sendDriveD(detailMatrixFromRows(drv.rows.concat(detailRows(d0.data).filter(o => String(o.account_code) === String(code)))), drv.st, String(code)); } catch (e0) { dm0 = ' · Save กลับ Drive D ไม่สำเร็จ'; } setDbMsg(`✓ Account ${code}: Backup ${prevPeriod} มีข้อมูล Include ครบแล้ว (${rows.length} แถว) — ไม่ต้องเก็บเพิ่ม` + dm0); return; }
      if (!await askDoa(`เก็บ Data Include กลับเข้า Backup Detail?

BU ${bu} · Account ${code}
แถว Include ใน DB: ${rows.length} แถว
เก็บเข้า Backup งวด ${prevPeriod} (รวมกับของเดิม ไม่ทับ)`)) return;
      const fnm = bkAccName(prevPeriod, String(code)); const sv = await saveDetBk(prevPeriod, mg.matrix); const drvMsg = sendDriveD(mg.matrix, drv.st, String(code)); /* MARKER_GL_DOA_RESTORE_VERIFY_V1 -- แสดงชื่อไฟล์ที่เก็บทันที + เตือนถ้า Backend ตั้งวันหมดอายุเลยมาแล้ว (ไฟล์จะถูกซ่อน/ลบ) */
      const expd = sv && sv.expires_at ? new Date(sv.expires_at) : null; const expired = !!(expd && expd.getTime() < Date.now());
      const j2 = await listDoaBackups(bu); const it2 = (j2.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort(bkCmp); setBkFiles(it2); bkLoaded.current = bu;
      { const nf = it2.find(x => x.period === prevPeriod && String(x.account) === String(code)); /* MARKER_GL_DOA_RESTORE_KEEP_LABEL_V1 -- ไม่ตั้ง conn=on หลัง Restore (ทำให้ช่อง Filename เปลี่ยนเป็น Dropdown ไม่เหมือนแถวอื่น) — แสดงเป็นชื่อไฟล์ ✓ เหมือนเดิม */ if (!nf) setBkHaveMap(m0 => ({ ...m0, [String(code)]: { id: sv && sv.id, period: prevPeriod, name: fnm } })); } setBkTick(t => t + 1); setDbMsg(expired ? `⚠ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) ลง ${fnm} แล้ว แต่ Backend ตั้งวันหมดอายุเป็น ${expd.toLocaleDateString('th-TH')} (เลยมาแล้ว) — ไฟล์จะถูกซ่อน/ลบ ต้องแก้กฎอายุไฟล์ที่ Backend` : `✓ เก็บ Data Include ของ Account ${code} (${rows.length} แถว) เข้า ${fnm} (Backup ${prevPeriod}) แล้ว` + drvMsg);
    } catch (e) { setDbMsg('เก็บ Data Include ไม่สำเร็จ: ' + e.message); } finally { setRstBusy(''); }
  };
  const restoreBtn = (a) => { const n = incByAcc.get(String(a.code)) || 0; /* MARKER_GL_DOA_RESTORE_BTN_ALLROWS_V1 -- แสดงปุ่ม Restore ครบทุกแถว: ไม่มีข้อมูลให้เก็บ = Disable (สีจาง) */ if (!n) return (<button type="button" disabled title="Restore — ไม่มี Data Include ของ Account นี้" style={{ marginLeft: 6, border: '1px solid #D5DEEA', background: '#fff', color: '#C3CCD9', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', width: 26, height: 24, padding: 0, opacity: 0.6, cursor: 'not-allowed' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /><path d="M12 8v5l3 2" /></svg></button>); return (<button type="button" disabled={!!rstBusy} onClick={() => restoreInc(a.code)} title={`Restore — เก็บ Data Include ของ Account นี้จาก DB (Transaction Date ต่ำกว่างวด ${period}) เข้า Backup ${prevPeriod} แบบสะสม ไม่ต้องโยนไฟล์`} style={{ marginLeft: 6, border: '1px solid #B9D3F2', background: '#EEF5FF', color: '#1F5FBF', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', width: 26, height: 24, padding: 0, cursor: rstBusy ? 'wait' : 'pointer' }}>{rstBusy === String(a.code) ? '…' : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /><path d="M12 8v5l3 2" /></svg>)}</button>); };
  const isCn = (c) => (incByAcc.get(String(c)) || 0) > 0; /* MARKER_GL_DOA_CONNECT_ICON_POPUP_RECHECK_V1 -- ไอคอนเปลี่ยน = มี Include ใน DB */ /* MARKER_GL_DOA_CONNECT_AUTO_V1 */ /* MARKER_GL_DOA_CONNECT_ICON_STATE_V1 -- Connect แล้ว = conn on หรือ มี Include ใน DB (ยังไม่เคยกด Disconnect) → ไอคอนเป็นเชื่อมต่อ */
  const bkMiss = (c) => { const ks = bkKeyMap[String(c)]; const rows = belowByAcc.get(String(c)) || []; return rows.filter(o => !(ks && ks.has(detKey(o)))).length; }; const bkWarn = (c) => { const h = bkHaveMap[String(c)]; return !!(hasInc(c) && (!h || bkMiss(c) > 0)); }; const bkShow = (c) => { const h = bkHaveMap[String(c)]; const tot = (belowByAcc.get(String(c)) || []).length; const ms = bkMiss(c); const exp = `${bu}_Detail_backup_${prevPeriod}.xlsx`; if (h) return (ms > 0 ? '⚠ ' : '✓ ') + (h.name || bkLbl(c, h.period)) + (ms > 0 ? ` · ขาด ${ms}/${tot} แถว` : ''); return hasInc(c) ? `⚠ ไม่พบในไฟล์ · ${incCnt(c)} แถวใน DB` : '-'; }; /* MARKER_GL_DOA_FILENAME_SHORT_V1 -- ข้อความสั้น ไม่ล้นคอลัมน์ (ชื่อไฟล์ที่จะใช้เก็บอยู่ใน Tooltip) */ /* MARKER_GL_DOA_FILENAME_TWOWAY_V1 -- เช็ค 2 ทาง: พบไฟล์จริง = ชื่อไฟล์จริง, ไม่พบไฟล์แต่มีข้อมูล Include/Below ใน DB = ชื่อไฟล์ Backup ของงวดก่อน (จาก DB) */ /* MARKER_GL_DOA_BACKUP_LOOKUP_NAME_V1 -- Filename = ชื่อไฟล์ Backup จริงที่ Lookup พบข้อมูลของ Account นี้ใน DB (ไม่สร้างชื่อเอง) */
  const hasInc = (c) => (incByAcc.get(String(c)) || 0) > 0 || belowByAcc.has(String(c));
  const incCnt = (c) => Math.max(incByAcc.get(String(c)) || 0, (belowByAcc.get(String(c)) || []).length);
  const stampBelow = async (codes) => { /* Connect: แถว Below (Transaction Date < งวด) ที่ยังเป็น Pending => Include ใน DB */
    const rs = []; codes.forEach(c => (belowByAcc.get(String(c)) || []).forEach(o => { const k = detKey(o); if (!clrKeys.has(k) && !incKeys.has(k)) rs.push(o); })); if (!rs.length || !bu || !period) return 0;
    await saveDoaClear(bu, period, rs.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rs.forEach(o => nx.add(detKey(o))); return nx; }); setDbTick(t => t + 1); return rs.length; }; const bkLbl = (code, per) => { const p = String(per || '').split('.'); return `${bu}_${code}_${p[1] || ''}.${p[0] || ''}_Backup`; }; /* MARKER_GL_DOA_BACKUP_LABEL_V1 */ const [bkHave, setBkHave] = React.useState(null); const [bkTick, setBkTick] = React.useState(0); /* MARKER_GL_DOA_BACKUP_PRECHECK_V1 -- เช็คล่วงหน้าว่า Account ไหนมี Backup (ไฟล์ M-1 หรือล่าสุดก่อนงวดนี้) — ไม่มี = ขึ้น "ไม่พบไฟล์ Backup" ทันที ไม่ต้องรอกด Connect */
  React.useEffect(() => {
    setBkHave(null); if (!bu || !period) return undefined; let off = false;
    (async () => {
      try {
        const j = await listDoaBackups(bu); const it = (j.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period < period).sort(bkCmp);
        const files = bkPick(it, period);
        if (!files.length) { if (!off) { setBkHaveMap({}); setBkKeyMap({}); setBkHave(new Set()); } return; }
        const ds = await Promise.all(files.map(f => getDoaBackup(f.id).then(d => ({ f, d })).catch(() => null)));
        const mp = {}; const mk = {}; ds.forEach(r => { if (!r) return; detailRows(Array.isArray(r.d && r.d.data) ? r.d.data : []).forEach(o => { const c = String(o.account_code); if (!mp[c]) mp[c] = { id: r.f.id, period: r.f.period, name: r.f.file_name || '' }; if (!mk[c]) mk[c] = new Set(); mk[c].add(detKey(o)); }); });
        if (!off) { setBkHaveMap(mp); setBkKeyMap(mk); setBkHave(new Set(Object.keys(mp))); }
      } catch (e) { if (!off) setBkHave(null); }
    })();
    return () => { off = true; };
  }, [bu, period, bkTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [clrKeys, setClrKeys] = React.useState(() => new Set()); /* MARKER_GL_DOA_STAMP_CLEAR_V1 -- แถวที่ Stamp Clear แล้วของ BU นี้ */
  React.useEffect(() => { let off = false; setClrKeys(new Set()); if (!bu) return undefined; listDoaClear(bu).then(it => { if (!off) applyClr(it); }).catch(() => {}); return () => { off = true; }; }, [bu]);
  React.useEffect(() => { if (!clrKeys.size || !detMatrix || !detMatrix.length) return; const rows = detailRows(detMatrix); const keep = rows.filter(o => !clrKeys.has(detKey(o))); if (keep.length === rows.length) return; setDetMatrix(detailMatrixFromRows(keep)); }, [clrKeys, detMatrix]); // eslint-disable-line react-hooks/exhaustive-deps
  const insRef = React.useRef({}); /* MARKER_GL_DOA_BACKUP_INSERT_V1 -- Connect Backup แล้วแทรกแถวจาก Backup ที่ไม่พบใน Detail ลงใน Detail (Detail ไม่สะสม ยอดค้างยกมาอยู่ใน Backup) | Disconnect = เอาแถวที่แทรกออก */
  React.useEffect(() => { const offA = Object.keys(insRef.current).filter(c => (bkAcc[c] || {}).conn !== 'on'); if (!offA.length) return; const rm = new Set(); offA.forEach(c => { insRef.current[c].forEach(k => rm.add(k)); delete insRef.current[c]; }); setDetMatrix(prev => { const rows = detailRows(prev || []); const keep = rows.filter(o => !rm.has(detKey(o))); return keep.length === rows.length ? prev : detailMatrixFromRows(keep); }); }, [bkAcc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [incKeys, setIncKeys] = React.useState(() => new Set()); /* MARKER_GL_DOA_INCLUDE_STATUS_FE_V1 -- Include = แถวที่ดึงจาก Backup เข้ามา (ไม่ซ่อน) | Pending = Detail ปัจจุบัน | แสดงสีเฉพาะตอน Preview */
  const applyClr = (it) => { const l = it || []; setClrKeys(new Set(l.filter(x => x.status !== 'Include').map(x => x.row_key))); setIncKeys(new Set(l.filter(x => x.status === 'Include').map(x => x.row_key))); };
  const incByAcc = React.useMemo(() => { const m = new Map(); incKeys.forEach(k => { const c = String(k).split('|').pop(); m.set(c, (m.get(c) || 0) + 1); }); return m; }, [incKeys]); /* MARKER_GL_DOA_INCLUDE_FROM_DB_V1 -- จำนวนแถว Include ต่อ Account (จาก DB) */
  const clrByAcc = React.useMemo(() => { const m = new Map(); clrKeys.forEach(k => { const c = String(k).split('|').pop(); m.set(c, (m.get(c) || 0) + 1); }); return m; }, [clrKeys]); /* MARKER_GL_DOA_CLEAR_REVERSE_FE_V1 -- จำนวนแถวที่ Stamp Clear แล้วต่อ Account (คีย์แถวลงท้ายด้วย account_code) */
  const [rvsBusy, setRvsBusy] = React.useState('');
  const clrFilt = (h) => { const it = (h && h.items) || []; const q = String((h && h.q) || '').toLowerCase().replace(/,/g, '').split(/\s+/).filter(Boolean); if (!q.length) return it; return it.filter(x => { const r = x.row || {}; const hay = [x.status === 'Pending' || x.status === 'Cleared' ? 'clear' : x.status, r.branch_code, r.cost_center, r.txn_date, r.journal_name, r.invoice_no, r.description, r.amount, Number(r.amount || 0).toFixed(2), x.cleared_by, x.cleared_at ? new Date(x.cleared_at).toLocaleString('th-TH') : ''].map(v => String(v == null ? '' : v)).join(' ').toLowerCase().replace(/,/g, ''); return q.every(t => hay.includes(t)); }); }; /* MARKER_GL_DOA_CLRHIST_SEARCH_V1 */ const [clrHist, setClrHist] = React.useState(null); /* MARKER_GL_DOA_CLEAR_HISTORY_FE_V1 -- Popup ประวัติ Auto Clear / Clear ของ Account: ดูรายการแถว + RVS (ยกเลิก Clear) ที่เลือก/ทั้งหมด */
  const openClrHist = async (code) => {
    if (!bu) return; setClrHist({ code: String(code), loading: true, items: [], sel: new Set() });
    try { const it = (await listDoaClearDetail(bu, String(code))).filter(x => x.status !== 'Include'); setClrHist({ code: String(code), loading: false, items: it, sel: new Set() }); }
    catch (e) { setClrHist({ code: String(code), loading: false, items: [], sel: new Set(), err: e.message }); }
  };
  const reverseClearAcc = async (keys) => {
    const h = clrHist; if (!h || !bu) return; const bkSet0 = new Set(h.items.filter(x => x.status === 'Backup').map(x => x.row_key)); const ks = (keys && keys.length ? keys : h.items.map(x => x.row_key)).filter(k => !bkSet0.has(k)); if (!ks.length) { setDbMsg('แถวสถานะ Backup (Confirm แล้ว) RVS ไม่ได้ — กด Release ที่ Account นี้ก่อน'); return; }
    if (!await askDoa(`ยกเลิก Stamp Clear (RVS) ${ks.length} แถวของ Account ${h.code}?\n\nแถวจะกลับมาแสดงใน Detail และ Reconcile อีกครั้ง (ข้อมูล Backup ไม่ถูกลบ)`)) return;
    setRvsBusy(h.code);
    try {
      const r = await reverseDoaClear(bu, h.code, ks); const cl = await listDoaClear(bu); applyClr(cl);
      if (rawRef.current) delete rawRef.current.Detail; setDbTick(t => t + 1); setBkTick(t => t + 1);
      const it = (await listDoaClearDetail(bu, h.code)).filter(x => x.status !== 'Include'); setClrHist({ ...h, items: it, sel: new Set() });
      setDbMsg(`✓ ยกเลิก Stamp Clear ของ Account ${h.code} ${r && r.reversed != null ? r.reversed : ks.length} แถว — Detail โหลดใหม่จาก DB`);
    } catch (e) { setDbMsg('✗ ยกเลิก Stamp Clear ไม่สำเร็จ: ' + e.message); } finally { setRvsBusy(''); }
  };
  const stampClearRows = async (items) => { // eslint-disable-line no-unused-vars
    /* MARKER_GL_DOA_PREVIEW_SELECT_CLEAR_V1 -- ใช้ใน Mode Edit (Full Screen) ของ Preview Detail -- Stamp Clear แถวที่เลือกใน Preview Detail: ทุกคนที่ทำงานกดได้ / เก็บใน DB ร่วมกันทั้ง BU / คัดออกจากรายงาน */
    if (!bu || !/^\d{4}\.\d{2}$/.test(period || '')) { setNotice({ tone: 'err', title: 'Stamp Clear ไม่ได้', lines: ['เลือก BU และงวดก่อน'] }); return false; }
    if (!await askDoa(`Stamp Clear ${items.length} รายการที่เลือก?\n\nถือว่าทำเสร็จแล้ว — ตัดออกจากรายงาน และถ้าโยน Detail เดิมเข้ามาอีกจะไม่ถูกนับซ้ำ`)) return false;
    try { const r = await saveDoaClear(bu, period, items); setClrKeys(prev => { const nx = new Set(prev); items.forEach(it => nx.add(it.key)); return nx; }); setNotice({ tone: 'ok', title: `Stamp Clear แล้ว ${r.cleared} รายการ`, lines: r.skipped ? [`ข้าม ${r.skipped} รายการที่เคย Clear ไปแล้ว`] : [] }); return true; } catch (e) { setNotice({ tone: 'err', title: 'Stamp Clear ไม่สำเร็จ', lines: [e.message] }); return false; }
  };
  const bkChk = React.useRef({}); /* MARKER_GL_DOA_BACKUP_MISSING_CHECK_V1 -- Connect Backup แล้วเทียบกับ Detail งวดปัจจุบัน: รายการที่อยู่ใน Backup แต่ไม่พบใน Detail ล่าสุด = เด้งแจ้ง (ยึด Backup เป็นหลัก) */
  React.useEffect(() => {
    Object.keys(bkChk.current).forEach(c => { if ((bkAcc[c] || {}).conn !== 'on') delete bkChk.current[c]; });
    if (!detMatrix || !detMatrix.length) return undefined;
    const todo = Object.keys(bkAcc).filter(c => (bkAcc[c] || {}).conn === 'on' && (bkAcc[c] || {}).sel && bkChk.current[c] !== `${bkAcc[c].sel}` /* MARKER_GL_DOA_CONNECT_CHECK_ONCE_V1 */); /* MARKER_GL_DOA_RECHECK_V1 -- เช็คซ้ำเมื่อ Backup ถูกบันทึกใหม่ (bkTick) หรือมี Stamp Clear เพิ่ม */
    if (!todo.length) return undefined; let off = false;
    todo.forEach(c => { bkChk.current[c] = `${bkAcc[c].sel}` /* MARKER_GL_DOA_CONNECT_CHECK_ONCE_V1 */; });
    (async () => {
      try {
        const cur = detailRows(detMatrix); const kf = (o) => [o.branch_code, o.cost_center, o.sub_account, o.txn_date, o.journal_name, o.invoice_no, (Math.round(Number(o.amount || 0) * 100) / 100).toFixed(2)].map(x => String(x == null ? '' : x).trim()).join('|');
        const cache = {}; const miss = []; let tot = 0;
        for (const c of todo) {
          const id = bkAcc[c].sel; if (!cache[id]) { const d = await getDoaBackup(id); cache[id] = detailRows(Array.isArray(d && d.data) ? d.data : []); }
          const have = new Set(cur.filter(o => String(o.account_code) === String(c)).map(kf));
          cache[id].filter(o => String(o.account_code) === String(c)).forEach(o => { tot++; if (!have.has(kf(o)) && !clrKeys.has(detKey(o))) miss.push([c, o]); }); /* Backup อาจทำก่อนหรือหลังทำงานเสร็จ — เทียบทุกแถวใน Backup (รวมแถวที่ Transaction Date อยู่ในงวดปัจจุบัน = ทำไปแล้ว) */
        }
        if (off || !miss.length) return;
        setDetMatrix(prev => detailMatrixFromRows([...detailRows(prev || []), ...miss.map(x => x[1])])); miss.forEach(([c, o]) => { (insRef.current[c] = insRef.current[c] || new Set()).add(detKey(o)); });
        if (miss.some(x => !incKeys.has(detKey(x[1])))) /* MARKER_GL_DOA_INSERT_NOTICE_ONCE_V1 */ setNotice({ tone: 'warn', title: `แทรก ${miss.length} รายการจาก Backup ลงใน Detail ${period} (ไม่พบใน Detail)`, rows: [['Account', Array.from(new Set(miss.map(x => x[0]))).join(', ')], ['ใน Backup (Account ที่ Connect)', String(tot)], ['ไม่พบใน Detail ล่าสุด', String(miss.length)]], lines: miss.slice(0, 12).map(([c, o]) => `${c} · ${o.txn_date || ''} · ${o.invoice_no || o.description || ''} · ${Number(o.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`).concat(miss.length > 12 ? [`… และอีก ${miss.length - 12} รายการ`] : []) });
      } catch (e) { /* ไม่เด้งถ้าอ่าน Backup ไม่ได้ */ }
    })();
    return () => { off = true; };
  }, [bkAcc, detMatrix, bkTick, clrKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const bkComOf = () => String(detailInfo(detMatrix, '').com || ((buOptions.find(o => o.value === bu) || {}).com) || '').trim();
  const bkAccName = (per, acc) => [bkComOf(), bu, 'Detail_backup', per, acc].filter(Boolean).join('_') + '.xlsx';
  const bkExistRows = async (per, accs, noLegacy) => { /* แถวเดิมของ Account (ไฟล์ by Account + แถวของ Account นั้นในไฟล์รวมเดิม) */
    const j = await listDoaBackups(bu); const its = (j.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period === per && (x.account ? accs.has(String(x.account)) : !noLegacy));
    const ds = await Promise.all(its.map(it => getDoaBackup(it.id).then(d => ({ it, rows: detailRows(Array.isArray(d && d.data) ? d.data : []) })).catch(() => null)));
    const out = []; const legacy = []; ds.forEach(r => { if (!r) return; if (r.it.account) out.push(...r.rows.filter(o => accs.has(String(o.account_code)))); else legacy.push(...r.rows.filter(o => accs.has(String(o.account_code)))); });
    const cnt = new Map(); out.forEach(o => { const k = detKey(o); cnt.set(k, (cnt.get(k) || 0) + 1); }); legacy.forEach(o => { const k = detKey(o); const v = cnt.get(k) || 0; if (v > 0) cnt.set(k, v - 1); else out.push(o); });
    return { rows: out, any: its.length > 0 };
  };
  const saveDetBk = async (per, matrix) => { /* เก็บ 1 ไฟล์ต่อ Account */
    const jj = await listDoaBackups(bu); if (!jj || !jj.by_account) throw new Error('Backend ยังไม่ได้อัปเดต (patch_doa_backup_by_account_v1.py + Restart-Service) — ไม่บันทึก เพื่อกันทับไฟล์ทั้ง BU');
    const g = new Map(); detailRows(matrix).forEach(o => { const k = String(o.account_code); if (!g.has(k)) g.set(k, []); g.get(k).push(o); });
    const ents = [...g.entries()]; let last = null; for (let i = 0; i < ents.length; i += 5) { const rs = await Promise.all(ents.slice(i, i + 5).map(([k, v]) => saveDoaBackup(bu, per, bkAccName(per, k), detailMatrixFromRows(v), 'Detail', k))); last = rs[rs.length - 1]; } return last;
  };
  const prepBackupMerge = async (per, mat, noLegacy) => { /* ทีละ Account: รวมแถวเดิม + แถวใหม่ที่ยังไม่มี (ไม่ทับ/ไม่ลบ) — ผลลัพธ์มีเฉพาะ Account ในไฟล์ที่ส่งเข้ามา */
    const newRows = detailRows(mat); const nSig = detSigByAcc(newRows); const accs = new Set(Object.keys(nSig));
    const ex = await bkExistRows(per, accs, noLegacy);
    if (!ex.any) return { matrix: mat, rep: Object.keys(nSig).map(c => ({ c, st: 'ใหม่', n: nSig[c].n, o: 0 })), changed: true, merged: false };
    const oSig = detSigByAcc(ex.rows); const rep2 = []; let changed = false; const take = [];
    Object.keys(nSig).forEach(c => { const o = oSig[c], n = nSig[c]; if (!o) { rep2.push({ c, st: 'ใหม่', n: n.n, o: 0 }); take.push(...n.rows); changed = true; } else { const cnt = new Map(); o.rows.forEach(r => { const k = detKey(r); cnt.set(k, (cnt.get(k) || 0) + 1); }); const add = n.rows.filter(r => { const k = detKey(r); const v = cnt.get(k) || 0; if (v > 0) { cnt.set(k, v - 1); return false; } return true; }); if (!add.length) { rep2.push({ c, st: 'เท่าเดิม', n: o.n, o: o.n }); take.push(...o.rows); } else { rep2.push({ c, st: 'อัปเดต', n: o.n + add.length, o: o.n }); take.push(...o.rows, ...add); changed = true; } } });
    return { matrix: changed ? detailMatrixFromRows(take) : mat, rep: rep2, changed, merged: true };
  };
  const carryM1 = async (def, codes) => { /* MARKER_GL_DOA_CONNECT_CARRY_M1_V1 -- Connect แล้วมี Backup M-1: ดึงแถวของ Account นั้นเข้ามาเป็น Detail ของงวดปัจจุบันใน DB (คัดแถว Stamp Clear ออก, ไม่ทับ Account ที่งวดนี้มี Detail แล้ว, Backup M-1 เดิมไม่ถูกลบ/แก้) */
    if (!def || !bu || !period) return;
    try {
      /* MARKER_GL_DOA_CONNECT_PENDING_TO_INCLUDE_V1 -- Connect: แถวใน DB งวดปัจจุบันที่ตรงกับ Backup และยังเป็น Pending => Include */
      try {
        const cs = new Set(codes.map(String)); const dB = await getDoaBackup(def.id); const mB = Array.isArray(dB && dB.data) ? dB.data : [];
        const curK = new Set(detailRows(detMatrix).map(detKey));
        const rsP = detailRows(mB).filter(o => { if (!cs.has(String(o.account_code))) return false; const k = detKey(o); return curK.has(k) && !clrKeys.has(k) && !incKeys.has(k); });
        if (rsP.length) { await saveDoaClear(bu, period, rsP.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rsP.forEach(o => nx.add(detKey(o))); return nx; }); setDbTick(t => t + 1); /* MARKER_GL_DOA_RECHECK_SILENT_V1 */ }
      } catch (e7) { /* ไม่กระทบการ Connect */ }
      const need = new Set(codes.map(String).filter(c => !detAcc.has(c))); if (!need.size) return;
      const d = await getDoaBackup(def.id); const m = Array.isArray(d && d.data) ? d.data : [];
      const rows = detailRows(m).filter(o => need.has(String(o.account_code)) && !clrKeys.has(detKey(o))); if (!rows.length) return;
      /* MARKER_GL_DOA_CONNECT_NO_DB_WRITE_V1 -- ไม่เขียน Backup งวดปัจจุบันตอน Connect */
      try { const rowsN = rows.filter(o => !incKeys.has(detKey(o))); /* MARKER_GL_DOA_CARRY_SKIP_EXISTING_INCLUDE_V1 */ if (rowsN.length) { await saveDoaClear(bu, period, rowsN.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rowsN.forEach(o => nx.add(detKey(o))); return nx; }); } } catch (e8) { /* ไม่กระทบการดึง */ }
      setDbTick(t => t + 1); setDbMsg(`✓ ดึง Backup ${def.period} เข้าเป็น Detail งวด ${period} (${rows.length} แถว) — Backup ${def.period} ยังอยู่เหมือนเดิม`);
    } catch (e) { setDbMsg('✗ ดึง Backup เข้างวดปัจจุบันไม่สำเร็จ: ' + e.message); }
  };
  const bkRepNotice = (per, mg) => ({ tone: mg.changed ? 'ok' : 'warn', title: mg.changed ? `Backup Detail ${per}: บันทึกแล้ว` : `Backup Detail ${per}: ไม่มีการเปลี่ยนแปลง — ไม่รับไฟล์นี้`, rows: [['ใหม่', String(mg.rep.filter(x => x.st === 'ใหม่').length)], ['รวมเพิ่มแถวใหม่ (ไม่ทับของเดิม)', String(mg.rep.filter(x => x.st === 'อัปเดต').length)], ['เท่าเดิม (ไม่รับ)', String(mg.rep.filter(x => x.st === 'เท่าเดิม').length)]], lines: mg.rep.filter(x => x.st !== 'เท่าเดิม').slice(0, 14).map(x => `${x.c} · ${x.st} · ${x.o} → ${x.n} แถว`) });
  const sendBkAccFiles = async (per, matrix) => { /* MARKER_GL_DOA_MAKEBACKUP_SEND_BY_ACC_V1 -- ส่งไฟล์ Backup ต่อ Account ไป Drive D + SharePoint Z_Backup_DOH (ทีละไฟล์ เว้นระยะให้ Handler ย้ายไฟล์จาก Downloads ทัน) */
    const com = bkComOf(); const spB = /^[0-9][0-9A-Za-z]{2,7}$/.test(com) ? com : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); if (!spB) return 0;
    const g = new Map(); detailRows(matrix).forEach(o => { const k = String(o.account_code); if (!g.has(k)) g.set(k, []); g.get(k).push(o); });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms)); let n = 0;
    for (const [k, v] of g.entries()) {
      try {
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailMatrixFromRows(v)), 'Detail'); const nm = bkAccName(per, k);
        const url = URL.createObjectURL(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const d = document.createElement('a'); d.href = url; d.download = nm; d.style.display = 'none'; document.body.appendChild(d); d.click(); d.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        await sleep(1000); spLaunch(`fastapn-sp://backup?name=${encodeURIComponent(nm)}&bu=${encodeURIComponent(spB)}&period=${encodeURIComponent(per)}&dest=doh`); await sleep(2500); n++;
      } catch (e) { /* ข้ามไฟล์นี้ */ }
    }
    return n;
  };
  const makeBackup = async (f, perOv) => {
    if (!f) return; let per = perOv || mkPer || prevPeriod; /* MARKER_GL_DOA_DRIVE_D_LIST_V1 -- perOv = งวดจากชื่อไฟล์ที่เลือกจาก Drive D */
    if (!bu || !per) { setDbMsg('เลือก BU ก่อนสร้าง Backup'); return; }
    if (per === period) { setDbMsg('ไฟล์ Backup ต้องไม่ใช่งวดปัจจุบัน'); return; }
    setMkBusy(true);
    try {
      const mat = await fileToMatrix(f, 'Detail');
      const n = detailRows(mat).length;
      if (!n) { setDbMsg('✗ ไม่พบข้อมูล Detail ในไฟล์ ' + f.name); return; }
      const dp = detailInfo(mat, f.name).period; /* MARKER_GL_DOA_MAKE_BACKUP_FILE_PERIOD_V1 -- งวดที่อ่านได้จากไฟล์ (ชื่อไฟล์/วันที่รายการ) ต้องตรงกับงวดที่เลือก ไม่ตรง = ถามว่าจะเก็บเป็นงวดของไฟล์ */
      if (dp && dp !== per) { if (dp === period) { /* MARKER_GL_DOA_BACKUP_CURRENT_PERIOD_V1 -- โยน Backup งวดปัจจุบัน = ทำงานไปแล้ว: ยึดไฟล์ Backup เป็นหลัก แล้วเทียบกับ Detail ที่โหลดอยู่ (ค้าง/ไม่พบ) แทนการปฏิเสธ */
        const allR = detailRows(mat); const curMap = new Map(); let nDb = 0; let nScr = 0; /* MARKER_GL_DOA_BACKUP_CUR_FROM_DB_V1 -- Detail งวดปัจจุบันตัวจริง: ดึงจาก DB (Detail ของงวด dp ทุกไฟล์ที่มองเห็น) + ที่โหลดอยู่ในหน้า แล้วรวมกัน (ซ้ำคีย์เดียวกันนับครั้งเดียว) */
        try { const jj = await listDoaBackups(bu); const dbIt = (jj.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period === dp); for (const it0 of dbIt) { const d0 = await getDoaBackup(it0.id); detailRows(Array.isArray(d0 && d0.data) ? d0.data : []).forEach(o => { const k = detKey(o); if (!curMap.has(k)) { curMap.set(k, o); nDb++; } }); } } catch (e) { /* ใช้ที่โหลดอยู่ในหน้าแทน */ }
        if (detMatrix && detMatrix.length) detailRows(detMatrix).forEach(o => { const k = detKey(o); if (!curMap.has(k)) { curMap.set(k, o); nScr++; } });
        const curR0 = [...curMap.values()].filter(o => !clrKeys.has(detKey(o))); /* MARKER_GL_DOA_BACKUP_CUR_EXCL_CLEARED_V1 -- แถวที่ Stamp Clear แล้ว (Pending/Cleared) ไม่ต้องกลับมาเป็น Unmatch ซ้ำ */
        const sp = await new Promise(res => setBkSplit({ rows: allR, curRows: curR0, srcNote: `Detail ${dp}: จาก DB ${nDb} แถว + ที่โหลดอยู่ในหน้า ${nScr} แถว`, fileName: f.name, res })); setBkSplit(null); if (!sp) return;
        const out = [];
        if (sp.parts.below.length) { const prevP = prevPerOf(dp); const mg = await prepBackupMerge(prevP, detailMatrixFromRows(sp.parts.below), true); if (mg.changed) { const comN = (detailInfo(mat, f.name).com || ((buOptions.find(o => o.value === bu) || {}).com) || '').toString().trim(); const bkName = `${comN ? comN + '_' : ''}${bu}_Detail_backup_${prevP}.xlsx`; /* MARKER_GL_DOA_BACKUP_BELOW_NAME_V1 -- ชื่อไฟล์ Backup ของแท็บ Below = ของงวดก่อนหน้า (<COM>_<BU>_Detail_backup_<YYYY.MM>.xlsx) ไม่ใช้ชื่อไฟล์ต้นทางของเดือนปัจจุบัน */ await saveDetBk(prevP, mg.matrix); { const nS = await sendBkAccFiles(prevP, mg.matrix); if (nS) out.push(`ส่งไฟล์ Backup ต่อ Account ${nS} ไฟล์ไป Drive D / SharePoint`); } out.push(`Backup ${prevP} ${sp.parts.below.length} แถว`); /* MARKER_GL_DOA_BACKUP_BELOW_SP_V1 -- ส่งไฟล์ Backup งวดก่อนหน้าไป Drive D + SharePoint ผ่าน Handler (เหมือนขั้นตอน Confirm): ดาวน์โหลดไฟล์ก่อนแล้ว fastapn-sp://backup | ไม่มี COM/Handler = ข้าม ไม่ถือเป็น Error ไม่กระทบการเก็บใน DB */
          try { const spB = /^[0-9][0-9A-Za-z]{2,7}$/.test(comN) ? comN : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); if (false) { const wbB = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbB, XLSX.utils.aoa_to_sheet(mg.matrix), 'Detail'); const urlB = URL.createObjectURL(new Blob([XLSX.write(wbB, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); setTimeout(() => { const dB = document.createElement('a'); dB.href = urlB; dB.download = bkName; dB.style.display = 'none'; document.body.appendChild(dB); dB.click(); dB.remove(); setTimeout(() => URL.revokeObjectURL(urlB), 4000); }, 600); setTimeout(() => { const hB = document.createElement('a'); hB.href = `fastapn-sp://backup?name=${encodeURIComponent(bkName)}&bu=${encodeURIComponent(spB)}&period=${encodeURIComponent(prevP)}&dest=doh`; hB.style.display = 'none'; document.body.appendChild(hB); hB.click(); hB.remove(); }, 1600); out.push('ส่งไป Drive D / SharePoint (ไฟล์รวมทั้ง BU — ดึงเป็นราย Account ได้ตอน Connect ไม่สร้างไฟล์แยก)'); } else out.push('Drive D แยกราย Account เก็บตอน Confirm / Restore'); } catch (e5) { out.push('ส่ง Drive D / SharePoint ไม่สำเร็จ (ข้าม)'); } } else out.push(`Backup ${prevP} เท่าเดิม (ไม่รับ)`); }
        if (sp.parts.below.length) { /* MARKER_GL_DOA_BACKUP_BELOW_TO_CUR_DETAIL_V1 -- แถว Below (ค้างยกมา) ต้องเข้า Detail ของงวดปัจจุบันใน DB ด้วย เพื่อให้ Preview เดือนนี้อัปเดต: รวมแบบระดับแถว (คีย์ซ้ำนับครั้งเดียว) ไม่ทับแถวเดิมของงวดนี้ และข้ามแถวที่ Stamp Clear แล้ว */
          try {
            const exRows = (await bkExistRows(dp, new Set(sp.parts.below.map(o => String(o.account_code))), true)).rows;
            const seen = new Set(exRows.map(detKey)); const addR = sp.parts.below.filter(o => { const k = detKey(o); if (seen.has(k) || clrKeys.has(k)) return false; seen.add(k); return true; });
            if (addR.length) { await saveDetBk(dp, detailMatrixFromRows([...exRows, ...addR])); try { await saveDoaClear(bu, dp, addR.map(o => ({ key: detKey(o), row: o })), null, 'Include'); } catch (e9) { /* ไม่กระทบ */ } out.push(`เพิ่มเข้า Detail ${dp} ${addR.length} แถว`); setDbTick(t => t + 1); } else { const rs = sp.parts.below.filter(o => { const k = detKey(o); return !clrKeys.has(k) && !incKeys.has(k); }); /* MARKER_GL_DOA_INCLUDE_RESTAMP_V1 -- โยนซ้ำ: Backup เดิมมีแถวครบแล้ว แต่ DB ยังไม่เป็น Include => ตั้ง Include ใหม่ */ if (rs.length) { try { await saveDoaClear(bu, dp, rs.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rs.forEach(o => nx.add(detKey(o))); return nx; }); out.push(`ตั้ง Status Include ใหม่ ${rs.length} แถว (Backup เดิม)`); setDbTick(t => t + 1); } catch (e9) { /* ไม่กระทบ */ } } else out.push(`Detail ${dp} มีแถว Below ครบแล้ว`); }
          } catch (e) { setDbMsg('✗ เพิ่มแถว Below เข้า Detail งวดปัจจุบันไม่สำเร็จ: ' + e.message); return; }
        }
        const mt = sp.curList.filter((o, i) => (sp.stat[i] === 'Match' || sp.stat[i] === 'Include') && !clrKeys.has(detKey(o)) && !incKeys.has(detKey(o))); /* MARKER_GL_DOA_MATCH_TO_INCLUDE_V1 -- แถวที่ Match กับ Backup = Include (ข้อมูลเดิมที่ถูกรวมแล้ว) */
        if (mt.length) { try { await saveDoaClear(bu, dp, mt.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); mt.forEach(o => nx.add(detKey(o))); return nx; }); out.push(`ตั้ง Status Include ${mt.length} แถวที่ Match กับ Backup`); } catch (e10) { /* ไม่กระทบ */ } }
        const un = sp.curList.filter((o, i) => sp.stat[i] === 'Unmatch' && !clrKeys.has(detKey(o)));
        if (un.length) { try { const r = await saveDoaClear(bu, dp, un.map(o => ({ key: detKey(o), row: o })), null); /* MARKER_GL_DOA_CLEAR_PENDING_FE_V1 -- Auto Clear = Clear (สถานะเดียวกับ Stamp Clear) */ setClrKeys(prev => { const nx = new Set(prev); un.forEach(o => nx.add(detKey(o))); return nx; }); out.push(`Stamp Auto Clear ${r.cleared} รายการ`); } catch (e) { setDbMsg('✗ Stamp Auto Clear ไม่สำเร็จ: ' + e.message); return; } }
        try { const j2 = await listDoaBackups(bu); const it2 = (j2.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort(bkCmp); setBkFiles(it2); bkLoaded.current = bu; const def2 = it2.find(x => x.period === prevPeriod) || null; const accB = new Set(detailRows(detailMatrixFromRows(sp.parts.below)).map(o => String(o.account_code))); /* MARKER_GL_DOA_BACKUP_AUTOCONNECT_V1 -- Account ที่อยู่ในไฟล์ Backup ที่เพิ่งเก็บ = Connect ให้อัตโนมัติ + แสดงไฟล์ที่เลือก */ setBkAcc(m0 => { const nn = { ...m0 }; Object.keys(nn).forEach(c => { if ((nn[c] || {}).conn === 'empty' || (accB.has(c) && (nn[c] || {}).conn !== 'on')) nn[c] = { conn: 'on', sel: bkSel(it2, prevPeriod, c) }; }); return nn; }); const cl2 = await listDoaClear(bu); setClrKeys(new Set(cl2.map(x => x.row_key))); } catch (e) { /* ไม่เด้ง */ } /* MARKER_GL_DOA_RECHECK_V1 -- โหลดรายการ Backup + Stamp Clear ใหม่หลังบันทึก */
        setBkTick(t => t + 1); setDropPop(false); setDbMsg(`✓ ${f.name}: ${out.join(' · ') || 'ไม่มีอะไรเปลี่ยน'}`); return;
      } if (!await askDoa(`ไฟล์ ${f.name} เป็นข้อมูลงวด ${dp} แต่คุณเลือกงวด ${per}\n\nเก็บเป็น Backup งวด ${dp} ตามไฟล์?`)) return; per = dp; }
      const mg = await prepBackupMerge(per, mat, true); /* MARKER_GL_DOA_MAKEBACKUP_PER_ACC_CHECK_V1 -- เช็คเฉพาะไฟล์ by Account */ if (!mg.changed) { setNotice(bkRepNotice(per, mg)); setDropPop(false); return; } /* MARKER_GL_DOA_BACKUP_CHECK_DB_FIRST_V1 -- เช็คกับ DB ก่อน: ข้อมูลเดียวกันอยู่แล้ว (ทุก Account เท่าเดิม) = แจ้งไม่รับ ไม่ต้องถามยืนยัน | มีที่เปลี่ยน = ถามพร้อมสรุปจำนวน ใหม่/อัปเดต/เท่าเดิม */
      if (!await askDoa(`สร้าง Backup Detail?\n\nไฟล์: ${f.name} (${n} แถว)${mat.__sheets ? '\nชีต Detail: ' + mat.__sheets.join(' + ') : ''}\nBU ${bu} · งวด ${per}\nเช็คกับ DB แล้ว: ใหม่ ${mg.rep.filter(x => x.st === 'ใหม่').length} · รวมเพิ่มแถว (ไม่ทับของเดิม) ${mg.rep.filter(x => x.st === 'อัปเดต').length} · เท่าเดิม (ไม่รับ) ${mg.rep.filter(x => x.st === 'เท่าเดิม').length} Account${mg.merged ? '' : '\n⚠ ไม่เห็นไฟล์ Backup เดิมของงวดนี้ — ถ้ามีไฟล์ที่ถูกซ่อน (หมดอายุ) จะถูกทับ'}`)) return;
      await saveDetBk(per, mg.matrix); const nSend = await sendBkAccFiles(per, mg.matrix); /* MARKER_GL_DOA_MAKEBACKUP_SEND_BY_ACC_V1 */
      const j = await listDoaBackups(bu); const it = (j.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort(bkCmp);
      setBkFiles(it); bkLoaded.current = bu;
      const def = it.find(x => x.period === prevPeriod) || null;
      const accN = new Set(detailRows(mat).map(o => String(o.account_code))); setBkAcc(m => { const nn = { ...m }; Object.keys(nn).forEach(c => { if ((nn[c] || {}).conn === 'empty' || (accN.has(c) && (nn[c] || {}).conn !== 'on')) nn[c] = { conn: 'on', sel: bkSel(it, prevPeriod, c) }; }); return nn; });
      try { const csR = [...accN].filter(c => (shownAcc || []).some(x => String(x.code) === c)); for (const c of csR) { const dfn = it.find(x => x.period === per && String(x.account) === c) || it.find(x => x.period === per && !x.account); if (dfn) await carryM1(dfn, [c]); } } catch (eR) { /* Recheck กับ DB ไม่สำเร็จ ไม่กระทบการสร้าง Backup */ } /* MARKER_GL_DOA_CONNECT_ICON_POPUP_RECHECK_V1 -- โยน Backup แล้ว Recheck กับ DB: เอาเข้าเฉพาะแถวที่ยังไม่มี Include */
      setBkTick(t => t + 1); setDropPop(false); setDbMsg(`✓ สร้าง Backup Detail แล้ว (BU ${bu} · งวด ${per} · ${n} แถว)` + (nSend ? ` · ส่งไฟล์ต่อ Account ${nSend} ไฟล์ไป Drive D / SharePoint` : '')); setNotice(bkRepNotice(per, mg));
    } catch (e) { setDbMsg('✗ สร้าง Backup ไม่สำเร็จ: ' + e.message); } finally { setMkBusy(false); }
  };
  /* MARKER_GL_DOA_DRIVE_D_LIST_V1 -- Drive D (D:\apps\Backup_DOH) ผ่าน SharePoint Handler v18: list = ดูรายการ / pull = ดึงไฟล์ | Backup ไม่มีลบ (เก็บ = ทับไฟล์ชื่อเดิม) */
  const [dropAcc, setDropAcc] = React.useState(''); const [dFiles, setDFiles] = React.useState({ st: 'idle', items: [], msg: '' }); const [dTick, setDTick] = React.useState(0); const [pullBusy, setPullBusy] = React.useState('');
  const spApi = () => { try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); return { root, tk: sessionStorage.getItem('fastapn_token') || '' }; } catch (e) { return { root: '', tk: '' }; } };
  const spLaunch = (uri) => { const h = document.createElement('a'); h.href = uri; h.style.display = 'none'; document.body.appendChild(h); h.click(); h.remove(); };
  const spNewReq = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const spPoll = async (url, tk, tries) => { for (let i = 0; i < tries; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } }); if (r.ok) { const j = await r.json(); if (j && j.ready) return j; } } catch (e) { /* ลองใหม่ */ } } return null; };
  React.useEffect(() => {
    if (!dropPop) return undefined; let off = false; const { root, tk } = spApi();
    if (!tk) { setDFiles({ st: 'err', items: [], msg: 'ไม่พบ Token — กรุณา Login ใหม่' }); return undefined; }
    setDFiles({ st: 'busy', items: [], msg: '' }); const rq = spNewReq();
    spLaunch(`fastapn-sp://list?dest=dod&path=&req=${rq}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`);
    (async () => {
      const j = await spPoll(`${root}/api/file-storage/sp-handler/local/result?req=${rq}`, tk, 15); if (off) return;
      if (!j) { setDFiles({ st: 'err', items: [], msg: 'ไม่ได้รับรายการจาก Handler — ตรวจว่าติดตั้ง Handler v18 แล้ว (Resource Center > Setup - Tools > Update)' }); return; }
      setDFiles({ st: 'ok', items: (j.items || []).filter(x => !x.dir), msg: '' });
    })();
    return () => { off = true; };
  }, [dropPop, dTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const dFilt = (() => { /* กรอง: BU นี้ + ไม่ใช่งวดปัจจุบัน | Detail ของ Account ที่กด Connect (ไม่สนงวด) แยกจากไฟล์รวมทั้ง BU | ชื่อไฟล์ <COM>_<BU>_Detail_backup_<YYYY.MM>[_<Account>].xlsx */
    const re = /_Detail_backup_(\d{4}\.\d{2})(?:_([^_]+))?\.xlsx$/i;
    const rows = dFiles.items.map(x => { const nm = String(x.name || String(x.path).split('/').pop()); if (nm.indexOf('_' + bu + '_Detail_backup_') < 0) return null; const m = re.exec(nm); return m ? { ...x, name: nm, per: m[1], acc: m[2] || '' } : null; }).filter(x => x && x.per !== period);
    const srt = (a) => a.slice().sort((p, q) => String(q.per).localeCompare(String(p.per)));
    return { acc: dropAcc ? srt(rows.filter(x => x.acc === dropAcc)) : [], whole: srt(rows.filter(x => !x.acc)) };
  })();
  const pullFromD = async (it) => {
    const { root, tk } = spApi(); if (!tk) { setDbMsg('ไม่พบ Token — กรุณา Login ใหม่'); return; }
    setPullBusy(it.path); const rq = spNewReq();
    try {
      spLaunch(`fastapn-sp://pull?dest=dod&path=${encodeURIComponent(it.path)}&req=${rq}&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`);
      const j = await spPoll(`${root}/api/file-storage/sp-handler/local/pull-result?req=${rq}`, tk, 30);
      if (!j || !j.b64) { setDbMsg('✗ ดึงไฟล์จาก Drive D ไม่สำเร็จ (Handler ไม่ตอบ หรือไม่พบไฟล์)'); return; }
      const bin = atob(j.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const f = new File([u8], j.name || it.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      let fUse = f; /* MARKER_GL_DOA_PULL_BY_ACCOUNT_V1 -- กด Connect จาก Account ใด แล้วเลือกไฟล์รวมทั้ง BU = ดึงเฉพาะแถวของ Account นั้นเข้ามา (ไม่ต้องสร้าง Backup แยกราย Account ซ้ำให้เปลืองพื้นที่) */
      if (dropAcc && !it.acc) { const mt = await fileToMatrix(f, 'Detail'); const rs = detailRows(mt).filter(o => String(o.account_code) === String(dropAcc)); if (!rs.length) { setDbMsg(`✗ ไม่พบข้อมูล Account ${dropAcc} ในไฟล์ ${j.name || it.name}`); return; } const wbP = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbP, XLSX.utils.aoa_to_sheet(detailMatrixFromRows(rs)), 'Detail'); fUse = new File([XLSX.write(wbP, { type: 'array', bookType: 'xlsx' })], j.name || it.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
      await makeBackup(fUse, it.per);
    } catch (e) { setDbMsg('✗ ดึงไฟล์ไม่สำเร็จ: ' + e.message); } finally { setPullBusy(''); }
  };
  const prevPeriod = React.useMemo(() => { /* MARKER_GL_DOA_BACKUP_PREV_OF_PERIOD_V1 -- M-1 = เดือนก่อน 'งวดที่เลือก' (ไม่ใช่เดือนก่อนวันนี้) และไฟล์ Connect ต้องไม่ใช่ไฟล์ของงวดปัจจุบัน */ const m = /^(\d{4})\.(\d{2})$/.exec(period || ''); const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`; }, [period]);
  React.useEffect(() => { setBkAcc({}); setBkFiles([]); bkLoaded.current = null; }, [bu, period]);
  const bkSet = (code, patch) => setBkAcc(m => ({ ...m, [code]: { conn: 'off', sel: '', ...(m[code] || {}), ...patch } }));
  const toggleBk = async (code) => {
    const cur = bkAcc[code] || { conn: 'off', sel: '' };
    if (cur.conn === 'busy') return;
    /* MARKER_GL_DOA_CONNECT_AUTO_DECIDE_V1 */
    { const hv = bkHaveMap[String(code)]; if (bkHave && hv) { bkSet(code, { conn: 'on', sel: String(hv.id) }); await carryM1({ id: hv.id, period: hv.period, file_name: hv.name }, [code]); return; } } /* MARKER_GL_DOA_CONNECT_USE_CACHE_V1 */
    { await connectAll([{ code }]); return; } /* MARKER_GL_DOA_CONNECT_CHECK_DB_V1 -- กด Connect รายแถว = เช็ค DB ใหม่ (Backup + Include + แถว Below) แล้ว Connect | ถ้า Connect อยู่แล้ว กดอีกครั้ง = Disconnect */
    if (!bu) { setDbMsg('เลือก BU ก่อน จึงจะ Connect ได้'); return; }
    bkSet(code, { conn: 'busy' }); setDbMsg('');
    if (belowByAcc.has(String(code)) && !(bkHave && bkHave.has(String(code)))) { /* แถว Below ใน Detail งวดนี้ = Connect ได้เลย ไม่ต้องมีไฟล์ Backup จริง */
      try { const n = await stampBelow([code]); bkSet(code, { conn: 'on', sel: '' }); if (n) setDbMsg(`✓ Connect: ตั้ง Include ${n} แถว (Transaction Date ต่ำกว่า ${period})`); } catch (e) { bkSet(code, { conn: 'off' }); setDbMsg('Connect ไม่สำเร็จ: ' + e.message); }
      return;
    }
    try {
      let it = bkFiles;
      if (bkLoaded.current !== bu) { const j = await listDoaBackups(bu); it = (j.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort(bkCmp); setBkFiles(it); bkLoaded.current = bu; }
      if (!it.length) { bkSet(code, { conn: 'empty', sel: '' }); setDropAcc(String(code)); setDropPop(true); return; } /* MARKER_GL_DOA_BACKUP_EMPTY_V1 -- ไม่มีไฟล์ Backup เลย = ไม่ขึ้น Connected */
      if (bkHave && !bkHave.has(String(code))) { bkSet(code, { conn: 'empty', sel: '' }); setDropAcc(String(code)); setDropPop(true); return; }
      const def = bkDefFor(it, code);
      bkSet(code, { conn: 'on', sel: def ? String(def.id) : '' }); await carryM1(def, [code]);
    } catch (e) { bkSet(code, { conn: 'off' }); setDbMsg('Connect ไม่สำเร็จ: ' + e.message); }
  };
  const connectAll = async (accs) => { /* MARKER_GL_DOA_BACKUP_CONNECT_ALL_V1 -- ปุ่ม Connect ทั้งหมด / Disconnect ทั้งหมด (ยังคง Connect ราย Account ได้) */
    const codes = accs.map(x => x.code); if (!codes.length) return;
    const allOn = codes.every(c => (bkAcc[c] || {}).conn === 'on');
    if (allOn) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { n[c] = { conn: 'off', sel: '' }; }); return n; }); return; }
    if (!bu) { setDbMsg('เลือก BU ก่อน จึงจะ Connect ได้'); return; }
    setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn !== 'on') n[c] = { conn: 'busy', sel: '' }; }); return n; }); setDbMsg('');
    try {
      /* MARKER_GL_DOA_CONNECT_ALL_RECHECK_V1 -- Connect ทั้งหมด = Recheck ใหม่ทุกครั้ง: โหลดรายการ Backup + เปิดไฟล์ดูว่า Account ไหนมีข้อมูล + อ่าน Include จาก DB แล้วค่อย Connect เฉพาะ Account ที่มีข้อมูลจริง */
      const jr = await listDoaBackups(bu); const it = (jr.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort(bkCmp); setBkFiles(it); bkLoaded.current = bu;
      const fl = bkPick(it, period);
      const ds = await Promise.all(fl.map(f => getDoaBackup(f.id).then(d => ({ f, d })).catch(() => null)));
      const mpN = {}; ds.forEach(r => { if (!r) return; detailRows(Array.isArray(r.d && r.d.data) ? r.d.data : []).forEach(o => { const c = String(o.account_code); if (!mpN[c]) mpN[c] = { id: r.f.id, period: r.f.period, name: r.f.file_name || '' }; }); });
      setBkHaveMap(mpN); setBkHave(new Set(Object.keys(mpN)));
      let incSet = new Set(); try { const cl = await listDoaClear(bu); applyClr(cl); (cl || []).filter(x => x.status === 'Include').forEach(x => incSet.add(String(x.row_key).split('|').pop())); } catch (e0) { incSet = new Set([...incByAcc.keys()]); }
      const hasD = (c) => !!mpN[String(c)] || incSet.has(String(c)) || belowByAcc.has(String(c));
      if (!codes.some(hasD)) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'empty', sel: '' }; }); return n; }); setDropAcc(codes.length === 1 ? String(codes[0]) : ''); setDropPop(true); /* MARKER_GL_DOA_CONNECT_NONE_POPUP_V1 */ return; }
      const defF = (c) => (mpN[String(c)] && it.find(x => String(x.id) === String(mpN[String(c)].id))) || null;
      setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn !== 'on') { const d1 = defF(c); n[c] = hasD(c) ? { conn: 'on', sel: d1 ? String(d1.id) : '' } : { conn: 'empty', sel: '' }; } }); return n; });
      { const grp = {}; codes.filter(c => mpN[String(c)]).forEach(c => { const d0 = defF(c); const k = d0 ? String(d0.id) : ''; (grp[k] = grp[k] || { d0, cs: [] }).cs.push(c); }); for (const k of Object.keys(grp)) await carryM1(grp[k].d0, grp[k].cs); }
      let nb = 0; try { nb = await stampBelow(codes.filter(c => belowByAcc.has(String(c)) && !mpN[String(c)])); } catch (e) { /* ไม่กระทบ */ }
      { const okC = codes.filter(hasD); const noC = codes.filter(c => !hasD(c)); if (noC.length) { setDropAcc(noC.length === 1 ? String(noC[0]) : ''); setDropPop(true); } /* MARKER_GL_DOA_CONNECT_MISSING_POPUP_V1 */ (() => {})(/* MARKER_GL_DOA_RECHECK_SILENT_V1 */`✓ Recheck BU ${bu}: Connect ${okC.length} Account (เจอใน Backup ${okC.filter(c => mpN[String(c)]).length} · Include ใน DB ${okC.filter(c => !mpN[String(c)] && incSet.has(String(c))).length}${nb ? ` · ตั้ง Include ${nb} แถว` : ''})${noC.length ? ` · ไม่พบข้อมูล ${noC.length} Account: ${noC.slice(0, 8).join(', ')}${noC.length > 8 ? '…' : ''}` : ''}`); }
    } catch (e) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'off', sel: '' }; }); return n; }); setDbMsg('Connect ไม่สำเร็จ: ' + e.message); }
  };
  React.useEffect(() => { /* MARKER_GL_DOA_BACKUP_LIST_RELOAD_V1 -- Connect อยู่แต่รายการไฟล์ว่าง (ค้างจากก่อนสร้าง Backup / โหลดไม่ทัน) -> โหลดรายการ Backup จาก DB ใหม่ + เลือก M-1 ให้ Account ที่ยังไม่ได้เลือกไฟล์ */
    if (!bu || bkFiles.length) return undefined; if (!Object.values(bkAcc).some(v => v && v.conn === 'on')) return undefined; let off = false;
    listDoaBackups(bu).then(j => { if (off) return; const it = (j.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort(bkCmp); if (!it.length) return; setBkFiles(it); bkLoaded.current = bu; const def = it.find(x => x.period === prevPeriod); if (def) setBkAcc(m => { const n = { ...m }; Object.keys(n).forEach(c => { if ((n[c] || {}).conn === 'on' && !(n[c] || {}).sel) n[c] = { ...n[c], sel: bkSel(it, prevPeriod, c) }; }); return n; }); }).catch(() => {});
    return () => { off = true; };
  }, [bkAcc, bkFiles, bu, period, prevPeriod, bkTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dbMsg, setDbMsg] = React.useState('');
  React.useEffect(() => { if (dbMsg) { setNotice({ tone: dbMsg.startsWith('✓') ? 'ok' : (dbMsg.startsWith('✗') ? 'err' : 'warn'), title: dbMsg.startsWith('✓') ? 'ดำเนินการแล้ว' : 'แจ้งเตือน', lines: [dbMsg.replace(/^[✓✗]\s*/, '')] }); setDbMsg(''); } }, [dbMsg]);
  React.useEffect(() => { if (bkMsg) { setNotice({ tone: bkMsg.startsWith('✓') ? 'ok' : 'err', title: bkMsg.startsWith('✓') ? 'Backup สำเร็จ' : 'Backup ไม่สำเร็จ', lines: [bkMsg.replace(/^[✓✗]\s*/, '')] }); setBkMsg(''); } }, [bkMsg]);
  // MARKER_GL_DOA_CLEAR_CTX_V1 -- คลิกขวาที่จุด Detail / Simple ของ Account → ล้างข้อมูลของ Account นั้น (ถามยืนยันก่อนเสมอ)
  const [ctx, setCtx] = React.useState(null); const [hovRow, setHovRow] = React.useState(''); // MARKER_GL_DOA_ROW_HOVER_V1
  const openCtx = (e, kind, a) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, kind, a }); };
  React.useEffect(() => { if (!ctx) return undefined; const close = () => setCtx(null); window.addEventListener('click', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', close); return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', close); }; }, [ctx]);
  // MARKER_GL_DOA_CLEAR_DELETES_FILE_V1 -- กดล้างแล้วต้องลบไฟล์ที่ Backup ไว้ด้วย: ล้างทั้งประเภท = ลบไฟล์ Backup ของงวดนี้ (TB/Simple รวม Header) | ล้างราย Account = ตัดแถว Account นั้นออกจากไฟล์แล้วบันทึกทับ (ไม่เหลือข้อมูล = ลบไฟล์)
  const dropAccRows = (m, code) => { const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0; for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } } if (hi < 0) return m; let skip = false; return m.filter((r, i) => { if (i <= hi) return true; const c = String((r || [])[ac] == null ? '' : r[ac]).trim(); if (/^total/i.test(c)) { skip = false; return c.indexOf(String(code)) < 0; } if (c) skip = (c === String(code)); return !skip; }); };
  // MARKER_GL_DOA_DOWNLOAD_V1 -- คลิกขวา → Download ข้อมูลของ Account นั้น (หัวรายงาน + แถวของ Account เป็น .xlsx; Simple ตั้งชื่อชีต "Outstanding Simple {Account}" และ Merge เซลล์ A-K ของแต่ละรายการเหมือนไฟล์จริง)
  const detCtx = () => { const th = parseTbHeader(tbMatrix) || {}; const lab = ((buOptions.find(o => o.value === bu) || {}).label || '').replace(new RegExp('^' + String(bu).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), ''); return { comName: String(th.company || '').replace(/^\s*\d+\s*/, '').trim() || lab, period }; };
  const downloadFile = (kind, code) => {
    const m00 = kind === 'TB' ? tbMatrix : (kind === 'Detail' ? detMatrix : simMatrix); const tbK = kind === 'TB' && m00.length > 0 && segKeyCol(m00) >= 0; const detK = kind === 'Detail' && !!detailCols(m00); const m = tbK ? buildTbDetail(m00, code).matrix : (detK ? buildDetailDoa(m00, code, detCtx()).matrix : m00); if (!m.length) { setNotice({ tone: 'warn', title: `ยังไม่มีข้อมูล ${kind} ให้ Download`, lines: ['โยนไฟล์ก่อน หรือโหลดจากรายการ Backup'] }); return; }
    const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1, ac = 0; for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) { const j = (m[i] || []).findIndex(c => re.test(String(c || '').trim())); if (j >= 0) { hi = i; ac = j; } }
    if (tbK) { hi = 8; ac = 2; }
    if (detK) { hi = 8; ac = 3; }
    const isBlankR = (r) => !r || r.every(c => String(c == null ? '' : c).trim() === '');
    let hb = 0; if (kind === 'Simple' && hi >= 0) while (hb < 10 && hi + 1 + hb < m.length && isBlankR(m[hi + 1 + hb])) hb++; // จำนวนแถวว่างใต้หัวตารางไม่ตายตัว นับตามไฟล์จริง // MARKER_GL_DOA_SIMPLE_LAYOUT_V1 -- หัวตาราง Simple สูง 3 แถว (แถวว่างใต้หัวคอลัมน์ 2 แถว) เหมือน Simple Final
    const out = hi < 0 ? m.slice() : m.slice(0, hi + 1 + hb); const merges = []; let keep = false, start = -1;
    const closeGroup = () => { start = -1; }; // ไม่ Merge A–K (Simple Final ไม่ Merge)
    if (hi >= 0) for (let i = hi + 1 + hb; i < m.length; i++) { const r = m[i] || []; const lead = String(r[0] == null ? '' : r[0]).trim(); if (kind === 'Simple' && /^(total|gran[dt])/i.test(lead)) { if (/^total/i.test(lead) && (!code || lead.slice(-String(code).length) === String(code))) { out.push(r); keep = false; } continue; } const c = String(r[ac] == null ? '' : r[ac]).trim(); if (c) { closeGroup(); const isT = /^total/i.test(c); keep = !code || (isT ? c.indexOf(String(code)) >= 0 : c === String(code)); if (keep) { out.push(r); start = isT ? -1 : out.length - 1; } } else if (keep) out.push(r); }
    closeGroup();
    if (tbK) { const sm = [5, 6, 7].map(j => out.slice(hi + 1).reduce((t, r) => { const tt = String((r || [])[j] == null ? '' : r[j]).trim(); const neg = /^\(.*\)$/.test(tt) || /^-/.test(tt); const x = Number(tt.replace(/[(),\s-]/g, '')); return t + (isFinite(x) ? (neg ? -x : x) : 0); }, 0)); out.push(['Total', '>', '', '', '', sm[0], sm[1], sm[2]]); }
    if (kind !== 'Simple' && hi >= 0 && hi < 8) { const pad = 8 - hi; out.splice(hi, 0, ...Array.from({ length: pad }, () => [])); hi += pad; } // MARKER_GL_DOA_DOWNLOAD_HDR_ROW9_V1 -- TB/Detail: หัวตารางเริ่มแถวที่ 9 (เหมือนรายงานต้นฉบับ) ข้อมูลเริ่มแถว 10
    // MARKER_GL_DOA_DOWNLOAD_STYLED_V1 -- Download ด้วย ExcelJS ให้มีสี/ฟอนต์เหมือน Simple Final: หัวตารางฟ้า B4C6E7 (M–R ส้ม F7CAAC), แถว Total เทา D9D9D9 ตัวหนา, Calibri 9, จำนวนเงินเป็นตัวเลข #,##0.00, ความกว้างคอลัมน์ตามไฟล์ Final
    const sheet = (kind === 'Simple' ? `Outstanding Simple ${code || ''}` : kind).trim().slice(0, 31);
    const comD = segKeyCom(m) || ((parseTbHeader(m) || {}).comCode) || (kind === 'Detail' ? detailInfo(m00, '').com : '') || ''; // MARKER_GL_DOA_TB_FILENAME_V1 -- ชื่อไฟล์ TB/Detail = COM_BU_ประเภท_งวด[_Account] (เช่น 0572_REV_TB_2026.09_21835000)
    const base = kind === 'Simple' ? (simName || `OutstandingSimple_${period}`) : [comD, bu, kind === 'Detail' ? 'DOH' : kind, period].filter(Boolean).join('_') /* MARKER_GL_DOA_DOH_NAME_V1 Detail = DOH (Detail of Overhead) */;
    const fn = `${String(base).replace(/\.xlsx?$/i, '')}${code ? '_' + code : ''}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
    const nCols = Math.max(...out.map(r => (r || []).length), 1);
    const FINAL_W = [33.6, 9.6, 27.5, 7.2, 24.2, 11.8, 11.6, 18.3, 17.8, 10.2, 35.2, 19.9, 12.4, 12.7, 16.3, 14.8, 13.9, 10.7, 35.2, 33.7, 35.2, 12.8, 22.1];
    (async () => {
      try {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet);
        // MARKER_GL_DOA_DOWNLOAD_FORMAT_FINAL_V2 -- Format ตาม Simple Final: ทุกเซลล์ A–W Top Align + เส้นขอบบาง + พื้นขาว, หัวตารางฟ้า/ส้ม, Total เทา, รูปแบบตัวเลข/วันที่ตามคอลัมน์, ความสูงแถวหัวรายงาน
        const fill = (rgb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rgb } });
        const thin = { style: 'thin', color: { argb: 'FF000000' } }; /* เส้นขอบดำบางเหมือน Simple Final */ const BORD = { top: thin, left: thin, bottom: thin, right: thin };
        const isSim = kind === 'Simple'; const W = isSim ? Math.min(nCols, 23) : nCols;
        const AMT = new Set([4, 7, 17]); const TXT = new Set([0, 1, 2, 3, 5, 6, 10]);
        const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
        const pm = String(period || '').match(/^(\d{4})\.(\d{2})$/); const pY = pm ? Number(pm[1]) : new Date().getFullYear(), pM = pm ? Number(pm[2]) - 1 : 11;
        const hdrR = (!isSim && hi >= 0) ? (out[hi] || []).map(c => String(c == null ? '' : c).trim()) : []; const AMT2 = new Set(hdrR.map((c, j) => (/balance|activity|amount|debit|credit/i.test(c) ? j : -1)).filter(j => j >= 0)); // MARKER_GL_DOA_DOWNLOAD_TB_CLEAN_V1 -- TB/Detail: ตัวเลขเป็นตัวเลขจริง (ไม่ใช่ข้อความ), ตัดช่องว่างหัวรายงาน, ความกว้างคอลัมน์ตามตาราง
        const numP = (v) => { const t = String(v).trim(); const neg = /^\(.*\)$/.test(t) || /^-/.test(t); const x = t.replace(/[(),\s-]/g, ''); return /^\d+(\.\d+)?$/.test(x) ? (neg ? -Number(x) : Number(x)) : null; };
        const num = (v) => { const t = String(v).replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
        const dDM = (v) => { const x = String(v).trim().match(/^(\d{1,2})-([A-Za-z]{3})$/); if (!x || MON[x[2].toLowerCase()] == null) return null; const mo = MON[x[2].toLowerCase()]; return new Date(Date.UTC(mo <= pM ? pY : pY - 1, mo, Number(x[1]))); }; // d-mmm (วันที่ Period Create) : ปี = ปีของงวด (เดือนหลังงวด = ปีก่อน)
        const dMY = (v) => { const x = String(v).trim().match(/^([A-Za-z]{3})-(\d{2})$/); if (!x || MON[x[1].toLowerCase()] == null) return null; return new Date(Date.UTC(2000 + Number(x[2]), MON[x[1].toLowerCase()], 1)); }; // mmm-yy (Expense period)
        out.forEach((r, i) => {
          const isHead = i === hi || (hb > 0 && i > hi && i <= hi + hb); const isData = i > hi + hb; const isTot = i > hi && (/^total/i.test(String((r || [])[kind === 'Simple' ? 0 : ac] || '').trim()) || (tbK && String((r || [])[0] || '').trim() === 'Total'));
          const row = ws.addRow(Array.from({ length: W }).map((_, j) => {
            const v = (r || [])[j]; if (v == null || v === '') return null;
            if (!isSim && hi >= 0 && i < hi && typeof v === 'string') return v.replace(/\s{2,}/g, '  ').trim();
            if (!isSim && isData && AMT2.has(j)) { const n = numP(v); if (n != null) return n; }
            if (isSim && isData && !isTot) { if (AMT.has(j)) { const n = num(v); if (n != null) return n; } if (j === 8) { const d = dDM(v); if (d) return d; } if (j === 22) { const d = dMY(v); if (d) return d; } }
            if (isSim && i === 2 && j === 3) { const d = dDM(v); if (d) return d; } if (isSim && i === 2 && j === 6) { const n = num(v); if (n != null) return n; }
            if (isSim && isTot && AMT.has(j)) { const n = num(v); if (n != null) return n; }
            return v;
          }));
          row.eachCell({ includeEmpty: true }, (cell, cn) => {
            const j = cn - 1; const lbl = isSim && i < hi - 1 && typeof cell.value === 'string' && /:/.test(cell.value);
            cell.font = { name: 'Calibri', size: (isSim && i === 0) ? 16 : ((isSim && i === hi - 1) ? 12 : 9), bold: isHead || isTot || lbl || ((tbK || detK) && i === 0) || (isSim && (i === 0 || i === 1 || i === hi - 1)) };
            cell.alignment = { vertical: 'top', wrapText: isHead || (isSim && i < hi), horizontal: (isSim && i === 0) ? 'center' : undefined };
            if (isSim && i < hi - 1) { cell.fill = fill('FFFFFF'); }
            if (isHead) { cell.fill = fill(isSim ? (j >= 12 && j <= 17 ? 'F7CAAC' : 'B4C6E7') : '002060'); cell.border = BORD; if (!isSim) { cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; } } // MARKER_GL_DOA_DOWNLOAD_TB_THEME_V1 -- หัวตาราง TB/Detail = กรมท่า 002060 ตัวอักษรขาว (ตรงกับ Preview)
            else if (isTot) { cell.fill = fill(tbK ? 'DDEBF7' : 'D9D9D9'); cell.border = BORD; }
            else if (isData) {
              cell.fill = fill('FFFFFF'); cell.border = BORD;
              if (isSim && j <= 10) { // MARKER_GL_DOA_GROUP_BORDER_V1 -- A–K ของกลุ่ม: เส้นบนเฉพาะแถวแรก เส้นล่างเฉพาะแถวสุดท้ายของกลุ่ม (ดูเหมือน Merge เหมือน Simple Final)
                const isStart = String((r || [])[ac] == null ? '' : r[ac]).trim() !== ''; const nx = out[i + 1]; const nxStart = !nx || String(nx[ac] == null ? '' : nx[ac]).trim() !== '' || /^(total|gran[dt])/i.test(String(nx[0] == null ? '' : nx[0]).trim());
                cell.border = { left: thin, right: thin, top: isStart ? thin : undefined, bottom: nxStart ? thin : undefined };
              }
            }
            if (isSim && i === hi - 1) { cell.fill = fill('FFFFFF'); cell.border = { bottom: thin }; }
            if (!isSim && isData && cell.value instanceof Date) { cell.numFmt = 'dd-mmm-yy'; cell.alignment = { vertical: 'top', horizontal: 'center' }; }
            if (!isSim && isData && AMT2.has(j) && typeof cell.value === 'number') { cell.numFmt = '#,##0.00_);[Red](#,##0.00)'; /* MARKER_GL_DOA_NEG_RED_V1 ยอดติดลบเป็นสีแดง */ cell.alignment = { vertical: 'top', horizontal: 'right' }; }
            if (isSim && isData) { if (AMT.has(j)) cell.numFmt = '#,##0.00'; else if (TXT.has(j)) cell.numFmt = '@'; else if (j === 8) cell.numFmt = 'd-mmm'; else if (j === 22) cell.numFmt = 'mmm-yy'; }
            if (isSim && i === 2 && j === 3 && cell.value instanceof Date) cell.numFmt = 'd-mmm';
          });
        });
        if (isSim && hi >= 0) { // Layout เหมือน Simple Final: A1:G1 ชื่อรายงาน / แถว BU Code Merge ทั้งแถว / หัวตาราง Merge แนวตั้งตามจำนวนแถวว่างจริง
          const lastC = W;
          try { ws.mergeCells(1, 1, 1, lastC); } catch (e) { /* ignore */ }
          if (hi >= 1) { try { ws.mergeCells(hi, 1, hi, lastC); } catch (e) { /* ignore */ } }
          if (hb > 0) for (let cc = 1; cc <= lastC; cc++) { try { ws.mergeCells(hi + 1, cc, hi + 1 + hb, cc); } catch (e) { /* ignore */ } }
          const H = { 1: 21, 2: 10.4, 3: 11.9, 4: 13.5, 5: 13.65, 6: 10.75, 8: 15.5 }; Object.keys(H).forEach(k => { if (Number(k) <= hi) ws.getRow(Number(k)).height = H[k]; });
          for (let rr = hi + 1; rr <= hi + 1 + hb; rr++) ws.getRow(rr).height = 13.75;
        }
        const FINAL_W = [33.6, 9.6, 27.5, 7.2, 24.2, 11.8, 11.6, 18.3, 17.8, 10.2, 35.2, 19.9, 12.4, 12.7, 16.3, 14.8, 13.9, 10.7, 35.2, 33.7, 35.2, 12.8, 22.1];
        for (let j = 0; j < W; j++) { // MARKER_GL_DOA_DOWNLOAD_FIT_COLS_V1 -- Detail/TB: ทุกคอลัมน์ Fit ตามเนื้อหา (หัว+ข้อมูลทุกแถว) ยกเว้นคอลัมน์ K (Description) กว้างคงที่
          if (isSim && FINAL_W[j]) { ws.getColumn(j + 1).width = FINAL_W[j]; continue; }
          if (kind === 'Detail' && j === 10) { ws.getColumn(j + 1).width = 35; continue; }
          const fitLen = (r) => { const v = (r || [])[j]; if (v == null || v === '') return 0; const t = typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v); return t.length; };
          const body = out.slice(Math.max(hi, 0)).reduce((mx, r) => Math.max(mx, fitLen(r)), 0);
          ws.getColumn(j + 1).width = Math.max(8, Math.min(60, Math.round((body + 3) * 1.05)));
        }
        ws.views = [{ state: isSim ? 'normal' : 'frozen', zoomScale: isSim ? 55 : 100, ySplit: (!isSim && hi >= 0) ? hi + 1 : undefined }];
        const buf = await wb.xlsx.writeBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const al = document.createElement('a'); al.href = url; al.download = fn; document.body.appendChild(al); al.click(); document.body.removeChild(al); setTimeout(() => URL.revokeObjectURL(url), 5000);
        setNotice({ tone: 'ok', title: 'Download แล้ว', rows: [['ไฟล์', fn], ['ชีต', sheet], ['ข้อมูล', `${Math.max(0, out.length - (hi + 1))} แถว${code ? ' ของ Account ' + code : ' (ทุก Account)'}`]] });
      } catch (e) { setNotice({ tone: 'err', title: 'Download ไม่สำเร็จ', lines: [e.message] }); }
    })();
  };
  const dataRows = (m) => { const re = /^(gl\s*)?(account|acct|a\/c|บัญชี|รหัสบัญชี|acc\s*code\s*deferred)/i; let hi = -1; for (let i = 0; i < Math.min(m.length, 30) && hi < 0; i++) if ((m[i] || []).some(c => re.test(String(c || '').trim()))) hi = i; return Math.max(0, m.length - hi - 1); };
  const trimOwnRaw = async (codes) => { // ตัด Account ออกจาก TB ทั้งไฟล์ (TBRAW) ของตัวเองใน DB
    try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') }, body: JSON.stringify({ bu, period, codes }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j.removed_lines ? ` · ตัด ${j.removed_lines} บรรทัดออกจาก TB ทั้งไฟล์${j.deleted_files ? ' (ไม่เหลือข้อมูล ลบไฟล์)' : ''}` : ''; } catch (e) { return ` · ✗ ตัด TB ทั้งไฟล์ไม่สำเร็จ: ${e.message}`; }
  }; // MARKER_GL_DOA_CLEAR_TB_TRIM_RAW_V1
  const dropBackupFile = async (kind, code) => {
    if (!bu || !period) return '';
    if (kind === 'TB') { const t0 = await trimOwnRaw([code]); const t1 = await dropBackupFile2(kind, code); _bc('doa_tb_changed'); return t0 + t1; }
    return dropBackupFile2(kind, code);
  };
  const clearByConfigServer = async (kind, codes) => { // MARKER_GL_DOA_CLEAR_BY_CONFIG_BACKEND_V1 -- Backend ตัดข้อมูลตาม Config ของคุณ (CPC+Account+Sub Acc) ออกจากทุกไฟล์ที่เห็น (ของตัวเอง + ไฟล์ร่วม)
    try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') }, body: JSON.stringify({ bu, period, kind, codes }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); loadLastBk(); _bc('doa_tb_changed'); return j.removed_rows ? ` · Backend ตัดข้อมูล ${kind} ตาม Config ของคุณ ${j.removed_rows} แถว${j.deleted_files ? ' (ไม่เหลือข้อมูล ลบไฟล์ ' + j.deleted_files + ' ไฟล์)' : ''}` : ''; } catch (e) { return ` · ✗ ล้างข้อมูล ${kind} ใน Backend ไม่สำเร็จ: ${e.message}`; }
  };
  const dropBackupFile2 = async (kind, code) => {
    if (!bu || !period) return '';
    if (kind === 'Detail' || kind === 'Simple') return clearByConfigServer(kind, code ? [code] : undefined); // Detail ไม่เก็บใน DB (เก็บเป็น CSV ใน SharePoint ตอน Confirm)
    try {
      const j = await listDoaBackups(bu); const it = (j.items || []).find(x => x.period === period && (x.kind || 'TB') === kind);
      if (!it) return '';
      if (!code) { await removeDoaBackup(it.id); loadLastBk(); return ` · ลบไฟล์ Backup ${kind} งวด ${period} แล้ว`; }
      const d = await getDoaBackup(it.id); const nm = dropAccRows(Array.isArray(d.data) ? d.data : [], code);
      if (!dataRows(nm)) { await removeDoaBackup(it.id); loadLastBk(); return ` · ไม่เหลือข้อมูล จึงลบไฟล์ Backup ${kind} ทั้งไฟล์`; }
      await saveDoaBackup(bu, period, d.file_name, nm, kind); loadLastBk(); return ` · อัปเดตไฟล์ Backup ${kind} (ตัด Account ${code} ออก)`;
    } catch (e) { return ` · ✗ ลบ/อัปเดตไฟล์ Backup ไม่สำเร็จ: ${e.message}`; }
  };
  const dropBackupAccs = async (kind, codes) => { // MARKER_GL_DOA_CLEAR_ALL_BY_CONFIG_V1 -- ล้างทั้งหมด = ตัดเฉพาะ Account ที่อยู่ใน Config/หน้าจอของคุณ ออกจากไฟล์ Backup (Account ของคนอื่นใน BU เดียวกันคงอยู่)
    if (!bu || !period) return '';
    if (kind === 'TB') { const t0 = await trimOwnRaw(codes); const t1 = await dropBackupAccs2(kind, codes); _bc('doa_tb_changed'); return t0 + t1; }
    return dropBackupAccs2(kind, codes);
  };
  const dropBackupAccs2 = async (kind, codes) => {
    if (!bu || !period) return '';
    if (kind === 'Detail' || kind === 'Simple') return clearByConfigServer(kind, codes);
    try {
      const j = await listDoaBackups(bu); const it = (j.items || []).find(x => x.period === period && (x.kind || 'TB') === kind);
      if (!it) return '';
      const d = await getDoaBackup(it.id); let nm = Array.isArray(d.data) ? d.data : []; codes.forEach(c => { nm = dropAccRows(nm, c); });
      if (!dataRows(nm)) { await removeDoaBackup(it.id); loadLastBk(); return ` · ไม่เหลือข้อมูล จึงลบไฟล์ Backup ${kind} ทั้งไฟล์`; }
      await saveDoaBackup(bu, period, d.file_name, nm, kind); loadLastBk(); return ` · อัปเดตไฟล์ Backup ${kind} (ตัด ${codes.length} Account ของคุณออก)`;
    } catch (e) { return ` · ✗ ลบ/อัปเดตไฟล์ Backup ไม่สำเร็จ: ${e.message}`; }
  };
  const clearAcc = async (kind, a) => { // ล้างเฉพาะ Account นี้ ของประเภทนี้
    if (kind === 'TB') { if (!await askDoa(`ล้าง Account ${a.code} ออกจาก TB (บนหน้าจอ และในไฟล์ Backup ของงวด ${period || '-'} ถ้ามี)?`)) return; delete rawRef.current.TB; persistRaw(period); setTbAcc(prev => prev.filter(x => x.code !== a.code)); setTbMatrix(prev => dropAccRows(prev, a.code)); dropBackupFile('TB', a.code).then(t => setDbMsg(`✓ ล้าง Account ${a.code} ออกจาก TB แล้ว` + t)); return; }
    const set = kind === 'Detail' ? detAcc : simAcc;
    if (!set.has(a.code)) { setDbMsg(`Account ${a.code} ยังไม่มีข้อมูล ${kind} ให้ล้าง`); return; }
    if (!await askDoa(`ล้าง ${kind} ของ Account ${a.code}?\n\nBU ${bu || '-'} · งวด ${period || '-'}\n\n• ลบเฉพาะข้อมูลของ Account ${a.code} — Account อื่นไม่ถูกแตะ\n• ล้างแล้วต้องโยนไฟล์ ${kind} ใหม่`)) return; /* MARKER_GL_DOA_CLEAR_DIALOG_TEXT_V1 */
    delete rawRef.current[kind]; persistRaw(period);
    (kind === 'Detail' ? setDetAcc : setSimAcc)(prev => { const n = new Set(prev); n.delete(a.code); return n; });
    if (kind === 'Simple') setSimMatrix(prev => dropAccRows(prev, a.code)); if (kind === 'Detail') setDetMatrix(prev => dropAccRows(prev, a.code));
    dropBackupFile(kind, a.code).then(t => setDbMsg(`✓ ล้างข้อมูล ${kind} ของ Account ${a.code} แล้ว` + t));
  };
  const clearType = async (kind) => { // ล้างทั้งประเภท (ทุก Account) — Simple ล้างทั้งหมดได้แล้ว (ผู้ใช้สั่ง 2026-10-17)
    const codesAll = kind === 'TB' ? tbAcc.map(x => x.code) : (kind === 'Detail' ? [...detAcc] : [...simAcc]);
    const n = codesAll.length;
    if (!n) { setDbMsg(`ยังไม่มีข้อมูล ${kind} ให้ล้าง`); return; }
    if (!await askDoa(`ล้าง ${kind} ทั้งหมดของคุณ?\n\nBU ${bu || '-'} · งวด ${period || '-'}\nAccount ที่จะล้าง: ${n} Account (ตาม Config ของคุณ)\n\n• ลบเฉพาะข้อมูลของ ${n} Account นี้ — Account ของคนอื่นไม่ถูกแตะ\n• ไฟล์ใน DB จะถูกลบทั้งไฟล์ก็ต่อเมื่อไม่เหลือข้อมูลของใครเลย\n• ล้างแล้วต้องโยนไฟล์ ${kind} ใหม่`)) return;
    delete rawRef.current[kind]; persistRaw(period);
    if (kind === 'TB') { setTbAcc([]); setTbMatrix([]); setTbName(''); } else (kind === 'Detail' ? setDetAcc : setSimAcc)(new Set()); if (kind === 'Simple') { setSimMatrix([]); setSimName(''); } if (kind === 'Detail') setDetMatrix([]);
    dropBackupAccs(kind, codesAll).then(t => setDbMsg(`✓ ล้างข้อมูล ${kind} ทั้งหมดแล้ว` + t));
  };
  const fileRef = React.useRef(null);
  const loadMine = React.useCallback(() => { myDoaConfig().then(setMine).catch(() => setMine(null)); const me = String(currentUser?.email || '').toLowerCase(); listDoaConfig('').then(rs => setMyRules(rs.filter(r => String(r.user_email).toLowerCase() === me))).catch(() => setMyRules([])); }, [currentUser]);
  useRealtimeRefresh(['doa_config_changed'], () => { loadMine(); }, 60000); // Auto Refresh รายการ BU/Account ของหน้าหลักเมื่อ Config เปลี่ยน
  React.useEffect(() => {
    loadMine();
    fetchCollection('CompanyList').then(l => {
      if (!Array.isArray(l)) return;
      const seen = new Set();
      setBuOptions(l.map(x => ({ value: String(x.bu || '').trim(), label: `${String(x.bu || '').trim()} ${x['THAI COMPANY NAME'] || ''}`.trim(), com: String(x.SEGMENT3 || x.segment3 || '').trim() })).filter(o => o.value && !NON_GL_BUS.has(o.value) && !seen.has(o.value) && seen.add(o.value)));
    }).catch(() => {});
    db.from('user_signoff_profile').select('owner_email, module').then(({ data }) => { if (Array.isArray(data)) { const m = {}; data.forEach(x => { if (x.owner_email && x.module) m[String(x.owner_email).toLowerCase()] = x.module; }); setMods(m); } }).catch(() => {});
    db.from('user_roles').select('email, username').then(({ data }) => { if (Array.isArray(data)) setUsers(data.filter(u => u.email)); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const popResult = (type, label, f, codes, extra, ov, allCodes = []) => { // สรุปผลการโยนไฟล์เป็น Popup (ใช้ BU/งวดที่ระบบตรวจพบ ไม่ใช่ค่า State เดิมที่ยังไม่อัปเดต)
    const ub = (ov && ov.bu != null) ? ov.bu : bu; const up = (ov && ov.period) || period;
    const dif = ov && ov.diff; const noChgP = !!(dif && !dif.added.length && !dif.changed.length && !dif.removed.length); // MARKER_GL_DOA_TB_DIFF_V1 -- Config (ซ้าย/ขวา) แสดงครบเสมอ ส่วนต่างแสดงเฉพาะรายการที่เปลี่ยน
    const cfgAcc = [...new Set(myRules.filter(x => x.bu === ub).map(x => x.account))]; const miss = cfgAcc.filter(c => !codes.has(c));
    const cfg = (ov && ov.cfg) || { ok: cfgAcc.length > 0, text: cfgAcc.length ? `✓ มี Config แล้ว — BU ${ub} · ${cfgAcc.length} Account` : '✗ ยังไม่มี Config สำหรับ BU นี้ — กดปุ่ม Config เพื่อตั้งค่า' };
    const rows = [['ประเภทไฟล์', type + (ov && ov.det ? ` (ตรวจพบจาก${ov.det})` : '')], ['ไฟล์', label + (ov && ov.orig && ov.orig !== label ? `  (ต้นฉบับ ${ov.orig})` : '')]];
    rows.push(['COM / BU', `${(ov && ov.com) || '—'} → BU ${ub || '—'}`]); rows.push(['งวด', up || '—']);
    const tbLists = type === 'TB' && ub && allCodes.length; /* MARKER_GL_DOA_TB_SAME_SHOW_V1 -- TB ไม่เปลี่ยนแปลงก็แสดงรายการ Account ครบ (สถานะ คงที่) */ // TB: มีรายการ ซ้าย/ขวา แทนแล้ว ไม่ต้องซ้ำ
    if (!tbLists) rows.push(['Config ของคุณ', cfg.text]);
    rows.push(['แถวข้อมูลในไฟล์', f.filtered ? `${f.total} รายการ → คัดตาม Config เหลือ ${f.kept} รายการ` : (ub ? 'ทั้งหมด (ไม่พบคอลัมน์ให้คัด)' : 'ทั้งหมด (ยังไม่คัด เพราะไม่มี BU/Config)')]);
    const cs = new Set(cfgAcc); const inCfg = allCodes.filter(c => cs.has(c)); const noC = allCodes.filter(c => !cs.has(c)); const lst = (a) => a.length ? `${a.length} Account (${a.slice(0, 12).join(', ')}${a.length > 12 ? ' …' : ''})` : '—';
    if (allCodes.length) { rows.push(['Account ในไฟล์', `${allCodes.length} Account`]); if (type !== 'TB') { rows.push(['มี Config แล้ว', lst(inCfg)]); } if (type !== 'TB') rows.push(['ยังไม่มี Config', noC.length ? lst(noC) + (ub ? ' — ไม่นำเข้า (ตั้งเพิ่มที่ปุ่ม Config ถ้าต้องการ)' : '') : '—']); /* TB มีทุก Account อยู่แล้ว: ไม่แสดง/ไม่ต้องผูก */ }
    if (type === 'Detail' && allCodes.length) { try { const rc = rowsPerAcc(f.matrix); const ks = inCfg.filter(c => rc[c]); const tot = ks.reduce((t, c) => t + rc[c], 0); rows.push(['สรุป Detail (Account ที่มี Config)', ks.length ? `${ks.length} Account · ${tot.toLocaleString('en-US')} รายการ` : 'ไม่มี Account ที่มี Config']); if (ks.length) rows.push(['จำนวนรายการแยกตาม Account', ks.map(c => `${c}${(allCodes.names && allCodes.names[c]) ? ' ' + allCodes.names[c] : ''}: ${rc[c].toLocaleString('en-US')}`).join('  |  ')]); } catch (e) { /* ignore */ } }
    if (!tbLists) rows.push(['นำเข้า (ตาม Config)', `${codes.size} Account${codes.size && codes.size <= 12 ? ' (' + [...codes].join(', ') + ')' : ''}`]);
    if (ub && cfgAcc.length && miss.length) rows.push(['Config ที่ไม่พบในไฟล์', `${miss.slice(0, 10).join(', ')}${miss.length > 10 ? ' …' : ''}`]);
    if (f.filtered && !f.cpcCol) rows.push(['หมายเหตุ', 'ไม่พบคอลัมน์ CPC ในไฟล์ จึงไม่ได้คัดตาม CPC']);
    if (f.filtered && !f.subCol) rows.push(['หมายเหตุ', 'ไม่พบคอลัมน์ Sub Acc ในไฟล์ จึงไม่ได้คัดตาม Sub Acc']);
    if (dif) { const L = (a) => a.length ? `${a.length} Account (${a.slice(0, 12).join(', ')}${a.length > 12 ? ' …' : ''})` : '—'; if (noChgP) { rows.push(['ผลเทียบกับ TB เดิม', `ไม่มีการเปลี่ยนแปลง — ${codes.size} Account ตาม Config ข้อมูลเหมือนเดิมทุกรายการ (ไม่ต้องบันทึกซ้ำ)`]); } else { rows.push(['เทียบกับ TB เดิม', 'แสดงเฉพาะรายการที่เปลี่ยนแปลง']); rows.push(['เพิ่มใหม่', L(dif.added)]); rows.push(['ข้อมูลเปลี่ยน', L(dif.changed)]); rows.push(['หายไปจากไฟล์', L(dif.removed)]); } }
    if (ov && ov.warn) ov.warn.forEach(t => rows.push(['คำเตือน', t]));
    // MARKER_GL_DOA_BIND_CONFIG_V1 -- ปุ่ม "ผูก Config": Account ในไฟล์ที่ยังไม่มี Config -> เพิ่มเข้า Config ของ User ที่ล็อกอิน (CPC = BBBBB, Sub Acc = BBBBBB) แล้วคัดไฟล์ใหม่ทันที
    const meMail = currentUser?.email || ''; const canBind = !!(false /* MARKER_GL_DOA_NO_BIND_DETAIL_V1 -- ผูก/เพิ่ม Config ทำได้เฉพาะตอนโยน TB (รายการ + Add) */ && ub && noC.length && meMail && buOptions.some(o => String(o.value) === String(ub)));
    const bindAction = canBind ? { label: `ผูก Config ${noC.length} Account (CPC = BBBBB, Sub Acc = BBBBBB)`, run: async () => {
      try {
        await addDoaConfig(meMail, noC.map(a => ({ bu: ub, cpc: 'BBBBB', cpc_mode: 'accept', account: a, sub_acc: 'BBBBBB', sub_mode: 'accept' })));
        broadcastWs('doa_config_changed', { by: meMail }); loadMine();
        setNotice({ tone: 'ok', title: 'ผูก Config แล้ว', rows: [['BU', ub], ['User', meMail], ['Account ที่เพิ่ม', lst(noC)], ['CPC / Sub Acc', 'BBBBB / BBBBBB (ทุกค่า)']], lines: ['ระบบคัดไฟล์ใหม่ตาม Config ให้แล้ว — แก้ไขภายหลังได้ที่ปุ่ม Config'] });
      } catch (e) { setNotice({ tone: 'err', title: 'ผูก Config ไม่สำเร็จ', lines: [e.message] }); }
    } } : null;
    const canPick = !!(type === 'TB' && ub && allCodes.length && meMail && buOptions.some(o => String(o.value) === String(ub)));
    const cfgLab = {}; myRules.filter(x => x.bu === ub).forEach(x => { (cfgLab[x.account] = cfgLab[x.account] || []).push(`${x.cpc_mode === 'exclude' ? '✗' : ''}${x.cpc}-${x.account}-${x.sub_mode === 'exclude' ? '✗' : ''}${x.sub_acc}`); });
    const meL = String(meMail).toLowerCase(); const reloadRules = async () => (await listDoaConfig('')).filter(r => String(r.user_email || '').toLowerCase() === meL && r.bu === ub);
    const pick = canPick ? { have: inCfg, none: noC, rawM: allCodes.m || null, com: (ov && ov.com) || ((buOptions.find(o => o.value === ub) || {}).com) || '', names: allCodes.names || {}, sums: allCodes.sums || {}, bu: ub, cfgLab, rules: myRules.filter(r => r.bu === ub && allCodes.includes(r.account)), inFile: allCodes.slice(), reload: reloadRules,
      upd: async (r, cpc, sub) => { await removeDoaConfig(r.id); await addDoaConfig(meMail, [{ bu: ub, cpc, cpc_mode: r.cpc_mode || 'accept', account: r.account, sub_acc: sub, sub_mode: r.sub_mode || 'accept' }]); broadcastWs('doa_config_changed', { by: meMail }); loadMine(); }, /* MARKER_GL_DOA_EDIT_LEFT_V1 -- แก้ CPC / Sub Acc ของ Config เดิมจาก popup */ split: async (r, cpcs) => { await addDoaConfig(meMail, cpcs.map(c => ({ bu: ub, cpc: c, cpc_mode: 'accept', account: r.account, sub_acc: r.sub_acc, sub_mode: r.sub_mode || 'accept' }))); await removeDoaConfig(r.id); broadcastWs('doa_config_changed', { by: meMail }); loadMine(); }, /* MARKER_GL_DOA_DRILL_SPLIT_CPC_V1 -- แทนแถว BBBBB ด้วย CPC ที่เลือก */ add: async (sel) => { // sel = [{ account, cpc, sub }]
      await addDoaConfig(meMail, sel.map(a => ({ bu: ub, cpc: a.cpc || 'BBBBB', cpc_mode: 'accept', account: a.account, sub_acc: a.sub || 'BBBBBB', sub_mode: 'accept' })));
      broadcastWs('doa_config_changed', { by: meMail }); loadMine();
    } } : null; // MARKER_GL_DOA_TB_PICK_BIND_V1 -- TB: แบ่ง 2 รายการ (มี Config / ยังไม่มี Config) เลือกผูกเฉพาะ Account ที่ต้องการ
    const noCfg = cfg.ok === false;
    const saveAct = pendBk.current && pendBk.current.kind === type ? pendBk.current : null; pendBk.current = null;
    let sums = null; if (type === 'TB' && f && f.matrix) { const chg = dif ? new Set([...dif.added, ...dif.changed]) : null; const add = dif ? new Set(dif.added) : null; sums = tbAccSums(f.matrix).map(o => ({ ...o, st: !dif ? 'new' : (add.has(o.code) ? 'new' : (chg.has(o.code) ? 'upd' : 'same')) })); try { sums.det = tbCpcSums(f.matrix); } catch (e) { sums.det = []; } } // MARKER_GL_DOA_TB_SUMS_V1
    setNotice({ sums, pick, save: saveAct, action: bindAction, tone: (!codes.size || noCfg) ? (noCfg ? 'warn' : 'err') : ((miss.length || (ov && ov.warn && ov.warn.length)) ? 'warn' : 'ok'), title: noChgP ? 'ไม่มีการเปลี่ยนแปลง — TB คงที่ (ยอดเหมือนเดิมทุก Account)' : noCfg ? `โยนไฟล์ ${type} แล้ว แต่ยังไม่มี Config` : (codes.size ? `โยนไฟล์ ${type} สำเร็จ` : `ไม่พบ Account ตาม Config ในไฟล์ ${type}`), rows });
  };
  const applyType = (type, m0, label, extra = '', pop = false, ov = null) => {
    const ubu = (ov && ov.bu != null) ? ov.bu : bu;
    const comOf = (buOptions.find(o => o.value === ubu) || {}).com;
    const f = ubu ? filterByConfig(m0, myRules, ubu, comOf, type === 'Simple') : { matrix: m0, filtered: false, total: 0, kept: 0 };
    let m = f.matrix; let tbCut = []; // MARKER_GL_DOA_DETAIL_SIMPLE_BY_TB_V1
    if (type !== 'TB' && tbAcc.length) { const ts = new Set(tbAcc.map(a => String(a.code))); tbCut = matrixToAccounts(m).accounts.map(a => a.code).filter(c => !ts.has(String(c))); if (tbCut.length) m = keepAccs(m, ts); }
    const r = matrixToAccounts(m);
    const note0 = (tbCut.length ? ` · ไม่อยู่ใน TB ของงวด ตัดออก ${tbCut.length} Account (${tbCut.slice(0, 6).join(', ')}${tbCut.length > 6 ? ' …' : ''})` : '') + (f.filtered ? ` · คัดตาม Config ${f.kept}/${f.total} แถว${f.cpcCol ? '' : ' (ไม่พบคอลัมน์ CPC)'}${f.subCol ? '' : ' (ไม่พบคอลัมน์ Sub Acc)'}` : (ubu ? '' : ' · เลือก BU เพื่อคัดตาม Config'));
    const note = note0 + extra;
    if (type !== 'TB') { // Detail / Simple
      const codes = new Set(r.accounts.map(a => a.code));
      (type === 'Detail' ? setDetAcc : setSimAcc)(codes); if (type === 'Detail') setDetMatrix(m); if (type === 'Simple') { setSimMatrix(m); setSimName(label); }
      setTbMsgFull(codes.size ? `✓ ${label} (${type}): พบ ${codes.size} Account${note}` : `✗ ไม่พบ Account ตาม Config ในไฟล์ ${type}${note}`); setTbMsg(codes.size ? `✓ ${label} (${type}): พบ ${codes.size} Account${note0}` : `✗ ไม่พบ Account ตาม Config ในไฟล์ ${type}${note0}`);
      if (pop && (type === 'Simple' || type === 'Detail')) autoBackup(type, m, /* MARKER_GL_DOA_DETAIL_TO_DB_V1 -- Detail เข้า DB (เก็บ 1 เดือน) เหมือน Simple */ label, ubu, (ov && ov.period) || period);
      if (pop) popResult(type, label, f, codes, extra, ov, accList(m0));
      return;
    }
    setTbMatrix(m); setTbName(label);
    setTbAcc(r.accounts);
    let ov2 = ov; if (pop && tbMatrix && tbMatrix.length && ubu === bu && ((ov && ov.period) || period) === period) ov2 = { ...(ov || {}), diff: tbDiff(tbMatrix, m) };
    const noChg = !!(ov2 && ov2.diff && !ov2.diff.added.length && !ov2.diff.changed.length && !ov2.diff.removed.length);
    if (pop && !noChg) autoBackup('TB', m, label, ubu, (ov && ov.period) || period, m0);
    if (pop) popResult('TB', label, f, new Set(r.accounts.map(a => a.code)), extra, ov2, accList(m0));
    setTbMsgFull(`✓ ${label}: พบ ${r.accounts.length} Account${note}`); setTbMsg(r.accounts.length ? `✓ ${label} (TB): พบ ${r.accounts.length} Account${r.header ? '' : ' (ไม่พบหัวคอลัมน์ Account ใช้คอลัมน์แรก)'}${note0}` : '✗ ไม่พบ Account ในข้อมูล — ตรวจว่ามีหัวคอลัมน์ Account หรือรหัสบัญชีอยู่คอลัมน์แรก');
  };
  // MARKER_GL_DOA_SAME_DATA_NOCHANGE_V1 -- โยน/วางข้อมูลเดิมซ้ำ (เหมือนเดิมทุกเซลล์) = แจ้ง "ไม่มีการเปลี่ยนแปลง" ไม่ประมวลผลซ้ำ
  const sigOf = (m) => { const t = JSON.stringify(m); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return t.length + ':' + h; };
  const applyMatrix = async (m, label) => {
    if (spLoaded && !sp.err && !(sp.my_name && sp.report_to_name && sp.module)) { setTbMsg('✗ ยังไม่ได้ตั้งค่า Profile — ตั้งค่าก่อนจึงโยนข้อมูลได้'); setNotice({ tone: 'err', title: 'ยังไม่ได้ตั้งค่า Profile — โยนข้อมูลไม่ได้', rows: [['ไฟล์', label]], lines: ['กรอก ชื่อผู้จัดทำ / ผู้สอบทาน / Module ที่กล่องด้านขวา แล้วกด "บันทึกเข้า Profile" ก่อน (ใช้ Module ในการ Stamp TB กลางว่า Account ถูกใช้โดย Module ไหน)'] }); return; } // MARKER_GL_DOA_REQUIRE_PROFILE_V1
    if (!spLoaded) { setTbMsg('กำลังตรวจ Profile — ลองโยนอีกครั้ง'); return; }
    // เทียบทั้ง "ข้อมูลในไฟล์" และ "Config ทั้งหมดของ BU นี้" — ไฟล์เดิมแต่ Config เปลี่ยน (เพิ่ม/ลบ Account, CPC, Exclude) ต้องประมวลผลใหม่
    const cfgSig = bu + '|' + myRules.filter(r => r.bu === bu).map(r => [r.account, r.cpc, r.cpc_mode, r.sub_acc, r.sub_mode].join('~')).sort().join(',');
    const sig = sigOf(m) + '#' + sigOf(cfgSig); const det = detectForm(m, label); const type = det.type; const prev = rawRef.current[type];
    if (prev && prev.sig === sig && type !== 'TB') { // MARKER_GL_DOA_NOCHG_DETAIL_V1 -- ไม่มีการเปลี่ยนแปลง: แสดงด้วยว่ามี Account อะไรที่เข้าแล้ว (ตาม Config) / อะไรไม่อยู่ใน Config
      setTbMsg(`ไม่มีการเปลี่ยนแปลง — ข้อมูล ${type} และ Config เหมือนเดิม (${label})`);
      const rows0 = [['ประเภทไฟล์', type], ['ไฟล์', label]];
      try {
        const comOf0 = (buOptions.find(o => o.value === bu) || {}).com; const src = type === 'Simple' ? prev.m : m;
        const f0 = bu ? filterByConfig(src, myRules, bu, comOf0, type === 'Simple') : null; const kept = f0 ? matrixToAccounts(f0.matrix).accounts.map(a => a.code) : [];
        const allC = accList(src); const ks = new Set(kept); const out = allC.filter(c => !ks.has(c));
        const L = (a) => a.length ? `${a.length} Account (${a.slice(0, 12).join(', ')}${a.length > 12 ? ' …' : ''})` : '—';
        rows0.push(['COM / BU', `${comOf0 || '—'} → BU ${bu || '—'}`], ['งวด', period || '—']);
        if (f0 && f0.filtered) rows0.push(['แถวข้อมูลในไฟล์', `${f0.total} รายการ → คัดตาม Config เหลือ ${f0.kept} รายการ`]);
        rows0.push(['Account ในไฟล์', `${allC.length} Account`], ['เข้าแล้ว (ตาม Config) — ไม่เปลี่ยนแปลง', L(kept)], ['ไม่อยู่ใน Config — ไม่นำเข้า', L(out)]);
      } catch (_) { /* แสดงแบบย่อ */ }
      setNotice({ tone: 'warn', title: 'ไม่มีการเปลี่ยนแปลง', rows: rows0, lines: ['ข้อมูลในไฟล์และ Config เหมือนครั้งก่อนทุกอย่าง จึงไม่ได้ประมวลผลซ้ำ'] }); return; }
    let mm = m, rnote = '', rfCom = '', fPeriod = '', rfName = '', rfBrand = '', buRes = bu;
    if (type === 'Simple') { const rf = reformSimple(m); if (rf) { mm = rf.matrix; rfCom = rf.comCode; fPeriod = rf.period; rfName = rf.fileName; rfBrand = rf.bu; rnote = ` · Reform แล้ว (ดึงข้อมูลบรรทัดบนลงล่าง ${rf.merged} รายการ · เหลือ ${rf.rows} แถว)`; } }
    if (type === 'TB') { const h0 = parseTbHeader(m); if (h0) fPeriod = h0.period; }
    // MARKER_GL_DOA_SAME_AS_DB_V1 -- ข้อมูลที่โยนเหมือนกับที่โหลดมาจาก DB ทุกเซลล์ (ไม่มีการเปลี่ยนแปลง) → ไม่ประมวลผล/ไม่ถามบันทึกซ้ำ
    { const pv = rawRef.current[type]; if (type === 'Simple' && pv && pv.fromDb && pv.dbSig === sigOf(JSON.parse(JSON.stringify(mm)))) { setTbMsg(`ไม่มีการเปลี่ยนแปลง — ข้อมูล ${type} เหมือนที่บันทึกใน DB (${label})`); setNotice({ tone: 'warn', title: 'ไม่มีการเปลี่ยนแปลง', rows: [['ประเภทไฟล์', type], ['ไฟล์', label]], lines: ['ข้อมูลในไฟล์เหมือนที่บันทึกใน DB ทุกอย่าง จึงไม่ได้ประมวลผลและไม่บันทึกซ้ำ'] }); return; } }
    if ((type === 'Detail' || type === 'Simple') && !tbAcc.length && !(rawRef.current && rawRef.current.TB)) { setTbMsg(`✗ ยังไม่มี TB — โยน TB ก่อนจึงโยน ${type} ได้`); setNotice({ tone: 'err', title: `ยังไม่มี TB — โยน ${type} ไม่ได้`, rows: [['ไฟล์', label]], lines: [`${type} เข้าตาม TB เป็นหลัก (เฉพาะ Account ที่อยู่ใน TB ของงวดและผ่าน Config) กรุณาโยน TB ของงวดนี้ก่อน`] }); return; } // MARKER_GL_DOA_DETAIL_SIMPLE_BY_TB_V1
    const dInfo = type === 'Detail' ? detailInfo(m, label) : null; if (dInfo && dInfo.period) fPeriod = dInfo.period;
    const tbBr = (type === 'TB' && !parseTbHeader(m)) ? tbBranchCom(m) : ''; // MARKER_GL_DOA_PASTE_TB_BRANCH_V1
    if (fPeriod) { if (periodOptions.includes(fPeriod)) { if (period !== fPeriod) switchPeriod(fPeriod); rnote += ` · งวด ${fPeriod}`; } else rnote += ` · ⚠ งวด ${fPeriod} อยู่นอก 3 เดือนล่าสุด`; }
    rawRef.current[type] = { m: mm, label, sig }; persistRaw(fPeriod && periodOptions.includes(fPeriod) ? fPeriod : period);
    // MARKER_GL_DOA_COM_CONFIG_CHECK_V1 -- อ่าน COM จาก Header ในไฟล์ → Lookup เป็น BU → เช็คว่า COM นี้มี Config อะไรไว้บ้าง (ถ้ามี BU เดียวที่มี Config และยังไม่ได้เลือก/เลือกไม่ตรง จะเลือกให้)
    let cmsg = ''; let cfgInfo = null; const warns = []; const hd0 = parseTbHeader(m); const skCom = segKeyCom(m); const hd = (hd0 && hd0.comCode) ? hd0 : (rfCom ? { comCode: rfCom } : (skCom ? { ...(hd0 || {}), comCode: skCom } : ((dInfo && dInfo.com) ? { ...(hd0 || {}), comCode: dInfo.com } : (tbBr ? { ...(hd0 || {}), comCode: tbBr } : hd0)))); const zz = (x) => String(x || '').replace(/^0+/, '');
    if (hd && hd.comCode) {
      const cands = buOptions.filter(o => zz(o.com) === zz(hd.comCode) || zz(o.value) === zz(hd.comCode));
      const withCfg = cands.filter(o => myRules.some(r => r.bu === o.value));
      const sumOf = (b) => { const accs = [...new Set(myRules.filter(r => r.bu === b).map(r => r.account))]; return `${accs.length} Account (${accs.slice(0, 6).join(', ')}${accs.length > 6 ? ' …' : ''})`; };
      if (!cands.length) { cmsg = ` · ⚠ ไม่พบ COM ${hd.comCode} ในรายการ BU ที่ตั้ง Config ไว้`; cfgInfo = { ok: false, text: `✗ ยังไม่มี Config — ไม่พบ COM ${hd.comCode} ในรายการ BU (กดปุ่ม Config เพื่อตั้งค่า)` }; }
      else if (!withCfg.length) { buRes = cands[0].value; cmsg = ` · ⚠ COM ${hd.comCode} (BU ${cands.map(o => o.value).join(', ')}) ยังไม่มี Config`; cfgInfo = { ok: false, text: `✗ ยังไม่มี Config สำหรับ COM ${hd.comCode} (BU ${cands.map(o => o.value).join(', ')}) — กดปุ่ม Config เพื่อตั้งค่าก่อน` }; }
      else if (withCfg.some(o => o.value === bu)) { cmsg = ` · COM ${hd.comCode} → BU ${bu}: Config ${sumOf(bu)}`; cfgInfo = { ok: true, text: `✓ มี Config แล้ว — BU ${bu} · ${sumOf(bu)}` }; }
      else if (withCfg.length === 1) { setBu(withCfg[0].value); buRes = withCfg[0].value; cmsg = ` · COM ${hd.comCode} → เลือก BU ${withCfg[0].value} ให้: Config ${sumOf(withCfg[0].value)}`; cfgInfo = { ok: true, text: `✓ มี Config แล้ว — BU ${withCfg[0].value} · ${sumOf(withCfg[0].value)} (ระบบเลือก BU ให้จาก COM)` }; }
      else { cmsg = ` · COM ${hd.comCode} มีหลาย BU ที่มี Config (${withCfg.map(o => o.value).join(', ')}) — เลือก BU เอง`; cfgInfo = { ok: null, text: `⚠ COM ${hd.comCode} มีหลาย BU ที่มี Config (${withCfg.map(o => o.value).join(', ')}) — เลือก BU เอง` }; }
    }
    // MARKER_GL_DOA_SIMPLE_RENAME_V1 -- ตั้งชื่อไฟล์ Simple ใหม่ตอนโยนเข้า: <COM>_<BU>_OutstandingSimple_<YYYY.MM>
    if (type === 'Simple' && rfName) { const nm = `${rfCom || (hd && hd.comCode) || 'COM'}_${buRes || rfBrand || 'BU'}_OutstandingSimple_${fPeriod || period || 'YYYY.MM'}`; rnote += ` · เปลี่ยนชื่อไฟล์เป็น ${nm} (ต้นฉบับ ${label})`; rfName = nm; rawRef.current[type].label = nm; }
    if (fPeriod && !periodOptions.includes(fPeriod)) warns.push(`งวดในไฟล์ ${fPeriod} อยู่นอก 3 เดือนล่าสุด จึงไม่ได้ตั้งช่องงวดให้`);
    if (!hd || !hd.comCode) { const own = buRes && myRules.some(r => r.bu === buRes); cfgInfo = own ? { ok: true, text: `✓ มี Config แล้ว — BU ${buRes} · ${[...new Set(myRules.filter(r => r.bu === buRes).map(r => r.account))].length} Account` } : { ok: false, text: buRes ? `✗ BU ${buRes} ยังไม่มี Config — กดปุ่ม Config เพื่อตั้งค่าก่อน` : '✗ ยังไม่ได้เลือก BU — เลือก BU ก่อน หรือตั้ง Config ที่ปุ่ม Config' }; }
    if (type === 'TB') saveRawTb(buRes, (fPeriod && periodOptions.includes(fPeriod)) ? fPeriod : period, label, mm); // MARKER_GL_DOA_TB_CENTRAL_ON_DROP_V1 -- โยน TB เข้า = เก็บ TB กลาง (ทั้งไฟล์) ให้ Backend ตรวจกับ Config ทั้งหมดแล้ว Stamp Module | Account ที่ไม่มี Module ใช้ = Standby ดูที่ Admin Operation
    applyType(type, mm, (type === 'Simple' && rfName) ? rfName : label, ` · ตรวจพบเป็น ${type} (จาก${det.why})` + rnote + cmsg, true, { bu: buRes, period: (fPeriod && periodOptions.includes(fPeriod)) ? fPeriod : period, com: (hd && hd.comCode) || '', cfg: cfgInfo, orig: label, det: det.why, warn: warns });
  };
  React.useEffect(() => { Object.keys(rawRef.current).forEach(t => { const r = rawRef.current[t]; const cfgSig = bu + '|' + myRules.filter(x => x.bu === bu).map(x => [x.account, x.cpc, x.cpc_mode, x.sub_acc, x.sub_mode].join('~')).sort().join(','); rawRef.current[t] = { ...r, sig: sigOf(r.m) + '#' + sigOf(cfgSig) }; applyType(t, r.m, r.label); }); }, [bu, myRules, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const onFile = async (f) => {
    if (!f) return;
    try { applyMatrix(await fileToMatrix(f), f.name); } catch (e) { setTbAcc([]); setTbMsg('✗ อ่านไฟล์ไม่ได้: ' + e.message); setNotice({ tone: 'err', title: 'อ่านไฟล์ไม่ได้', rows: [['ไฟล์', f.name]], lines: [e.message] }); }
  };

  const [cfmAcc, setCfmAcc] = React.useState({});
  const DOA_CFM_EXPIRE_DAYS = 40; /* MARKER_GL_DOA_CONFIRM_EXPIRY_40D_V1 -- อายุ Badge หลัง Confirm = 40 วัน */
  const [cfmAt, setCfmAt] = React.useState({}); const [cfmSrc, setCfmSrc] = React.useState({}); /* MARKER_GL_DOA_CONFIRM_SRC_FILE_V1 -- Stamp ชื่อไฟล์ Backup ที่ดึงข้อมูลมา ตอน Confirm */ /* MARKER_GL_DOA_CONFIRM_EXPIRY_V1 -- วัน Confirm ต่อ Account (ms) -> Badge หมดอายุ = +30 วัน | เก็บใน localStorage ของ browser นี้ */
  const cfmKey = `doa_cfm_${bu}_${period}`;
  React.useEffect(() => { try { const j = JSON.parse(localStorage.getItem(cfmKey) || '{}'); const at = {}, ac = {}, sr = {}; Object.keys(j).forEach(k => { at[k] = j[k].at; ac[k] = j[k].f; sr[k] = j[k].sf || ''; }); setCfmAt(at); setCfmAcc(ac); setCfmSrc(sr); } catch (e) { setCfmAt({}); } }, [cfmKey]);
  const markCfm = (code, f) => { const t = Date.now(); const sf = (() => { try { const id = String((bkAcc[code] || {}).sel || ''); const it = id ? bkFiles.find(x => String(x.id) === id) : null; return it ? (it.file_name || '') : ''; } catch (e) { return ''; } })(); setCfmAt(p => ({ ...p, [code]: t })); setCfmSrc(p => ({ ...p, [code]: sf })); try { const j = JSON.parse(localStorage.getItem(cfmKey) || '{}'); j[code] = { at: t, f, sf }; localStorage.setItem(cfmKey, JSON.stringify(j)); } catch (e) { /* ไม่มี storage */ } };
  const unmarkCfm = (code) => { setCfmSrc(p => { const n = { ...p }; delete n[code]; return n; }); setCfmAt(p => { const n = { ...p }; delete n[code]; return n; }); try { const j = JSON.parse(localStorage.getItem(cfmKey) || '{}'); delete j[code]; localStorage.setItem(cfmKey, JSON.stringify(j)); } catch (e) { /* ไม่มี storage */ } };
  const DOA_SP_DEST = 'gl'; // MARKER_GL_DOA_SP_DEST_V1 -- ปลายทาง SharePoint ของ Detail (gl = Z_Detail of Account ใต้ _Taii\Reconcile_Backup — ต้องใช้ Handler v15 ขึ้นไป)
  const confirmDetail = async (a) => {
    if (!bu || !period) { setDbMsg('เลือก BU และงวดก่อน Confirm'); return; }
    const rows = detAcc.has(a.code) ? detailRows(detMatrix).filter(o => String(o.account_code) === String(a.code)) : [];
    if (!detAcc.has(a.code)) { setCfmAcc(p => ({ ...p, [a.code]: 'Confirm แล้ว (Simple — ไม่ส่งไฟล์ Detail)' })); markCfm(a.code, 'Confirm แล้ว (Simple — ไม่ส่งไฟล์ Detail)'); return; }
    if (!rows.length) { setDbMsg(`Account ${a.code} ไม่มีข้อมูล Detail ให้ Confirm`); return; }
    const com = detailInfo(detMatrix, '').com;
    const spBu = /^[0-9][0-9A-Za-z]{2,7}$/.test(String(com || '')) ? String(com) : (/^[0-9][0-9A-Za-z]{2,7}$/.test(String(bu)) ? String(bu) : ''); /* MARKER_GL_DOA_SP_COM_FOLDER_V1 -- โฟลเดอร์ SharePoint ใช้รหัส COM ตัวเลข (เช่น 0572) ไม่ใช่ชื่อ BU (REV) */
    if (!spBu) { setNotice({ tone: 'err', title: 'Confirm ไม่ได้', lines: ['หารหัส COM (ตัวเลข เช่น 0572) ของ Detail ไม่พบ จึงไม่ทราบโฟลเดอร์ SharePoint ปลายทาง'] }); return; }
    let fname = [com, bu, 'DOH', period, a.code].filter(Boolean).join('_') + '.xlsx';
    if (!await askDoa(`Confirm Detail ของ Account ${a.code}?\n\nไฟล์: Reconcile Excel ของ Account ${a.code} (ชื่อไฟล์ตามปุ่ม Download Excel) (${rows.length} แถว Detail)\nระบบสร้างไฟล์ Reconcile (Excel ตัวเดียวกับปุ่ม Download Excel) แล้วส่งเข้าโฟลเดอร์ SharePoint Z_Detail of Account ผ่าน Handler และเพิ่ม Backup ของ Account นี้ (สะสม ไม่ซ้ำ) (BU ${bu} · งวด ${period})\nถ้ามีไฟล์ชื่อเดียวกันอยู่แล้วจะถูกแทนที่`)) return;
    try {
      const dlName = await new Promise(res => setRcSend({ code: a.code, res })); const okR = !!dlName; if (okR && typeof dlName === 'string') fname = dlName; /* MARKER_GL_DOA_CONFIRM_RECON_XLSX_V1 */
      if (!okR) { setNotice({ tone: 'err', title: 'Confirm ไม่ได้', lines: ['สร้างไฟล์ Reconcile ไม่สำเร็จ — ตรวจว่ามี TB ของงวดนี้และ Account นี้อยู่ใน TB'] }); return; }
      let sp = ''; try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const tk = sessionStorage.getItem('fastapn_token') || ''; if (tk) sp = `&api=${encodeURIComponent(root)}&token=${encodeURIComponent(tk)}`; } catch (e) { /* ignore */ }
      /* MARKER_GL_DOA_CONFIRM_GL_PUT_V1 -- dest=gl (v17) = รากโฟลเดอร์ Reconcile_Backup: send จะวางที่ Reconcile_Backup\<COM>\<งวด> ไม่เข้า Z_Detail of Account -> ใช้ put ระบุ path ให้เข้า Z_Detail of Account\<COM>\<งวด> */
      setTimeout(() => { const h = document.createElement('a'); h.href = `fastapn-sp://put?name=${encodeURIComponent(dlName)}&path=${encodeURIComponent('Z_Detail of Account/' + spBu + '/' + period)}&dest=${DOA_SP_DEST}${sp}`; h.style.display = 'none'; document.body.appendChild(h); h.click(); h.remove(); }, 800);
      /* MARKER_GL_DOA_CONFIRM_BACKUP_V1 -- Confirm = สร้าง Backup ใหม่ด้วย: Backup All รวมใหม่ทุกครั้ง = Backup เดิมของงวดนี้ (DB) + Detail ในหน้า (Account ซ้ำใช้ข้อมูลในหน้า) -> ดาวน์โหลด -> Handler (backup) เก็บ D:\apps\Backup_DOH + SharePoint Z_Backup_DOH ถ้ามี (ทับของเดิม) | ไม่มี Handler/SharePoint ไม่ใช่ Error */
      (async () => {
        try {
          const cur = rows; /* MARKER_GL_DOA_CONFIRM_BACKUP_ACC_ONLY_V1 -- Confirm Account ไหน = เพิ่มเฉพาะแถวของ Account นั้นเข้า Backup เดิม (แถวของ Account อื่นในไฟล์คงเดิม ไม่ดึงทั้งหน้าเข้า Backup) */ const curAcc = new Set([String(a.code)]); let old = [];
          try { old = (await bkExistRows(period, curAcc, true)).rows; } catch (e3) { old = []; } /* MARKER_GL_DOA_CONFIRM_BACKUP_UNION_V1 -- Backup สะสม: เก็บแถวเดิมทั้งหมด (ทุก Account) ไม่ลบ/ไม่ทับ */
          const cntB = new Map(); old.filter(o => curAcc.has(String(o.account_code))).forEach(o => { const k = detKey(o); cntB.set(k, (cntB.get(k) || 0) + 1); }); const addB = cur.filter(o => { const k = detKey(o); const v = cntB.get(k) || 0; if (v > 0) { cntB.set(k, v - 1); return false; } return true; }); const merged = old.concat(addB); const mat = detailMatrixFromRows(merged); /* แถวที่มีอยู่แล้วไม่เพิ่มซ้ำ (เทียบ detKey แบบนับจำนวน) เพิ่มเฉพาะแถวใหม่ของ Account ที่ Confirm */
          try { await saveDetBk(period, mat); setBkTick(t => t + 1); } catch (e5) { /* MARKER_GL_DOA_CONFIRM_DB_BACKUP_V1 -- Confirm เก็บ Backup ลง DB ด้วย (ไม่สำเร็จไม่กระทบ Confirm) */ }
          const bkName = [com, bu, 'Detail_backup', period, a.code].filter(Boolean).join('_') + '.xlsx'; /* by Account */
          const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mat), 'Detail');
          const bkUrl = URL.createObjectURL(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
          setTimeout(() => { const d2 = document.createElement('a'); d2.href = bkUrl; d2.download = bkName; d2.style.display = 'none'; document.body.appendChild(d2); d2.click(); d2.remove(); setTimeout(() => URL.revokeObjectURL(bkUrl), 4000); }, 1800);
          setTimeout(() => { const h2 = document.createElement('a'); h2.href = `fastapn-sp://backup?name=${encodeURIComponent(bkName)}&bu=${encodeURIComponent(spBu)}&period=${encodeURIComponent(period)}&dest=doh`; h2.style.display = 'none'; document.body.appendChild(h2); h2.click(); h2.remove(); }, 2800);
        } catch (e2) { /* Backup ไฟล์ไม่สำเร็จ ไม่กระทบ Confirm */ }
      })();
      setCfmAcc(prev => ({ ...prev, [a.code]: fname })); markCfm(a.code, fname); /* Confirm ไม่เปลี่ยน Status ของแถว — แค่คิด Expired Date + Badge */
      setNotice({ tone: 'ok', title: 'Confirm แล้ว — ส่ง Detail เข้า SharePoint', rows: [['Account', a.code], ['ไฟล์', fname], ['จำนวนแถว', String(rows.length)], ['BU / งวด', `${bu} · ${period}`]], lines: ['Handler จะย้ายไฟล์จาก Downloads เข้าโฟลเดอร์ SharePoint (OneDrive) ให้'] });
    } catch (e) { setNotice({ tone: 'err', title: 'Confirm ไม่สำเร็จ', lines: [e.message] }); }
  };
  const pendBk = React.useRef(null);
  // MARKER_GL_DOA_TB_RAW_STORE_V1 -- TB: เก็บไฟล์ทั้งไฟล์ (ทุกแถว/ทุกสาขา) ลง DB ทันทีที่โยน แม้ยังไม่ผูก Config | ไม่หมดอายุ ไม่ลบ | ถ้าข้อมูลเปลี่ยนจึงอัปเดตทับฉบับเดิม (เหมือนเดิม = ไม่ทำอะไร) | เจ้าของไฟล์เท่านั้นที่อ่านได้
  const saveRawTb = async (ub, per, label, raw) => {
    if (!ub || !per || !raw || !dataRows(raw)) return;
    try {
      const j = await listDoaBackups(ub); const it = (j.items || []).find(x => x.period === per && x.kind === 'TBRAW'); const nz = (m) => sigOf(JSON.parse(JSON.stringify(m)));
      if (it) { const d = await getDoaBackup(it.id); if (Array.isArray(d && d.data) && nz(d.data) === nz(raw)) return; }
      await saveDoaBackup(ub, per, label, raw, 'TBRAW'); setBkMsg(`✓ ${it ? 'อัปเดต' : 'เก็บ'} TB ทั้งไฟล์ลง DB แล้ว (BU ${ub} งวด ${per}) — ไม่หมดอายุ`);
    } catch (e) { setBkMsg(`⚠ เก็บ TB ทั้งไฟล์ลง DB ไม่สำเร็จ: ${e.message}`); }
  };
  const autoBackup = (kind, mat, label, ub, per, raw) => { // MARKER_GL_DOA_TB_RAW_STORE_V1 -- raw = TB ทั้งไฟล์ (เก็บเมื่อผู้ใช้กดยืนยันเท่านั้น แม้ยังไม่ผูก Config) // MARKER_GL_DOA_CONFIRM_SAVE_V2 -- โยนไฟล์: แสดง Popup แบบเดิม + ปุ่มยืนยัน "บันทึกลง DB" (ไม่กดยืนยัน = ไม่เข้า DB)
    if (!ub || !per) { setBkMsg(`⚠ ยังไม่ได้ Backup ${kind} ลง DB — ไม่ทราบ ${!ub ? 'BU' : 'งวด'}`); pendBk.current = null; return; }
    if (!dataRows(mat) && !(kind === 'TB' && raw && dataRows(raw))) { pendBk.current = null; return; }
    pendBk.current = { kind, label: `บันทึก ${kind} ลง DB (BU ${ub} · งวด ${per})`, discard: () => { // MARKER_GL_DOA_DISCARD_V1 -- ไม่บันทึก = ยกเลิกข้อมูลที่โยน (ไม่ให้ค้างบนหน้าจอ) แล้วโหลดฉบับที่บันทึกไว้ใน DB กลับมาแทน (ถ้ามี)
      delete rawRef.current[kind];
      if (kind === 'TB') { setTbAcc([]); setTbMatrix([]); setTbName(''); } else if (kind === 'Detail') { setDetAcc(new Set()); setDetMatrix([]); } else { setSimAcc(new Set()); setSimMatrix([]); setSimName(''); }
      setTbMsg(`ไม่บันทึก ${kind} — ยกเลิกข้อมูลที่โยนเข้ามา`); setDbTick(t => t + 1);
    }, run: async () => {
      try { let sv = null; let mat2 = mat; let simRep = null;
        if (kind === 'Simple' && dataRows(mat)) { /* MARKER_GL_DOA_SIMPLE_MERGE_V1 -- เทียบทีละ Account กับ Simple ใน DB งวดเดียวกัน: เท่าเดิม = ไม่รับ / ไม่เท่า = ทับ / ใหม่ = เพิ่ม / ที่ไม่อยู่ในไฟล์ใหม่ = คงเดิม */
          try { const jj = await listDoaBackups(ub); const ex = (jj.items || []).find(x => (x.kind || 'TB') === 'Simple' && x.period === per); const nw = simGroups(mat);
            if (ex && nw) { const d0 = await getDoaBackup(ex.id); const od = simGroups(Array.isArray(d0 && d0.data) ? d0.data : []);
              if (od) { const rp = []; let ch = false; const out = new Map(od.g); nw.g.forEach((rows, c) => { const o = od.g.get(c); if (!o) { rp.push({ c, st: 'ใหม่' }); out.set(c, rows); ch = true; } else if (simSig(o) === simSig(rows)) rp.push({ c, st: 'เท่าเดิม' }); else { rp.push({ c, st: 'อัปเดต' }); out.set(c, rows); ch = true; } });
                simRep = { rp, ch }; if (ch) mat2 = [...nw.pre, ...[...out.values()].flat()]; } } } catch (e) { /* เทียบไม่ได้ = บันทึกทั้งไฟล์ตามเดิม */ } }
        if (simRep && !simRep.ch) { setNotice({ tone: 'warn', title: `Simple ${per}: ไม่มีการเปลี่ยนแปลง — ไม่รับไฟล์นี้`, rows: [['เท่าเดิม (ไม่รับ)', String(simRep.rp.length)]] }); setBkMsg(`✓ ${kind} BU ${ub} งวด ${per} — ไม่มีการเปลี่ยนแปลง (ไม่รับ)`); pendBk.current = null; return; }
        if (dataRows(mat2)) sv = await saveDoaBackup(ub, per, label, mat2, kind); if (kind === 'TB' && raw) await saveRawTb(ub, per, label, raw); setNotice(null); setBkMsg(sv && sv.unchanged ? `✓ ${kind} BU ${ub} งวด ${per} — ไม่มีการเปลี่ยนแปลง (คงที่ ไม่เขียนซ้ำ)${sv.replaced_legacy ? ' · ล้างไฟล์เก่าที่ซ้ำแล้ว' : ''}` : `✓ บันทึก ${kind} ลง DB แล้ว (BU ${ub} งวด ${per})${kind === 'TB' && raw ? ' · เก็บ TB ทั้งไฟล์แล้ว' : ''}${sv && sv.replaced_legacy ? ' · แทนที่ไฟล์เก่าที่ซ้ำ' : ''}`); loadLastBk(); } catch (e) { setNotice(null); setBkMsg(`✗ บันทึก ${kind} ลง DB ไม่สำเร็จ: ${e.message}`); }
    } };
  };
  const doBackup = async () => {
    if (!bu || !period) { setBkMsg('✗ เลือก BU และงวดก่อน'); return; }
    if (!tbMatrix.length && !simMatrix.length) { setBkMsg('✗ ยังไม่มี TB / Simple ให้ Backup — โยนไฟล์หรือ Paste ก่อน'); return; }
    try {
      const done = [];
      if (tbMatrix.length) { const r = await saveDoaBackup(bu, period, tbName, tbMatrix, 'TB'); done.push(`TB เก็บ ${r.retention_months} เดือน`); }
      if (simMatrix.length) { const r = await saveDoaBackup(bu, period, simName, simMatrix, 'Simple'); done.push(`Simple เก็บ ${r.retention_months} เดือน`); }
      setBkMsg(`✓ Backup แล้ว (BU ${bu} งวด ${period}) — ${done.join(' · ')}`); loadLastBk();
    } catch (e) { setBkMsg('✗ Backup ไม่สำเร็จ: ' + e.message); }
  };
  const persistRaw = () => {}; // MARKER_GL_DOA_DB_TRUTH_V1 -- ข้อมูลจริงอยู่ที่ DB (doa_tb_backup) เท่านั้น: โยน = บันทึก DB / ลบ = ลบ DB / เปลี่ยนงวด-เปิดหน้า = โหลดจาก DB (ไม่เก็บใน Browser แล้ว)
  const [dbTick, setDbTick] = React.useState(0);   // MARKER_GL_DOA_TB_STANDBY_ADMIN_V1 -- Admin Operation: TB ทั้งไฟล์ (Standby) ของทุก BU
  const [admData, setAdmData] = React.useState(null); const [admOpen, setAdmOpen] = React.useState({}); const [admSel, setAdmSel] = React.useState({}); const [admLines, setAdmLines] = React.useState(null); const [admLQ, setAdmLQ] = React.useState(''); const [admAsg, setAdmAsg] = React.useState(''); const [admLTick, setAdmLTick] = React.useState(0); const [admBusy, setAdmBusy] = React.useState(false); /* MARKER_GL_DOA_ADMIN_OP_ASSIGN_V1 */ /* MARKER_GL_DOA_ADMIN_OP_CHECKBOX_V1 */ const [admQ, setAdmQ] = React.useState(''); const [admF, setAdmF] = React.useState('all'); const [admLim, setAdmLim] = React.useState(20); const [admSort, setAdmSort] = React.useState('standby'); const [admView, setAdmView] = React.useState(null); const [admPer, setAdmPer] = React.useState(''); const [admTab, setAdmTab] = React.useState('tb'); /* MARKER_GL_DOA_ADMIN_OP_REDESIGN_V1 */
  const loadAdm = React.useCallback(async (quiet) => { if (quiet !== true) setAdmData({ loading: true }); try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/standby`, { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') } }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); setAdmData({ items: j.items || [] }); } catch (e) { setAdmData({ error: e.message }); } }, []);
  // MARKER_GL_DOA_STORAGE_POPUP_V1 -- ป้าย 💾 DOA Storage + Popup (เฉพาะ Owner/Admin): ขนาดข้อมูล DOA แยกชนิด / BU / Module
  const [showStor, setShowStor] = React.useState(false); const [stor, setStor] = React.useState(null); const [storTab, setStorTab] = React.useState('ov'); const [storQ, setStorQ] = React.useState(''); const [storView, setStorView] = React.useState(null); const [delAsk, setDelAsk] = React.useState(null); const [delBusy, setDelBusy] = React.useState(false); /* MARKER_GL_DOA_STORAGE_FILE_VIEW_V1 */
  const loadStor = React.useCallback(async (refresh) => { try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/${isAdm ? 'doa-backup-admin/storage' : 'doa-backup/storage-badge'}${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') } }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); setStor(j); } catch (e) { setStor({ error: e.message }); } }, [isAdm]);
  React.useEffect(() => { loadStor(false); }, [isAdm, loadStor]);
  React.useEffect(() => { if (showAdm) loadAdm(); }, [showAdm, loadAdm]);
  const evTimer = React.useRef(null); // MARKER_GL_DOA_STORAGE_EVENT_V1 -- Event (Broadcast) -> รีเฟรชทันที ข้ามแคช Server (debounce 0.8 วิ กันยิงถี่) | Poll สำรองทุก 60 วิ ใช้แคชได้
  useRealtimeRefresh(['doa_config_changed', 'doa_tb_changed'], () => { if (evTimer.current) clearTimeout(evTimer.current); evTimer.current = setTimeout(() => { if (showAdm) { loadAdm(true); setAdmLTick(n => n + 1); } loadStor(true); }, 800); }, 0);
  useRealtimeRefresh(['__poll_only__'], () => { if (showAdm) { loadAdm(true); setAdmLTick(n => n + 1); } loadStor(false); }, 60000);
  useRealtimeRefresh(['doa_tb_changed'], () => { setDbTick(t => t + 1); setBkTick(t => t + 1); try { loadLastBk(); } catch (e) { /* ignore */ } if (bu) listDoaClear(bu).then(it => applyClr(it)).catch(() => {}); }, 0); // MARKER_GL_DOA_TB_REALTIME_V1 -- มีคนโยน/ลบ TB-Detail-Simple -> รายการหน้าหลักรีเฟรชทันที // MARKER_GL_DOA_ADMIN_REALTIME_V1 -- Admin Operation + DOA Storage รีเฟรชเองเมื่อมีคนแก้ Config/TB (Broadcast) + Poll สำรอง 60 วิ
  React.useEffect(() => { let off = false; if (!bu) return undefined; listDoaClear(bu).then(it => { if (!off) applyClr(it); }).catch(() => {}); return () => { off = true; }; }, [bu, dbTick, bkTick]); // eslint-disable-line react-hooks/exhaustive-deps
  /* MARKER_GL_DOA_INCLUDE_REFRESH_V1 -- โยนข้อมูลเข้าใหม่ / DB เปลี่ยน => อ่านสถานะ Include/Clear จาก DB ใหม่ (ลบใน DB = หายเอง) */
  React.useEffect(() => { if (!admView) return; let off = false; setAdmLines({ id: admView, loading: true }); (async () => { try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/lines?id=${encodeURIComponent(admView)}`, { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') } }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); if (!off) setAdmLines({ id: admView, lines: j.lines || [], modules: j.modules || [] }); } catch (e) { if (!off) setAdmLines({ id: admView, error: e.message }); } })(); return () => { off = true; }; }, [admView, admLTick]); // MARKER_GL_DOA_ADMIN_OP_LINES_V1
  const switchPeriod = (p) => { // เปลี่ยนงวด: ล้างหน้าจอ แล้ว Effect ด้านล่างโหลดข้อมูลของงวดนั้นจาก DB
    if (p === period) return false;
    rawRef.current = {}; setTbAcc([]); setTbMatrix([]); setTbName(''); setDetAcc(new Set()); setDetMatrix([]); setSimAcc(new Set()); setSimMatrix([]); setSimName(''); setTbMsgFull(''); setTbMsg('');
    setPeriod(p); setDbTick(t => t + 1); return 'cleared';
  };
  const rulesSig = bu + '|' + myRules.filter(x => x.bu === bu).map(x => [x.account, x.cpc, x.cpc_mode, x.sub_acc, x.sub_mode].join('~')).sort().join(','); /* MARKER_GL_DOA_RECHECK_ON_RULES_V1 -- Config ของ User โหลดเสร็จ/เปลี่ยน (เช่น Admin Assign) -> โหลดจาก DB ซ้ำ (TB ที่คัดตาม Config ได้ว่างเพราะตอนโหลดครั้งแรก Config ยังไม่มา จะไม่ค้างว่างอีก) */
  React.useEffect(() => { // MARKER_GL_DOA_LOAD_FROM_DB_V1 -- เปิดหน้า / เปลี่ยน BU / เปลี่ยนงวด → โหลดข้อมูลจาก DB (ไม่ได้เลือกงวด = ใช้งวดล่าสุดที่มี Backup ใน 3 เดือน)
    if (!bu) return undefined; let off = false;
    (async () => {
      try {
        const j = await listDoaBackups(bu); const items = j.items || []; let per = period;
        if (!per) { const pers = items.map(x => x.period).filter(x => periodOptions.includes(x)).sort().reverse(); per = pers[0]; if (!per || off) return; setPeriod(per); }
        { const have = ['TB', 'Simple', 'Detail'].filter(k => items.some(x => x.period === per && (x.kind || 'TB') === k)); if (!off && !have.length && !rawRef.current.TB && !rawRef.current.Simple) setTbMsg(`ℹ ยังไม่มี TB / Simple งวด ${per} บันทึกใน DB (BU ${bu}) — โยนไฟล์แล้วกดยืนยันบันทึก`); } // MARKER_GL_DOA_LOAD_DIAG_V1
        const warnDb = []; let loadedAny = false; // MARKER_GL_DOA_DB_CFG_CHECK_V1
        for (const kind of ['TB', 'Simple', 'Detail']) {
          if (off) continue;
          const it = items.find(x => x.period === per && (x.kind || 'TB') === kind && !x.account); const itRaw = kind === 'TB' ? items.find(x => x.period === per && x.kind === 'TBRAW') : null;
          { /* MARKER_GL_DOA_DB_GONE_CLEAR_V1 -- ข้อมูลที่โหลดมาจาก DB แต่ใน DB ถูกลบ/ล้างแล้ว (Admin ลบ / ล้าง TB / หมดอายุ) = ล้างออกจากหน้าด้วย; ถ้า DB ถูกอัปเดตใหม่ = โหลดใหม่ */
            const cur = (rawRef.current || {})[kind];
            if (cur && cur.fromDb) {
              const src = it || itRaw;
              if (!src) { delete rawRef.current[kind]; if (kind === 'TB') { setTbAcc([]); setTbMatrix([]); setTbName(''); } else if (kind === 'Detail') { setDetAcc(new Set()); setDetMatrix([]); } else { setSimAcc(new Set()); setSimMatrix([]); setSimName(''); } continue; }
              if (cur.dbAt && String(src.created_at || '') !== cur.dbAt) delete rawRef.current[kind];
            }
          }
          if ((rawRef.current || {})[kind]) continue;
          if (!it && !itRaw) continue; // MARKER_GL_DOA_TB_RAW_STORE_V1
          let d = it ? await getDoaBackup(it.id) : null; let rawFull = null;
          if (itRaw) { try { const dr0 = await getDoaBackup(itRaw.id); if (Array.isArray(dr0 && dr0.data) && dr0.data.length) { rawFull = dr0.data; if (!d) d = dr0; } } catch (e) { /* ใช้ฉบับที่คัดแล้วแทน */ } }
          let m = Array.isArray(d && d.data) ? d.data : [];
          if (rawFull) { const cm0 = (buOptions.find(o => o.value === bu) || {}).com; const fr0 = bu ? filterByConfig(rawFull, myRules, bu, cm0, false) : null; m = (fr0 && fr0.matrix) ? fr0.matrix : rawFull; }
          if (off || !m.length || (rawRef.current || {})[kind]) continue;
          if (kind === 'TB' && detectForm(m, '').type === 'Detail') { setTbMsg(`⚠ ข้อมูล TB งวด ${per} ใน DB เป็นข้อมูล Detail (บันทึกผิดชนิด) — ข้ามไม่โหลด กรุณาโยน TB ใหม่`); continue; } // MARKER_GL_DOA_GUARD_KIND_V1
          const r = matrixToAccounts(m); rawRef.current[kind] = { m: rawFull || m, label: d.file_name || `Backup ${kind} ${per}`, sig: '', fromDb: true, dbAt: String((it || itRaw).created_at || ''), dbSig: sigOf(JSON.parse(JSON.stringify(rawFull || m))) }; // MARKER_GL_DOA_SAME_AS_DB_V1
          if (kind === 'TB') { setTbMatrix(m); setTbName(d.file_name || `Backup ${per}`); setTbAcc(r.accounts); } else if (kind === 'Detail') { setDetMatrix(m); setDetAcc(new Set(r.accounts.map(a => a.code))); } else { setSimMatrix(m); setSimName(d.file_name || ''); setSimAcc(new Set(r.accounts.map(a => a.code))); }
          loadedAny = true;
          { const cfgS = new Set(myRules.filter(x => x.bu === bu).map(x => x.account)); if (cfgS.size) { const hit = r.accounts.filter(a => cfgS.has(a.code)).length; if (hit < cfgS.size) warnDb.push(`${kind} ใน DB มี ${r.accounts.length} Account แต่ตรง Config ของคุณ ${hit}/${cfgS.size} (บันทึกด้วย Config คนละชุด หรือ Config เปลี่ยนหลังบันทึก)`); } }
        }
        if (!off && loadedAny) setTbMsg(`✓ โหลดข้อมูลงวด ${per} จาก DB (BU ${bu})` + (warnDb.length ? ' · ⚠ ' + warnDb.join(' · ') + ' — โยนไฟล์ใหม่ถ้าต้องการอัปเดต' : ''));
      } catch (e) { if (!off) setTbMsg('✗ โหลดข้อมูลจาก DB ไม่สำเร็จ: ' + (e && e.message ? e.message : e)); } // MARKER_GL_DOA_LOAD_DIAG_V1 -- เดิมกลืน Error ทำให้ไม่รู้ว่าทำไมไม่โหลด
    })();
    return () => { off = true; };
  }, [bu, period, dbTick, rulesSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const incMergeRef = React.useRef('');
  React.useEffect(() => { /* MARKER_GL_DOA_INCLUDE_LOAD_DB_V2 -- Include ใน DB = ข้อมูลที่อยู่ใน DB แล้ว: โหลดเข้า Detail ในหน้าตอนเปิด (ไม่เขียนทับ Detail ใน DB) */
    if (!bu || !period || !detMatrix || !detMatrix.length) { incMergeRef.current = ''; return undefined; }
    const key = `${bu}|${period}|${dbTick}`; if (incMergeRef.current === key) return undefined; incMergeRef.current = key; let off = false;
    (async () => {
      try {
        const items = (await listDoaClearDetail(bu, '')).filter(x => x.status === 'Include' && x.row && String(x.period) === String(period));
        if (off || !items.length) return;
        setDetMatrix(prev => { const rows = detailRows(prev || []); const have = new Map(); rows.forEach(o => { const k = detKey(o); have.set(k, (have.get(k) || 0) + 1); }); const add = []; items.forEach(x => { const k = detKey(x.row); if (clrKeys.has(k)) return; const v = have.get(k) || 0; if (v > 0) have.set(k, v - 1); else add.push(x.row); }); return add.length ? detailMatrixFromRows([...rows, ...add]) : prev; });
      } catch (e) { /* ไม่กระทบการโหลดหน้า */ }
    })();
    return () => { off = true; };
  }, [bu, period, dbTick, detMatrix]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastFocusChk = React.useRef(Date.now()); /* MARKER_GL_DOA_RECHECK_ON_FOCUS_V1 -- กลับมาที่หน้า/แท็บนี้ (เกิน 10 วินาที) → เช็คข้อมูลจาก DB ซ้ำ (TB / Detail / Simple / Backup / Stamp Clear) */
  React.useEffect(() => {
    const go = () => { if (document.visibilityState && document.visibilityState !== 'visible') return; if (Date.now() - lastFocusChk.current < 10000) return; lastFocusChk.current = Date.now(); setDbTick(t => t + 1); setBkTick(t => t + 1); try { loadLastBk(); } catch (e) { /* ignore */ } if (bu) listDoaClear(bu).then(it => applyClr(it)).catch(() => {}); };
    window.addEventListener('focus', go); document.addEventListener('visibilitychange', go);
    return () => { window.removeEventListener('focus', go); document.removeEventListener('visibilitychange', go); };
  }, [bu, loadLastBk]); // eslint-disable-line react-hooks/exhaustive-deps
  const changePeriod = (p) => { switchPeriod(p); };
  const loadFromBackup = (d) => {
    const m = Array.isArray(d.data) ? d.data : [];
    if (d.kind === 'Detail') { switchPeriod(d.period); applyType('Detail', m, d.file_name || `Backup Detail ${d.period}`); return; }
    if (d.kind === 'Simple') { switchPeriod(d.period); applyType('Simple', m, d.file_name || `Backup Simple ${d.period}`); return; }
    switchPeriod(d.period); setTbMatrix(m); setTbName(d.file_name || `Backup ${d.period}`);
    const r = matrixToAccounts(m); setTbAcc(r.accounts);
    setTbMsg(`✓ โหลด Backup งวด ${d.period}: พบ ${r.accounts.length} Account`);
  };
  // MARKER_GL_DOA_BU_ONLY_CONFIGURED_V1 -- ช่อง BU ของหน้านี้แสดงเฉพาะ BU ที่ User นี้ตั้ง Config ไว้ (โหลด Config ไม่ได้ = แสดงทั้งหมด)
  // MARKER_GL_DOA_BU_FROM_CONFIG_V1 -- รายการ BU ดึงจาก Config ของ User โดยตรง (ชื่อเต็มเอามาจาก CompanyList ถ้ามี ไม่มีก็แสดงรหัส BU)
  const buInitRef = React.useRef(false);
  const pageBuOptions = mine ? Array.from(new Set(mine.map(x => x.bu).filter(Boolean))).map(b => buOptions.find(o => o.value === b) || { value: b, label: b }) : buOptions;
  // เปิดหน้าใหม่/รีเฟรช: ถ้า Config มี BU เดียว เลือกให้เลย | มีหลาย BU ให้ว่าง (ผู้ใช้เลือกเอง) — MARKER_GL_DOA_BU_AUTO_SINGLE_V1
  React.useEffect(() => {
    if (buInitRef.current || bu || !mine || !mine.length || !pageBuOptions.length) return;
    buInitRef.current = true; // เลือกให้ครั้งเดียวตอนเปิดหน้า — กด "ล้างการเลือก" แล้วต้องว่างได้
    if (pageBuOptions.length === 1) setBu(pageBuOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, bu]);
  React.useEffect(() => { if (bu) { buInitRef.current = true; } }, [bu]);
  // ค้นหา: ข้อความตรงกับรหัส/ชื่อ BU เพียง 1 รายการ -> เลือก BU นั้นแล้วล้างช่องค้นหา | ไม่ตรง = กรอง Account ตามเดิม
  const searchBu = () => {
    const t = accQ.trim().toLowerCase();
    if (!t) return;
    const hit = pageBuOptions.filter(o => o.value.toLowerCase() === t || o.label.toLowerCase().includes(t));
    const exact = hit.find(o => o.value.toLowerCase() === t);
    const pick = exact || (hit.length === 1 ? hit[0] : null);
    if (pick && !shownAccHas(t)) { setBu(pick.value); setAccQ(''); }
  };
  const shownAccHas = (t) => tbAcc.some(a => (a.code + ' ' + a.name).toLowerCase().includes(t));
  // กรอง Account ตาม Config ของ User นี้ (เมื่อเลือก BU และ User นี้มี Config ใน BU นั้น) | ไม่มี Config = แสดงทั้งหมด
  const myAccs = bu && mine ? new Set(mine.filter(x => x.bu === bu).map(x => x.account)) : null;
  const cfgActive = !!(myAccs && myAccs.size);
  // MARKER_GL_DOA_LIST_FROM_CONFIG_V1 -- มี Config ของ BU นี้ = แสดงรายการ Account จาก Config ทันที (ยังไม่ต้องโยน TB) ชื่อบัญชีเติมจาก TB เมื่อโหลดแล้ว
  const tbByCode = new Map(tbAcc.map(a => [a.code, a]));
  const baseAcc = cfgActive ? Array.from(myAccs).sort().map(c => ({ code: c, name: (tbByCode.get(c) || {}).name || '', inTb: tbByCode.has(c) })) : tbAcc.map(a => ({ ...a, inTb: true }));
  const shownAcc = baseAcc
    .filter(a => !accQ.trim() || (a.code + ' ' + a.name).toLowerCase().includes(accQ.trim().toLowerCase()));
  const [editSign, setEditSign] = React.useState(false); // MARKER_GL_SIGNOFF_EDIT_BTN_V1 -- ปุ่ม แก้ไข: เปิดฟอร์มกรอกชื่อ/ตำแหน่ง/Module
  const [sp, setSp] = React.useState({ my_name: '', my_job: '', report_to_name: '', report_to_job: '', module: '' }); const [spLoaded, setSpLoaded] = React.useState(false); // MARKER_GL_DOA_REQUIRE_PROFILE_V1 -- ยังไม่ตั้ง Profile (ชื่อ / ผู้สอบทาน / Module) = ไม่ให้โยนข้อมูล
  React.useEffect(() => {
    let off = false;
    loadSignoffProfile().then(d => { if (!off) { setSp(d); setSpLoaded(true); } }).catch(e => { if (!off) { setSp(x => ({ ...x, err: 'โหลดข้อมูลผู้ลงนามไม่ได้: ' + e.message })); setSpLoaded(true); } });
    return () => { off = true; };
  }, []);
  const noProf = !spLoaded || (!sp.err && !(sp.my_name && sp.report_to_name && sp.module)); // MARKER_GL_DOA_DROPZONE_DISABLE_NOPROFILE_V1
  return (
    <div style={{ height: 'calc(100vh - 6px)', minHeight: 720, display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: C.bg, boxSizing: 'border-box' }}>
      {/* บน 35% : 70 : 30 */}
      <div style={{ flex: '35 1 0', minHeight: 0, display: 'flex', gap: 12 }}>
        <section style={{ ...card, flex: '72 1 0', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 17, color: C.navy }}>🔎 Detail of Account</h2>
            {(() => { const q = stor && stor.quota; const p = q && q.use_pct; const col = p == null ? '#5A6B80' : p >= (stor.config.warn_red || 90) ? '#c0392b' : p >= (stor.config.warn_yellow || 70) ? '#d97706' : '#2E7D5B'; const fb = (n) => { n = Number(n) || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(0, Math.round(n / 1024)) + ' KB'; }; return (<button type="button" disabled={!isAdm} onClick={() => { if (!isAdm) return; setShowStor(true); setStorTab('ov'); loadStor(true); }} title={isAdm ? 'ดูข้อมูลที่ Detail of Account เก็บไว้' : 'พื้นที่ที่ Detail of Account เก็บไว้ (ดูรายละเอียดได้เฉพาะ Admin)'} style={{ height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid ' + col, background: isAdm ? '#fff' : '#F8FAFC', color: C.navy, fontSize: 12, cursor: isAdm ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}>💾 DOA Storage {stor && !stor.error ? <b>{fb(stor.total)}</b> : <span style={{ color: '#888' }}>…</span>}{p != null && <span style={{ background: col, color: '#fff', borderRadius: 10, padding: '0 7px', fontSize: 11 }}>{p}%</span>}</button>); })()}
            {isAdm && <button type="button" onClick={() => setShowAdm(true)} style={{ marginLeft: 'auto', height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #B9C4D2', background: '#fff', color: C.navy, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🛠 Admin Operation</button>}
            <button type="button" onClick={() => setShowCfg(true)} style={{ marginLeft: isAdm ? 8 : 'auto', height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #B9C4D2', background: '#fff', color: C.navy, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⚙ Config</button>
          </div>
          <div style={{ flex: '1 1 0', minHeight: 160, display: 'flex', flexDirection: 'column', gap: 6 }}> {/* MARKER_GL_DOA_DROPZONE_ENLARGE_V1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              {[['file', 'โยนไฟล์'], ['paste', 'Paste Text']].map(([k, t]) => (
                <button key={k} type="button" onClick={() => setTbMode(k)}
                  style={{ height: 24, padding: '0 10px', borderRadius: 999, border: `1px solid ${tbMode === k ? C.navy : '#B9C4D2'}`, background: tbMode === k ? C.navy : '#fff', color: tbMode === k ? '#fff' : C.mute, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t}</button>
              ))}
              {tbMsg && !tbMsg.startsWith('✓') && <span style={{ color: '#B42318', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tbMsgFull || tbMsg}>{tbMsg}</span>}{/* MARKER_GL_DOA_HIDE_OK_STATUS_V1 -- ไม่แสดงข้อความสำเร็จ (✓) ข้างแท็บโยนไฟล์ — แสดงเฉพาะข้อความผิดพลาด */}
            </div>
            {tbHead && (() => { const comOf = (buOptions.find(o => o.value === bu) || {}).com || ''; const z = (x) => String(x || '').replace(/^0+/, ''); const warns = [];
              if (tbHead.period && period && tbHead.period !== period) warns.push(`งวดในรายงาน ${tbHead.period} ไม่ตรงงวดที่เลือก ${period}`);
              if (tbHead.comCode && bu && z(tbHead.comCode) !== z(comOf) && z(tbHead.comCode) !== z(bu)) warns.push(`บริษัทในรายงาน ${tbHead.comCode} ไม่ตรง BU ${bu}`);
              if (!warns.length) return null; // MARKER_GL_DOA_HIDE_TBHEAD_V1 -- ไม่แสดงแถบ Header TB ถ้าไม่มีคำเตือน
              return (<div title={tbHead.lines.join('\n')} style={{ fontSize: 11.5, color: C.mute, background: '#F1F5F9', border: '1px solid #D5DEEA', borderRadius: 6, padding: '4px 10px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <b style={{ color: C.navy }}>Header TB</b>
                {tbHead.book ? <span>{tbHead.book}</span> : null}{tbHead.title ? <span>{tbHead.title}</span> : null}{tbHead.periodText ? <span>{tbHead.periodText}</span> : null}{tbHead.company ? <span>Company: {tbHead.company}</span> : null}{tbHead.reportDate ? <span>Report Date: {tbHead.reportDate}</span> : null}
                {warns.map((w, i) => <span key={i} style={{ color: '#B42318', fontWeight: 600 }}>⚠ {w}</span>)}
              </div>); })()}
            {tbMode === 'file' ? (
              <div onClick={() => { if (noProf) return; fileRef.current && fileRef.current.click(); }}
                onDragOver={e => { e.preventDefault(); if (!noProf) setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (noProf) return; onFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
                style={{ flex: 1, minHeight: 140, border: `2px dashed ${noProf ? '#D0D5DD' : drag ? C.navy : '#9AA6B8'}`, background: noProf ? '#F2F4F7' : drag ? '#E8F0FB' : '#F8FAFC', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: noProf ? '#98A2B3' : C.mute, fontSize: 16, cursor: noProf ? 'not-allowed' : 'pointer', textAlign: 'center', opacity: noProf ? .85 : 1 }}>{/* MARKER_GL_DOA_DROPZONE_DISABLE_NOPROFILE_V1 */}
                {noProf ? (spLoaded ? '🔒 ยังไม่ได้ตั้งค่า Profile (ชื่อ / ผู้สอบทาน / Module) — ตั้งค่าที่ฝั่งขวาแล้วกด "บันทึกเข้า Profile" ก่อน จึงจะโยนไฟล์ได้' : 'กำลังตรวจ Profile…') : 'ลากไฟล์ TB / Detail / Simple (.xlsx / .xls / .csv) มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์ — ระบบรู้เองว่าเป็นฟอร์มอะไร'}
                <input ref={fileRef} type="file" disabled={noProf} accept=".xlsx,.xls,.csv,.txt,.tsv" style={{ display: 'none' }}
                  onChange={e => { onFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 140, display: 'flex', gap: 6 }}>
                <textarea value={pasteText} disabled={noProf} onChange={e => setPasteText(e.target.value)} onPaste={e => { if (noProf) { e.preventDefault(); return; } const t = e.clipboardData && e.clipboardData.getData('text'); if (t && t.trim()) { e.preventDefault(); setPasteText(t); applyMatrix(textToMatrix(t), 'Paste Text'); } }} /* MARKER_GL_DOA_PASTE_AUTO_READ_V1 -- วางแล้วอ่านทันที ไม่ต้องกดปุ่ม อ่านข้อมูล */ placeholder="คัดลอก TB / Detail / Simple จาก Excel (รวมหัวคอลัมน์) แล้ววางที่นี่ — ระบบรู้เองว่าเป็นฟอร์มอะไร"
                  style={{ flex: 1, minWidth: 0, resize: 'none', border: '1px solid #B9C4D2', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'none', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}> {/* MARKER_GL_DOA_HIDE_FILTER_AND_BUTTONS_V1 -- ซ่อน (ไม่ลบ) แถวปุ่ม 5 ปุ่ม */}
            <button type="button" style={btn(false)} onClick={() => { setTbMode('file'); fileRef.current && fileRef.current.click(); }}>ดึง TB เข้ามา</button>
            <button type="button" style={btn(false)} onClick={() => { if (!bu) { setBkMsg('✗ เลือก BU ก่อน'); return; } setShowBk(true); }}>โหลดข้อมูลเก่าจาก Backup</button>
            <button type="button" style={btn(false)}>อัปโหลด DOA ปัจจุบัน</button>
            <button type="button" style={btn(true)}>รวมข้อมูล + Reconcile</button>
            <span style={{ flex: 1 }} />
            <button type="button" style={btn(false, true)} onClick={doBackup}>Backup TB + Simple (เก็บชั่วคราว)</button>
          </div>
        </section>
        <section style={{ ...card, flex: '28 1 0', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 340, overflow: 'auto' }}>
          {(!sp.err && (editSign || !(sp.my_name && sp.report_to_name && sp.module))) ? (<>
            <SignoffUnset key={[sp.my_name, sp.my_job, sp.report_to_name, sp.report_to_job, sp.module].join('|')} sp={sp} onSaved={d => { setSp(x => ({ ...x, ...d })); setEditSign(false); }} onCancel={editSign ? () => setEditSign(false) : undefined} />
          </>) : (<>
          {/* MARKER_GL_SIGNOFF_VIEW_CARDS_V1 -- แบบ D3: หัวการ์ด + วงกลมอักษรย่อ (Prepare=น้ำเงิน, Review=เขียว) + ชิป Module คลิกแก้ได้ */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>ข้อมูลผู้ลงนาม &amp; Module</div>
              <div style={{ fontSize: 11, color: '#8a96a6' }}>ใช้แสดงในรายงาน / Module ใช้ Filter ข้อมูล</div>
            </div>
            <button type="button" onClick={() => setEditSign(true)} title="แก้ไขชื่อ / ตำแหน่ง / Module" style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>✎ แก้ไข</button>
          </div>
          {[['Prepare by · ผู้จัดทำ', sp.my_name, sp.my_job, '#2c7be5'], ['Review by · ผู้สอบทาน', sp.report_to_name, sp.report_to_job, '#12a37f']].map(([title, name, job, color]) => (
            <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #EEF1F5', flexShrink: 0 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{(name || '?').trim().charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: '#8a96a6', textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1B2A3D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || <span style={{ color: '#8a96a6', fontWeight: 400 }}>ยังไม่ได้ตั้งค่า</span>}</div>
                <div style={{ fontSize: 12, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job}>{job || '—'}</div>
              </div>
            </div>
          ))}
          {(sp.err || (sp.my_name && sp.report_to_name && sp.module)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>{/* MARKER_GL_DOA_MODULE_BOX_V1 -- Module (กรอกเอง) ใช้ Filter ข้อมูล */}
            <span style={{ fontSize: 12, color: C.mute }}>Module</span>
            <ModuleChip value={sp.module} onChange={v => setSp(x => ({ ...x, module: v }))}
              onSave={async () => { try { await saveSignoffProfile({ module: String(sp.module || '').trim() }); } catch (e) { setSp(x => ({ ...x, err: 'บันทึก Module ไม่สำเร็จ: ' + e.message })); } }} />
            <span style={{ fontSize: 11, color: '#8a96a6' }}>คลิกเพื่อแก้</span>
          </div>
          )}
          <div style={{ marginTop: 'auto', fontSize: 11, color: sp.err ? '#B42318' : '#8a96a6' }}>
            {sp.err ? sp.err : 'แก้ชื่อ/ตำแหน่งได้ที่ System Console > Profile'}
          </div>
          </>)}
        </section>
      </div>

      {/* ล่าง 65% เต็มความกว้าง */}
      <section style={{ ...card, flex: '65 1 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}> {/* MARKER_GL_DOA_BOTTOM_SEARCH_BAR_V1 -- BU/งวด/ค้นหา อยู่ซ้าย ไม่มีหัวข้อ */}
          <BuPicker value={bu} options={pageBuOptions} onChange={setBu} height={32} width={230} placeholder={mine && mine.length === 0 ? 'ตั้ง Config ก่อน' : 'เลือก BU'} />
          <select style={{ ...inp, width: 150, height: 32 }} value={period} onChange={e => changePeriod(e.target.value)} title="งวด (YYYY.MM)"><option value="">เลือกงวด</option>{periodOptions.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <input style={{ ...inp, width: 220, height: 32, paddingLeft: 14 /* MARKER_GL_DOA_SEARCH_PAD_V1 */ }} placeholder="ค้นหา Account / BU" value={accQ} onChange={e => setAccQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') searchBu(); }} />
          {cfgActive && <span style={{ fontSize: 12, color: '#1F6B4A' }}>แสดงเฉพาะ Account ตาม Config ของคุณ ({myAccs.size})</span>}
          {shownAcc.length > 0 && (() => { const allOn = shownAcc.every(x => (bkAcc[x.code] || {}).conn === 'on'); const busy = shownAcc.some(x => (bkAcc[x.code] || {}).conn === 'busy'); return <button type="button" onClick={() => connectAll(shownAcc)} disabled={busy} title={allOn ? 'Disconnect ทุก Account' : 'Connect ทุก Account ที่แสดง'} style={{ marginLeft: 'auto', border: `1px solid ${allOn ? '#9FD3B6' : '#B9C4D2'}`, background: allOn ? '#EAF6EF' : '#fff', color: allOn ? '#1F6B4A' : '#334155', borderRadius: 6, height: 30, padding: '0 14px', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>{busy ? '… Connecting' : (allOn ? '🔗 Disconnect ทั้งหมด' : '🔌 Connect ทั้งหมด')}</button>; })()}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 6 }}>
          <table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...th, textAlign: 'left' }}>Account</th>
                <th colSpan={3} style={th}>ข้อมูลนำเข้า</th>
                <th colSpan={2} style={th}>Backup</th>
                <th rowSpan={2} style={th}>Action</th>
                <th rowSpan={2} style={th}>Confirm</th>
                <th rowSpan={2} style={th}>Sharedrive</th>
              </tr>
              <tr>
                {['TB', 'Detail', 'Simple', 'Filename', 'Status'].map(t => <th key={t} style={{ ...th, fontSize: 12, color: C.mute }}>{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {shownAcc.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#8a96a6' }}>{!bu ? 'เลือก BU ก่อน — รายการ Account จะแสดงตาม Config ของคุณ' : (tbAcc.length || cfgActive ? 'ไม่พบ Account ที่ตรงเงื่อนไข / Config' : 'BU นี้ยังไม่มี Config — ตั้ง Config หรือโยนไฟล์ TB ที่ด้านบนเพื่อดึงรายการ Account')}</td></tr>}
              {shownAcc.map(a => (
                <tr key={a.code} onMouseEnter={() => setHovRow(a.code)} onMouseLeave={() => setHovRow('')} style={{ borderTop: '1px solid #EAEFF5', background: (hovRow === a.code || (ctx && ctx.a && ctx.a.code === a.code)) ? '#E6F0FF' : undefined, boxShadow: (hovRow === a.code || (ctx && ctx.a && ctx.a.code === a.code)) ? 'inset 3px 0 0 #1F5FBF' : undefined, transition: 'background .12s' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 600, color: C.navy, whiteSpace: 'nowrap' }}>{a.code}{cfmAt[a.code] ? (() => { const ex = new Date(cfmAt[a.code] + DOA_CFM_EXPIRE_DAYS * 86400000); const dl = Math.ceil((ex.getTime() - Date.now()) / 86400000); const tx = `${String(ex.getDate()).padStart(2, '0')}/${String(ex.getMonth() + 1).padStart(2, '0')}/${ex.getFullYear()}`; return (<div title={`Confirm เมื่อ ${new Date(cfmAt[a.code]).toLocaleString('th-TH')} · หมดอายุ ${tx}${cfmSrc[a.code] ? ' · ไฟล์ต้นทาง: ' + cfmSrc[a.code] : ''}`} style={{ display: 'inline-block', marginLeft: 8, verticalAlign: 'middle', fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, border: `1px solid ${dl <= 0 ? '#B42318' : dl <= 7 ? '#B35C00' : '#1F6B4A'}`, background: dl <= 0 ? '#FDECEA' : dl <= 7 ? '#FFF4E8' : '#E8F5EE', color: dl <= 0 ? '#B42318' : dl <= 7 ? '#B35C00' : '#1F6B4A' }}>{dl <= 0 ? 'หมดอายุแล้ว ' : 'หมด '}{tx}</div>); })() : null}{/* MARKER_GL_DOA_STAMP_AFTER_ACCOUNT_V1 -- Stamp หมดอายุอยู่หลังรหัส Account */}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span onContextMenu={e => openCtx(e, 'TB', a)}><StatusDot kind={a.inTb ? 'ok' : 'none'} title={(a.inTb ? 'มีใน TB' : (tbAcc.length ? 'ไม่มีใน TB' : 'ยังไม่มีข้อมูล')) + ' · คลิกขวาเพื่อล้าง'} /></span></span></td>
                  <td onContextMenu={e => openCtx(e, 'Detail', a)} style={{ padding: '7px 10px', textAlign: 'center' }}><StatusDot kind={detAcc.has(a.code) ? 'ok' : (detAcc.size ? 'miss' : 'none') /* MARKER_GL_DOA_DETAIL_DOT_GREY_NODETAIL_V1 -- ยังไม่มี Detail เลย = เทา | แดงเฉพาะเมื่อโหลด Detail แล้วแต่ไม่พบ Account นี้ */ /* MARKER_GL_DOA_DOT_GREY_EMPTY_V1 -- ทั้งงวดยังไม่มีข้อมูลเลย = เทา | มีข้อมูลบางรายงานแล้วแต่ Account นี้ไม่มี Detail = แดง */} title={(detAcc.has(a.code) ? 'มีใน Detail' : (detAcc.size ? 'ไม่มีใน Detail' : 'ยังไม่มีข้อมูล')) + ' · คลิกขวาเพื่อล้าง'} /></td>
                  <td onContextMenu={e => openCtx(e, 'Simple', a)} style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>{(!simAcc.has(a.code) && cfmAt[a.code]) ? <span title="Confirm แล้ว — ข้อมูล Simple ถูกเอาออกจากหน้านี้ · คลิกขวาเพื่อ Preview / Download" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 12 }}><svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="#B42318" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 1h8M1.5 12h8M2.5 1c0 3 3 3.6 3 5.5S2.5 9 2.5 12M8.5 1c0 3-3 3.6-3 5.5S8.5 9 8.5 12" /></svg></span> : <StatusDot kind={simAcc.has(a.code) ? 'ok' : 'none'} title={(simAcc.has(a.code) ? 'มีใน Simple' : 'ยังไม่มีข้อมูล Simple') + ' · คลิกขวาเพื่อ Preview / Download / ล้าง'} />}{/* MARKER_GL_DOA_SIMPLE_DOT_GREY_V1 -- ไม่มี/ล้างแล้ว = เทา (ไม่ใช่แดง) ทีละ Account */}{/* MARKER_GL_DOA_SIMPLE_BADGE_TIDY_V1 */}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', width: 270, maxWidth: 270, fontSize: 12 }}>{/* MARKER_GL_DOA_BACKUP_FILE_COL_V1 -- Filename: Default = ไฟล์ M-1 ถ้ามี, Dropdown เลือกไฟล์อื่น (ต้อง Connect ก่อน) */}{!a.inTb ? <span style={{ color: '#B9C4D2' }} title="ยังไม่มี TB ของงวดนี้ — Include ใช้ได้เมื่อมีข้อมูลงวดปัจจุบันแล้ว">-{/* MARKER_GL_DOA_INCLUDE_NEED_TB_V1 */}</span> : (!(hasInc(String(a.code))) && ((bkAcc[a.code] || {}).conn === 'empty' || ((bkAcc[a.code] || {}).conn !== 'on' && bkHave && !bkHave.has(String(a.code))))) ? <span style={{ color: '#B54708', whiteSpace: 'nowrap', fontWeight: 600 }} title={`ไม่มี Backup ของงวดที่ต่ำกว่า ${period} ใน DB สำหรับ BU + Account นี้ จึงไม่มีอะไรให้ Connect — โยนไฟล์ Backup (Detail งวดก่อน) ลงช่องด้านบนเพื่อสร้าง Backup แล้วระบบจะ Connect ให้อัตโนมัติ`}>ไม่พบ Backup ก่อน {period}{/* MARKER_GL_DOA_BACKUP_ONELINE_V1 */}</span> : (bkAcc[a.code] || {}).conn !== 'on' ? <span style={{ color: bkWarn(a.code) ? '#B54708' : '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง · ' : 'ข้อมูลจาก DB (Include/Below) · ') + (hasInc(String(a.code)) ? `Include ใน DB ${incCnt(String(a.code))} แถว (งวด ${prevPeriod} ลงไป) · ` : '') + `BU ${bu} · Account ${a.code}`}>{bkShow(a.code)}</span> : ((bkFiles.length > 1 /* MARKER_GL_DOA_NO_DROPDOWN_SINGLE_V1 -- มีไฟล์เดียว = แสดงชื่อไฟล์ ไม่ต้อง Dropdown */ && !bkHaveMap[String(a.code)] /* MARKER_GL_DOA_NO_DROPDOWN_WHEN_MATCHED_V1 -- หาไฟล์ Match Account ได้แล้ว = แสดงชื่อไฟล์ ไม่ต้อง Dropdown */ && !(belowByAcc.has(String(a.code)) && !(bkHave && bkHave.has(String(a.code))))) ? (
                    <select value={(bkAcc[a.code] || {}).sel || ''} onChange={e => bkSet(a.code, { sel: e.target.value })} title="เลือกไฟล์ Backup" style={{ ...inp, height: 26, fontSize: 12, width: 170, maxWidth: 170, textOverflow: 'ellipsis' /* MARKER_GL_DOA_BACKUP_SELECT_FIXED_W_V1 -- ไม่ขยายคอลัมน์ Filename */ }}>
                      <option value="">{bkFiles.some(x => x.period === prevPeriod) ? 'เลือกไฟล์…' : `ไม่มีไฟล์ ${prevPeriod} — เลือกไฟล์…`}</option>
                      {bkFiles.map(f => <option key={f.id} value={String(f.id)}>{f.file_name || bkLbl(a.code, f.period)}</option>)}
                    </select>) : ((hasInc(String(a.code)) || belowByAcc.has(String(a.code)) || !!bkHaveMap[String(a.code)]) ? <span style={{ color: bkWarn(a.code) ? '#B54708' : '#1a3a5c', fontWeight: 600, whiteSpace: 'nowrap' }} title={(bkHaveMap[String(a.code)] ? 'พบในไฟล์ Backup จริง' : `ข้อมูลจาก DB (Include/Below) — ไม่พบ Account นี้ในไฟล์ Backup ใด กดปุ่ม Restore เพื่อเก็บเข้าไฟล์ ${bu}_Detail_backup_${prevPeriod}.xlsx`) + ` · Include ${incCnt(String(a.code))} แถว · BU ${bu} · Account ${a.code}`}>{/* MARKER_GL_DOA_INCLUDE_CONNECTED_V1 */}{bkShow(a.code)}</span> : <span style={{ color: '#B9C4D2' }} title="Connect แล้ว แต่ใน DB ยังไม่มีไฟล์ Backup Detail ของ BU นี้ (ที่ไม่ใช่งวดปัจจุบัน)">ไม่มีไฟล์ Backup ใน DB</span>))}{/* MARKER_GL_DOA_RESTORE_INCLUDE_V1 */}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => toggleBk(a.code)} title={isCn(a.code) ? 'เชื่อมต่อแล้ว — กดเพื่อ Disconnect' : ((bkAcc[a.code] || {}).conn === 'busy' ? 'กำลังเชื่อมต่อ…' : 'ยังไม่ได้เชื่อมต่อ — กดเพื่อ Connect')}
                      style={{ border: `1px solid ${isCn(a.code) ? '#9FD3B6' : '#D5DEEA'}`, background: isCn(a.code) ? '#EAF6EF' : '#fff', color: isCn(a.code) ? '#1F6B4A' : '#8a96a6', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', width: 30, height: 26, padding: 0, fontSize: 14, lineHeight: 1, cursor: (bkAcc[a.code] || {}).conn === 'busy' ? 'wait' : 'pointer' }}>{/* MARKER_GL_DOA_STATUS_BTN_ALIGN_V1 */}
                      {isCn(a.code) ? bkIcon(true) : ((bkAcc[a.code] || {}).conn === 'busy' ? '…' : bkIcon(false))}</button>{/* MARKER_GL_DOA_REMOVE_STATUS_BADGE_V1 */}
                    {(() => { const nC = clrByAcc.get(String(a.code)) || 0; return (<button type="button" disabled={!nC || rvsBusy === String(a.code)} onClick={() => openClrHist(a.code)} title={nC ? `ประวัติ Auto Clear / Clear ${nC} แถวของ Account นี้ (ดู / RVS)` : 'ไม่มีแถวที่ Stamp Clear'} style={{ marginLeft: 6, border: `1px solid ${nC ? '#F0B27A' : '#D5DEEA'}`, background: nC ? '#FFF4E8' : '#fff', color: nC ? '#B35C00' : '#C3CCD9', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', boxSizing: 'border-box', width: 30, height: 26, padding: 0, fontSize: 14, lineHeight: 1, cursor: nC ? 'pointer' : 'not-allowed', opacity: nC ? 1 : 0.6 }}>{rvsBusy === String(a.code) ? '…' : '♻'}</button>); })()}
                    {/* MARKER_GL_DOA_RESTORE_BTN_STATUS_V1 -- ย้ายปุ่ม Restore ไปคอลัมน์ Status */}{restoreBtn(a)}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>{/* MARKER_GL_DOA_ACTION_RECONCILE_ICON_V1 -- Icon Reconcile (🔗 เหมือนเมนู Reconcile) — ยังไม่ผูกการทำงาน */}
                    {((a.inTb && detAcc.has(a.code)) || simAcc.has(a.code)) ? <button type="button" title="Reconcile" onClick={() => setRecAcc(a.code)} style={{ border: '1px solid #D5DEEA', background: '#fff', borderRadius: 6, width: 28, height: 24, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>🔗</button> : <span style={{ color: '#B9C4D2' }}>-</span>}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12 }}>{/* MARKER_GL_DOA_CONFIRM_DETAIL_SP_V1 -- Confirm: สร้าง CSV ของ Account นี้ (COM_BU_DOH_งวด_Account.csv) แล้วส่งเข้า SharePoint ผ่าน Handler */}
                    {!((a.inTb && detAcc.has(a.code)) || simAcc.has(a.code)) ? <span style={{ color: '#B9C4D2' }}>-</span> : (cfmAcc[a.code]
                      ? <button type="button" onClick={async () => { if (await askDoa(`Release Account ${a.code}?\n\nยกเลิกสถานะ Confirm เพื่อให้แก้ไข/Confirm ใหม่ได้ (ไม่ลบไฟล์ที่ส่งไป SharePoint แล้ว)\nล้างวันหมดอายุและปลด Badge (ไม่เปลี่ยน Status ของแถว)`)) { setCfmAcc(prev => { const n = { ...prev }; delete n[a.code]; return n; }); unmarkCfm(a.code); } }} title={`Confirm แล้ว (${cfmAcc[a.code]}) — กดเพื่อ Release`} style={{ border: '1px solid #B54708', background: '#fff', color: '#B54708', borderRadius: 999, height: 24, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Release</button> /* MARKER_GL_DOA_RELEASE_BTN_V1 -- Confirm แล้วเปลี่ยนเป็นปุ่ม Release (ยกเลิกสถานะ Confirm บนหน้าจอ) */
                      : <button type="button" onClick={() => confirmDetail(a)} title={detAcc.has(a.code) ? 'Confirm Detail ของ Account นี้ → ส่งไฟล์ CSV เข้า SharePoint' : 'Confirm Account นี้ (Simple — ไม่ส่งไฟล์)'} style={{ border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', borderRadius: 999, height: 24, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', color: '#B9C4D2' }}>-</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {ctx && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', left: ctx.x, top: ctx.y, zIndex: 3000, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(26,58,92,.18)', padding: 4, minWidth: 200 }}>
          <button type="button" onClick={() => { const c = ctx; setCtx(null); setPrevw({ kind: c.kind, code: c.a.code }); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 12px', fontSize: 13, color: '#1a3a5c', cursor: 'pointer', borderRadius: 6 }}>👁 Preview ไฟล์ {ctx.kind}</button>
          <button type="button" onClick={() => { const c = ctx; setCtx(null); downloadFile(c.kind, c.a.code); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 12px', fontSize: 13, color: '#1F6B4A', cursor: 'pointer', borderRadius: 6 }}>⬇ Download {ctx.kind} ของ Account {ctx.a.code}</button>
          {<button type="button" onClick={() => { const c = ctx; setCtx(null); downloadFile(c.kind, ''); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 12px', fontSize: 13, color: '#1F6B4A', cursor: 'pointer', borderRadius: 6 }}>⬇ Download {ctx.kind} ทั้งไฟล์ (ทุก Account)</button>}
          <button type="button" onClick={() => { const c = ctx; setCtx(null); clearAcc(c.kind, c.a); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 12px', fontSize: 13, color: '#B42318', cursor: 'pointer', borderRadius: 6 }}>🗑 ล้าง {ctx.kind} ของ Account {ctx.a.code}</button>
          {<button type="button" onClick={() => { const c = ctx; setCtx(null); clearType(c.kind); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 12px', fontSize: 13, color: '#B42318', cursor: 'pointer', borderRadius: 6 }}>🗑 ล้าง {ctx.kind} ทั้งหมด (ทุก Account)</button>}
        </div>
      )}
      <DoaConfirmHost />
      {notice && <DoaNoticeModal n={notice} onClose={() => setNotice(null)} />}
      {recAcc && <DoaReconcileModal code={recAcc} tbMatrix={tbMatrix} detMatrix={detMatrix} simMatrix={simMatrix} bu={bu} period={period} onClose={() => setRecAcc(null)} />}
      {rcSend && <DoaReconcileModal hidden autoSend={rcSend} code={rcSend.code} tbMatrix={tbMatrix} detMatrix={detMatrix} simMatrix={simMatrix} bu={bu} period={period} onClose={() => setRcSend(null)} />}
      {dropPop && (<div onClick={() => setDropPop(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(560px, 92vw)', padding: 22, boxShadow: '0 12px 40px rgba(0,0,0,.3)' }}>
          <div style={{ fontWeight: 700, color: '#1a3a5c', fontSize: 16, marginBottom: 6 }}>สร้าง Backup Detail</div>
          <div style={{ fontSize: 13, color: '#57606a', marginBottom: 14 }}>BU {bu} ยังไม่มี Backup Detail — เลือกงวดของไฟล์ แล้วโยนไฟล์ Detail ของงวดนั้นเพื่อสร้าง Backup (ไม่ใช่ข้อมูลงวดปัจจุบัน) จากนั้นระบบ Connect ให้อัตโนมัติ</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>งวดของไฟล์ Backup
            <select value={mkPer || prevPeriod} onChange={e => setMkPer(e.target.value)} style={{ height: 30, borderRadius: 6, border: '1px solid #B9C4D2', padding: '0 8px' }}>{Array.from(new Set([prevPeriod].concat(periodOptions))).filter(x => x !== period).sort().reverse().map(x => <option key={x} value={x}>{x}{x === prevPeriod ? ' (M-1)' : ''}</option>)}</select>
          </div>
          <label onDragOver={e => { e.preventDefault(); setDropOver(true); }} onDragLeave={() => setDropOver(false)} onDrop={e => { e.preventDefault(); setDropOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) makeBackup(f); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 130, border: `2px dashed ${dropOver ? '#2c7be5' : '#B9C4D2'}`, borderRadius: 10, background: dropOver ? '#EEF5FF' : '#FAFBFD', color: '#57606a', fontSize: 14, cursor: 'pointer', textAlign: 'center', padding: 10 }}>
            {mkBusy ? 'กำลังสร้าง Backup…' : 'ลากไฟล์ Detail (.xlsx / .xls / .csv) มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์'}
            <input type="file" accept=".xlsx,.xls,.csv,.txt,.tsv" style={{ display: 'none' }} onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) makeBackup(f); }} />
          </label>
          <div style={{ marginTop: 14, borderTop: '1px solid #E3E8EF', paddingTop: 10 }}>{/* MARKER_GL_DOA_DRIVE_D_LIST_V1 -- รายการไฟล์ใน Drive D (กรอบแดง) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a3a5c' }}>ไฟล์ใน Drive D · BU {bu}{dropAcc ? ` · Account ${dropAcc}` : ''}</span>
              <button type="button" title="รีเฟรชรายการจาก Drive D" disabled={dFiles.st === 'busy'} onClick={() => setDTick(t => t + 1)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 26, width: 30, cursor: 'pointer' }}>↻</button>
            </div>
            {dFiles.st === 'busy' && <div style={{ fontSize: 12, color: '#57606a' }}>กำลังอ่านรายการจาก Handler…</div>}
            {dFiles.st === 'err' && <div style={{ fontSize: 12, color: '#B42318' }}>{dFiles.msg}</div>}
            {dFiles.st === 'ok' && !dFilt.acc.length && !dFilt.whole.length && <div style={{ fontSize: 12, color: '#57606a' }}>ไม่พบไฟล์ Backup Detail ของ BU นี้ใน Drive D</div>}
            {dFiles.st === 'ok' && (dFilt.acc.length > 0 || dFilt.whole.length > 0) && (
              <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid #E3E8EF', borderRadius: 8 }}>
                {[['Detail ของ Account ' + dropAcc, dFilt.acc], ['ไฟล์รวมทั้ง BU', dFilt.whole]].filter(g => g[1].length).map(g => (
                  <div key={g[0]}>
                    <div style={{ background: '#F4F7FB', padding: '4px 10px', fontSize: 12, color: '#57606a' }}>{g[0]}</div>
                    {g[1].map(it => (
                      <div key={it.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderTop: '1px solid #EEF2F7', fontSize: 13 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.path}>📄 {it.name}</span>
                        <span style={{ color: '#6b7785', fontSize: 12, whiteSpace: 'nowrap' }}>งวด {it.per} · {Math.max(1, Math.round((it.size || 0) / 1024))} KB</span>
                        <button type="button" disabled={!!pullBusy || mkBusy} onClick={() => pullFromD(it)} style={{ border: '1px solid #1a3a5c', background: pullBusy === it.path ? '#EEF5FF' : '#1a3a5c', color: pullBusy === it.path ? '#1a3a5c' : '#fff', borderRadius: 6, height: 26, padding: '0 10px', cursor: 'pointer', fontSize: 12 }}>{pullBusy === it.path ? 'กำลังดึง…' : 'ใช้ไฟล์นี้'}</button>
                      </div>))}
                  </div>))}
              </div>)}
          </div>
          <div style={{ textAlign: 'right', marginTop: 14 }}><button type="button" onClick={() => setDropPop(false)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 30, padding: '0 16px', cursor: 'pointer' }}>ปิด</button></div>
        </div>
      </div>)}
      {clrHist && (<div onClick={() => setClrHist(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{/* MARKER_GL_DOA_CLEAR_HISTORY_FE_V1 */}
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 'min(1900px, 98vw)', height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '5px solid #B35C00' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #E1E6EE', display: 'flex', alignItems: 'center', gap: 12 }}><b style={{ color: '#1a3a5c' }}>♻ ประวัติ Auto Clear / Clear · Account {clrHist.code} · BU {bu}</b><span style={{ fontSize: 12, color: '#6B778C' }}>{clrFilt(clrHist).length === clrHist.items.length ? clrHist.items.length : `${clrFilt(clrHist).length} / ${clrHist.items.length}`} แถวที่ Clear (Auto Clear / Stamp Clear) · ติ๊กแล้วกด "กลับเป็น Pending" เพื่อคืนแถวกลับมาแสดงใน Detail</span><input value={clrHist.q || ''} onChange={e => { const v = e.target.value; setClrHist(h0 => ({ ...h0, q: v })); }} placeholder="🔍 ค้นหา Journal / Description / Invoice / Amount / CPC …" autoFocus style={{ marginLeft: 'auto', width: 360, height: 30, border: '1px solid #B9C4D2', borderRadius: 6, padding: '0 10px', fontSize: 13 }} />{clrHist.q ? <button type="button" onClick={() => setClrHist(h0 => ({ ...h0, q: '' }))} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 30, padding: '0 10px', cursor: 'pointer' }}>ล้าง</button> : null}</div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
            {clrHist.loading ? <div style={{ padding: 24, color: '#6B778C' }}>กำลังโหลด…</div> : clrHist.err ? <div style={{ padding: 24, color: '#B42318' }}>โหลดไม่สำเร็จ: {clrHist.err}</div> : !clrHist.items.length ? <div style={{ padding: 24, color: '#6B778C' }}>ไม่มีแถวที่ Clear</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#F3F6FA', position: 'sticky', top: 0, zIndex: 2, height: 48 }}>{['', 'สถานะ', 'Branch', 'CPC', 'Date', 'Journal', 'Invoice', 'Description', 'Amount', 'โดย', 'เวลา'].map((h, i) => <th key={i} style={{ border: '1px solid #E3E8EF', padding: '14px 8px', height: 48, background: '#F3F6FA', boxShadow: 'inset 0 -1px 0 #C9D3E0', verticalAlign: 'middle', textAlign: 'left' }}>{i === 0 ? <input type="checkbox" checked={clrFilt(clrHist).length > 0 && clrFilt(clrHist).every(x => clrHist.sel.has(x.row_key))} onChange={e => setClrHist(h0 => { const fk = clrFilt(h0).map(x => x.row_key); return { ...h0, sel: e.target.checked ? new Set([...h0.sel, ...fk]) : new Set([...h0.sel].filter(k => !fk.includes(k))) }; })} /> : h}</th>)}</tr></thead>
                <tbody>{clrFilt(clrHist).map(x => { const r = x.row || {}; return (<tr key={x.row_key} style={{ background: '#fff' }}>
                  <td style={{ border: '1px solid #EEF2F7', padding: '3px 8px' }}><input type="checkbox" checked={clrHist.sel.has(x.row_key)} onChange={e => setClrHist(h0 => { const n = new Set(h0.sel); if (e.target.checked) n.add(x.row_key); else n.delete(x.row_key); return { ...h0, sel: n }; })} /></td>
                  <td style={{ border: '1px solid #EEF2F7', padding: '3px 8px', fontWeight: 700, color: x.status === 'Backup' ? '#1a3a5c' : '#1F6B4A', whiteSpace: 'nowrap' }} title={(x.status === 'Pending' || x.status === 'Cleared') ? 'Clear (Auto Clear หรือ Stamp Clear) — ซ่อนจาก Detail' : x.status}>{(x.status === 'Pending' || x.status === 'Cleared') ? 'Clear' : x.status}</td>
                  <td style={{ border: '1px solid #EEF2F7', padding: '3px 8px' }}>{r.branch_code}</td><td style={{ border: '1px solid #EEF2F7', padding: '3px 8px' }}>{r.cost_center}</td><td style={{ border: '1px solid #EEF2F7', padding: '3px 8px', whiteSpace: 'nowrap' }}>{r.txn_date}</td>
                  <td style={{ border: '1px solid #EEF2F7', padding: '3px 8px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.journal_name}>{r.journal_name}</td><td style={{ border: '1px solid #EEF2F7', padding: '3px 8px' }}>{r.invoice_no}</td><td style={{ border: '1px solid #EEF2F7', padding: '3px 8px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                  <td style={{ border: '1px solid #EEF2F7', padding: '3px 8px', textAlign: 'right' }}>{Number(r.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td style={{ border: '1px solid #EEF2F7', padding: '3px 8px' }}>{String(x.cleared_by || '').split('@')[0]}</td><td style={{ border: '1px solid #EEF2F7', padding: '3px 8px', whiteSpace: 'nowrap' }}>{x.cleared_at ? new Date(x.cleared_at).toLocaleString('th-TH') : ''}</td></tr>); })}{!clrFilt(clrHist).length && <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#6B778C' }}>ไม่พบรายการที่ตรงกับคำค้น</td></tr>}</tbody>
              </table>)}
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #E1E6EE', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#44546A', flex: 1 }}>{clrHist.sel.size ? `เลือก ${clrHist.sel.size} แถว` : (clrHist.q ? `ไม่ได้เลือก = RVS เฉพาะ ${clrFilt(clrHist).length} แถวที่ค้นหา` : 'ไม่ได้เลือก = RVS ทั้งหมดของ Account นี้')}</span>
            <button type="button" disabled={!clrHist.items.length || rvsBusy === clrHist.code || (!!clrHist.q && !clrHist.sel.size && !clrFilt(clrHist).length)} onClick={() => reverseClearAcc(clrHist.sel.size ? [...clrHist.sel] : (clrHist.q ? clrFilt(clrHist).map(x => x.row_key) : []))} style={{ border: 'none', background: '#B35C00', color: '#fff', borderRadius: 6, height: 32, padding: '0 18px', cursor: 'pointer', fontWeight: 700, opacity: clrHist.items.length ? 1 : 0.5 }}>{clrHist.sel.size ? 'กลับเป็น Pending (ที่เลือก)' : (clrHist.q ? 'กลับเป็น Pending (ที่ค้นหา)' : 'กลับเป็น Pending (ทั้งหมด)')}</button>
            <button type="button" onClick={() => setClrHist(null)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 32, padding: '0 16px', cursor: 'pointer' }}>ปิด</button>
          </div>
        </div></div>)}
      {bkSplit && <DoaBackupSplitModal rows={bkSplit.rows} curRows={bkSplit.curRows} srcNote={bkSplit.srcNote} period={period} fileName={bkSplit.fileName} ctx={detCtx()} onDone={(v) => bkSplit.res(v)} />}
      {prevw && <DoaPreviewModal kind={prevw.kind} code={prevw.code} matrix={prevw.kind === 'TB' ? tbMatrix : (prevw.kind === 'Detail' ? detMatrix : simMatrix)} fileName={prevw.kind === 'TB' ? tbName : (prevw.kind === 'Simple' ? simName : '')} ctx={detCtx()} onClear={prevw.kind === 'Detail' ? stampClearRows : undefined} incKeys={prevw.kind === 'Detail' ? incKeys : undefined} curPeriod={period} onClose={() => setPrevw(null)} />}
      {showBk && <DoaBackupModal bu={bu} onLoad={loadFromBackup} onClose={() => setShowBk(false)} />}
      {showStor && isAdm && (() => {
        const S = stor || {}; const fb = (n) => { n = Number(n) || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; };
        const Y = (S.config || {}).warn_yellow || 70, R = (S.config || {}).warn_red || 90; const lc = (l) => (l === 'red' ? '#c0392b' : l === 'yellow' ? '#d97706' : '#2E7D5B');
        const th = { textAlign: 'left', padding: '5px 8px', color: '#888', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #E4E9F0' }; const td = { padding: '5px 8px', fontSize: 13, borderBottom: '1px solid #F0F2F5' }; const rt = { textAlign: 'right' };
        const pill = (col, tx) => <span style={{ background: col, color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 11 }}>{tx}</span>;
        const kp = (k, v, s) => (<div style={{ border: '1px solid #E4E9F0', borderRadius: 8, padding: 8, flex: '1 1 140px' }}><div style={{ fontSize: 12, color: '#888' }}>{k}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 12, color: '#888' }}>{s}</div></div>);
        const q = S.quota || {}; const qc = q.use_pct == null ? '#2E7D5B' : q.use_pct >= R ? '#c0392b' : q.use_pct >= Y ? '#d97706' : '#2E7D5B'; const fc = S.forecast || {};
        const KC = { TBRAW: '#2563eb', Detail: '#7c3aed', Simple: '#0891b2', TB: '#9ca3af' }; const kinds = S.by_kind || []; const sumK = kinds.reduce((s, k) => s + k.bytes, 0) || 1;
        const buAll = S.by_bu || []; const qq = storQ.trim().toLowerCase(); const buRows = qq ? buAll.filter(b => String(b.bu).toLowerCase().includes(qq)) : buAll;
        const kb = (b, k) => fb(((b.kinds || {})[k] || {}).bytes || 0);
        return (<div onClick={() => setShowStor(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 4300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: storTab === 'files' ? 'min(1280px, 96vw)' : 'min(900px, 95vw)', height: storTab === 'files' ? '92vh' : undefined, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><div style={{ fontWeight: 700, color: '#1a3a5c', fontSize: 16 }}>💾 DOA Storage <span style={{ fontWeight: 400, fontSize: 12, color: '#6B778C' }}>— ข้อมูลที่ Detail of Account เก็บไว้</span></div><span style={{ marginLeft: 'auto' }} /><button type="button" onClick={() => loadStor(true)} title="โหลดใหม่" style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 26, padding: '0 10px', cursor: 'pointer' }}>↻</button><button type="button" onClick={() => setShowStor(false)} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#888' }}>✕</button></div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>{[['ov', 'ภาพรวม'], ['bu', 'แยกตาม BU'], ['files', 'ไฟล์ที่เก็บ'], ['mod', 'ตาม Module (Stamp)']].map(([k, l]) => (<button key={k} type="button" onClick={() => setStorTab(k)} style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid ' + (storTab === k ? '#1a3a5c' : '#E4E9F0'), background: storTab === k ? '#1a3a5c' : '#fff', color: storTab === k ? '#fff' : '#5A6B80', fontSize: 13, cursor: 'pointer' }}>{l}</button>))}</div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {!stor ? <div style={{ color: '#888', fontSize: 13 }}>กำลังโหลด…</div> : S.error ? <div style={{ color: '#c0392b', fontSize: 13 }}>โหลดไม่สำเร็จ: {S.error}</div> : (<>
                {storTab === 'ov' && (<>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {kp('ขนาดรวม DOA', fb(S.total), q.use_pct != null ? q.use_pct + '% ของโควตา ' + fb(q.bytes) + ' (' + q.pct + '%)' : 'ยังอ่านความจุดิสก์ไม่ได้')}
                    {kp('ไฟล์ที่เก็บ', (S.files || 0).toLocaleString(), (S.bu_count || 0) + ' BU · เพดาน ' + S.max_periods + ' งวด/BU')}
                    {kp('เก็บเพิ่มได้อีก', q.bytes ? fb(q.free) : '—', 'ตามโควตากลุ่ม Detail of Account')}
                    {kp('คาดว่าเต็มโควตา', fc.months_left != null ? '≈ ' + fc.months_left + ' เดือน' : '—', fc.per_month != null ? 'โตเฉลี่ย ' + fb(fc.per_month) + '/เดือน' : 'ต้องมีประวัติ ≥ 7 วัน (ตอนนี้ ' + (fc.days_of_history || 0) + ' วัน)')}
                  </div>
                  {q.use_pct != null && <div style={{ height: 10, background: '#E4E9F0', borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}><div style={{ width: Math.min(100, q.use_pct) + '%', height: '100%', background: qc }} /></div>}
                  <div style={{ fontWeight: 600, fontSize: 13, margin: '6px 0 4px' }}>แยกตามชนิดข้อมูล</div>
                  <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', background: '#E4E9F0' }}>{kinds.map(k => <div key={k.kind} title={k.kind + ' ' + fb(k.bytes)} style={{ width: (k.bytes / sumK * 100) + '%', background: KC[k.kind] || '#6b7280' }} />)}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}><thead><tr><th style={th}>ชนิด</th><th style={{ ...th, ...rt }}>ไฟล์</th><th style={{ ...th, ...rt }}>BU</th><th style={{ ...th, ...rt }}>ขนาด</th></tr></thead><tbody>{kinds.map(k => <tr key={k.kind}><td style={td}><span style={{ display: 'inline-block', width: 10, height: 10, background: KC[k.kind] || '#6b7280', marginRight: 6, borderRadius: 2 }} /><b>{k.kind}</b>{k.kind === 'TBRAW' ? ' (TB ทั้งไฟล์)' : ''}</td><td style={{ ...td, ...rt }}>{k.files.toLocaleString()}</td><td style={{ ...td, ...rt }}>{k.bus}</td><td style={{ ...td, ...rt }}>{fb(k.bytes)}</td></tr>)}</tbody></table>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
                    <div style={{ flex: '1 1 320px' }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>BU ที่ใช้พื้นที่มากสุด (Top 6)</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>BU</th><th style={{ ...th, ...rt }}>TBRAW</th><th style={{ ...th, ...rt }}>Detail</th><th style={{ ...th, ...rt }}>Simple</th><th style={{ ...th, ...rt }}>รวม</th></tr></thead><tbody>{buAll.slice(0, 6).map(b => <tr key={b.bu}><td style={td}>{b.bu}</td><td style={{ ...td, ...rt }}>{kb(b, 'TBRAW')}</td><td style={{ ...td, ...rt }}>{kb(b, 'Detail')}</td><td style={{ ...td, ...rt }}>{kb(b, 'Simple')}</td><td style={{ ...td, ...rt }}><b>{fb(b.bytes)}</b></td></tr>)}</tbody></table></div>
                    <div style={{ flex: '1 1 300px' }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>เพดานงวดต่อ BU (สูงสุด {S.max_periods} งวด)</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>BU</th><th style={{ ...th, ...rt }}>งวดที่เก็บ</th><th style={th}>สถานะ</th></tr></thead><tbody>{[...buAll].sort((a, b) => b.periods - a.periods).slice(0, 6).map(b => <tr key={b.bu}><td style={td}>{b.bu}</td><td style={{ ...td, ...rt }}>{b.periods} / {b.max}</td><td style={td}>{pill(lc(b.level), b.level === 'red' ? 'เต็มเพดาน' : b.level === 'yellow' ? 'ใกล้เต็ม' : 'ปกติ')}</td></tr>)}</tbody></table>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>เกินเพดาน = เตือนให้ย้ายไป SharePoint — ระบบไม่ลบเอง</div></div>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, margin: '10px 0 4px' }}>ตารางข้อมูลของ DOA</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>ตาราง</th><th style={{ ...th, ...rt }}>แถว</th><th style={{ ...th, ...rt }}>ข้อมูล</th><th style={{ ...th, ...rt }}>Index</th><th style={{ ...th, ...rt }}>รวม</th></tr></thead><tbody>{(S.tables || []).map(x => <tr key={x.name}><td style={td}>{x.name}</td><td style={{ ...td, ...rt }}>{x.rows.toLocaleString()}</td><td style={{ ...td, ...rt }}>{fb(x.tbl)}</td><td style={{ ...td, ...rt }}>{fb(x.idx)}</td><td style={{ ...td, ...rt }}><b>{fb(x.total)}</b></td></tr>)}</tbody></table>
                </>)}
                {storTab === 'bu' && (<>
                  <input value={storQ} onChange={e => setStorQ(e.target.value)} placeholder="ค้นหา BU" style={{ height: 28, padding: '0 8px', border: '1px solid #B9C4D2', borderRadius: 6, marginBottom: 8, width: 200 }} />
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>BU</th><th style={{ ...th, ...rt }}>งวด (TBRAW)</th><th style={th}>สถานะ</th><th style={{ ...th, ...rt }}>TBRAW</th><th style={{ ...th, ...rt }}>Detail</th><th style={{ ...th, ...rt }}>Simple</th><th style={{ ...th, ...rt }}>TB</th><th style={{ ...th, ...rt }}>รวม</th><th style={th}>อัปเดตล่าสุด</th></tr></thead>
                    <tbody>{buRows.map(b => <tr key={b.bu}><td style={td}>{b.bu}</td><td style={{ ...td, ...rt }}>{b.periods} / {b.max}</td><td style={td}>{pill(lc(b.level), b.level === 'red' ? 'เต็มเพดาน' : b.level === 'yellow' ? 'ใกล้เต็ม' : 'ปกติ')}</td><td style={{ ...td, ...rt }}>{kb(b, 'TBRAW')}</td><td style={{ ...td, ...rt }}>{kb(b, 'Detail')}</td><td style={{ ...td, ...rt }}>{kb(b, 'Simple')}</td><td style={{ ...td, ...rt }}>{kb(b, 'TB')}</td><td style={{ ...td, ...rt }}><b>{fb(b.bytes)}</b></td><td style={{ ...td, fontSize: 12, color: '#888' }}>{b.last ? new Date(b.last).toLocaleString('th-TH') : '-'}</td></tr>)}{!buRows.length && <tr><td style={td} colSpan={9}>ยังไม่มีข้อมูล</td></tr>}</tbody></table>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>แสดง {buRows.length} จาก {S.bu_count || 0} BU (เรียงตามขนาด)</div>
                </>)}
{storTab === 'files' && (() => { // MARKER_GL_DOA_STORAGE_FILE_LIST_V1 -- รายชื่อไฟล์ที่เก็บใน DB ทีละไฟล์ (BU / งวด / ชนิด / เจ้าของ / ขนาด)
                  const fl = (S.file_list || []); const ql = storQ.trim().toLowerCase(); const rowsF = fl.filter(f => !ql || [f.bu, f.period, f.kind, f.owner, f.file_name].join(' ').toLowerCase().includes(ql)); const dtf = (v) => v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                  const dupN = {}; fl.forEach(x => { const k = x.bu + '|' + x.period + '|' + x.kind; dupN[k] = (dupN[k] || 0) + 1; }); const dupSets = Object.keys(dupN).filter(k => dupN[k] > 1 && !k.endsWith('|TBRAW')).length; // MARKER_GL_DOA_REUPLOAD_DEDUPE_V1
                  const delFile = (f) => setDelAsk(f);
                  const doDel = async () => { const f = delAsk; if (!f) return; setDelBusy(true); try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/file/${f.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); setStorView(null); setDelAsk(null); _bc('doa_tb_changed'); loadStor(true); } catch (e) { setDelAsk({ ...f, err: e.message || String(e) }); } setDelBusy(false); }; // MARKER_GL_DOA_STORAGE_FILE_DELETE_V1
                  const setRet = async (key, val) => { try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/retention`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') }, body: JSON.stringify({ [key]: Number(val) }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); _bc('doa_tb_changed'); loadStor(true); } catch (e) { window.alert('ตั้งค่าไม่สำเร็จ: ' + (e.message || e) + ' (ต้องวาง Backend ตัวใหม่)'); } }; // MARKER_GL_DOA_RETENTION_DAYS_V1
                  const retSel = (label, key) => { const cur = Number((S.config || {})[key]) || 0; const opts = [[0, 'สิ้นเดือนถัดจากงวด'], [30, '30 วัน'], [45, '45 วัน'], [60, '60 วัน'], [90, '90 วัน'], [180, '180 วัน']]; if (!opts.some(o => o[0] === cur)) opts.push([cur, cur + ' วัน']); return (<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#334155' }}>{label}<select value={cur} onChange={e => setRet(key, e.target.value)} style={{ height: 28, border: '1px solid #B9C4D2', borderRadius: 6, padding: '0 6px', fontSize: 12.5 }}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>); };
                  return (<>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '8px 12px', marginBottom: 8, background: '#F6F8FB', border: '1px solid #E4E9F0', borderRadius: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1a3a5c' }}>⏳ อายุการเก็บ</span>{retSel('Simple', 'doa_simple_days')}{retSel('Detail', 'doa_detail_days')}
                      {dupSets > 0 && <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>⚠ พบไฟล์ซ้ำ {dupSets} ชุด</span>}<span style={{ fontSize: 11.5, color: '#6B778C' }}>นับจากสิ้นงวด (เช่น งวด 2026.09 → 30 ก.ย.) · TB เก็บ 3 เดือน · TBRAW ไม่หมดอายุ</span>
                    </div>
                    <input value={storQ} onChange={e => setStorQ(e.target.value)} placeholder="ค้นหา BU / งวด / ชนิด / เจ้าของ / ชื่อไฟล์" style={{ height: 28, padding: '0 8px', border: '1px solid #B9C4D2', borderRadius: 6, marginBottom: 8, width: 320 }} />
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>BU</th><th style={th}>งวด</th><th style={th}>ชนิด</th><th style={th}>เจ้าของ</th><th style={th}>ชื่อไฟล์</th><th style={{ ...th, ...rt }}>แถว</th><th style={{ ...th, ...rt }}>ขนาด</th><th style={th}>เก็บเมื่อ</th><th style={th}>หมดอายุ</th></tr></thead>
                      <tbody>{rowsF.map(f => <tr key={f.id} onClick={async () => { setStorView({ id: f.id, loading: true, f }); try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/file/${f.id}`, { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') } }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); setStorView({ id: f.id, f, data: j }); } catch (e) { setStorView({ id: f.id, f, error: e.message }); } }} style={{ cursor: 'pointer', background: storView && storView.id === f.id ? '#EAF3FF' : undefined }} title="คลิกเพื่อดูข้อมูลในไฟล์"><td style={td}>{f.bu}</td><td style={td}>{f.period}</td><td style={td}><b>{f.kind}</b>{(dupN[f.bu + '|' + f.period + '|' + f.kind] || 0) > 1 && f.kind !== 'TBRAW' && <span title={'มี ' + dupN[f.bu + '|' + f.period + '|' + f.kind] + ' ไฟล์ของ BU/งวด/ชนิดนี้ (คนละเจ้าของ หรือแถวเก่าไม่ระบุเจ้าของ) — ตรวจแล้วลบตัวที่ซ้ำได้'} style={{ marginLeft: 6, background: '#FFF4E0', color: '#b45309', border: '1px solid #F5D9A8', borderRadius: 10, padding: '0 6px', fontSize: 11 }}>ซ้ำ ×{dupN[f.bu + '|' + f.period + '|' + f.kind]}</span>}</td><td style={td}>{f.owner ? String(f.owner).split('@')[0] : <span style={{ color: '#888' }}>(ไม่ระบุ)</span>}</td><td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.file_name}>{f.file_name || '-'}</td><td style={{ ...td, ...rt }}>{Number(f.rows || 0).toLocaleString()}</td><td style={{ ...td, ...rt }}>{fb(f.bytes)}</td><td style={{ ...td, whiteSpace: 'nowrap' }}>{(() => { const exOf = (x) => { if (x.expires_at) return new Date(x.expires_at); if (x.kind === 'TBRAW') return new Date(2200, 0, 1); const mm = /^(\d{4})\.(\d{2})$/.exec(x.period || ''); if (!mm) return null; if (x.kind === 'Simple' || x.kind === 'Detail') { const dd = Number((S.config || {})[x.kind === 'Simple' ? 'doa_simple_days' : 'doa_detail_days']) || 0; return new Date(+mm[1], +mm[2] - 1 + (dd > 0 ? 1 : 2), 1 + dd, 0, 0, -1); } const c = new Date(x.created_at); c.setMonth(c.getMonth() + 3); return c; }; const ex = exOf(f); if (!ex || isNaN(ex)) return '-'; if (ex.getFullYear() >= 2100) return <span style={{ color: '#888' }}>ไม่หมดอายุ</span>; const dl = Math.ceil((ex - Date.now()) / 86400000); const col = dl <= 7 ? '#c0392b' : dl <= 15 ? '#d97706' : '#334155'; return <span style={{ color: col }} title={dtf(f.expires_at)}><b>{ex.toLocaleDateString('en-GB')}</b> <span style={{ fontSize: 11, opacity: .8 }}>(อีก {Math.max(dl, 0)} วัน)</span></span>; })()}</td></tr>)}{!rowsF.length && <tr><td style={{ ...td, color: '#888', textAlign: 'center' }} colSpan={8}>ไม่มีไฟล์</td></tr>}</tbody></table>
                    {delAsk && (<div onClick={() => !delBusy && setDelAsk(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.55)', zIndex: 4500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(440px, 92vw)', boxShadow: '0 20px 60px rgba(0,0,0,.35)', overflow: 'hidden' }}>
                        <div style={{ padding: '22px 24px 8px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FDECEC', color: '#c0392b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: '0 0 auto' }}>🗑</div>
                          <div><div style={{ fontSize: 17, fontWeight: 700, color: '#1a3a5c' }}>ลบไฟล์ที่เก็บ?</div><div style={{ fontSize: 13, color: '#6B778C', marginTop: 2 }}>การลบนี้ย้อนกลับไม่ได้</div></div>
                        </div>
                        <div style={{ margin: '8px 24px 0', padding: '10px 12px', background: '#F6F8FB', border: '1px solid #E4E9F0', borderRadius: 8, fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
                          <div><b>{delAsk.kind}</b> · BU <b>{delAsk.bu}</b> · งวด <b>{delAsk.period}</b></div>
                          <div style={{ color: '#6B778C' }}>เจ้าของ: {delAsk.owner || '(ไม่ระบุ)'} · {(delAsk.rows || 0).toLocaleString()} แถว · {fb(delAsk.bytes)}</div>
                          <div style={{ wordBreak: 'break-all', color: '#6B778C' }}>{delAsk.file_name}</div>{delAsk.expires_at && new Date(delAsk.expires_at).getFullYear() < 2100 && <div style={{ color: '#6B778C' }}>หมดอายุ: {dtf(delAsk.expires_at)}</div>}
                        </div>
                        <div style={{ padding: '10px 24px 0', fontSize: 12.5, color: '#6B778C' }}>ระบบจะคืนพื้นที่ทันที และแจ้งทุกหน้าให้รีเฟรช</div>
                        {delAsk.err && <div style={{ padding: '8px 24px 0', fontSize: 12.5, color: '#c0392b' }}>ลบไม่สำเร็จ: {delAsk.err}</div>}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '18px 24px 20px' }}>
                          <button type="button" disabled={delBusy} onClick={() => setDelAsk(null)} style={{ height: 34, padding: '0 18px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
                          <button type="button" disabled={delBusy} onClick={doDel} style={{ height: 34, padding: '0 18px', borderRadius: 8, border: 'none', background: '#c0392b', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: delBusy ? .6 : 1 }}>{delBusy ? 'กำลังลบ…' : 'ลบไฟล์'}</button>
                        </div>
                      </div>
                    </div>)}
                    {storView && (<div style={{ marginTop: 10, border: '1px solid #D7DEE8', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#F1F5F9', fontSize: 12.5, fontWeight: 600, color: '#1a3a5c' }}><span>{storView.f.kind} · BU {storView.f.bu} · งวด {storView.f.period}{storView.data ? ` — แสดง ${storView.data.shown} จาก ${storView.data.total} แถว` : ''}</span><span style={{ marginLeft: 'auto' }} /><button type="button" onClick={() => delFile(storView.f)} style={{ border: '1px solid #e0b4b4', background: '#fff5f5', color: '#c0392b', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>🗑 ลบไฟล์นี้</button><button type="button" onClick={() => setStorView(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: '#888' }}>✕</button></div>
                      {storView.loading && <div style={{ padding: 12, color: '#888', fontSize: 13 }}>กำลังโหลดข้อมูล…</div>}
                      {storView.error && <div style={{ padding: 12, color: '#c0392b', fontSize: 13 }}>โหลดไม่สำเร็จ: {storView.error} (ต้องวาง Backend ตัวใหม่)</div>}
                      {storView.data && <div style={{ height: 'calc(92vh - 430px)', minHeight: 300, overflow: 'auto' }}><table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}><tbody>{storView.data.rows.map((rw, ri) => <tr key={ri}>{rw.map((c, ci) => <td key={ci} style={{ padding: '2px 6px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c}>{c}</td>)}</tr>)}</tbody></table></div>}
                    </div>)}
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>แสดง {rowsF.length} จาก {fl.length} ไฟล์ (เรียงตามขนาด) · ขนาด = ข้อมูลของไฟล์นั้นหลังบีบอัดใน DB</div>
                  </>); })()}
                {storTab === 'mod' && (<>
                  <div style={{ fontSize: 12, color: '#6B778C', marginBottom: 6 }}>Stamp = การประทับ Module ลงบัญชีใน TB กลาง (ตาราง doa_tb_stamp)</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Module</th><th style={{ ...th, ...rt }}>รายการ Stamp</th><th style={{ ...th, ...rt }}>Account</th><th style={{ ...th, ...rt }}>BU</th></tr></thead><tbody>{(S.by_module || []).map(m => <tr key={m.module}><td style={td}><b>{m.module}</b></td><td style={{ ...td, ...rt }}>{m.rows.toLocaleString()}</td><td style={{ ...td, ...rt }}>{m.accounts.toLocaleString()}</td><td style={{ ...td, ...rt }}>{m.bus}</td></tr>)}{!(S.by_module || []).length && <tr><td style={td} colSpan={4}>ยังไม่มี Stamp</td></tr>}</tbody></table>
                </>)}
              </>)}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>อัปเดต {S.at ? new Date(S.at).toLocaleString('th-TH') : '-'}{S.cached ? ' (แคช 1 นาที)' : ''} · ปรับโควตา/เพดานได้ที่ System Console › Backend Ops › Storage Dashboard</div>
          </div>
        </div>);
      })()}
      {showAdm && isAdm && (<div onClick={() => setShowAdm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,.45)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{/* MARKER_GL_DOA_ADMIN_OP_REDESIGN_V1 -- Admin Operation: KPI รวมทุก BU + ค้นหา/กรอง + การ์ด BU พับได้ + 2 ฝั่ง (มี Module ใช้ / Standby) สไตล์เดียวกับ Popup Config */}
        <div className="doa-noscroll" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '98vw', height: '92vh', minHeight: 360, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,.3)', borderTop: '5px solid #1a3a5c', overflow: 'hidden' }}><style>{'.doa-noscroll::-webkit-scrollbar{display:none}.doa-slim{scrollbar-width:thin;scrollbar-color:#C3CCD9 transparent}.doa-slim::-webkit-scrollbar{width:6px;height:6px}.doa-slim::-webkit-scrollbar-track{background:transparent}.doa-slim::-webkit-scrollbar-thumb{background:#C3CCD9;border-radius:6px}.doa-slim::-webkit-scrollbar-thumb:hover{background:#9AA7BA}.doa-row{transition:background .1s}.doa-row:hover{background:#E3EEFB !important;box-shadow:inset 3px 0 0 #1B3A5C}'}</style>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px 6px' }}><div style={{ fontWeight: 700, color: '#1a3a5c', fontSize: 17 }}>🛠 Admin Operation</div><span style={{ color: '#6B778C', fontSize: 12.5 }}>TB Standby ทุก BU — TB ทั้งไฟล์ที่เก็บไว้ เทียบกับ Config ของแต่ละ BU</span><span style={{ marginLeft: 'auto' }} />{/* MARKER_GL_DOA_ADMIN_OP_TABS_V1 -- แถบ Tab ของ Admin Operation (ตอนนี้มี TB — เพิ่ม Tab ในอนาคตที่ ADM_TABS) */}{[['tb', 'TB']].map(([tk, tl]) => (<button key={tk} type="button" onClick={() => setAdmTab(tk)} style={{ height: 30, padding: '0 16px', borderRadius: 8, border: '1px solid ' + (admTab === tk ? '#1a3a5c' : '#D5DEEA'), background: admTab === tk ? '#1a3a5c' : '#fff', color: admTab === tk ? '#fff' : '#5A6B80', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{tl}</button>))}<button type="button" onClick={() => loadAdm()} title="โหลดใหม่" style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 28, padding: '0 12px', cursor: 'pointer' }}>↻</button><button type="button" onClick={() => setShowAdm(false)} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#888' }}>✕</button></div>
          {(!admData || admData.loading) && <div style={{ padding: 24, color: '#6B778C', textAlign: 'center' }}>กำลังโหลด…</div>}
          {admData && admData.error && <div style={{ padding: '8px 20px', color: '#B42318', fontSize: 13 }}>โหลดไม่สำเร็จ: {admData.error}</div>}
          {admTab === 'tb' && admData && admData.items && (() => {
            // MARKER_GL_DOA_ADMIN_OP_BY_PERIOD_V1 -- รวม TB ทั้งหมดในระบบของงวดที่เลือก: 1 แถวต่อ BU+งวด (รวมผู้โยนหลายคน) / เลือกงวดได้ (ค่าเริ่มต้น = งวดล่าสุด)
            const mg = new Map(); admData.items.forEach(x => { const kk = x.bu + '|' + x.period; const o = mg.get(kk); if (!o) mg.set(kk, { ...x, owners: x.owner ? [x.owner] : [] }); else { const nw = new Date(x.created_at || 0) > new Date(o.created_at || 0); const ow = [...new Set([...o.owners, ...(x.owner ? [x.owner] : [])])]; mg.set(kk, { ...(nw ? x : o), owners: ow }); } });
            const merged = [...mg.values()]; const periods = [...new Set(merged.map(x => x.period))].sort().reverse(); const per = admPer || periods[0] || '*'; const all = merged.filter(x => per === '*' || x.period === per); const nf2 = (v) => { const t = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${t})` : t; };
            const sumA = all.reduce((s, it) => s + (it.total_accounts || 0), 0), sumU = all.reduce((s, it) => s + (it.config_accounts || 0), 0), sumS = all.reduce((s, it) => s + (it.standby_count || 0), 0); const latest = all.reduce((m, it) => (it.created_at && (!m || new Date(it.created_at) > new Date(m)) ? it.created_at : m), null);
            const ql = admQ.trim().toLowerCase(); let its = all.filter(it => (admF === 'standby' ? it.standby_count > 0 : admF === 'used' ? it.config_accounts > 0 : true) && (!ql || [it.bu, it.period, ...(it.owners || []), ...it.standby.map(a => a.code + ' ' + a.name), ...(it.used || []).map(a => a.code + ' ' + a.name + ' ' + (a.modules || []).join(' '))].join(' ').toLowerCase().includes(ql)));
            its = its.slice().sort((a, b) => admSort === 'bu' ? String(a.bu).localeCompare(String(b.bu)) : (b.standby_count - a.standby_count) || String(a.bu).localeCompare(String(b.bu)));
            const shown = its.slice(0, admLim);
            const kpi = (k, v, c) => (<div style={{ flex: '1 1 130px', border: '1px solid #E4E9F0', borderRadius: 10, padding: '7px 12px' }}><div style={{ fontSize: 11.5, color: '#6B778C' }}>{k}</div><div style={{ fontSize: 21, fontWeight: 700, color: c || '#1f2937' }}>{v}</div></div>);
            const chip = (k, l, n) => (<button key={k} type="button" onClick={() => { setAdmF(k); setAdmLim(20); }} style={{ height: 28, border: '1px solid ' + (admF === k ? '#1a3a5c' : '#D5DEEA'), borderRadius: 999, padding: '0 12px', background: admF === k ? '#1a3a5c' : '#fff', color: admF === k ? '#fff' : '#5A6B80', fontSize: 12.5, cursor: 'pointer' }}>{l} <b>{n}</b></button>);
            return (<>
              <div style={{ display: admView ? 'none' : 'flex', gap: 10, flexWrap: 'wrap', padding: '8px 20px' }}>{kpi('BU ที่มี TB ' + (per === '*' ? '(ทุกงวด)' : 'งวด ' + per), all.length)}{kpi('Account ทั้งหมด', sumA.toLocaleString())}{kpi('มี Module ใช้', sumU.toLocaleString(), '#1F6B4A')}{kpi('Standby (ไม่มีใครใช้)', sumS.toLocaleString(), '#B54708')}{kpi('TB อัปเดตล่าสุด', <span style={{ fontSize: 14 }}>{latest ? new Date(latest).toLocaleString('th-TH') : '-'}</span>)}</div>
              <div style={{ display: admView ? 'none' : 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '0 20px 8px' }}>
                <select value={per} onChange={e => { setAdmPer(e.target.value); setAdmLim(20); }} title="งวด" style={{ height: 32, border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, padding: '0 8px', fontWeight: 600, color: '#1a3a5c' }}>{periods.map(pp => <option key={pp} value={pp}>งวด {pp}</option>)}<option value="*">ทุกงวด</option></select>
                <input value={admQ} onChange={e => { setAdmQ(e.target.value); setAdmLim(20); }} placeholder="🔍 ค้นหา BU / Account / ชื่อบัญชี / Module / ผู้โยน" style={{ flex: '1 1 260px', height: 32, border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 10px', fontSize: 13 }} />
                {chip('all', 'ทั้งหมด', all.length)}{chip('standby', 'มี Standby', all.filter(it => it.standby_count > 0).length)}{chip('used', 'มี Module ใช้', all.filter(it => it.config_accounts > 0).length)}
                <select value={admSort} onChange={e => setAdmSort(e.target.value)} style={{ height: 30, border: '1px solid #D5DEEA', borderRadius: 8, fontSize: 12.5, padding: '0 6px' }}><option value="standby">เรียง: Standby มากสุด</option><option value="bu">เรียง: ชื่อ BU</option></select>
              </div>
              <div className="doa-noscroll" style={{ display: admView ? 'none' : 'block', overflowY: 'auto', flex: 1, minHeight: 100, padding: '0 20px 8px' }}>
                {!its.length && <div style={{ padding: 20, color: '#6B778C', textAlign: 'center' }}>{all.length ? 'ไม่พบที่ค้นหา' : 'ยังไม่มี TB ทั้งไฟล์ที่เก็บไว้ (เก็บเมื่อผู้ใช้โยน TB)'}</div>}
                {shown.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 1.1fr 2fr 1.4fr 150px', gap: 10, alignItems: 'center', padding: '10px 14px', background: '#E8EEF8', border: '1px solid #CBD7EA', borderRadius: 8, fontWeight: 700, fontSize: 13, color: '#1a3a5c', marginBottom: 8, position: 'sticky', top: 0, zIndex: 1 }}><span>BU</span><span>Period</span><span>Last Update</span><span>User</span><span>Module</span><span style={{ textAlign: 'center' }}>Action</span></div>}
                {shown.map(it => { const k = String(it.id); const mods = [...new Set((it.used || []).flatMap(a => a.modules || []))]; const d0 = it.created_at ? new Date(it.created_at) : null; const p2 = (n) => String(n).padStart(2, '0'); const dt = d0 ? `${p2(d0.getDate())}/${p2(d0.getMonth() + 1)}/${d0.getFullYear()} ${p2(d0.getHours())}:${p2(d0.getMinutes())}` : '-';
                  return (<div key={k} className="doa-row" onClick={() => setAdmView(k)} style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 1.1fr 2fr 1.4fr 150px', gap: 10, alignItems: 'center', padding: '9px 14px', background: '#fff', border: '1px solid #E1E7F0', borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13 }}>
                    <span><b style={{ color: '#1a3a5c', fontSize: 14 }}>{it.bu}</b> <span style={{ color: '#4A6A8A', fontSize: 12, marginLeft: 6 }}>{it.total_accounts} Account</span><div style={{ marginTop: 2 }}><span style={{ background: '#E6F4EA', color: '#1a7f37', borderRadius: 999, padding: '0 8px', fontSize: 11, fontWeight: 700 }}>ใช้ {it.config_accounts}</span> <span style={{ background: it.standby_count ? '#FDE6BE' : '#EEF0F3', color: it.standby_count ? '#B54708' : '#6B778C', borderRadius: 999, padding: '0 8px', fontSize: 11, fontWeight: 700 }}>Standby {it.standby_count}</span></div></span>
                    <span><b style={{ background: '#EEF3FB', color: '#1a3a5c', border: '1px solid #CBD7EA', borderRadius: 6, padding: '1px 8px', fontSize: 12.5 }}>{it.period || '-'}</b></span>{/* MARKER_GL_DOA_ADMIN_OP_PERIOD_COL_V1 */}
                    <span style={{ color: '#2E6B4A' }}>{dt}</span>
                    <span style={{ color: '#344054' }}>{(it.owners && it.owners.length) ? <>{String(it.owners[0]).split('@')[0]} <span style={{ color: '#B42318' }}>({it.owners[0]})</span>{it.owners.length > 1 && <span style={{ color: '#6B778C', fontSize: 11.5 }}> +{it.owners.length - 1} คน</span>}</> : '-'}</span>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{mods.length ? mods.map(mo => <span key={mo} style={{ background: '#E6F4EA', color: '#1a7f37', borderRadius: 999, padding: '1px 9px', fontSize: 11.5, fontWeight: 600 }}>{mo}</span>) : '-'}</span>
                    <span style={{ textAlign: 'center' }}><button type="button" onClick={e => { e.stopPropagation(); setAdmView(k); }} style={{ border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', borderRadius: 5, fontSize: 12, padding: '0 10px', height: 24, cursor: 'pointer', fontWeight: 600 }}>▸ Detail</button></span>
                  </div>); })}
                {its.length > admLim && <div style={{ textAlign: 'center', padding: '4px 0 8px' }}><button type="button" onClick={() => setAdmLim(n => n + 20)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 8, height: 30, padding: '0 16px', cursor: 'pointer' }}>แสดงเพิ่ม (เหลืออีก {its.length - admLim} BU)</button></div>}
              </div>
              {admView && (() => { const it = all.find(x => String(x.id) === String(admView)); if (!it) return null; // MARKER_GL_DOA_ADMIN_OP_LINES_V1 -- ระดับ CPC + Account + Sub Acc: แต่ละบรรทัดเป็นของใคร
                const LD = admLines && String(admLines.id) === String(admView) ? admLines : null; const lines = (LD && LD.lines) || [];
                const GR = '28px 64px 86px 78px minmax(90px,1fr) 112px 150px'; const colh = { display: 'grid', gridTemplateColumns: GR, gap: 6, padding: '5px 12px', background: '#FAFBFD', borderBottom: '1px solid #EEF2F7', fontSize: 11.5, fontWeight: 700, color: '#6B778C', textTransform: 'uppercase', letterSpacing: .3 };
                const rowS = { display: 'grid', gridTemplateColumns: GR, gap: 6, alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid #F2F4F7', fontSize: 13, color: '#344054' };
                const lk = (a) => it.id + '|' + a.code + '|' + a.cpc + '|' + a.sub;
                const modUsers = (mo) => Object.keys(mods || {}).filter(em => mods[em] === mo);
                const allowCall = async (arr, body, ask) => { if (!arr.length || admBusy) return; if (ask && arr.length > 1 && !window.confirm(ask)) return; setAdmBusy(true); try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/lines/allow`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') }, body: JSON.stringify({ id: it.id, lines: arr.map(a => ({ code: a.code, cpc: a.cpc, sub: a.sub })), ...body }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); try { broadcastWs('doa_config_changed', { by: String(currentUser?.email || '') }); } catch (e) {} setAdmLTick(n => n + 1); loadAdm(true); loadMine(); } catch (e) { window.alert('บันทึกสิทธิ์ไม่สำเร็จ: ' + (e.message || e)); } setAdmBusy(false); }; // MARKER_GL_DOA_ADMIN_OP_ALLOW_MODULE_V1 -- กำหนด Module ที่ดึง Config ของบรรทัดนั้นได้ (เลือกได้หลาย Module)
                const allowAdd = (arr, mo) => mo && allowCall(arr, { add: [mo] }, `อนุญาต Module ${mo} ดึง Config ${arr.length} บรรทัด ?`);
                const allowClear = (arr) => allowCall(arr, { clear: true }, `ล้างสิทธิ์ ${arr.length} บรรทัด (กลับเป็นทุก Module ดึงได้) ?`);
                const delSel = async (arr) => { if (!arr.length || admBusy) return; if (!window.confirm(`ลบ ${arr.length} บรรทัด Standby ออกจาก TB กลางของ BU ${it.bu} งวด ${it.period} ?\n\n(ลบถาวร — ถ้าโยน TB ใหม่ข้อมูลจะกลับมา)`)) return; setAdmBusy(true); try { const root = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, ''); const r = await fetch(`${root}/api/file-storage/doa-backup-admin/lines/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('fastapn_token') || '') }, body: JSON.stringify({ id: it.id, lines: arr.map(a => ({ code: a.code, cpc: a.cpc, sub: a.sub })) }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); setAdmSel(m0 => { const t0 = { ...m0 }; arr.forEach(a => { delete t0[lk(a)]; }); return t0; }); setAdmLTick(n => n + 1); loadAdm(true); _bc('doa_tb_changed'); loadStor(true); if (j.skipped_owned) window.alert(`ข้าม ${j.skipped_owned} บรรทัดที่มีเจ้าของแล้ว`); } catch (e) { window.alert('ลบไม่สำเร็จ: ' + (e.message || e)); } setAdmBusy(false); }; // MARKER_GL_DOA_ADMIN_OP_DELETE_V1
                const modCnt = {}; ((LD && LD.modules) || []).forEach(x => { modCnt[x.module] = x.users; }); Object.values(mods || {}).filter(Boolean).forEach(mo => { if (!(mo in modCnt)) modCnt[mo] = modUsers(mo).length; }); lines.forEach(a => { (a.owners || []).forEach(o => { if (o.module && !(o.module in modCnt)) modCnt[o.module] = 0; }); (a.allow || []).forEach(mo => { if (!(mo in modCnt)) modCnt[mo] = 0; }); }); const modNames = Object.keys(modCnt).filter(mo => mo && mo !== '(ไม่ระบุ Module)').sort(); const uOpts = [...modNames.map(mo => <option key={mo} value={mo}>{mo}{modCnt[mo] ? ` (${modCnt[mo]} User)` : ''}</option>), ...((LD && LD.modules) ? [] : [<option key="__old" value="" disabled>— Backend ยังเป็นตัวเก่า: ต้องวาง fileStorage.js ใหม่ถึงจะเห็นทุก Module —</option>])]; /* MARKER_GL_DOA_ADMIN_OP_MODULE_LIST_V1 -- รายชื่อ Module: จาก Backend (modules) + Profile + Module ที่พบในบรรทัด */
                const pane = (title, bg, col, bbg, rows, tailOf, empty) => { const nSel = rows.filter(a => admSel[lk(a)]).length; const setAll = (v) => setAdmSel(m0 => { const t0 = { ...m0 }; rows.forEach(a => { if (v) t0[lk(a)] = true; else delete t0[lk(a)]; }); return t0; }); const nAcc = new Set(rows.map(a => a.code)).size; return (<div style={{ border: '1px solid #D7DEE8', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                  <div style={{ background: bg, color: col, borderBottom: '1px solid #E4E9F1' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 2px', fontWeight: 700, fontSize: 13.5 }}><span>{title}</span><span style={{ background: bbg, color: col, borderRadius: 10, padding: '1px 9px', fontSize: 12, whiteSpace: 'nowrap' }}>{rows.length} บรรทัด · {nAcc} Account</span><span style={{ marginLeft: 'auto' }} />{nSel > 0 && <span style={{ fontSize: 12, fontWeight: 600 }}>เลือก {nSel}</span>}</div><div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '4px 12px 8px', fontWeight: 600, fontSize: 12 }}><button type="button" onClick={() => setAll(true)} style={{ border: '1px solid ' + col, background: '#fff', color: col, borderRadius: 6, whiteSpace: 'nowrap', height: 26, padding: '0 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Select All</button><button type="button" disabled={!nSel} onClick={() => setAll(false)} style={{ border: '1px solid #B9C4D2', background: '#fff', color: '#5A6B80', borderRadius: 6, whiteSpace: 'nowrap', height: 26, padding: '0 10px', fontSize: 12, cursor: nSel ? 'pointer' : 'default', opacity: nSel ? 1 : .5 }}>Clear เลือก</button>{<><select value={admAsg} onChange={e => setAdmAsg(e.target.value)} title="เลือก Module ที่ดึง Config ของบรรทัดที่เลือกได้" style={{ height: 26, border: '1px solid #B9C4D2', borderRadius: 6, fontSize: 12, maxWidth: 210 }}><option value="">อนุญาต Module…</option>{uOpts}</select><button type="button" disabled={!nSel || !admAsg || admBusy} onClick={() => allowAdd(rows.filter(a => admSel[lk(a)]), admAsg)} style={{ border: 'none', background: '#1a3a5c', color: '#fff', borderRadius: 6, whiteSpace: 'nowrap', height: 26, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: nSel && admAsg ? 'pointer' : 'default', opacity: nSel && admAsg ? 1 : .45 }}>{admBusy ? '…' : `อนุญาต ${nSel || ''}`}</button><button type="button" disabled={!nSel || admBusy} onClick={() => allowClear(rows.filter(a => admSel[lk(a)]))} title="ล้างสิทธิ์ = ทุก Module ดึงได้" style={{ border: '1px solid #B9C4D2', background: '#fff', color: '#5A6B80', borderRadius: 6, whiteSpace: 'nowrap', height: 26, padding: '0 10px', fontSize: 12, cursor: nSel ? 'pointer' : 'default', opacity: nSel ? 1 : .45 }}>ทุก Module</button>{tailOf === 'sb' && <button type="button" disabled={!nSel || admBusy} onClick={() => delSel(rows.filter(a => admSel[lk(a)]))} title="ลบบรรทัดที่เลือกออกจาก TB กลาง" style={{ border: '1px solid #D92D20', background: '#fff', color: '#D92D20', borderRadius: 6, whiteSpace: 'nowrap', height: 26, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: nSel ? 'pointer' : 'default', opacity: nSel ? 1 : .45 }}>🗑 ลบ {nSel || ''}</button>}</>}</div></div>
                  <div style={colh}><span><input type="checkbox" checked={rows.length > 0 && nSel === rows.length} onChange={e => setAll(e.target.checked)} title="เลือกทั้งหมด" /></span><span>CPC</span><span>Account</span><span>Sub Acc</span><span>ชื่อบัญชี</span><span style={{ textAlign: 'right' }}>Ending</span><span>Module</span></div>
                  <div className="doa-slim" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{rows.length ? rows.map(a => (<div className="doa-row" key={lk(a)} style={{ ...rowS, background: admSel[lk(a)] ? '#EAF3FF' : undefined }}><input type="checkbox" checked={!!admSel[lk(a)]} onChange={e => setAdmSel(m0 => { const t0 = { ...m0 }; if (e.target.checked) t0[lk(a)] = true; else delete t0[lk(a)]; return t0; })} /><span>{a.cpc || '—'}</span><b>{a.code}</b><span>{a.sub || '—'}</span><span style={{ color: '#6B778C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: a.e < 0 ? '#C0392B' : '#344054' }}>{nf2(a.e)}</span>
                    <select value="" disabled={admBusy} onChange={e => { const v = e.target.value; if (!v) return; if (tailOf === 'sb') { if (v === '__clear') allowCall([a], { clear: true }); else if ((a.allow || []).includes(v)) allowCall([a], { remove: [v] }); else allowCall([a], { add: [v] }); } else if (v !== '__same') allowCall([a], { clear: true, add: [v] }, `ย้าย ${a.code} / ${a.cpc} / ${a.sub} ไป Module ${v} ?`); }} title={tailOf === 'sb' ? 'เลือก Module ที่ดึง Config บรรทัดนี้ได้ (เลือกซ้ำ = เอาออก)' : 'ย้ายบรรทัดนี้ไป Module อื่น'} style={{ width: '100%', height: 24, border: '1px solid ' + (tailOf === 'sb' ? ((a.allow || []).length ? '#9BD3AE' : '#F0D9A6') : '#9BD3AE'), background: tailOf === 'sb' ? ((a.allow || []).length ? '#E6F4EA' : '#FFF3CD') : '#E6F4EA', color: tailOf === 'sb' ? ((a.allow || []).length ? '#1a7f37' : '#8A5A00') : '#1a7f37', borderRadius: 6, fontSize: 11.5, fontWeight: 600 }}><option value="">{tailOf === 'sb' ? ((a.allow || []).length ? (a.allow || []).join(', ') : 'Standby') : [...new Set(a.owners.map(o => o.module))].join(', ')} ▾</option>{tailOf === 'sb' ? <><option value="__clear">ทุก Module (ล้างสิทธิ์)</option>{modNames.map(mo => <option key={mo} value={mo}>{(a.allow || []).includes(mo) ? '✓ ' : '＋ '}{mo}</option>)}</> : modNames.filter(mo => !a.owners.some(o => o.module === mo)).map(mo => <option key={mo} value={mo}>→ ย้ายไป {mo}</option>)}</select></div>)) : <div style={{ padding: 14, color: '#6B778C', textAlign: 'center', fontSize: 12.5 }}>{empty}</div>}</div></div>); };
                const lq = admLQ.trim().toLowerCase(); const fl = lq ? lines.filter(a => [a.code, a.cpc, a.sub, a.name, ...a.owners.map(o => o.module + ' ' + o.email)].join(' ').toLowerCase().includes(lq)) : lines;
                const sbR = fl.filter(a => !a.owners.length), cfR = fl.filter(a => a.owners.length);
                return (<div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '6px 20px 8px' }}>{/* MARKER_GL_DOA_ADMIN_OP_DETAIL_INLINE_V1 -- กด Detail = สลับเนื้อหาใน Popup เดิม (ไม่เด้ง Popup ใหม่) มีปุ่มกลับ */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}><button type="button" onClick={() => setAdmView(null)} style={{ border: '1px solid #1a3a5c', background: '#fff', color: '#1a3a5c', borderRadius: 6, height: 28, padding: '0 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>← กลับรายการ</button><div style={{ fontWeight: 700, color: '#1a3a5c', fontSize: 16 }}>BU {it.bu} <span style={{ fontWeight: 400, color: '#57606a', fontSize: 13 }}>· งวด {it.period}</span></div><span style={{ marginLeft: 'auto' }} /><input value={admLQ} onChange={e => setAdmLQ(e.target.value)} placeholder="🔍 ค้นหา CPC / Account / Sub Acc / ชื่อบัญชี / Module" style={{ width: 360, maxWidth: '45%', height: 30, border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 10px', fontSize: 13 }} /></div>
                    <div style={{ color: '#6B778C', fontSize: 12, marginBottom: 8 }}>📄 {it.file_name || '-'} · {it.row_count} แถว · {it.total_accounts} Account{LD && LD.lines ? ` · ${lines.length} บรรทัด (CPC+Account+Sub Acc)` : ''}</div>
                    {(!LD || LD.loading) && <div style={{ padding: 24, color: '#6B778C', textAlign: 'center' }}>กำลังโหลดรายบรรทัด…</div>}
                    {LD && LD.error && <div style={{ padding: 12, color: '#B42318', fontSize: 13 }}>โหลดไม่สำเร็จ: {LD.error} (ต้องวาง Backend fileStorage.js ตัวใหม่บน Server ก่อน)</div>}
                    {LD && LD.lines && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(640px, 1fr))', gridTemplateRows: 'minmax(0, 1fr)', gap: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                      {pane('Standby', '#FFF6E5', '#B54708', '#FDE6BE', sbR, 'sb', 'ไม่มี — ทุกบรรทัดมีเจ้าของแล้ว')}
                      {pane('✓ Config', '#EAF6EF', '#1F6B4A', '#CDEBD9', cfR, 'md', 'ยังไม่มีบรรทัดที่ผูก Config')}
                    </div>}
                  </div>); })()}
            </>); })()}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px 14px', borderTop: '1px solid #EEF2F7', fontSize: 11.5, color: '#6B778C' }}><span>ℹ รายการ Clear (แถว Clear ที่ครบ 3 เดือน) เพื่อย้ายเป็น History บน SharePoint จะแสดงที่นี่เมื่อระบบสถานะ Clear พร้อมใช้งาน (กำลังพัฒนา)</span><span style={{ marginLeft: 'auto' }} /><button type="button" onClick={() => setShowAdm(false)} style={{ border: '1px solid #B9C4D2', background: '#fff', borderRadius: 6, height: 30, padding: '0 16px', cursor: 'pointer' }}>ปิด</button></div>
        </div>
      </div>)}
      {showCfg && <DoaConfigModal buOptions={buOptions} users={users} mods={mods} defaultBu={bu} meEmail={currentUser?.email || ''} canDeleteAll={userRole === 'Owner' || userRole === 'Admin'} onClose={() => setShowCfg(false)} onChanged={loadMine} />}
    </div>
  );
}
