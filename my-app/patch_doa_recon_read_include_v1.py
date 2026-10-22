# -*- coding: utf-8 -*-
# Reconcile อ่านแถว Include จาก DB (doa_detail_clear) เองทุกครั้ง รวมกับ Detail ในหน้า (ไม่ซ้ำ) — ไม่ต้องพึ่ง Connect
import os, shutil
MARKER = "MARKER_GL_DOA_RECON_READ_INCLUDE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
def rep(old, new):
    global s
    assert s.count(old) == 1, ("anchor", s.count(old), old[:80]); s = s.replace(old, new)
rep("const [sp, setSp] = React.useState({}); const [spReady, setSpReady] = React.useState(false);",
    "const [incRows, setIncRows] = React.useState([]); const [incReady, setIncReady] = React.useState(false); /* " + MARKER + " */ React.useEffect(() => { let off = false; setIncReady(false); if (!bu || !code) { setIncReady(true); return undefined; } listDoaClearDetail(bu, String(code)).then(it => { if (!off) { setIncRows((it || []).filter(x => x.status === 'Include' && x.row && (!period || String(x.period) === String(period))).map(x => x.row)); setIncReady(true); } }).catch(() => { if (!off) { setIncRows([]); setIncReady(true); } }); return () => { off = true; }; }, [bu, period, code]);\n  const [sp, setSp] = React.useState({}); const [spReady, setSpReady] = React.useState(false);")
rep("try { detAll = detailRows(detMatrix || []).filter(o => String(o.account_code) === String(code));",
    "try { detAll = (() => { const base = detailRows(detMatrix || []).filter(o => String(o.account_code) === String(code)); const have = new Map(); base.forEach(o => { const k = detKey(o); have.set(k, (have.get(k) || 0) + 1); }); const extra = []; incRows.filter(o => String(o.account_code) === String(code)).forEach(o => { const k = detKey(o); const v = have.get(k) || 0; if (v > 0) have.set(k, v - 1); else extra.push(o); }); return base.concat(extra); })();")
rep("  }, [tbMatrix, detMatrix, simMatrix, code]);\n  const ov = ", "  }, [tbMatrix, detMatrix, simMatrix, code, incRows]);\n  const ov = ")
rep("if (!autoSend || autoRan.current || !spReady) return undefined;", "if (!autoSend || autoRan.current || !spReady || !incReady) return undefined;")
rep("[D, autoSend, spReady]", "[D, autoSend, spReady, incReady]")
if not os.path.exists(P + ".bak_recinc"): shutil.copy2(P, P + ".bak_recinc")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
