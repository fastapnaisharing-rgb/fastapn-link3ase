"""
docenter_ocr.py
================================================================
OCR สำหรับ Document Center — อ่าน PDF รายงาน APN01 format
ใช้ PaddleOCR + pdf2image แปลง PDF → image → อ่าน text + coordinates
แล้ว parse โครงสร้างตาราง → return JSON

Usage:
    python docenter_ocr.py <pdf_path>

Output (stdout):
    JSON { success, metadata, rows, error }

ติดตั้ง:
    pip install paddleocr pdf2image pillow
    apt install poppler-utils  (หรือ Windows: ติดตั้ง poppler แล้วเพิ่ม PATH)
================================================================
"""

import sys
import json
import os
import re
import traceback
from pathlib import Path


def pdf_to_images(pdf_path: str, dpi: int = 200):
    """แปลง PDF ทุกหน้าเป็น PIL Image"""
    from pdf2image import convert_from_path
    raw_images = convert_from_path(pdf_path, dpi=dpi, poppler_path=r"C:\apps\poppler\Library\bin")
    # auto-rotate ถ้าภาพ portrait แต่ควรเป็น landscape (PDF rotate 270)
    images = []
    for img in raw_images:
        w, h = img.size
        if h > w:  # portrait → rotate 90 CCW ให้เป็น landscape
            img = img.rotate(90, expand=True)
        images.append(img)
    return images


def ocr_image(image, ocr_engine):
    """รัน OCR บน PIL Image → list of items"""
    import numpy as np
    img_array = np.array(image)
    result = ocr_engine.ocr(img_array)
    items = []
    if not result:
        return items

    ocr_res = result[0]

    # PaddleOCR v3+ return OCRResult object — access via dict keys
    if hasattr(ocr_res, '__getitem__'):
        texts = ocr_res['rec_texts']
        polys = ocr_res['rec_polys']
        scores = ocr_res.get('rec_scores', [1.0] * len(texts))
        for text, poly, conf in zip(texts, polys, scores):
            try:
                xs = [p[0] for p in poly]
                ys = [p[1] for p in poly]
                x1, x2 = min(xs), max(xs)
                y1, y2 = min(ys), max(ys)
                items.append({
                    "text": str(text).strip(),
                    "x1": float(x1), "y1": float(y1),
                    "x2": float(x2), "y2": float(y2),
                    "cx": float(x1 + x2) / 2,
                    "cy": float(y1 + y2) / 2,
                    "conf": round(float(conf), 3),
                })
            except Exception:
                continue
    elif isinstance(ocr_res, list):
        # format เก่า: list of [box, [text, conf]]
        for line in ocr_res:
            try:
                box = line[0]
                rest = line[1]
                if isinstance(rest, (list, tuple)):
                    text = str(rest[0])
                    conf = float(rest[1]) if len(rest) > 1 else 1.0
                else:
                    text = str(rest)
                    conf = 1.0
                if isinstance(box[0], (list, tuple)):
                    xs = [p[0] for p in box]
                    ys = [p[1] for p in box]
                else:
                    xs = [box[i] for i in range(0, len(box), 2)]
                    ys = [box[i] for i in range(1, len(box), 2)]
                x1, x2 = min(xs), max(xs)
                y1, y2 = min(ys), max(ys)
                items.append({
                    "text": text.strip(),
                    "x1": float(x1), "y1": float(y1),
                    "x2": float(x2), "y2": float(y2),
                    "cx": float(x1 + x2) / 2,
                    "cy": float(y1 + y2) / 2,
                    "conf": round(conf, 3),
                })
            except Exception:
                continue
    return items
    for line in result[0]:
        if len(line) == 2:
            box, txt = line
            if isinstance(txt, (list, tuple)):
                text, conf = txt[0], float(txt[1])
            else:
                text, conf = str(txt), 1.0
        elif len(line) == 3:
            box, text, conf = line[0], str(line[1]), float(line[2])
        else:
            continue
        # box = [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x1, x2 = min(xs), max(xs)
        y1, y2 = min(ys), max(ys)
        items.append({
            "text": text.strip(),
            "x1": x1, "y1": y1,
            "x2": x2, "y2": y2,
            "cx": (x1 + x2) / 2,
            "cy": (y1 + y2) / 2,
            "conf": round(conf, 3),
        })
    return items


def group_rows(items: list, y_tolerance: int = 12) -> list:
    """จัดกลุ่ม items ที่มี cy ใกล้กัน → เป็น rows เรียงซ้าย→ขวา"""
    if not items:
        return []
    sorted_items = sorted(items, key=lambda x: x["cy"])
    rows = []
    current_row = [sorted_items[0]]

    for item in sorted_items[1:]:
        if abs(item["cy"] - current_row[-1]["cy"]) <= y_tolerance:
            current_row.append(item)
        else:
            rows.append(sorted(current_row, key=lambda x: x["cx"]))
            current_row = [item]
    rows.append(sorted(current_row, key=lambda x: x["cx"]))
    return rows


def row_text(row: list) -> str:
    """รวม text ของ row เป็น string เดียว"""
    return " ".join(i["text"] for i in row).strip()


def is_number(text: str) -> bool:
    """เช็คว่า text เป็นตัวเลข (รองรับ comma และ decimal)"""
    return bool(re.match(r"^[\d,]+(\.\d+)?$", text.strip()))


def clean_number(text: str) -> str:
    """ทำความสะอาด number string → comma format"""
    text = text.strip().replace(",", "")
    try:
        val = float(text)
        # format กลับเป็น comma
        if val == int(val):
            return f"{int(val):,}"
        return f"{val:,.2f}"
    except Exception:
        return text


def parse_date(text: str) -> str:
    """normalize date string → DD-Mon-YY"""
    months = {
        "jan": "Jan", "feb": "Feb", "mar": "Mar", "apr": "Apr",
        "may": "May", "jun": "Jun", "jul": "Jul", "aug": "Aug",
        "sep": "Sep", "oct": "Oct", "nov": "Nov", "dec": "Dec",
        "มค": "Jan", "กพ": "Feb", "มีค": "Mar", "เมย": "Apr",
        "พค": "May", "มิย": "Jun", "กค": "Jul", "สค": "Aug",
        "กย": "Sep", "ตค": "Oct", "พย": "Nov", "ธค": "Dec",
    }
    # ลอง parse DD-Mon-YY หรือ DD/MM/YYYY
    m = re.match(r"(\d{1,2})[-/]([A-Za-z]+)[-/](\d{2,4})", text.strip())
    if m:
        d, mon, y = m.group(1), m.group(2), m.group(3)
        yy = y[-2:] if len(y) >= 2 else y
        mon_out = months.get(mon.lower()[:3], mon[:3].capitalize())
        return f"{d.zfill(2)}-{mon_out}-{yy}"
    m2 = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text.strip())
    if m2:
        d, mo, y = m2.group(1), int(m2.group(2)), m2.group(3)
        mon_list = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        mon_out = mon_list[mo] if 1 <= mo <= 12 else str(mo)
        yy = y[-2:]
        return f"{d.zfill(2)}-{mon_out}-{yy}"
    return text.strip()


# ── Column boundaries สำหรับ Document Center ทุก Doc Type ───────────────────
# APN01 / AP07 / AP09 / TRANS — ใช้ Template เดียวกัน layout เดียวกัน
# (normalized 0–1 ของความกว้างภาพ) — ปรับได้ถ้า layout เปลี่ยน
DOC_COLS = [
    {"name": "Branch",             "x_start": 0.00, "x_end": 0.06},
    {"name": "Vendor Name",        "x_start": 0.06, "x_end": 0.23},
    {"name": "GR Transaction No.", "x_start": 0.23, "x_end": 0.30},
    {"name": "Invoice Number",     "x_start": 0.30, "x_end": 0.41},
    {"name": "Receive Date",       "x_start": 0.41, "x_end": 0.45},
    {"name": "รายการ",             "x_start": 0.45, "x_end": 0.63},
    {"name": "มูลค่าก่อนภาษี",    "x_start": 0.63, "x_end": 0.71},
    {"name": "มูลค่าภาษี",        "x_start": 0.71, "x_end": 0.77},
    {"name": "มูลค่ารวม",         "x_start": 0.77, "x_end": 0.81},
    {"name": "Batch Name",         "x_start": 0.81, "x_end": 0.94},
    {"name": "Payment Doc",        "x_start": 0.94, "x_end": 1.00},
]

# Doc types ที่รองรับ — ใช้ layout เดียวกันหมด
SUPPORTED_DOC_TYPES = {"APN01", "AP07", "AP09", "TRANS", "IMP"}

# Keywords บ่งชี้ว่าเป็น header row หรือ summary row (ข้าม)
SKIP_KEYWORDS = [
    "branch", "vendor name", "gr transaction", "invoice number",
    "receive date", "รายการ", "มูลค่า", "batch name", "payment doc",
    "ยอดรวม", "doc type", "bu code", "ชื่อผู้ประกอบการ",
    "apn01", "ap07", "ap09", "receive date",
]

META_KEYS = {
    "doc type": "doc_type",
    "bu code": "bu_code",
    "ชื่อผู้ประกอบการ": "bu_name",
    "receive date": "receive_date",
}


def item_to_col(item: dict, img_width: int) -> str:
    """หาว่า item นี้อยู่ใน column ไหนตาม x-position"""
    cx_norm = item["cx"] / img_width
    for col in DOC_COLS:
        if col["x_start"] <= cx_norm < col["x_end"]:
            return col["name"]
    return "__OTHER__"


def is_data_row(row: list, img_width: int) -> bool:
    """เช็คว่า row นี้ดูเหมือน data row (มี branch number + มีตัวเลข)"""
    if not row:
        return False
    full_text = row_text(row).lower()
    # ข้าม header/summary rows
    if any(kw in full_text for kw in SKIP_KEYWORDS):
        return False
    # ต้องมีตัวเลข GR หรือ Invoice อยู่บ้าง
    has_number = any(is_number(i["text"].replace(",", "")) for i in row)
    # ต้องมีอย่างน้อย 3 items
    return has_number and len(row) >= 3


def parse_metadata(rows: list) -> dict:
    """ดึง metadata จาก rows แรกๆ (DOC TYPE, BU CODE ฯลฯ)"""
    meta = {}
    for row in rows[:10]:
        text = row_text(row)
        text_lower = text.lower()
        for key, field in META_KEYS.items():
            if key in text_lower:
                # ค่าอยู่หลัง : หรือหลัง keyword
                parts = re.split(r"[:：]", text, maxsplit=1)
                if len(parts) > 1:
                    meta[field] = parts[1].strip()
                else:
                    # ค่าอยู่ item ถัดไปใน row
                    items_text = [i["text"] for i in row]
                    for ki, itext in enumerate(items_text):
                        if key in itext.lower() and ki + 1 < len(items_text):
                            meta[field] = items_text[ki + 1].strip()
    return meta


def parse_data_rows(ocr_rows: list, img_width: int) -> list:
    """แปลง OCR rows → list of dict ตาม Document Center columns"""
    data_rows = []
    for row in ocr_rows:
        if not is_data_row(row, img_width):
            continue
        record = {col["name"]: "" for col in DOC_COLS}
        for item in row:
            col_name = item_to_col(item, img_width)
            if col_name == "__OTHER__":
                continue
            text = item["text"].strip()
            # format ตามประเภท column
            if col_name in ("มูลค่าก่อนภาษี", "มูลค่าภาษี", "มูลค่ารวม"):
                text = clean_number(text) if is_number(text.replace(",", "")) else text
            elif col_name == "Receive Date":
                text = parse_date(text) if text else ""
            # append ถ้า cell มีข้อมูลแล้ว (multi-word)
            if record[col_name]:
                record[col_name] += " " + text
            else:
                record[col_name] = text
        # ข้าม row ที่ข้อมูลว่างเกือบหมด
        filled = sum(1 for v in record.values() if v.strip())
        if filled >= 3:
            data_rows.append(record)
    return data_rows


def parse_doc_pdf(pdf_path: str) -> dict:
    """Main function — PDF → metadata + rows JSON
    รองรับ: APN01, AP07, AP09, TRANS, IMP — ใช้ layout เดียวกัน"""
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(
        use_textline_orientation=True,
        lang="th",
        
        
    )

    images = pdf_to_images(pdf_path, dpi=200)

    all_metadata = {}
    all_rows = []

    for page_idx, image in enumerate(images):
        img_width, img_height = image.size
        items = ocr_image(image, ocr)
        ocr_rows = group_rows(items, y_tolerance=15)

        if page_idx == 0:
            all_metadata = parse_metadata(ocr_rows)

        data_rows = parse_data_rows(ocr_rows, img_width)
        all_rows.extend(data_rows)

    # normalize doc_type ให้ตรงกับ SUPPORTED_DOC_TYPES
    raw_type = str(all_metadata.get("doc_type", "")).strip().upper()
    doc_type = raw_type if raw_type in SUPPORTED_DOC_TYPES else raw_type or "APN01"
    all_metadata["doc_type"] = doc_type

    return {
        "success":    True,
        "metadata":   all_metadata,
        "rows":       all_rows,
        "total_rows": len(all_rows),
        "pages":      len(images),
        "doc_type":   doc_type,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: python docenter_ocr.py <pdf_path>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(json.dumps({"success": False, "error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    try:
        result = parse_doc_pdf(pdf_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }, ensure_ascii=False))
        sys.exit(1)