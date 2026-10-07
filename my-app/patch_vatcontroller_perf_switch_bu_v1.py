# -*- coding: utf-8 -*-
"""
patch_vatcontroller_perf_switch_bu_v1.py
MARKER_PERF_SWITCHBU_V1 -- ลดงานตอนสลับ BU ในหน้า Incomplete BU Operation (VatController.js)
  1) Type A/B/F: เดิมดึงแถวทั้งหมด (สูงสุด 5,000 x 3) ตอน Mount -> เปลี่ยนเป็นนับ Count (ปุ่ม Type) + ดึงแถวเมื่อเปิดโหมด Type เท่านั้น
  2) Cache company_list (Dropdown สลับ BU) และ vat_incomplete_column_config ระดับ Module (TTL 2 นาที, ล้างเมื่อบันทึก Config)
  3) เลื่อนโหลด typeTree + Type Count ไปหลังตารางหลักโหลดเสร็จ (secondaryReady) + กัน Response ของ BU เก่าเขียนทับ
  4) aging_bucket_counts กับ aging_month_bucket_counts ยิงพร้อมกัน (เดิมรอเรียงทีละตัว)
ไม่แตะ: key Remount, sync_draft_status, Search/Filter ฝั่ง DB

ใช้: python patch_vatcontroller_perf_switch_bu_v1.py <input VatController.js> <output VatController.js>
"""
import sys

src, dst = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
assert b'\r\n' not in raw, 'ไฟล์นี้ควรเป็น LF'
s = raw.decode('utf-8')  # คง BOM (﻿) ไว้ตามเดิม


def once(text, old, new, label):
    n = text.count(old)
    assert n == 1, f'[{label}] anchor พบ {n} ครั้ง (ต้องเป็น 1)'
    return text.replace(old, new)


# ── 1) Module-level cache ──
s = once(
    s,
    'function IncompleteBuOperationTest({ bu, onBack, onGotoUploadFile, onSwitchBu })',
    '''// MARKER_PERF_SWITCHBU_CACHE_V1 -- Cache ระดับ Module (อยู่รอดข้ามการ Remount ตอนสลับ BU) ใช้กับข้อมูลที่ไม่เปลี่ยนตาม BU
const VAT_SWITCHBU_CACHE_TTL_MS = 2 * 60 * 1000;
let __vatCompanyListCache = { rows: null, ts: 0 };
let __vatColumnConfigCache = { configs: null, ts: 0 };
function IncompleteBuOperationTest({ bu, onBack, onGotoUploadFile, onSwitchBu })''',
    'module cache',
)

# ── 2) company_list ใช้ Cache ──
s = once(
    s,
    '''        const list = await apiFetch('/company_list');
        const rows = Array.isArray(list) ? list : (list?.rows || []);
        const me = rows.find(''',
    '''        let rows;
        const __cc = __vatCompanyListCache; // MARKER_PERF_SWITCHBU_CACHE_V1
        if (__cc.rows && Date.now() - __cc.ts < VAT_SWITCHBU_CACHE_TTL_MS) {
          rows = __cc.rows;
        } else {
          const list = await apiFetch('/company_list');
          rows = Array.isArray(list) ? list : (list?.rows || []);
          __vatCompanyListCache = { rows, ts: Date.now() };
        }
        const me = rows.find(''',
    'company_list cache',
)

# ── 3) State ใหม่ ──
s = once(
    s,
    '  const [typeRows, setTypeRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1',
    '''  const [typeCount, setTypeCount] = React.useState(null); // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1 -- null = ยังไม่โหลด | 'err' = โหลดไม่สำเร็จ
  const [typeRowsLoading, setTypeRowsLoading] = React.useState(false); // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1
  const [secondaryReady, setSecondaryReady] = React.useState(false); // MARKER_PERF_SWITCHBU_DEFER_V1 -- true เมื่อตารางหลักโหลดเสร็จแล้ว (ค่อยโหลดข้อมูลรอง)
  const [typeRows, setTypeRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1''',
    'states',
)

# ── 4) Effect Type A/B/F: Count + โหลดแถวเมื่อเปิดโหมด Type ──
start_marker = '  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_TYPE_ABF_STATUS_V1 -- โหลดรายการ Type A/B/F ของ BU นี้'
end_marker = '  }, [bu?.bu, detailReloadKey]);\n'
i = s.index(start_marker)
assert s.count(start_marker) == 1, 'type effect start ซ้ำ'
j = s.index(end_marker, i) + len(end_marker)
old_block = s[i:j]
assert 'limit=5000' in old_block and len(old_block) < 1600, 'type effect block ผิดรูป'
new_block = '''  // MARKER_PERF_SWITCHBU_DEFER_V1 -- สำรอง: ถ้าตารางหลักไม่เสร็จใน 4 วินาที (เช่น Request ค้าง) ให้ปล่อยข้อมูลรองโหลดต่อ
  React.useEffect(() => {
    const t = setTimeout(() => setSecondaryReady(true), 4000);
    return () => clearTimeout(t);
  }, []);
  // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1 -- ปุ่ม Type (n): นับด้วย count=true (ไม่ดึงแถวมาเลย) รอให้ตารางหลักโหลดเสร็จก่อน
  React.useEffect(() => {
    if (!bu?.bu) { setTypeCount(0); return undefined; }
    if (!secondaryReady) return undefined;
    let active = true;
    (async () => {
      try {
        const parts = await Promise.all(['type_a', 'type_b', 'type_f'].map((st) => apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=${st}&count=true`)));
        const total = parts.reduce((a, p) => a + (p && typeof p.total === 'number' ? p.total : 0), 0);
        if (active) setTypeCount(total);
      } catch (e) { console.error('load type count failed', e); if (active) setTypeCount('err'); }
    })();
    return () => { active = false; };
  }, [bu?.bu, detailReloadKey, secondaryReady]);
  // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1 -- โหลดรายการ Type A/B/F (แถวจริง) เฉพาะตอนเปิดโหมด Type (ตรรกะดึงเหมือนเดิม: 3 สถานะ สถานะละสูงสุด 5000)
  const isTypeMode = showDetailMode === 'type';
  React.useEffect(() => {
    if (!bu?.bu) { setTypeRows([]); return undefined; }
    if (!isTypeMode) return undefined;
    let active = true;
    setTypeRowsLoading(true);
    (async () => {
      try {
        const parts = await Promise.all(['type_a', 'type_b', 'type_f'].map((st) => apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=${st}&limit=5000`))); // MARKER_VATWATCHLISTOPS_TYPE_ABF_V5
        const res = parts.reduce((a, p) => a.concat(Array.isArray(p) ? p : []), []);
        if (active) setTypeRows(res);
      } catch (e) { console.error('load type rows failed', e); if (active) setTypeRows([]); }
      if (active) setTypeRowsLoading(false);
    })();
    return () => { active = false; };
  }, [bu?.bu, detailReloadKey, isTypeMode]);
'''
s = s[:i] + new_block + s[j:]

# ── 5) ป้ายปุ่ม Type ──
s = once(
    s,
    "{ key: 'type', label: `Type (${typeRows.length})` },",
    "{ key: 'type', label: `Type (${typeCount === null ? '…' : (typeCount === 'err' ? '?' : typeCount)})` }, // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1",
    'type label',
)

# ── 6) โชว์ "กำลังโหลด..." ตอนรอแถว Type ──
s = once(
    s,
    '                {loadingDetail ? (\n                  <tr><td colSpan={activeCols.length + 1}',
    '                {(loadingDetail || (showDetailMode === \'type\' && typeRowsLoading)) ? ( /* MARKER_PERF_SWITCHBU_TYPE_COUNT_V1 */\n                  <tr><td colSpan={activeCols.length + 1}',
    'loading row',
)

# ── 7) typeTree: เลื่อนโหลด + กัน Race ──
s = once(
    s,
    '''  React.useEffect(() => {
    if (!bu?.bu) return;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('eq_bu', bu.bu);
        params.set('distinct_group', 'bus_type,sub_type');''',
    '''  React.useEffect(() => { // MARKER_PERF_SWITCHBU_DEFER_V1 -- เลื่อนไปหลังตารางหลักโหลดเสร็จ + กัน Response ของ BU เก่าเขียนทับ
    if (!bu?.bu || !secondaryReady) return undefined;
    let active = true;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('eq_bu', bu.bu);
        params.set('distinct_group', 'bus_type,sub_type');''',
    'typeTree start',
)
s = once(
    s,
    '''        setTypeTree(tree);
      } catch (err) {
        console.error('load typeTree error:', err);
      }
    })();
  }, [bu?.bu]);''',
    '''        if (active) setTypeTree(tree);
      } catch (err) {
        console.error('load typeTree error:', err);
      }
    })();
    return () => { active = false; };
  }, [bu?.bu, secondaryReady]);''',
    'typeTree end',
)

# ── 8) aging counts ยิงพร้อมกัน ──
a_start = '''        const res = await apiFetch(`/vat_watchlist_report?${params.toString()}`);
        if (!active) return;
        // MARKER_VATWATCHLISTOPS_AGING_6_5_SPLIT_V1'''
a_end = "        } catch (e2) { /* ไม่มีก็แค่ไม่ขึ้นตัวเลขย่อย */ }\n"
assert s.count(a_start) == 1, 'aging start'
ai = s.index(a_start)
aj = s.index(a_end, ai) + len(a_end)
assert aj - ai < 1200, 'aging block ผิดรูป'
s = s[:ai] + '''        // MARKER_PERF_SWITCHBU_AGING_PARALLEL_V1 -- ยิง aging_bucket_counts กับ aging_month_bucket_counts พร้อมกัน (เดิมรอเรียงทีละตัว)
        const monthParams = new URLSearchParams(params.toString());
        monthParams.delete('aging_bucket_counts');
        monthParams.set('aging_month_bucket_counts', 'true');
        const [res, r2] = await Promise.all([
          apiFetch(`/vat_watchlist_report?${params.toString()}`),
          apiFetch(`/vat_watchlist_report?${monthParams.toString()}`).catch(() => null), // MARKER_VATWATCHLISTOPS_AGING_6_5_SPLIT_V1 -- ไม่มีก็แค่ไม่ขึ้นตัวเลขย่อย
        ]);
        const monthCounts = (r2 && r2.counts) || {};
''' + s[aj:]

# ── 9) บอกว่าตารางหลักโหลดเสร็จแล้ว ──
s = once(
    s,
    '      if (active) setLoadingDetail(false);\n',
    '      if (active) setLoadingDetail(false);\n      if (active) setSecondaryReady(true); // MARKER_PERF_SWITCHBU_DEFER_V1\n',
    'secondaryReady set',
)

# ── 10) Config คอลัมน์ ใช้ Cache + ล้างตอนบันทึก ──
s = once(
    s,
    '''        const configs = await apiFetch('/vat_incomplete_column_config');
        if (!active) return;''',
    '''        let configs;
        const __cfgc = __vatColumnConfigCache; // MARKER_PERF_SWITCHBU_CACHE_V1
        if (__cfgc.configs && Date.now() - __cfgc.ts < VAT_SWITCHBU_CACHE_TTL_MS) {
          configs = __cfgc.configs;
        } else {
          configs = await apiFetch('/vat_incomplete_column_config');
          __vatColumnConfigCache = { configs, ts: Date.now() };
        }
        if (!active) return;''',
    'config cache',
)
s = once(
    s,
    '            setAllConfigs((prev) => [...prev.filter((c) => c.username !== savedRow.username), savedRow]);\n',
    '            setAllConfigs((prev) => [...prev.filter((c) => c.username !== savedRow.username), savedRow]);\n            __vatColumnConfigCache = { configs: null, ts: 0 }; // MARKER_PERF_SWITCHBU_CACHE_V1 -- บันทึก Config แล้ว ล้าง Cache ให้รอบหน้าดึงใหม่\n',
    'config invalidate',
)

open(dst, 'wb').write(s.encode('utf-8'))
print('OK: patched ->', dst)
