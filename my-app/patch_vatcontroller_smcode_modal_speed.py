# -*- coding: utf-8 -*-
# Patch: Simple Code modal เปิดช้า -- (1) แสดงแถวทีละช่วง (เริ่ม 100 แถว ไถลงเพิ่ม) แทน Render 2,000+ แถวพร้อมกัน (Search ยังค้นทั้งหมดเหมือนเดิม)
# (2) useVatSupportingData (sm_code_list/branch_list/vendor_category) เก็บ Cache ระดับ Module 2 นาที -- สลับ BU/เปิดหน้าซ้ำไม่ต้อง Fetch 3 ก้อนใหญ่ใหม่ (Broadcast ยังอัปเดต Cache)
# (3) GL-TransferVat ส่ง smLoading จริงเข้า Modal (เดิมส่ง false ทำให้ช่วงโหลดขึ้น "ไม่พบข้อมูล")
# usage: python patch_vatcontroller_smcode_modal_speed.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, ('anchor count', txt.count(old), old[:90])
    txt = txt.replace(old, new)

# ---- (2) Cache ของ Hook ----
rep("""function useVatSupportingData() {
  const [smCodes, setSmCodes] = React.useState([]);
  const [branches, setBranches] = React.useState([]);
  const [vendorCategories, setVendorCategories] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
""",
"""const VAT_SUPPORT_CACHE_TTL_MS = 2 * 60 * 1000; // MARKER_SMCODE_MODAL_SPEED_V1
let __vatSupportCache = { sm: null, br: null, vc: null, ts: 0 }; // MARKER_SMCODE_MODAL_SPEED_V1 -- Cache ระดับ Module (รอด Remount ตอนสลับ BU) ถูกอัปเดตเมื่อ Broadcast Refetch
function useVatSupportingData() {
  const [smCodes, setSmCodes] = React.useState(__vatSupportCache.sm || []);
  const [branches, setBranches] = React.useState(__vatSupportCache.br || []);
  const [vendorCategories, setVendorCategories] = React.useState(__vatSupportCache.vc || []);
  const [loading, setLoading] = React.useState(!(__vatSupportCache.sm && __vatSupportCache.br && __vatSupportCache.vc));
""")
rep(".then((sm) => setSmCodes(Array.isArray(sm) ? sm : [])).catch(",
    ".then((sm) => { const a = Array.isArray(sm) ? sm : []; __vatSupportCache.sm = a; setSmCodes(a); }).catch(")
rep(".then((vc) => setVendorCategories(Array.isArray(vc) ? vc : [])).catch(",
    ".then((vc) => { const a = Array.isArray(vc) ? vc : []; __vatSupportCache.vc = a; setVendorCategories(a); }).catch(")
rep(".then((br) => setBranches(Array.isArray(br) ? br : [])).catch(",
    ".then((br) => { const a = Array.isArray(br) ? br : []; __vatSupportCache.br = a; setBranches(a); }).catch(")
rep("""  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sm, br, vc] = await Promise.all([""",
"""  React.useEffect(() => {
    if (__vatSupportCache.sm && __vatSupportCache.br && __vatSupportCache.vc && Date.now() - __vatSupportCache.ts < VAT_SUPPORT_CACHE_TTL_MS) { setLoading(false); return undefined; } // MARKER_SMCODE_MODAL_SPEED_V1 -- Cache ยังสด ไม่ต้อง Fetch
    let cancelled = false;
    (async () => {
      try {
        const [sm, br, vc] = await Promise.all([""")
rep("""        if (!cancelled) {
          setSmCodes(Array.isArray(sm) ? sm : []);
          setBranches(Array.isArray(br) ? br : []);
          setVendorCategories(Array.isArray(vc) ? vc : []);
        }""",
"""        __vatSupportCache = { sm: Array.isArray(sm) ? sm : [], br: Array.isArray(br) ? br : [], vc: Array.isArray(vc) ? vc : [], ts: Date.now() }; // MARKER_SMCODE_MODAL_SPEED_V1
        if (!cancelled) {
          setSmCodes(__vatSupportCache.sm);
          setBranches(__vatSupportCache.br);
          setVendorCategories(__vatSupportCache.vc);
        }""")

# ---- (3) smLoading จริง ----
rep("const { smCodes, branches, vendorCategories } = useVatSupportingData();",
    "const { smCodes, branches, vendorCategories, loading: smSupportLoadingMain } = useVatSupportingData(); // MARKER_SMCODE_MODAL_SPEED_V1")
rep("""                smLoading={false}
              />""",
"""                smLoading={smSupportLoadingMain}
              />""")

# ---- (1) แสดงทีละช่วง ----
rep("""  const smBuOptions = React.useMemo(() => Array.from(new Set(smCodes.map((r) => r['BU']).filter(Boolean))).sort(), [smCodes]);""",
"""  const [smRenderLimit, setSmRenderLimit] = React.useState(100); // MARKER_SMCODE_MODAL_SPEED_V1 -- Render ทีละช่วง ไถลงเพื่อโหลดเพิ่ม
  const smBuOptions = React.useMemo(() => Array.from(new Set(smCodes.map((r) => r['BU']).filter(Boolean))).sort(), [smCodes]);""")
rep("""  }, [smCodes, smSearch, smBuFilter, smAtMatchFilter]);
""",
"""  }, [smCodes, smSearch, smBuFilter, smAtMatchFilter]);
  React.useEffect(() => { setSmRenderLimit(100); }, [smSearch, smBuFilter, smAtMatchFilter]); // MARKER_SMCODE_MODAL_SPEED_V1
""")
rep("""            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '0.5px solid #e5e7eb', borderRadius: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {VAT_SMCODE_MODAL_COLUMNS.map(""",
"""            <div onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) setSmRenderLimit((l) => (l < smFilteredRows.length ? l + 150 : l)); }} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '0.5px solid #e5e7eb', borderRadius: '10px' }}> {/* MARKER_SMCODE_MODAL_SPEED_V1 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {VAT_SMCODE_MODAL_COLUMNS.map(""")
rep("""                    smFilteredRows.map((r, i) => (
                      <tr key={r.id || r['SM-Code'] || i}""",
"""                    smFilteredRows.slice(0, smRenderLimit).map((r, i) => (
                      <tr key={r.id || r['SM-Code'] || i}""")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
