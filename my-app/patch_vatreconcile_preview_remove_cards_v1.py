# -*- coding: utf-8 -*-
"""patch_vatreconcile_preview_remove_cards_v1
Preview Input Reconcile: เอาแถวการ์ด Per TB / Per Detail / Diff / FinCredit / Diff หลัง FinCredit / สาขาที่มียอด ออก
(ดูตัวเลขได้จากแถว Total ในตารางอยู่แล้ว)
รันที่โฟลเดอร์ my-app:  python patch_vatreconcile_preview_remove_cards_v1.py
"""
import os, shutil, sys

TARGET = os.path.join("src", "pages", "VatReconcileDashboard.js")
MARKER = "PREVIEW_REMOVE_CARDS_V1"

DEF_START = "  const cover = data?.cover;\n  const cards = data ? ["
DEF_END = "  ] : [];\n"
JSX_START = "              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>\n                {cards.map("
JSX_END = "                ))}\n              </div>\n\n"

def cut(src, start, end, nl):
    s = src.find(start)
    if s < 0 or src.count(start) != 1: return None
    e = src.find(end, s)
    if e < 0: return None
    return src[:s] + src[e + len(end):]

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    n = src.replace("\r\n", "\n")
    out = cut(n, DEF_START, DEF_END, "\n")
    out = cut(out, JSX_START, JSX_END, "\n") if out else None
    if out is None:
        print("ERROR: ไม่พบ anchor ครบ (ต้องเจออย่างละ 1 จุด) - ไม่เขียนไฟล์"); sys.exit(1)
    if "cards" in out.split("const hasDiff")[1].split("return (")[0] or "{cards." in out:
        print("ERROR: ยังมีการอ้างอิง cards เหลือ - ไม่เขียนไฟล์"); sys.exit(1)
    out = out.replace("const hasDiff =", "// PREVIEW_REMOVE_CARDS_V1\n  const hasDiff =", 1)
    for a, b in ("{}", "()", "[]"):
        if out.count(a) != out.count(b):
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: out = out.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")   # 1 .bak ต่อไฟล์ เขียนทับทุกครั้ง
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(out)
    print("OK: patched ->", TARGET)

main()
