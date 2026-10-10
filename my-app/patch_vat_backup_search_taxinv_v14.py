import sys
def rep(s, a, b, n=1):
    assert s.count(a) == n, (a[:60], s.count(a))
    return s.replace(a, b)

# ---------- backend ----------
p = 'vatExport.js'
s = open(p, encoding='utf-8').read()
assert 'MARKER_VATEXPORT_BACKUP_SEARCH_TAXINV_V14' not in s
s = rep(s, '''    if (!tbl) return res.status(400).json({ error: "type ไม่ถูกต้อง" });
    const { rows } = await pool.query(
      `SELECT bu, batch_id,''', '''    if (!tbl) return res.status(400).json({ error: "type ไม่ถูกต้อง" });
    // MARKER_VATEXPORT_BACKUP_SEARCH_TAXINV_V14 -- ?q= ค้นทุก Field (ค่าอย่างเดียว ไม่รวมชื่อ Column) ของรายการใน Backup เช่น Tax Invoice / Vendor Tax Invoice / Invoice / GRT / Supplier -> คืนเฉพาะ Batch ที่เจอ + match_count
    const q = String(req.query.q || "").trim();
    const params = [];
    let hitSel = "FALSE AS _hit";
    let having = "";
    if (q) {
      params.push(`%${q.replace(/[\\\\%_]/g, "\\\\$&")}%`);
      hitSel = `EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(x) - 'id' - 'status' - 'draft_id' - 'created_at' - 'updated_at' - 'finished_at' - 'expire_at' - 'batch_id' - 'bu') e WHERE e.value ILIKE $1) AS _hit`;
      having = "HAVING COUNT(*) FILTER (WHERE _hit) > 0";
    }
    const { rows } = await pool.query(
      `SELECT bu, batch_id,
              COUNT(*) FILTER (WHERE _hit)::int AS match_count,''', 1)
s = rep(s, '''       FROM ${tbl} t
       WHERE status = '${BACKUP_STATUS[type]}' AND batch_id IS NOT NULL
       GROUP BY bu, batch_id
       ORDER BY MIN(finished_at) DESC NULLS LAST, batch_id DESC
       LIMIT 500`
    );''', '''       FROM (SELECT x.*, ${hitSel} FROM ${tbl} x WHERE x.status = '${BACKUP_STATUS[type]}' AND x.batch_id IS NOT NULL) t
       GROUP BY bu, batch_id
       ${having}
       ORDER BY MIN(finished_at) DESC NULLS LAST, batch_id DESC
       LIMIT 500`,
      params
    );''', 1)
open(p, 'w', encoding='utf-8').write(s)

# ---------- frontend ----------
p = 'VatController.js'
s = open(p, encoding='utf-8').read()
assert 'MARKER_VATCONTROLLER_BACKUP_SEARCH_TAXINV_V14' not in s
# modal signature + initial search
s = rep(s, 'function VatBackupViewModal({ batch, initialTab, onClose }) {', 'function VatBackupViewModal({ batch, initialTab, initialSearch, onClose }) {', 1)
s = rep(s, "  const [search, setSearch] = React.useState('');\n  const [data, setData] = React.useState({ popvat: [], simple: [], adi: [] });",
        "  const [search, setSearch] = React.useState(initialSearch || ''); // MARKER_VATCONTROLLER_BACKUP_SEARCH_TAXINV_V14 -- รับคำค้นจากหน้า Transaction Backup แล้ว Highlight แถวที่ตรงทันที\n  const [data, setData] = React.useState({ popvat: [], simple: [], adi: [] });", 1)
# auto switch to tab that has matches (once after load)
s = rep(s, '''  React.useEffect(() => {
    if (!kw || loading) return;
    const el = document.querySelector('[data-bkmatch="1"]');''', '''  const bkAutoTabRef = React.useRef(false);
  React.useEffect(() => {
    if (loading || bkAutoTabRef.current) return;
    bkAutoTabRef.current = true;
    if (!kw || bkMatchCount(tab) > 0) return;
    const hit = ['popvat', 'simple', 'adi'].find((k) => bkMatchCount(k) > 0);
    if (hit) setTab(hit);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!kw || loading) return;
    const el = document.querySelector('[data-bkmatch="1"]');''', 1)
# lobby: server-side search
s = rep(s, '''    setBkLoading(true);
    apiFetch(`/vat-export/backup?type=${tab}`)
      .then((res) => { if (!cancelled) setBkRows(res && Array.isArray(res.batches) ? res.batches : []); })
      .catch(() => { if (!cancelled) setBkRows([]); })
      .finally(() => { if (!cancelled) setBkLoading(false); });
    return () => { cancelled = true; };
  }, [tab, isBkTab, bkRefresh]);''', '''    setBkLoading(true);
    const qTerm = bkSearchDebounced.trim(); // MARKER_VATCONTROLLER_BACKUP_SEARCH_TAXINV_V14 -- ค้นใน DB (Tax Invoice / Invoice / GRT / Supplier ฯลฯ) แล้วเหลือเฉพาะ Batch ที่เจอ
    apiFetch(`/vat-export/backup?type=${tab}${qTerm ? `&q=${encodeURIComponent(qTerm)}` : ''}`)
      .then((res) => { if (!cancelled) setBkRows(res && Array.isArray(res.batches) ? res.batches : []); })
      .catch(() => { if (!cancelled) setBkRows([]); })
      .finally(() => { if (!cancelled) setBkLoading(false); });
    return () => { cancelled = true; };
  }, [tab, isBkTab, bkRefresh, bkSearchDebounced]);''', 1)
s = rep(s, "  const [bkRefresh, setBkRefresh] = React.useState(0);\n  const [bkViewBatch",
        "  const [bkRefresh, setBkRefresh] = React.useState(0);\n  const [bkSearchDebounced, setBkSearchDebounced] = React.useState('');\n  React.useEffect(() => { const t = setTimeout(() => setBkSearchDebounced(bkSearch), 350); return () => clearTimeout(t); }, [bkSearch]);\n  const [bkViewBatch", 1)
# client filter: drop text filter (server does it)
s = rep(s, "return bkRows.filter((r) => (!bkBu || r.bu === bkBu) && (!bkPeriod || r.period === bkPeriod) && (!q || String(r.batch_id || '').toLowerCase().includes(q) || String(r.bu || '').toLowerCase().includes(q)));\n  }, [bkRows, bkBu, bkPeriod, bkSearch]);",
        "return bkRows.filter((r) => (!bkBu || r.bu === bkBu) && (!bkPeriod || r.period === bkPeriod) && (!q || bkSearch.trim() !== bkSearchDebounced.trim() || (r.match_count || 0) > 0 || String(r.batch_id || '').toLowerCase().includes(q) || String(r.bu || '').toLowerCase().includes(q)));\n  }, [bkRows, bkBu, bkPeriod, bkSearch, bkSearchDebounced]);", 1)
# batch id cell badge
s = rep(s, "    if (key === 'batch_id') return r.batch_id || '-';\n    if (key === 'receive_from')",
        "    if (key === 'batch_id') return (<span>{r.batch_id || '-'}{bkSearchDebounced.trim() && r.match_count > 0 && <span title=\"จำนวนแถวที่ตรงกับคำค้น\" style={{ marginLeft: '8px', padding: '1px 8px', borderRadius: '10px', background: '#f59e0b', color: 'white', fontSize: '11px' }}>พบ {r.match_count} แถว</span>}</span>);\n    if (key === 'receive_from')", 1)
# placeholder
s = rep(s, "placeholder={isBkTab ? 'ค้นหา Batch ID / BU'", "placeholder={isBkTab ? 'ค้นหา Tax Invoice / Invoice / GRT / Supplier / Batch ID / BU'", 1)
# pass term to modal
s = rep(s, "<VatBackupViewModal batch={bkViewBatch} initialTab={tab} onClose={() => setBkViewBatch(null)} />",
        "<VatBackupViewModal batch={bkViewBatch} initialTab={tab} initialSearch={bkSearchDebounced.trim()} onClose={() => setBkViewBatch(null)} />", 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
