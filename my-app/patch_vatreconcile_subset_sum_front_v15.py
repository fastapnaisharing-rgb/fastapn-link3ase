# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15
# Detail (Input Summary): ใส่ยอด -> กด Calculate -> ระบบหาชุดรายการที่รวมกันได้ยอดนั้น (Algorithm ล้วน ไม่ใช้ AI / ไม่ยิง API) กดชุดเพื่อไฮไลต์แถว
# ใช้: python patch_vatreconcile_subset_sum_front_v15.py <path src\pages\VatReconcileDashboard.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15"
here = os.path.dirname(os.path.abspath(__file__))
path = sys.argv[1] if len(sys.argv) > 1 else r"src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
if MARKER in s:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
def rp(s, old, new, label):
    c = s.count(old)
    if c != 1:
        print(f"[ABORT] {label}: anchor พบ {c} ครั้ง (ต้องเป็น 1)"); sys.exit(1)
    return s.replace(old, new)
SOLVER = r'''// MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15 -- ค้นหาชุดรายการที่รวมกันได้ยอดเป้าหมาย (Subset Sum แบบ Algorithm ล้วน ไม่ใช้ AI) ทำงานในเบราว์เซอร์ ไม่ยิง API
// items: [{ c: จำนวนเต็มสตางค์ }] -> คืน [[index,...]] เรียงจากชุดที่ใช้รายการน้อยที่สุด | tol = ช่วงคลาดเคลื่อน (สตางค์)
async function findSubsetSums(items, targetC, tolC, maxK, maxSets, shouldAbort) {
  const n = items.length;
  const v = items.map((x) => x.c);
  const out = [];
  const seen = new Set();
  const add = (idxs) => {
    const a = idxs.slice().sort((x, y) => x - y);
    const key = a.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  let ops = 0;
  const yieldNow = async () => { if ((++ops & 0x1ffff) === 0) await new Promise((r) => setTimeout(r, 0)); return shouldAbort(); };
  const lo = targetC - tolC;
  const hi = targetC + tolC;
  const ok = (s) => s >= lo && s <= hi;
  let pairs = null;
  if (maxK >= 4) {
    pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push({ s: v[i] + v[j], i, j });
    pairs.sort((a, b) => a.s - b.s);
  }
  const firstGE = (x) => { let l = 0; let h = pairs.length; while (l < h) { const m = (l + h) >> 1; if (pairs[m].s < x) l = m + 1; else h = m; } return l; };
  for (let k = 1; k <= maxK && out.length < maxSets; k++) {
    if (k === 1) {
      for (let i = 0; i < n; i++) if (ok(v[i])) add([i]);
    } else if (k === 2) {
      for (let i = 0; i < n; i++) { if (await yieldNow()) return out; for (let j = i + 1; j < n; j++) if (ok(v[i] + v[j])) add([i, j]); }
    } else if (k === 3) {
      for (let i = 0; i < n; i++) {
        if (await yieldNow()) return out;
        for (let j = i + 1; j < n; j++) { const s2 = v[i] + v[j]; for (let l = j + 1; l < n; l++) if (ok(s2 + v[l])) add([i, j, l]); }
      }
    } else if (k === 4) {
      for (let a = 0; a < pairs.length && out.length < maxSets; a++) {
        if (await yieldNow()) return out;
        const A = pairs[a];
        for (let b = firstGE(lo - A.s); b < pairs.length && pairs[b].s <= hi - A.s; b++) {
          const B = pairs[b];
          if (b > a && A.i !== B.i && A.i !== B.j && A.j !== B.i && A.j !== B.j) add([A.i, A.j, B.i, B.j]);
        }
      }
    } else if (k === 5) {
      for (let i = 0; i < n && out.length < maxSets; i++) {
        if (await yieldNow()) return out;
        for (let j = i + 1; j < n; j++) {
          const s2 = v[i] + v[j];
          for (let l = j + 1; l < n; l++) {
            const s3 = s2 + v[l];
            for (let b = firstGE(lo - s3); b < pairs.length && pairs[b].s <= hi - s3; b++) {
              const B = pairs[b];
              if (B.i > l && B.i !== B.j) add([i, j, l, B.i, B.j]);
            }
          }
        }
      }
    }
  }
  return out;
}
''' + "\n"
PANEL = r'''// MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15 -- แผงค้นหาชุดรายการที่รวมกันได้ยอดที่ต้องการ (Detail)
const SS_COLS = [['paid_vat', 'เงินภาษีที่ชำระ'], ['paid_amount', 'มูลค่าที่ชำระ'], ['claimed100_vat', 'เงินภาษีที่ใช้สิทธิ์'], ['claimed100_amount', 'มูลค่าที่ใช้สิทธิ์'], ['calculate_tax', 'Calculate Tax']];
function SubsetSumPanel({ rows, onPick, onClear }) {
  const cols = SS_COLS.filter(([k]) => rows.some((r) => r[k] !== undefined));
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState('paid_vat');
  const [target, setTarget] = useState('');
  const [tol, setTol] = useState('0');
  const [maxK, setMaxK] = useState(5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { sets:[{rows,sum}], ms, n, note }
  const [pick, setPick] = useState(-1);
  const abortRef = useRef(false);
  const calc = async () => {
    const tg = Number(String(target).replace(/,/g, ''));
    if (!Number.isFinite(tg) || String(target).trim() === '') { setResult({ sets: [], note: 'กรอกยอดเป้าหมายก่อน' }); return; }
    const items = rows.filter((r) => r[col] !== null && r[col] !== undefined && r[col] !== '' && Number.isFinite(Number(r[col]))).map((r) => ({ r, c: Math.round(Number(r[col]) * 100) }));
    if (items.length > 400) { setResult({ sets: [], note: `มี ${items.length.toLocaleString()} แถว (เกิน 400) — กรองสาขา/คอลัมน์ให้เหลือน้อยลงก่อน` }); return; }
    const k = items.length > 300 ? Math.min(maxK, 4) : maxK;
    abortRef.current = false; setRunning(true); setPick(-1); onClear();
    const t0 = Date.now();
    const sets = await findSubsetSums(items, Math.round(tg * 100), Math.round(Math.abs(Number(tol) || 0) * 100), k, 30, () => abortRef.current || Date.now() - t0 > 60000);
    setResult({
      sets: sets.map((idx) => ({ rows: idx.map((i) => items[i].r), sum: idx.reduce((s, i) => s + items[i].c, 0) / 100 })),
      ms: Date.now() - t0, n: items.length, note: abortRef.current ? 'หยุดค้นหาแล้ว (แสดงเท่าที่พบ)' : Date.now() - t0 > 60000 ? 'ครบเวลา 60 วินาที (แสดงเท่าที่พบ)' : '',
    });
    setRunning(false);
  };
  const box = { border: '1px solid #d0d7de', borderRadius: 8, padding: '8px 12px', marginBottom: 10, background: '#fafbfc' };
  const inp = { fontSize: 12.5, padding: '4px 8px', border: '1px solid #d0d7de', borderRadius: 6 };
  return (
    <div style={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#334155', padding: 0 }}>
        {open ? '▾' : '▸'} หาชุดรายการที่รวมกันได้ยอดที่ต้องการ
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
            <label>ยอดที่ต้องการ <input style={{ ...inp, width: 110, textAlign: 'right' }} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="13.65" onKeyDown={(e) => { if (e.key === 'Enter' && !running) calc(); }} /></label>
            <label>รวมจากคอลัมน์ <select style={inp} value={col} onChange={(e) => setCol(e.target.value)}>{cols.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>คลาดเคลื่อน ± <input style={{ ...inp, width: 60, textAlign: 'right' }} value={tol} onChange={(e) => setTol(e.target.value)} /></label>
            <label>สูงสุดต่อชุด <select style={inp} value={maxK} onChange={(e) => setMaxK(Number(e.target.value))}>{[2, 3, 4, 5].map((k) => <option key={k} value={k}>{k} รายการ</option>)}</select></label>
            {!running
              ? <button type="button" onClick={calc} style={{ ...inp, background: '#1a7f37', color: '#fff', fontWeight: 700, border: 'none', padding: '5px 16px', cursor: 'pointer' }}>Calculate</button>
              : <button type="button" onClick={() => { abortRef.current = true; }} style={{ ...inp, background: '#cf222e', color: '#fff', fontWeight: 700, border: 'none', padding: '5px 16px', cursor: 'pointer' }}>หยุด</button>}
            <span style={{ color: '#57606a' }}>ค้นจาก {rows.length.toLocaleString()} แถวที่แสดงอยู่ (ตามตัวกรอง/สาขาที่เลือก)</span>
          </div>
          {running && <div style={{ marginTop: 6, fontSize: 12.5, color: '#57606a' }}>กำลังค้นหา...</div>}
          {result && !running && (
            <div style={{ marginTop: 8, fontSize: 12.5 }}>
              {result.note && <div style={{ color: '#856404', marginBottom: 4 }}>{result.note}</div>}
              {result.sets.length === 0 && !result.note?.startsWith('กรอก') && !result.note?.startsWith('มี ') && <div style={{ color: '#cf222e' }}>ไม่พบชุดที่รวมได้ยอดนี้ (ภายใน {maxK} รายการ) {result.ms != null ? `· ใช้เวลา ${result.ms} ms` : ''}</div>}
              {result.sets.length > 0 && <div style={{ color: '#57606a', marginBottom: 4 }}>พบ {result.sets.length}{result.sets.length >= 30 ? '+' : ''} ชุด (เรียงจากใช้รายการน้อยที่สุด) · กดชุดเพื่อไฮไลต์แถวในตาราง · ใช้เวลา {result.ms} ms</div>}
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {result.sets.map((s, i) => (
                  <div key={i} onClick={() => { setPick(i); onPick(s.rows.map((r) => r.id)); }}
                    style={{ border: `1px solid ${pick === i ? '#bf8700' : '#d0d7de'}`, background: pick === i ? '#fff8c5' : '#fff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
                    <b>ชุดที่ {i + 1}</b> · {s.rows.length} รายการ · รวม {s.sum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <div style={{ color: '#475569', marginTop: 2 }}>
                      {s.rows.map((r) => `${r.tax_invoice_no || r.grt_no || r.id} (${Number(r[col]).toLocaleString('en-US', { minimumFractionDigits: 2 })})`).join('  +  ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'''
sig = "function ReportPreviewTable({ data, onRowAction, actionLabel, initialBranch, onEdited }) {"
s = rp(s, sig, SOLVER + PANEL + sig, "insert components")
st = "  const [selection, setSelection] = React.useState(null);"
s = rp(s, st, "  const [hiIds, setHiIds] = React.useState(() => new Set()); // " + MARKER + "\n" + st, "hiIds state")
s = rp(s, "      {activeFilterCols.length > 0 && (\n        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 12, color: '#57606a' }}>",
  "      {data.type === 'input_summary' && data.view === 'detail' && filteredRows.length > 0 && typeof filteredRows[0].id !== 'undefined' && (\n        <SubsetSumPanel rows={filteredRows} onPick={(ids) => setHiIds(new Set(ids))} onClear={() => setHiIds(new Set())} />\n      )}\n\n      {activeFilterCols.length > 0 && (\n        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 12, color: '#57606a' }}>", "panel use")
s = rp(s, "            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>",
          "            <tr key={i} style={{ background: hiIds.has(r.id) ? '#fff3bf' : i % 2 === 0 ? '#fff' : '#fafbfc' }}>", "row hi")
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copy2(path, f"{path}.bak{n:02d}")
open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
