# -*- coding: utf-8 -*-
# patch: เปิด Over Period (Toggle หรือ Auto Over) -> Receive Date เปลี่ยนไปอยู่เดือนถัดไปของ Period (Quick Action / GL-TransferVat และ Add Tax Invoice Full Page)
#        ปิด Over -> กลับเป็นค่า Default เดิม; ถ้าผู้ใช้แก้ Receive Date ไปเดือนอื่นเอง (ไม่ใช่เดือน Period / เดือนถัดไป) จะไม่แตะ
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:80])
    s = s.replace(a, b)
rep("  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_GRT_AUTOGEN_V1\n  // ── คำนวณ GRT Prefix/Digit/Running เริ่มต้นสำหรับ",
"""  // MARKER_OVER_RECEIVEDATE_NEXTMONTH_V1 -- Over ON: Receive Date อยู่เดือนถัดไปของ Period (วันนี้ถ้าเป็นเดือนนั้น / ไม่งั้นวันที่ 1 หรือวันสุดท้าย) / OFF: Default เดิม
  function vatAdjustReceiveForOver(prev, effYm, over) {
    const nextYm = vatShiftYm(effYm, 1); const y = vatYmOfDate(prev);
    if (prev && y !== effYm && y !== nextYm) return prev; // ผู้ใช้แก้ไปเดือนอื่นเอง ไม่แตะ
    if (!over) return getDefaultQuickActionReceiveDate(effYm);
    const now = new Date(); const t = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (t === nextYm) return `${t}-${String(now.getDate()).padStart(2, '0')}`;
    if (t > nextYm) { const [yy, mm] = nextYm.split('-').map(Number); const ld = new Date(yy, mm, 0); return `${ld.getFullYear()}-${String(ld.getMonth() + 1).padStart(2, '0')}-${String(ld.getDate()).padStart(2, '0')}`; }
    return `${nextYm}-01`;
  }
  const quickActionRecvOverRef = React.useRef(false); const addTaxRecvOverRef = React.useRef(false);
  React.useEffect(() => { // Quick Action (และ GL-TransferVat ที่ใช้ Receive Date ชุดเดียวกัน)
    if (!showQuickAction) { quickActionRecvOverRef.current = false; return; }
    const over = !!(quickActionOver || quickActionAutoOver);
    if (!quickActionPeriodMonth || over === quickActionRecvOverRef.current) return;
    quickActionRecvOverRef.current = over;
    const nv = vatAdjustReceiveForOver(quickActionReceiveDate, quickActionPeriodMonth, over);
    if (nv !== quickActionReceiveDate) { setQuickActionReceiveDate(nv); if (quickActionReceiveDateTextRef.current) quickActionReceiveDateTextRef.current.value = formatDateDisplayMDY(nv); }
  }, [showQuickAction, quickActionOver, quickActionAutoOver, quickActionPeriodMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { // Add Tax Invoice Full Page
    const over = !!addTaxInvoiceOver; const eff = addTaxPeriodRef.current;
    if (!eff || over === addTaxRecvOverRef.current) return;
    addTaxRecvOverRef.current = over;
    setAddTaxInvoiceReceiveDate((prev) => vatAdjustReceiveForOver(prev, eff, over));
  }, [addTaxInvoiceOver]);
  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_GRT_AUTOGEN_V1
  // ── คำนวณ GRT Prefix/Digit/Running เริ่มต้นสำหรับ""")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
