# -*- coding: utf-8 -*-
# Patch: โหมด Note = รายการ Aging = Accept -- ให้ DB กรอง (in_aging_label=Accept) ทั้ง BU แทนกรองเฉพาะ 200 แถวของหน้าปัจจุบัน
# usage: python patch_vatcontroller_note_mode_accept_server.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
txt = raw.decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, ('anchor count', txt.count(old), old[:70])
    txt = txt.replace(old, new)

# 1) buildDetailParams: โหมด Note -> กรอง Accept ที่ DB
rep("""  const buildDetailParams = React.useCallback(() => {
    const params = new URLSearchParams();""",
"""  const isNoteModeParam = showDetailMode === 'note'; // MARKER_NOTE_MODE_ACCEPT_SERVER_V1
  const buildDetailParams = React.useCallback(() => {
    const params = new URLSearchParams();""")
rep("""    return params;
  }, [bu?.bu, detailSearchDebounced, columnFiltersKey, selectedSubtypeKeys, selectedAgingBuckets, visibleColumns]);""",
"""    if (isNoteModeParam) { params.set('in_aging_label', 'Accept'); params.delete('aging_buckets'); } // MARKER_NOTE_MODE_ACCEPT_SERVER_V1 -- โหมด Note = Aging Accept ทั้ง BU (Accept อยู่ Bucket Uncount, aging_months=null)
    return params;
  }, [bu?.bu, detailSearchDebounced, columnFiltersKey, selectedSubtypeKeys, selectedAgingBuckets, visibleColumns, isNoteModeParam]);""")

# 2) กลับหน้า 1 เมื่อสลับเข้า/ออกโหมด Note
rep("""[detailSearchDebounced, columnFiltersKey, selectedSubtypeKeys, selectedAgingBuckets]); // MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1""",
"""[detailSearchDebounced, columnFiltersKey, selectedSubtypeKeys, selectedAgingBuckets, showDetailMode === 'note']); // MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1""")

# 3) แถวที่แสดงในโหมด Note = ที่ DB กรองมาแล้ว
rep("""    if (showDetailMode === 'note') return detailRows.filter((r) => !!noteMap[getNoteKey(r)]); // MARKER_VATWATCHLISTOPS_NOTE_MODE_V1 -- แสดงเฉพาะรายการที่มี Note""",
"""    if (showDetailMode === 'note') return detailRows; // MARKER_NOTE_MODE_ACCEPT_SERVER_V1 -- DB กรอง aging_label=Accept มาแล้ว (เดิมกรองด้วย noteMap เฉพาะหน้าปัจจุบัน)""")

# 4) ยอด Note ทั้ง BU
rep("""  const [typeRowsLoading, setTypeRowsLoading] = React.useState(false); // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1""",
"""  const [typeRowsLoading, setTypeRowsLoading] = React.useState(false); // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1
  const [acceptCount, setAcceptCount] = React.useState(null); // MARKER_NOTE_MODE_ACCEPT_SERVER_V1 -- ยอด Aging=Accept ทั้ง BU (null=กำลังโหลด, 'err'=ไม่สำเร็จ)""")
rep("""  // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1 -- โหลดรายการ Type A/B/F (แถวจริง)""",
"""  // MARKER_NOTE_MODE_ACCEPT_SERVER_V1 -- ปุ่ม Note (n): นับ Aging=Accept (Pending) ทั้ง BU ด้วย count=true
  React.useEffect(() => {
    if (!bu?.bu) { setAcceptCount(0); return undefined; }
    if (!secondaryReady) return undefined;
    let active = true;
    (async () => {
      try {
        const r = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=pending&in_aging_label=Accept&count=true`);
        if (active) setAcceptCount(r && typeof r.total === 'number' ? r.total : 0);
      } catch (e) { console.error('load accept count failed', e); if (active) setAcceptCount('err'); }
    })();
    return () => { active = false; };
  }, [bu?.bu, detailReloadKey, secondaryReady]);
  // MARKER_PERF_SWITCHBU_TYPE_COUNT_V1 -- โหลดรายการ Type A/B/F (แถวจริง)""")
rep("""{ key: 'note', label: `Note (${noteCount})` },""",
"""{ key: 'note', label: `Note (${acceptCount === null ? '…' : (acceptCount === 'err' ? '?' : acceptCount)})` }, // MARKER_NOTE_MODE_ACCEPT_SERVER_V1""")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
