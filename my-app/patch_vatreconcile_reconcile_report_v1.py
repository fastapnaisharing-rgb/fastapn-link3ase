# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_RECONCILE_REPORT_V1
# เพิ่ม Endpoint GET /vat-reconcile/dashboard/reconcile-report ใน src/routes/vatReconcile.js
# (ข้อมูลสำหรับ Popup Preview ให้เหมือน Reconcile จริงตาม Macro: Template 100% / 100%+Simple / เฉลี่ย AVG + Cover + Check Diff)
#
# วิธีใช้ (บน Server จริง):  python patch_vatreconcile_reconcile_report_v1.py <path ของ vatReconcile.js>
#   เช่น  python patch_vatreconcile_reconcile_report_v1.py src\\routes\\vatReconcile.js
#   หลัง Patch สำเร็จ -> Restart-Service fastapn-backend
# - Idempotent (รันซ้ำได้ ไม่เพิ่มซ้ำ) | สำรอง <ไฟล์>.bak ไฟล์เดียว (ทับของเดิม) | เช็ค Bracket Balance | node --check ถ้ามี node
import sys, io, os, shutil, subprocess

if len(sys.argv) < 2:
    print("usage: python patch_vatreconcile_reconcile_report_v1.py <path to vatReconcile.js>")
    sys.exit(2)
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
N = "MARKER_VATRECONCILE_RECONCILE_REPORT_V1"
if N in src:
    print("already patched"); sys.exit(0)

BLOCK = r'''// MARKER_VATRECONCILE_RECONCILE_REPORT_V1
/**
 * GET /vat-reconcile/dashboard/reconcile-report?bu=...&account=...&period=YYYY-MM
 * สร้างข้อมูล Popup Preview ให้ "เหมือน Reconcile จริงตาม Macro" (ชีต ReportVat_VGR / ReportVat_AVG + Cover)
 * ไม่มีการเขียน DB -- อ่านอย่างเดียว
 *
 * เลือก Template อัตโนมัติจากชนิด Simple ที่มีข้อมูลของ (BU, Account, Period):
 *   - มี Simple AVG  -> "avg"         (ReportVat_AVG: Input-N 100% | Input ใช้สิทธิ์ x% | Excel ใช้สิทธิ์ x% | รวม | เพิ่มเติม | รวมทั้งสิ้น)
 *   - มี Simple 100  -> "100_simple"  (ReportVat_VGR: Input-N 100% | Excel-N 100% | รวม | เพิ่มเติม | รวมทั้งสิ้น)
 *   - ไม่มี Simple   -> "100"         (ReportVat_VGR เหมือนบน แต่ Excel-N = 0)
 *
 * สูตรตามไฟล์ Macro จริง:
 *   100%: Input-N 100% = Σ paid (มูลค่า/ภาษี) | Excel-N 100% = Σ Simple 100 claimed | รวม = Input + Excel
 *         T/B = Σ ending(SubAcc 999999) - Σ ending(CPC 46119)   (บวก/ลบ CPC 46250 หักล้างกันเอง)
 *         Total = SUBTOTAL(9) ทุกสาขา | Check Diff = มี Unbalance ใน Detail (|paid_amount*7/100 - claimed100_vat| > 0.05) ไหม
 *   AVG : Input-N 100% ภาษี = Σ paid_amount ที่ paid_vat=0, มูลค่า = ภาษี*100/7
 *         Input ใช้สิทธิ์ x% = Σ claimed - Σ claimed ที่ calculate_tax=0 | Excel ใช้สิทธิ์ x% = Σ Simple AVG claimed
 *         รวม = Input-N100% + Input ใช้สิทธิ์ + Excel ใช้สิทธิ์ | T/B = Σ ending ต่อสาขา
 *   Cover: Per TB = Σ ending ทั้ง TB | Per Detail = รวมทั้งสิ้น(ภาษี) | Diff | (100% เท่านั้น) FinCredit 46250 = -Σ ending(CPC 46250)
 * "ภาษีซื้อที่ต้องยื่นเพิ่มเติม" ในไฟล์เป็นค่ากรอกมือ -> ส่ง 0 (ยังไม่มีข้อมูลในระบบ)
 */
const RECON_THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
function reconThaiPeriodLabel(period) {
  const m = /^(\d{4})-(\d{2})/.exec(String(period || ""));
  if (!m) return String(period || "");
  return `${RECON_THAI_MONTHS[Number(m[2]) - 1] || m[2]} ${Number(m[1]) + 543}`;
}
const reconR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function reconPickKey(row, re, exclude) {
  return Object.keys(row || {}).find((k) => re.test(k) && !(exclude && exclude.test(k)));
}

router.get("/dashboard/reconcile-report", async (req, res) => {
  try {
    const { account, period } = req.query;
    let { bu } = req.query;
    if (!bu || !account || !period) {
      return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
    }
    const buInput = String(bu);
    const numericBu = await resolveBuToNumeric(buInput);
    if (!numericBu) {
      return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    }
    bu = numericBu;

    // Short Code ของ BU (ไว้ Join branch_list / company_list)
    let buShort = /^\d+$/.test(buInput) ? null : buInput;
    if (!buShort) {
      const sc = await pool.query(
        `SELECT bu FROM company_list WHERE split_part("COMPANY CODE", '-', 3) = $1 AND deleted IS NOT TRUE LIMIT 1`,
        [numericBu]
      );
      buShort = sc.rows[0]?.bu || null;
    }

    const [tbQ, inQ, simQ] = await Promise.all([
      pool.query(
        `SELECT branch, cpc, subacc, description, ending_balance::float8 AS ending_balance
         FROM vat_reconcile_tb WHERE bu = $1 AND account = $2 AND period = $3`,
        [bu, account, period]
      ),
      pool.query(
        `SELECT branch,
                COALESCE(SUM(paid_amount), 0)::float8 AS paid_amount,
                COALESCE(SUM(paid_vat), 0)::float8 AS paid_vat,
                COALESCE(SUM(claimed100_amount), 0)::float8 AS claimed_amount,
                COALESCE(SUM(claimed100_vat), 0)::float8 AS claimed_vat,
                COALESCE(SUM(paid_amount) FILTER (WHERE COALESCE(paid_vat, 0) = 0), 0)::float8 AS zero_vat_amount,
                COALESCE(SUM(claimed100_amount) FILTER (WHERE COALESCE(calculate_tax, 0) = 0), 0)::float8 AS claimed_amount_p0,
                COALESCE(SUM(claimed100_vat) FILTER (WHERE COALESCE(calculate_tax, 0) = 0), 0)::float8 AS claimed_vat_p0,
                COUNT(*) FILTER (
                  WHERE ABS(ROUND((COALESCE(paid_amount, 0) * 7 / 100 - COALESCE(claimed100_vat, 0))::numeric, 2)) > 0.05
                )::int AS unbalance_count,
                COUNT(*)::int AS invoice_count,
                MAX(operator_name) AS operator_name
         FROM vat_reconcile_input_summary
         WHERE bu = $1 AND reconcile_account = $2 AND period = $3
         GROUP BY branch`,
        [bu, account, period]
      ),
      pool.query(
        `SELECT h.branch, h.simple_type, MAX(h.operator_name) AS operator_name, MAX(h.company_tax_id) AS company_tax_id,
                COALESCE(SUM(d.claimed_amount), 0)::float8 AS claimed_amount,
                COALESCE(SUM(d.claimed_vat), 0)::float8 AS claimed_vat,
                COALESCE(AVG(NULLIF(d.claim_percent, 0)), 0)::float8 * 100 AS claim_percent
         FROM vat_reconcile_simple_header h
         LEFT JOIN vat_reconcile_simple_detail d ON d.header_id = h.id
         WHERE h.bu = $1 AND h.reconcile_account = $2 AND h.period = $3
         GROUP BY h.branch, h.simple_type`,
        [bu, account, period]
      ),
    ]);

    // ชื่อสาขา / ข้อมูลบริษัท -- ป้องกันชื่อคอลัมน์ไม่ตรง (ไม่ Crash ถ้าไม่เจอ)
    const branchNames = new Map();
    let totalBranchCount = 0;
    if (buShort) {
      try {
        const bq = await pool.query(`SELECT * FROM branch_list WHERE bu = $1 AND deleted IS NOT TRUE`, [buShort]);
        totalBranchCount = bq.rows.length;
        if (bq.rows.length) {
          const codeKey = reconPickKey(bq.rows[0], /branch.*code/i) || "Branch Code";
          const nameKey = reconPickKey(bq.rows[0], /name|desc/i, /code/i);
          for (const r of bq.rows) {
            if (r[codeKey] != null && nameKey && r[nameKey]) branchNames.set(String(r[codeKey]).trim(), String(r[nameKey]).trim());
          }
        }
      } catch (e) {
        console.warn("[vatReconcile] reconcile-report branch_list lookup skipped:", e.message);
      }
    }
    let companyName = null;
    let companyTaxId = null;
    if (buShort) {
      try {
        const cq = await pool.query(`SELECT * FROM company_list WHERE bu = $1 AND deleted IS NOT TRUE LIMIT 1`, [buShort]);
        const c = cq.rows[0];
        if (c) {
          const nk = reconPickKey(c, /company.*name|^name$|บริษัท/i);
          const tk = reconPickKey(c, /tax.*id|taxid|เลขประจำตัว/i);
          if (nk && c[nk]) companyName = String(c[nk]).trim();
          if (tk && c[tk]) companyTaxId = String(c[tk]).trim();
        }
      } catch (e) {
        console.warn("[vatReconcile] reconcile-report company_list lookup skipped:", e.message);
      }
    }
    for (const r of simQ.rows) {
      if (!companyTaxId && r.company_tax_id) companyTaxId = String(r.company_tax_id).replace(/-\d+$/, "").trim();
    }

    // แยกข้อมูลตามชนิด Simple
    const simple100 = new Map();
    const simpleAvg = new Map();
    let ratePercent = null;
    for (const r of simQ.rows) {
      if (String(r.simple_type) === "AVG") {
        simpleAvg.set(r.branch, r);
        if (!ratePercent && Number(r.claim_percent) > 0) ratePercent = reconR2(r.claim_percent);
      } else {
        simple100.set(r.branch, r);
      }
    }
    const template = simpleAvg.size > 0 ? "avg" : simple100.size > 0 ? "100_simple" : "100";

    // TB ต่อสาขา
    const tbBy = new Map();
    let tbAll = 0;
    let tbFin46250 = 0;
    let accountName = null;
    for (const r of tbQ.rows) {
      const b = r.branch;
      if (!tbBy.has(b)) tbBy.set(b, { sub999: 0, cpc46119: 0, all: 0 });
      const t = tbBy.get(b);
      const v = Number(r.ending_balance) || 0;
      t.all += v;
      tbAll += v;
      if (String(r.subacc || "").trim() === "999999") t.sub999 += v;
      if (String(r.cpc || "").trim() === "46119") t.cpc46119 += v;
      if (String(r.cpc || "").trim() === "46250") tbFin46250 += v;
      if (!accountName && r.description) accountName = String(r.description).trim();
    }
    const inBy = new Map(inQ.rows.map((r) => [r.branch, r]));

    const branchSet = new Set([...tbBy.keys(), ...inBy.keys(), ...simple100.keys(), ...simpleAvg.keys()]);
    const branches = [...branchSet].sort();

    let pairLabels;
    if (template === "avg") {
      const pct = ratePercent != null ? `${ratePercent}%` : "";
      pairLabels = [
        "ภาษีซื้อ Input-N 100%",
        `ภาษีซื้อ Input ใช้สิทธิ์ ${pct}`.trim(),
        `ภาษีซื้อ Excel ใช้สิทธิ์ ${pct}`.trim(),
        "รวมภาษีซื้อ",
        "ภาษีซื้อที่ต้องยื่นเพิ่มเติม",
        "รวมภาษีซื้อทั้งสิ้น",
      ];
    } else {
      pairLabels = ["ภาษีซื้อ Input-N 100%", "ภาษีซื้อ Excel-N 100%", "รวมภาษีซื้อ", "ภาษีซื้อที่ต้องยื่นเพิ่มเติม", "รวมภาษีซื้อทั้งสิ้น"];
    }
    const nPairs = pairLabels.length;
    const TOLERANCE = 1.0; // เหมือน type=reconcile เดิม

    const rows = branches.map((branch) => {
      const i = inBy.get(branch) || {};
      const tb = tbBy.get(branch) || { sub999: 0, cpc46119: 0, all: 0 };
      let pairs;
      let tbAmount;
      if (template === "avg") {
        const s = simpleAvg.get(branch) || {};
        const d = reconR2(i.zero_vat_amount);
        const c = reconR2((d * 100) / 7);
        const e = reconR2((i.claimed_amount || 0) - (i.claimed_amount_p0 || 0));
        const f = reconR2((i.claimed_vat || 0) - (i.claimed_vat_p0 || 0));
        const g = reconR2(s.claimed_amount);
        const h = reconR2(s.claimed_vat);
        const ii = reconR2(c + e + g);
        const j = reconR2(d + f + h);
        pairs = [[c, d], [e, f], [g, h], [ii, j], [0, 0], [reconR2(ii), reconR2(j)]];
        tbAmount = reconR2(tb.all);
      } else {
        const s = simple100.get(branch) || {};
        const inA = reconR2(i.paid_amount);
        const inV = reconR2(i.paid_vat);
        const exA = reconR2(s.claimed_amount);
        const exV = reconR2(s.claimed_vat);
        pairs = [[inA, inV], [exA, exV], [reconR2(inA + exA), reconR2(inV + exV)], [0, 0], [reconR2(inA + exA), reconR2(inV + exV)]];
        tbAmount = reconR2(tb.sub999 - tb.cpc46119);
      }
      const allVat = pairs[nPairs - 1][1];
      const diff = reconR2(allVat - tbAmount);
      const name = branchNames.get(String(branch).trim()) || i.operator_name || (simpleAvg.get(branch) || simple100.get(branch) || {}).operator_name || "";
      return {
        branch,
        name,
        pairs,
        tb: tbAmount,
        diff,
        status: Math.abs(diff) <= TOLERANCE ? "ตรงกัน" : "ไม่ตรงกัน",
      };
    });

    const totalPairs = Array.from({ length: nPairs }, (_, k) => [
      reconR2(rows.reduce((s, r) => s + r.pairs[k][0], 0)),
      reconR2(rows.reduce((s, r) => s + r.pairs[k][1], 0)),
    ]);
    const totalTb = reconR2(rows.reduce((s, r) => s + r.tb, 0));
    const totalDiff = reconR2(totalPairs[nPairs - 1][1] - totalTb);

    const unbalanceCount = inQ.rows.reduce((s, r) => s + (Number(r.unbalance_count) || 0), 0);
    const perTb = reconR2(tbAll);
    const perDetail = totalPairs[nPairs - 1][1];
    const coverDiff = reconR2(perTb - perDetail);
    const finCredit = template === "avg" ? null : reconR2(-tbFin46250);

    return res.json({
      template,
      sheet: template === "avg" ? "ReportVat_AVG" : "ReportVat_VGR",
      account,
      accountName: accountName || "",
      tbLabel: `${account.slice(0, 3)}-${account.slice(3, 5)}-${account.slice(5)}`,
      ratePercent,
      header: {
        title: "รายงานสรุปภาษีซื้อ Non Merchandise",
        company: companyName || buShort || String(numericBu),
        taxId: companyTaxId || "",
        periodLabel: reconThaiPeriodLabel(period),
      },
      pairLabels,
      rows,
      totals: { pairs: totalPairs, tb: totalTb, diff: totalDiff },
      cover: {
        perTb,
        perDetail,
        diff: coverDiff,
        finCredit,
        coverDiff: reconR2(coverDiff + (finCredit || 0)),
      },
      checkDiff: template === "avg"
        ? { applicable: false }
        : { applicable: true, unbalance: unbalanceCount, text: unbalanceCount > 0 ? "Found Diff in Detail" : "Approve Balance" },
      branchCount: { withData: rows.length, total: totalBranchCount || rows.length },
    });
  } catch (err) {
    console.error("[vatReconcile] reconcile-report error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างสร้าง Reconcile Report", detail: err.message });
  }
});

'''

ANCHOR = 'router.get("/dashboard/status", async (req, res) => {'
if src.count(ANCHOR) != 1:
    print("ERROR: anchor found %d times (expected 1) -- ไม่แก้ไฟล์" % src.count(ANCHOR)); sys.exit(1)

def bal(s):
    return (s.count("{") - s.count("}"), s.count("(") - s.count(")"), s.count("[") - s.count("]"))
assert bal(BLOCK) == (0, 0, 0), "block bracket imbalance %s" % (bal(BLOCK),)

new = src.replace(ANCHOR, BLOCK + ANCHOR, 1)
assert bal(new) == bal(src), "bracket balance changed"

shutil.copyfile(path, path + ".bak")  # .bak ไฟล์เดียว (ทับของเดิม)
io.open(path, "w", encoding="utf-8", newline="").write(new)

try:
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.copyfile(path + ".bak", path)
        print("node --check FAILED -> restored from .bak\n" + r.stderr); sys.exit(1)
    print("node --check OK")
except FileNotFoundError:
    print("(ไม่พบ node -- ข้าม node --check)")
print("patched OK ->", path)
