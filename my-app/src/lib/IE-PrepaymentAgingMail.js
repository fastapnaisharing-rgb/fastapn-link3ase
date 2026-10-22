// IE-PrepaymentAgingMail.js
// MARKER_IE_PREPAYMENT_AGING_MAIL_V1
// ─────────────────────────────────────────────────────────────────────────
// ประกอบอีเมล "Prepayment Aging" จาก Config (To/CC/Greeting/Subject/Add Text) + ข้อมูลในไฟล์ที่ Generate
// โครงเนื้อหาเมล:  บรรทัด 1 = เรียน {Greeting Name}
//                  บรรทัด 2 = Add Text (ข้อความที่ผู้ใช้พิมพ์ใน Config)
//                  บรรทัดสุดท้าย = Prepayment Aging Placeholder (ตารางสรุปคำนวณจากข้อมูลในไฟล์)
// Placeholder ตาราง: Status | Branch Name | Count Inv. | Min Date | Max Date | Remaining
// ไม่มี React/DOM -- Pure function เรียกใช้จากหน้าเว็บหรือ Test ได้
// ─────────────────────────────────────────────────────────────────────────

export const PREPAYMENT_AGING_PLACEHOLDER = '{Prepayment_Aging}';
export const PREPAYMENT_AGING_COLUMNS = ['Branch Name', 'Status', 'Count Inv.', 'Min Date', 'Max Date', 'Remaining']; // MARKER_IE_MACROMAIL_BRANCH_FIRST_V1 -- เรียงตามสาขา แล้วแตก Status ด้านใน

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtMoney = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDMY = (t) => { const d = new Date(t); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };

// รับวันที่ได้ทั้ง Date, 'DD-MMM-YYYY' (รูปแบบ Oracle) -> timestamp (null ถ้าอ่านไม่ได้)
export function toTime(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  const m = String(v || '').match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m || MONTHS[m[2].toUpperCase()] === undefined) return null;
  return new Date(Number(m[3]), MONTHS[m[2].toUpperCase()], Number(m[1])).getTime();
}

// ลำดับ Status: A-F ตาม Aging แล้วตามด้วย Settled/Unpaid, อื่นๆ ต่อท้าย
const statusRank = (s) => {
  const m = String(s || '').match(/^([A-F]) - /);
  if (m) return m[1].charCodeAt(0) - 65;
  if (/^Settled\/Unpaid$/i.test(s)) return 10;
  return 20;
};

// rows = แถวที่อ่านจากไฟล์ (key ตาม PREPAYMENT_TEMPLATE_COLUMNS: status, branchName, invoiceDate, amountRemaining)
// คืนแถวสรุป [{ status, branchName, count, minDate, maxDate, remaining }] + แถวรวม
export function buildPrepaymentAgingRows(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const status = String(r.status || '').trim() || '(ไม่ระบุ)';
    // MARKER_IE_MACROMAIL_GROUP_BY_EMPLOYEE_V1 -- ไฟล์ IE (TOPS มี Employee Name) แยกกลุ่มตามชื่อพนักงาน ไฟล์ HWS ยังแยกตามสาขาเหมือนเดิม
    const branchName = (r.employeeName && String(r.supplierName || r.employeeName).trim()) || String(r.branchName || '').trim() || String(r.branchCode || '').trim() || '(ไม่ระบุ)';
    const branchCode = String(r.branchCode || '').trim(); // MARKER_IE_MACROMAIL_SORT_BRANCH_CODE_V1 -- จัดกลุ่ม/เรียงตาม Branch Code แต่แสดงเป็น Branch Name
    const k = `${branchCode}\u0001${branchName}\u0001${status}`;
    if (!map.has(k)) map.set(k, { status, branchName, branchCode, count: 0, minT: null, maxT: null, remaining: 0 });
    const g = map.get(k);
    g.count += 1;
    g.remaining += Number(r.amountRemaining) || 0;
    const t = toTime(r.invoiceDate);
    if (t !== null) { g.minT = g.minT === null ? t : Math.min(g.minT, t); g.maxT = g.maxT === null ? t : Math.max(g.maxT, t); }
  });
  const list = [...map.values()].sort((a, b) => (a.branchCode === b.branchCode ? 0 : (a.branchCode === '' ? 1 : b.branchCode === '' ? -1 : (a.branchCode < b.branchCode ? -1 : 1))) || a.branchName.localeCompare(b.branchName) || statusRank(a.status) - statusRank(b.status) || a.status.localeCompare(b.status));
  const total = list.reduce((s, g) => {
    s.count += g.count; s.remaining += g.remaining;
    if (g.minT !== null) s.minT = s.minT === null ? g.minT : Math.min(s.minT, g.minT);
    if (g.maxT !== null) s.maxT = s.maxT === null ? g.maxT : Math.max(s.maxT, g.maxT);
    return s;
  }, { count: 0, minT: null, maxT: null, remaining: 0 });
  return { list, total };
}

const cellVals = (g) => [g.branchName, g.status, g.count.toLocaleString('en-US'), g.minT === null ? '-' : fmtDMY(g.minT), g.maxT === null ? '-' : fmtDMY(g.maxT), fmtMoney(g.remaining)];

const RED_DOT = '🔴'; // Emoji สั้นกว่า <span style> มาก (ลิงก์ fastapn:// ยาวได้จำกัด)
const AGING_ICON = { E: RED_DOT, F: RED_DOT }; // จุดแดงนำหน้า Status ของ Aging E-F (เปลี่ยนไอคอน/สีได้ที่นี่)
// ตาราง HTML (Inline Style ล้วน เพื่อให้ Copy ไปวางใน Outlook แล้วหน้าตาคงเดิม)
export function buildPrepaymentAgingHtml(rows) {
  const { list, total } = buildPrepaymentAgingRows(rows);
  const th = 'style="border:1px solid #bbb;padding:4px 10px;background:#e3edf7;text-align:left;white-space:nowrap"';
  const thR = 'style="border:1px solid #bbb;padding:4px 10px;background:#e3edf7;text-align:right;white-space:nowrap"';
  const td = 'style="border:1px solid #bbb;padding:4px 10px;white-space:nowrap"';
  const tdR = 'style="border:1px solid #bbb;padding:4px 10px;text-align:right;white-space:nowrap"';
  const head = PREPAYMENT_AGING_COLUMNS.map((c, i) => `<th ${i >= 2 && i !== 3 && i !== 4 ? thR : th}>${esc(c)}</th>`).join('');
  const body = list.map((g, idx) => {
    const v = cellVals(g);
    const first = idx === 0 || list[idx - 1].branchName !== g.branchName || list[idx - 1].branchCode !== g.branchCode; // แสดงชื่อสาขาเฉพาะแถวแรกของสาขา
    const icon = AGING_ICON[(String(g.status || '').match(/^([EF]) - /) || [])[1]] || ''; // MARKER_IE_MACROMAIL_AGING_EF_ICON_V1 -- Aging E-F ใส่ไอคอนนำหน้า Status (แทนสีตัวอักษร)
    return `<tr>${v.map((x, i) => (i === 0 ? `<td ${td}>${first ? `<b>${esc(x)}</b>` : '&nbsp;'}</td>` : `<td ${i === 2 || i === 5 ? tdR : td}>${i === 1 && icon ? `${icon} ` : ''}${esc(x)}</td>`)).join('')}</tr>`;
  }).join('');
  const tv = cellVals({ status: '', branchName: 'Total', ...total });
  const foot = `<tr>${tv.map((x, i) => `<td style="border:1px solid #bbb;padding:4px 10px;background:#f3f6fa;font-weight:bold;white-space:nowrap${i === 2 || i === 5 ? ';text-align:right' : ''}">${esc(x)}</td>`).join('')}</tr>`;
  return `<table style="border-collapse:collapse;font-size:11pt;margin:6px 0"><tr>${head}</tr>${body}${foot}</table>`;
}

// MARKER_IE_MACROMAIL_OUTLOOK_COMPACT_V1 -- ย่อ HTML ของตาราง (Inline Style -> Attribute) เพื่อส่งผ่าน URL fastapn:// ไป Outlook Draft Handler (URL ยาวได้จำกัด)
// ใช้ได้กับ HTML ที่สร้างจาก buildPrepaymentAgingHtml เท่านั้น (รวม Draft เก่าที่เก็บไว้ใน Log)
export function compactMailHtml(html) {
  return String(html == null ? '' : html)
    .replace(/<table style="[^"]*">/g, '<table border="1" cellspacing="0" cellpadding="4" bordercolor="#bbbbbb" style="border-collapse:collapse">')
    .replace(/<td style="[^"]*background:#f3f6fa;font-weight:bold[^"]*?(;text-align:right)?">([^<]*)<\/td>/g, (m, r, c) => `<td bgcolor="#f3f6fa"${r ? ' align="right"' : ''}><b>${c}</b></td>`)
    .replace(/<th style="[^"]*text-align:right[^"]*">/g, '<th align="right" bgcolor="#e3edf7">')
    .replace(/<th style="[^"]*">/g, '<th align="left" bgcolor="#e3edf7">')
    .replace(/<td style="([^"]*)">/g, (m, st) => `<td${/text-align:right/.test(st) ? ' align=right' : ''}>`);
}

export function buildPrepaymentAgingText(rows) {
  const { list, total } = buildPrepaymentAgingRows(rows);
  const lines = [PREPAYMENT_AGING_COLUMNS.join('\t')];
  list.forEach((g) => lines.push(cellVals(g).join('\t')));
  lines.push(cellVals({ status: '', branchName: 'Total', ...total }).join('\t'));
  return lines.join('\n');
}

// ── Placeholder Registry (ประเภทรายงาน PREPAYMENT) ────────────────────────────
// {Prepayment_Aging} คำนวณจากแถวข้อมูลในไฟล์ของ Job ; ที่เหลือเป็นค่าจาก Config / Job
export const PREPAYMENT_MAIL_PLACEHOLDERS = [
  { key: '{greeting_name}', label: 'Greeting Name', desc: 'ชื่อผู้รับที่ตั้งใน Config' },
  { key: PREPAYMENT_AGING_PLACEHOLDER, label: 'Prepayment Aging', desc: 'ตาราง Branch Name | Status | Count Inv. | Min Date | Max Date | Remaining (เรียงตามสาขา แตก Status ด้านใน)' },
  { key: '{BU}', label: 'BU', desc: 'BU ของ Job' },
  { key: '{DATE}', label: 'วันที่', desc: 'วันที่สร้างอีเมล (dd/mm/yyyy)' },
  { key: '{Min_Date}', label: 'Min Date', desc: 'InvoiceDate เก่าสุดในไฟล์ (dd/mm/yyyy)' },
  { key: '{Max_Date}', label: 'Max Date', desc: 'InvoiceDate ใหม่สุดในไฟล์ (dd/mm/yyyy)' },
];

// เนื้อหาเริ่มต้น: ส่วนที่แก้ได้ + {Prepayment_Aging} เป็นบรรทัดสุดท้ายเสมอ (ล็อก)
export const DEFAULT_BODY_EDITABLE = `เรียน {greeting_name}\n\nรบกวนตรวจสอบรายการ Prepayment ที่ค้างตามตารางด้านล่าง`;
export const DEFAULT_BODY_TPL = `${DEFAULT_BODY_EDITABLE}\n{Prepayment_Aging}`;

// ส่วนที่ผู้ใช้แก้ได้ (ตัด {Prepayment_Aging} ออก) / ประกอบกลับพร้อมล็อก Placeholder ไว้บรรทัดสุดท้าย
export const bodyEditablePart = (tpl) => String(tpl == null || !String(tpl).trim() ? DEFAULT_BODY_TPL : tpl).replace(/\{Prepayment_Aging\}/gi, '').replace(/\{add_text\}/gi, '').replace(/\s+$/, '');
export const lockBodyTpl = (editable) => `${String(editable || '').replace(/\{Prepayment_Aging\}/gi, '').replace(/\s+$/, '')}\n${PREPAYMENT_AGING_PLACEHOLDER}`;

export const DEFAULT_SUBJECT_TPL = '{BU} - ขอจัดส่งรายละเอียด Prepayment ตั้งแต่ {Min_Date} - {Max_Date}';
// Config ต่อ (รายงาน + BU): ส่วนผู้รับ/แนบไฟล์ ; Subject + Body อยู่ใน Draft Template กลาง (template_id)
export const DEFAULT_MAIL_CONFIG = { to_emails: '', cc_emails: '', greeting_name: '', attach_file: true, template_id: null };

// Placeholder ที่เขียนผิด/ไม่มีในทะเบียน (ไว้เตือนตอนบันทึก)
export function findUnknownPlaceholders(tpl) {
  const known = new Set(PREPAYMENT_MAIL_PLACEHOLDERS.map((p) => p.key.toLowerCase()));
  return [...new Set((String(tpl || '').match(/\{[A-Za-z_]+\}/g) || []).filter((m) => !known.has(m.toLowerCase())))];
}

const SIMPLE_VALS = (c, bu, rows) => {
  const { total } = buildPrepaymentAgingRows(rows);
  return {
    '{greeting_name}': String(c.greeting_name || '').trim(), '{add_text}': String(c.add_text || '').trim(), '{bu}': bu || '', '{date}': fmtDMY(Date.now()),
    '{min_date}': total.minT === null ? '-' : fmtDMY(total.minT), '{max_date}': total.maxT === null ? '-' : fmtDMY(total.maxT),
  };
};
const replaceSimple = (line, vals) => line.replace(/\{[A-Za-z_]+\}/g, (m) => (Object.prototype.hasOwnProperty.call(vals, m.toLowerCase()) ? vals[m.toLowerCase()] : m));

// ประกอบอีเมลทั้งฉบับจาก body_tpl: { subject, to, cc, html, text, attach_file }
export function composePrepaymentAgingMail(cfg, rows, bu, template) {
  const c = { ...DEFAULT_MAIL_CONFIG, ...(cfg || {}) };
  const tpl = lockBodyTpl(bodyEditablePart(template && template.body_template)); // Placeholder ตารางล็อกเป็นบรรทัดสุดท้ายเสมอ
  const subjectTpl = (template && String(template.subject_template || '').trim()) || DEFAULT_SUBJECT_TPL;
  const vals = SIMPLE_VALS(c, bu, rows);
  const tableHtml = buildPrepaymentAgingHtml(rows);
  const tableText = buildPrepaymentAgingText(rows);
  const tokenRe = new RegExp(PREPAYMENT_AGING_PLACEHOLDER.replace(/[{}]/g, '\\$&'), 'i');
  const htmlParts = []; const textParts = [];
  tpl.replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
    if (tokenRe.test(raw)) {
      const [before, ...rest] = raw.split(tokenRe);
      const pre = replaceSimple(before, vals).trim();
      const post = replaceSimple(rest.join(''), vals).trim();
      if (pre) { htmlParts.push(`<div>${esc(pre)}</div>`); textParts.push(pre); }
      htmlParts.push(`<div style="margin-top:6px">${tableHtml}</div>`); textParts.push(tableText);
      if (post) { htmlParts.push(`<div>${esc(post)}</div>`); textParts.push(post); }
      return;
    }
    const line = replaceSimple(raw, vals);
    if (!line.trim()) { if (/\{add_text\}/i.test(raw)) return; htmlParts.push('<div><br></div>'); textParts.push(''); return; }
    htmlParts.push(`<div>${esc(line.trimEnd()).replace(/\n/g, '<br>')}</div>`); textParts.push(line.trimEnd());
  });
  const html = `<div style="font-family:Tahoma,'Segoe UI',sans-serif;font-size:11pt">${htmlParts.join('')}</div>`;
  const text = textParts.join('\n');
  return { subject: replaceSimple(subjectTpl, vals), to: c.to_emails, cc: c.cc_emails, html, text, attach_file: c.attach_file !== false };
}

// ── .eml (Draft ที่เปิดใน Outlook ได้: X-Unsent: 1) พร้อมไฟล์แนบ ──────────────
const utf8ToBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap76 = (b64) => (b64.match(/.{1,76}/g) || []).join('\r\n');
const asciiName = (n) => String(n || 'attachment.xlsx').replace(/[^A-Za-z0-9._\- ]+/g, '_');
const addrList = (t) => String(t || '').split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).join(', ');

// attachment = { name, base64 } หรือ null
export function buildEml(mail, attachment) {
  const boundary = `----=_FastAPN_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const h = ['X-Unsent: 1'];
  if (addrList(mail.to)) h.push(`To: ${addrList(mail.to)}`);
  if (addrList(mail.cc)) h.push(`Cc: ${addrList(mail.cc)}`);
  h.push(`Subject: =?UTF-8?B?${utf8ToBase64(mail.subject || '')}?=`);
  h.push('MIME-Version: 1.0');
  h.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const out = [h.join('\r\n'), '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    wrap76(utf8ToBase64(`<html><body>${mail.html}</body></html>`)), ''];
  if (attachment && attachment.base64) {
    const nm = asciiName(attachment.name);
    out.push(`--${boundary}`,
      `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${nm}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${nm}"`, '',
      wrap76(attachment.base64), '');
  }
  out.push(`--${boundary}--`, '');
  return out.join('\r\n');
}
