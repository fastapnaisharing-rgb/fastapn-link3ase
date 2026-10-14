#!/usr/bin/env python3
# patch_cfm_backend.py -- BU CFM: รายงานแถวเดียว + TB แยก HO/FC + Error List (FC)  | MARKER_VATRECONCILE_CFM_V1
# ใช้: python3 patch_cfm_backend.py <vatReconcile.js> <vatReconcileReportFiles.js>
import sys, re
p1, p2 = sys.argv[1], sys.argv[2]
s = open(p1, encoding="utf-8").read()
if "MARKER_VATRECONCILE_CFM_V1" in s:
    print("vatReconcile.js already patched"); 
else:
    # 1) migration: ตารางเก็บสถานะ "ตรวจแล้ว" ของรายการ FC
    a1 = "// MARKER_VATRECONCILE_MANUAL_CP874_V1"
    assert s.count(a1) == 1
    mig = '''// MARKER_VATRECONCILE_CFM_V1 -- CFM: ตารางเก็บสถานะ "ตรวจแล้ว" ของรายการ FC ใน Error List
pool.query("CREATE TABLE IF NOT EXISTS vat_reconcile_cfm_fc_ack (row_id bigint PRIMARY KEY, acked_at timestamptz DEFAULT now(), acked_by text)").catch((e) => console.error("[migrate cfm_fc_ack]:", e.message));

'''
    s = s.replace(a1, mig + a1, 1)

    # 2) CFM block ก่อน return res.json ของ reconcileReportHandler
    a2 = "    return res.json({\n      template,\n      sheet: isAvgLayout"
    assert s.count(a2) == 1
    block = r'''    // MARKER_VATRECONCILE_CFM_V1 -- BU CFM: รายงานแถวเดียว 410001 (CFM-HO) / TB แยก HO-FC ตามมาโคร Z_Object_Input_TB (เฉพาะ BU CFM)
    if (String(buShort || "").toUpperCase() === "CFM") {
      const pivotF = new Map(inQ.rows.map((r) => [String(r.branch).trim(), reconR2(r.claimed_vat)]));
      const tbRows = tbQ.rows.map((r) => {
        const br = String(r.branch || "").trim(); const cpc = String(r.cpc || "").trim(); const end = Number(r.ending_balance) || 0;
        const p3 = br.slice(0, 3);
        const I = (cpc === "46115" || cpc === "46119") ? "X" : pivotF.has(br) ? "HO" : ["410", "414", "415"].includes(p3) ? "HO" : ["411", "412", "413", "416", "417", "418", "419"].includes(p3) ? "FC" : "";
        const pf = pivotF.has(br) ? pivotF.get(br) : null;
        const J = reconR2((I === "HO" && pf != null && pf < end) ? (br.includes("410001") ? end : pf) : (cpc === "99999" ? (pf == null ? 0 : pf) : 0));
        const K = I === "X" ? 0 : I === "HO" ? (br !== "410001" ? reconR2(end - J) : 0) : I === "FC" ? reconR2(end) : null;
        const L = (K != null && K < 0 && J !== 0) ? "ERROR" : "TRUE";
        return { branch: br, cpc, account: r.account, subacc: r.subacc, description: r.description, beginning_balance: r.beginning_balance, period_activity: r.period_activity, ending_balance: end, tb_branch: I, tb_ho: J, tb_fc: K, status: L };
      });
      const tbHO = reconR2(tbRows.reduce((t, r) => t + r.tb_ho, 0));
      const tbFC = reconR2(tbRows.reduce((t, r) => t + (r.tb_fc || 0), 0));
      const tbErrors = tbRows.filter((r) => r.status === "ERROR").map((r) => ({ branch: r.branch, cpc: r.cpc, tb_fc: r.tb_fc, tb_ho: r.tb_ho, message: `สาขา ${r.branch}: Input มากกว่า TB อยู่ ${Math.abs(r.tb_fc).toFixed(2)}` }));
      const inA = reconR2(inQ.rows.reduce((t, r) => t + (Number(r.paid_amount) || 0), 0));
      const inV = reconR2(inQ.rows.reduce((t, r) => t + (Number(r.paid_vat) || 0), 0));
      // Simple = Σ "รวมสาขา" ทุกสาขา (เท่ากับ "รวมสุทธิ" ของมาโคร) ถ้า Header ไม่มียอดรวมสาขา ใช้ผลรวมรายบรรทัด
      const smQ = await pool.query(
        `SELECT COALESCE(SUM(COALESCE((to_jsonb(h)->>'sub_paid_amount')::numeric, ds.pa)), 0)::float8 AS amt,
                COALESCE(SUM(COALESCE((to_jsonb(h)->>'sub_paid_vat')::numeric, ds.pv)), 0)::float8 AS vat,
                COALESCE(bool_or((to_jsonb(h)->>'sub_paid_amount') IS NULL), false) AS fallback, COUNT(*)::int AS n
           FROM vat_reconcile_simple_header h
           LEFT JOIN (SELECT header_id, SUM(paid_amount) AS pa, SUM(paid_vat) AS pv FROM vat_reconcile_simple_detail GROUP BY header_id) ds ON ds.header_id = h.id
          WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3 AND h.simple_type <> 'AVG'`,
        [bu, account, period]
      );
      const exA = reconR2(smQ.rows[0].amt); const exV = reconR2(smQ.rows[0].vat);
      const hasSimple = Number(smQ.rows[0].n) > 0;
      const sumA = reconR2(inA + exA); const sumV = reconR2(inV + exV);
      const cfmPairs = [[inA, inV], [exA, exV], [sumA, sumV], [0, 0], [sumA, sumV]];
      const cfmDiff = reconR2(sumV - tbHO);
      const cfmTemplate = hasSimple ? "100_simple" : "100";
      const sumQ = (k) => inQ.rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
      const hoInfo = branchInfo.get("410001") || {};
      const cfmRow = {
        branch: "410001", name: branchNames.get("410001") || "CFM-HO", branchMissing: !branchInfo.has("410001"),
        hasSimpleAvg: false, hasSimple100: hasSimple, branchStatus: hoInfo.status || "", inactiveDate: hoInfo.inactiveDate || "",
        futureCount: 0, futureCountRaw: sumQ("future_count"), futureCauseIds: [], expiredCount: sumQ("expired_count"), overCount: sumQ("over_count"),
        pairs: cfmPairs, tb: tbHO, diff: cfmDiff, status: Math.abs(cfmDiff) <= TOLERANCE ? "ตรงกัน" : "ไม่ตรงกัน",
      };
      // Error List: รายการ Detail ทุกสาขาที่มี "FC" (ตัวพิมพ์ใหญ่) ใน Tax Invoice No. หรือ Description  (Fc'Sharing ไม่ติด)
      const fcQ = await pool.query(
        `SELECT s.id, s.branch, s.grt_no, s.tax_invoice_no, s.vendor_name, s.item_detail,
                s.paid_amount::float8 AS paid_amount, s.paid_vat::float8 AS paid_vat,
                (COALESCE(s.tax_invoice_no, '') ~ 'FC') AS in_invoice, (COALESCE(s.item_detail, '') ~ 'FC') AS in_desc,
                (a.row_id IS NOT NULL) AS checked
           FROM vat_reconcile_input_summary s LEFT JOIN vat_reconcile_cfm_fc_ack a ON a.row_id = s.id
          WHERE s.bu = $1 AND s.reconcile_account = $2 AND s.period = $3
            AND (COALESCE(s.tax_invoice_no, '') ~ 'FC' OR COALESCE(s.item_detail, '') ~ 'FC')
          ORDER BY s.branch, s.tax_invoice_no, s.id`,
        [bu, account, period]
      );
      if (sources) sources.cfmTb = tbRows;
      return res.json({
        template: cfmTemplate, isCfm: true, sheet: "ReportVat_VGR", account, accountName: accountName || "",
        tbLabel: `${account.slice(0, 3)}-${account.slice(3, 5)}-${account.slice(5)}`, ratePercent: null,
        header: { title: "รายงานสรุปภาษีซื้อ Non Merchandise", company: companyName || buShort || String(numericBu), taxId: companyTaxId || "", companyEn: companyNameEn || "",
          preparedBy: preparedBySrc ? preparedBySrc.value : "", preparedByEditable: !!preparedBySrc, periodLabel: reconThaiPeriodLabel(period) },
        pairLabels: ["ภาษีซื้อ Input-N 100%", "ภาษีซื้อ Excel-N 100%", "รวมภาษีซื้อ", "ภาษีซื้อที่ต้องยื่นเพิ่มเติม", "รวมภาษีซื้อทั้งสิ้น"],
        rows: [cfmRow], totals: { pairs: cfmPairs, tb: tbHO, diff: cfmDiff },
        cover: { perTb: tbHO, perDetail: sumV, diff: reconR2(tbHO - sumV), finCredit: null, coverDiff: reconR2(tbHO - sumV) },
        checkDiff: { applicable: true, unbalance: inQ.rows.reduce((s2, r) => s2 + (Number(r.unbalance_count) || 0), 0), text: inQ.rows.some((r) => Number(r.unbalance_count) > 0) ? "Found Diff in Detail" : "Approve Balance" },
        futureCount: 0, overCount: cfmRow.overCount,
        branchCount: { withData: inQ.rows.length, total: totalBranchCount || inQ.rows.length },
        buCode: { numeric: String(numericBu), short: buShort || null },
        cfm: { tbHO, tbFC, tbRows: sources ? undefined : undefined, tbStatus: tbErrors.length ? "ERROR" : "TRUE", tbErrors, simpleFallback: !!smQ.rows[0].fallback, fcList: fcQ.rows, fcOpen: fcQ.rows.filter((r) => !r.checked).length },
        ...(sources ? { sources } : {}),
      });
    }

'''
    s = s.replace(a2, block + a2, 1)

    # 3) endpoint ติ๊ก "ตรวจแล้ว"
    a3 = 'router.get("/dashboard/reconcile-report", reconcileReportHandler);'
    assert s.count(a3) == 1
    ep = '''router.put("/dashboard/cfm-fc-ack", express.json(), async (req, res) => { // MARKER_VATRECONCILE_CFM_V1
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => Number.isFinite(n)) : [];
    if (!ids.length) return res.status(400).json({ error: "ต้องระบุ ids" });
    if (req.body?.checked === false) await pool.query("DELETE FROM vat_reconcile_cfm_fc_ack WHERE row_id = ANY($1::bigint[])", [ids]);
    else await pool.query("INSERT INTO vat_reconcile_cfm_fc_ack (row_id) SELECT unnest($1::bigint[]) ON CONFLICT (row_id) DO NOTHING", [ids]);
    res.json({ ok: true, count: ids.length });
  } catch (e) { console.error("[vatReconcile] cfm-fc-ack:", e); res.status(500).json({ error: e.message }); }
});
'''
    s = s.replace(a3, ep + a3, 1)
    open(p1, "w", encoding="utf-8").write(s)
    print("vatReconcile.js patched")

r = open(p2, encoding="utf-8").read()
if "MARKER_VATRECONCILE_CFM_V1" in r:
    print("ReportFiles already patched")
else:
    a = '  addTable("TB", ["Branch", "CPC", "SubAcc", "Description", "Ending Balance"], trows, [12, 10, 12, 36, 18], [5]);'
    assert r.count(a) == 1
    new = '''  if (rep.isCfm && Array.isArray(src.cfmTb)) { // MARKER_VATRECONCILE_CFM_V1 -- TB ของ CFM: เพิ่ม Branch(HO/FC/X) / TB for HO / TB for FC / Status (I-L)
    const ct = src.cfmTb.map((t) => ({ values: [t.branch, t.cpc, t.account, t.subacc, t.description, t.beginning_balance, t.period_activity, t.ending_balance, t.tb_branch, t.tb_ho, t.tb_fc == null ? "" : t.tb_fc, t.status] }));
    ct.push({ values: ["Total", "", "", "", "", "", "", r2(src.cfmTb.reduce((s, t) => s + (Number(t.ending_balance) || 0), 0)), "", r2(src.cfmTb.reduce((s, t) => s + (Number(t.tb_ho) || 0), 0)), r2(src.cfmTb.reduce((s, t) => s + (Number(t.tb_fc) || 0), 0)), ""], bold: true });
    addTable("TB", ["Branch", "CPC", "Account", "SubAcc", "Description", "Beginning Balance", "Period Activity", "Ending Balance", "Branch", "TB for HO", "TB for FC", "Status"], ct, [12, 10, 12, 12, 30, 16, 16, 16, 10, 16, 16, 10], [6, 7, 8, 10, 11]);
  } else
''' + a
    r = r.replace(a, new, 1)
    open(p2, "w", encoding="utf-8").write(r)
    print("ReportFiles patched")
