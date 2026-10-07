# -*- coding: utf-8 -*-
# MARKER_TIMELINE_BU_ESC_BACK_V1 -- หน้า BU: กด ESC = กลับ Lobby
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_BU_ESC_BACK_V1" in src:
    print("already patched"); sys.exit(0)
OLD = '  const left46 = act46.length - d46;\n\n  return (\n    <div>\n      {/* MARKER_TIMELINE_BU_HEADER_ENLARGE_V1 */}'
NEW = '  const left46 = act46.length - d46;\n  // MARKER_TIMELINE_BU_ESC_BACK_V1 -- กด ESC = กลับ Lobby (ข้ามถ้ากำลังพิมพ์ในช่อง หรือมี Popup/Modal เปิดอยู่)\n  React.useEffect(() => {\n    const onEsc = (e) => {\n      if (e.key !== "Escape" || e.defaultPrevented) return;\n      const el = e.target;\n      const tag = el && el.tagName ? el.tagName.toUpperCase() : "";\n      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;\n      if (document.querySelector(\'[data-rid-pop], [style*="inset: 0"]\')) return;\n      onBack();\n    };\n    document.addEventListener("keydown", onEsc);\n    return () => document.removeEventListener("keydown", onEsc);\n  }, [onBack]);\n\n  return (\n    <div>\n      {/* MARKER_TIMELINE_BU_HEADER_ENLARGE_V1 */}'
assert src.count(OLD) == 1, "anchor"
src = src.replace(OLD, NEW)
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
