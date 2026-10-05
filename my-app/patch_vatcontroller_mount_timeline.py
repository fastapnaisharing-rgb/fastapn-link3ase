# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_MOUNT_TIMELINE_RESTORE_V1
# คืน Mount หน้า Timeline (vat-timeline -> TimelinePage) ที่หายไปจาก VatController.js
import sys, shutil, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_VATCONTROLLER_MOUNT_TIMELINE_RESTORE_V1" in src:
    print("already patched"); sys.exit(0)

imp_anchor = 'import VatReconcileDashboard from "./VatReconcileDashboard";'
assert src.count(imp_anchor) == 1, "import anchor not unique"
i = src.index(imp_anchor); eol = src.index("\n", i)
src = src[:eol+1] + 'import TimelinePage from "./TimelinePage"; // MARKER_VATCONTROLLER_MOUNT_TIMELINE_RESTORE_V1\n' + src[eol+1:]

ret_anchor = "  const title = VAT_MENU_LABEL_MAP[activeSubTab] || 'VAT Controller';\n  return <PlaceholderPage title={title} />;"
assert src.count(ret_anchor) == 1, "return anchor not unique"
src = src.replace(ret_anchor,
"  if (activeSubTab === 'vat-timeline') { // MARKER_VATCONTROLLER_MOUNT_TIMELINE_RESTORE_V1\n    return <TimelinePage />;\n  }\n" + ret_anchor)
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
