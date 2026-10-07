# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V16
# หาชุดยอดรวม: รองรับหลักพันแถว (เรียงค่า + Two-pointer/Binary search/ตารางผลรวมคู่ แทนการไล่ทุกชุด) -- ไม่ใช้ AI
#   <=500 แถว: ชุดละไม่เกิน 5 รายการ | 501-2000 แถว: ไม่เกิน 4 รายการ | >2000 แถว: ให้กรองก่อน
# ใช้: python patch_vatreconcile_subset_sum_front_v16.py <path src\pages\VatReconcileDashboard.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V16"
path = sys.argv[1] if len(sys.argv) > 1 else r"src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
if MARKER in s:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
NEW = r'''async function findSubsetSums(items, targetC, tolC, maxK, maxSets, shouldAbort) {
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
  let lastYield = Date.now();
  const yieldNow = async () => { if (Date.now() - lastYield > 40) { await new Promise((r) => setTimeout(r, 0)); lastYield = Date.now(); } return shouldAbort(); };
  const lo = targetC - tolC;
  const hi = targetC + tolC;
  // เรียงค่า (เก็บ index เดิมไว้) -> ใช้ Two-pointer / Binary search แทนการไล่ทุกคู่ ทำให้รองรับหลักพันแถว
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
  const sv = Float64Array.from(ord.map((i) => v[i])); // ค่าที่เรียงแล้ว
  const lowerBound = (arr, len, x) => { let l = 0; let h = len; while (l < h) { const m = (l + h) >> 1; if (arr[m] < x) l = m + 1; else h = m; } return l; };
  for (let k = 1; k <= maxK && out.length < maxSets; k++) {
    if (k === 1) {
      for (let p = lowerBound(sv, n, lo); p < n && sv[p] <= hi; p++) add([ord[p]]);
    } else if (k === 2) {
      for (let a = 0; a < n && out.length < maxSets; a++) {
        if (await yieldNow()) return out;
        for (let b = Math.max(a + 1, lowerBound(sv, n, lo - sv[a])); b < n && sv[b] <= hi - sv[a]; b++) add([ord[a], ord[b]]);
      }
    } else if (k === 3) {
      // เลือก 2 ตัว (a<b) แล้วหาตัวที่ 3 (c>b) ด้วย Binary search : O(n^2 log n)
      for (let a = 0; a < n && out.length < maxSets; a++) {
        if (await yieldNow()) return out;
        for (let b = a + 1; b < n; b++) {
          if (b % 64 === 0 && await yieldNow()) return out;
          const s2 = sv[a] + sv[b];
          for (let c = Math.max(b + 1, lowerBound(sv, n, lo - s2)); c < n && sv[c] <= hi - s2; c++) add([ord[a], ord[b], ord[c]]);
        }
      }
    } else {
      // k = 4,5: สร้างตารางผลรวมคู่ (เรียงแล้ว) แล้วจับคู่ด้วย Binary search
      const m = (n * (n - 1)) / 2;
      const ps = new Float64Array(m); const pa = new Int32Array(m); const pb = new Int32Array(m);
      { let t = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { ps[t] = sv[i] + sv[j]; pa[t] = i; pb[t] = j; t++; } }
      const pord = Int32Array.from({ length: m }, (_, i) => i).sort((x, y) => ps[x] - ps[y]);
      const sps = new Float64Array(m); for (let t = 0; t < m; t++) sps[t] = ps[pord[t]];
      if (k === 4) {
        for (let t = 0; t < m && out.length < maxSets; t++) {
          if (await yieldNow()) return out;
          const A = pord[t];
          for (let u = Math.max(t + 1, lowerBound(sps, m, lo - ps[A])); u < m && sps[u] <= hi - ps[A]; u++) {
            const B = pord[u];
            if (pa[A] !== pa[B] && pa[A] !== pb[B] && pb[A] !== pa[B] && pb[A] !== pb[B]) add([ord[pa[A]], ord[pb[A]], ord[pa[B]], ord[pb[B]]]);
          }
        }
      } else {
        for (let i = 0; i < n && out.length < maxSets; i++) {
          if (await yieldNow()) return out;
          for (let j = i + 1; j < n; j++) {
            if (await yieldNow()) return out;
            const s2 = sv[i] + sv[j];
            for (let l = j + 1; l < n; l++) {
              const s3 = s2 + sv[l];
              for (let u = lowerBound(sps, m, lo - s3); u < m && sps[u] <= hi - s3; u++) {
                const B = pord[u];
                if (pa[B] > l) add([ord[i], ord[j], ord[l], ord[pa[B]], ord[pb[B]]]);
              }
            }
          }
        }
      }
    }
  }
  out.sort((x, y) => x.length - y.length);
  return out;
}
'''
a = s.find("async function findSubsetSums(")
b = s.find("// MARKER_VATRECONCILE_SUBSET_SUM_FRONT_V15 -- แผงค้นหา")
if s.count("async function findSubsetSums(") != 1 or b < a or a < 0:
    print("[ABORT] ไม่พบ solver เดิมแบบ unique"); sys.exit(1)
s = s[:a] + "// " + MARKER + "\n" + NEW + "\n" + s[b:]
def rp(s, old, new, label):
    c = s.count(old)
    if c != 1:
        print(f"[ABORT] {label}: anchor พบ {c} ครั้ง"); sys.exit(1)
    return s.replace(old, new)
s = rp(s, "    if (items.length > 400) { setResult({ sets: [], note: `มี ${items.length.toLocaleString()} แถว (เกิน 400) — กรองสาขา/คอลัมน์ให้เหลือน้อยลงก่อน` }); return; }\n    const k = items.length > 300 ? Math.min(maxK, 4) : maxK;\n",
  "    if (items.length > 2000) { setResult({ sets: [], note: `มี ${items.length.toLocaleString()} แถว (เกิน 2,000) — กรองสาขา/คอลัมน์ให้เหลือน้อยลงก่อน` }); return; }\n    const k = items.length > 500 ? Math.min(maxK, 4) : maxK;\n", "limits")
s = rp(s, "!result.note?.startsWith('มี ')", "!result.note?.startsWith('มี ')", "keep")
# --- ตัวเลือก: ตัดรายการที่ยอดมากกว่ายอดเป้าหมายออกก่อน (ใช้ได้เมื่อไม่มียอดติดลบ) ---
s = rp(s, "  const [maxK, setMaxK] = useState(5);\n", "  const [maxK, setMaxK] = useState(5);\n  const [prune, setPrune] = useState(true);\n", "prune state")
s = rp(s, "    const items = rows.filter(", "    let items = rows.filter(", "items let")
s = rp(s, "    if (items.length > 2000) {",
"""    let prunedNote = '';
    if (prune) {
      const hasNeg = items.some((x) => x.c < 0) || tg < 0;
      if (hasNeg) prunedNote = 'ไม่ได้ตัดรายการที่ยอดมากกว่า เพราะมียอดติดลบ (ยอดใหญ่อาจถูกหักล้างได้)';
      else {
        const lim = Math.round(tg * 100) + Math.round(Math.abs(Number(tol) || 0) * 100);
        const before = items.length;
        items = items.filter((x) => x.c <= lim);
        prunedNote = `ตัดรายการที่ยอดมากกว่า ${tg.toLocaleString('en-US', { minimumFractionDigits: 2 })} ออก ${(before - items.length).toLocaleString()} แถว เหลือค้นหา ${items.length.toLocaleString()} แถว`;
      }
    }
    if (items.length > 2000) {""", "prune block")
s = rp(s, "ms: Date.now() - t0, n: items.length, note: abortRef.current ? 'หยุดค้นหาแล้ว (แสดงเท่าที่พบ)' : Date.now() - t0 > 60000 ? 'ครบเวลา 60 วินาที (แสดงเท่าที่พบ)' : '',",
          "ms: Date.now() - t0, n: items.length, note: [prunedNote, abortRef.current ? 'หยุดค้นหาแล้ว (แสดงเท่าที่พบ)' : Date.now() - t0 > 60000 ? 'ครบเวลา 60 วินาที (แสดงเท่าที่พบ)' : ''].filter(Boolean).join(' · '),", "note merge")
s = rp(s, "            {!running\n              ? <button type=\"button\" onClick={calc}",
"""            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} /> ตัดรายการที่ยอดมากกว่ายอดที่ต้องการออกก่อน</label>
            {!running
              ? <button type="button" onClick={calc}""", "prune checkbox")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copy2(path, f"{path}.bak{n:02d}")
open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
