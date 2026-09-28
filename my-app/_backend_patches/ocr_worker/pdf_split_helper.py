"""
pdf_split_helper.py
================================================================
ตัวช่วยแยก PDF เป็นภาพทีละหน้า (150 DPI ตามที่ตัดสินใจไว้)
เรียกจาก Node.js ผ่าน child_process.spawn

วิธีใช้:
  python pdf_split_helper.py <pdf_path> <output_dir> [dpi]

Output: พิมพ์ JSON บรรทัดเดียวไปที่ stdout เพื่อให้ Node.js อ่านง่าย
  {"success": true, "pages": ["path1.png", "path2.png", ...]}
  {"success": false, "error": "..."}
================================================================
"""
import sys
import os
import json


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "usage: pdf_split_helper.py <pdf_path> <output_dir> [dpi]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150

    try:
        import fitz  # pymupdf
    except ImportError:
        print(json.dumps({"success": False, "error": "pymupdf not installed"}))
        sys.exit(1)

    if not os.path.exists(pdf_path):
        print(json.dumps({"success": False, "error": f"file not found: {pdf_path}"}))
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    try:
        doc = fitz.open(pdf_path)
        page_paths = []
        for i, page in enumerate(doc):
            pix = page.get_pixmap(dpi=dpi)
            out_path = os.path.join(output_dir, f"page_{i+1:02d}.png")
            pix.save(out_path)
            page_paths.append(out_path)
        doc.close()
        print(json.dumps({"success": True, "pages": page_paths}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
