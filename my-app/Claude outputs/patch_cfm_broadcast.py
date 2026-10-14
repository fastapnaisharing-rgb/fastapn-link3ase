#!/usr/bin/env python3
# patch_cfm_broadcast.py -- CFM Error List: ติ๊ก "ตรวจแล้ว" แล้ว Broadcast ให้ทุกเครื่องที่เปิด Popup เดียวกันโหลดใหม่ | MARKER_VATRECONCILE_CFM_BROADCAST_V1
# ใช้: python3 patch_cfm_broadcast.py <vatReconcile.js> <VatReconcileDashboard.js>   (รันหลัง patch_cfm_backend.py / patch_cfm_frontend.py)
import sys
p1, p2 = sys.argv[1], sys.argv[2]
s = open(p1, encoding="utf-8").read()
if "MARKER_VATRECONCILE_CFM_BROADCAST_V1" in s:
    print("backend already patched")
else:
    old = '    res.json({ ok: true, count: ids.length });\n  } catch (e) { console.error("[vatReconcile] cfm-fc-ack:", e);'
    assert s.count(old) == 1, s.count(old)
    new = ('    try { if (global._wss) global._wss.clients.forEach((c) => { if (c.readyState === 1) c.send(JSON.stringify({ event: "vat_reconcile_data_changed", bu: req.body?.bu || null, account: req.body?.account || null, period: req.body?.period || null, kind: "cfm_fc_ack" })); }); } catch (e) { console.warn("[cfm-fc-ack] broadcast:", e.message); } // MARKER_VATRECONCILE_CFM_BROADCAST_V1\n'
           + old)
    s = s.replace(old, new, 1)
    open(p1, "w", encoding="utf-8").write(s)
    print("backend patched")

d = open(p2, encoding="utf-8").read()
if "MARKER_VATRECONCILE_CFM_BROADCAST_V1" in d:
    print("frontend already patched")
else:
    # 1) CfmFcPanel รับ ctx แล้วส่ง bu/account/period ไปกับ PUT
    a = "function CfmFcPanel({ cfm }) {"
    assert d.count(a) == 1
    d = d.replace(a, "function CfmFcPanel({ cfm, ctx }) {", 1)
    b = "        body: JSON.stringify({ ids, checked }),"
    assert d.count(b) == 1
    d = d.replace(b, "        body: JSON.stringify({ ids, checked, bu: ctx && ctx.bu, account: ctx && ctx.account, period: ctx && ctx.period }), // MARKER_VATRECONCILE_CFM_BROADCAST_V1", 1)
    c = "{data.isCfm && data.cfm && <CfmFcPanel cfm={data.cfm} />}"
    assert d.count(c) == 1
    d = d.replace(c, "{data.isCfm && data.cfm && <CfmFcPanel cfm={data.cfm} ctx={{ bu: state.bu, account: state.account, period: state.period }} />}", 1)
    # 2) Popup ฟัง Broadcast kind=cfm_fc_ack (Account/Period เดียวกัน) -> โหลดรายงานใหม่
    e = "  const onSourceEdited = (rowId, nextRow) => {"
    assert d.count(e) == 1
    listener = '''  useEffect(() => { // MARKER_VATRECONCILE_CFM_BROADCAST_V1 -- เครื่องอื่นติ๊ก "ตรวจแล้ว" ใน Error List ของ CFM -> โหลดรายงานนี้ใหม่
    const unsub = subscribeWs(['vat_reconcile_data_changed'], (ev, parsed) => {
      const dd = (parsed && (parsed.data || parsed)) || {};
      if (dd.kind !== 'cfm_fc_ack') return;
      if ((dd.account && String(dd.account) !== String(state.account)) || (dd.period && String(dd.period) !== String(state.period))) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        fetchReconcileReport({ bu: state.bu, account: state.account, period: state.period }).then(setLiveData).catch(() => {});
      }, 400);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [state.bu, state.account, state.period]); // eslint-disable-line react-hooks/exhaustive-deps
'''
    d = d.replace(e, listener + e, 1)
    open(p2, "w", encoding="utf-8").write(d)
    print("frontend patched")
