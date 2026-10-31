# -*- coding: utf-8 -*-
"""
patch_docenter_ocr_orient_ap09_v1.py
------------------------------------------------------------------
แก้ Document Center OCR (docenter_ocr_server.py + docenter_ocr_route.js)

ปัญหา (พิสูจน์จากไฟล์สแกน RICOH 5 ไฟล์ + log):
  1) เครื่องสแกนเขียน /Rotate 270 ลงใน PDF -> pdf2image/poppler หมุนตาม -> ภาพ "ตะแคง"
     แต่ภาพต้นฉบับ (ไม่ใช้ /Rotate) ตั้งตรงอยู่แล้ว  => OCR อ่านตารางไม่ออก (96 หน้า: 89 หน้าตกไป Fallback)
  2) AP09 มีคอลัมน์ GRT No./Tax Invoice Date/Tax Invoice No./Description/ยอด*  แต่ Server รู้จักแต่
     คอลัมน์ APN01 (Invoice Number / มูลค่า*)  -> แถวหาย / Lightweight Match ไม่ติด
  3) Serial Code Fast-path Match ต้องตรงเป๊ะ + Match 4-field อ่านเฉพาะคีย์ APN01

วิธีแก้:
  - Auto-Orient: ลอง "ภาพต้นฉบับ (ไม่ใช้ /Rotate)" ก่อน -> ถ้าอ่านหัวกระดาษได้ ใช้เลย (OCR แค่ 1 ครั้ง)
    ไม่ได้ค่อยลองภาพที่ใช้ /Rotate -> สุดท้ายค่อยลองหมุน 90/270/180 (Cache ต่อไฟล์)
  - Profile AP09 (หัวคอลัมน์ + ตำแหน่งสำรอง) เลือกอัตโนมัติจาก DOC TYPE / หัวคอลัมน์
  - Lightweight ส่ง invoice/GRT/amount ของ AP09 ให้ Node + อ่าน Serial Code จากข้อความทั้งหน้าเป็นตัวสำรอง
  - Node: Serial Fast-path ไม่สนช่องว่าง/ตัวพิมพ์, Match 4-field รองรับคีย์ AP09

ใช้:  python patch_docenter_ocr_orient_ap09_v1.py <docenter_ocr_server.py> <docenter_ocr_route.js>
(ทำ .bak_orient_v1 ให้อัตโนมัติ ถ้ายังไม่มี / รันซ้ำได้ ไม่ซ้อน)
"""
import sys, shutil, os, io

def rd(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

def rep(s, old, new, label, count=1):
    n = s.count(old)
    if n != count:
        raise SystemExit(f"[FAIL] {label}: พบ {n} จุด (ต้องการ {count})")
    return s.replace(old, new)

def main(srv, route):
    for p in (srv, route):
        bak = p + '.bak_orient_v1'
        if not os.path.exists(bak):
            shutil.copy2(p, bak)
            print('backup ->', bak)

    # ====================================================================
    # PYTHON SERVER
    # ====================================================================
    s = rd(srv)
    _crlf = '\r\n' in s  # ไฟล์ Windows (CRLF) -- แก้เป็น LF ในหน่วยความจำแล้วคืน CRLF ตอนเขียน
    s = s.replace('\r\n', '\n')
    if 'MARKER_DOCENTER_AUTO_ORIENT_V1' in s:
        print('[skip] server patched already')
    else:
        # ---- 1) Orientation helpers + AP09 profile  (วางต่อจาก rotate_image) ----
        anchor = '''def is_number(text: str) -> bool:'''
        helpers = '''# MARKER_DOCENTER_AUTO_ORIENT_V1
# ── Auto-Orient: เครื่องสแกน (RICOH) เขียน /Rotate 270 ลง PDF แต่ภาพจริงตั้งตรงอยู่แล้ว ──
# ── poppler หมุนตาม /Rotate -> ภาพตะแคง -> OCR อ่านไม่ออก. ลอง "ภาพต้นฉบับ" ก่อน ──
import hashlib as _hashlib
_ORIENT_CACHE = {}
_ORIENT_KEYS = ["doc type", "bu code", "branch", "vendor", "receive date", "invoice", "grt",
                "batch", "ผู้ประกอบการ", "รายการ", "ยอด", "มูลค่า", "serial code"]
_ORIENT_MIN_SCORE = 4


def pdf_to_images_orig(pdf_bytes: bytes, dpi: int = 200):
    """Render โดยไม่ใช้ /Rotate ของหน้า (ภาพต้นฉบับ) -> (images, had_rotate)"""
    import fitz  # pymupdf (ใช้อยู่แล้วใน /extract-pages)
    from PIL import Image as PILImage
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out, had_rot = [], False
    try:
        for page in doc:
            if page.rotation:
                had_rot = True
                page.set_rotation(0)
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            out.append(PILImage.frombytes("RGB", [pix.width, pix.height], pix.samples))
    finally:
        doc.close()
    return out, had_rot


def _orient_score(img) -> int:
    """OCR หน้าแรกแบบย่อ แล้วนับคำหัวกระดาษที่อ่านเจอ (ยิ่งมากยิ่งตั้งถูก)"""
    try:
        small = img.copy()
        small.thumbnail((1800, 1800))
        items = ocr_image_full(small)
    except Exception as e:
        log.warning(f"[orient] score failed: {e}")
        return 0
    txt = " ".join(i["text"] for i in items).lower()
    return sum(1 for k in _ORIENT_KEYS if k in txt)


def _decide_orientation(pdf_bytes: bytes, rendered):
    """คืน (source, extra_rot): source = 'orig' (ไม่ใช้ /Rotate) | 'rendered' (ใช้ /Rotate ปกติ)"""
    _ensure_ocr_engine()
    cands = []
    try:
        orig, had_rot = pdf_to_images_orig(pdf_bytes, dpi=200)
        if had_rot and orig:
            cands.append(("orig", orig[0]))
    except Exception as e:
        log.warning(f"[orient] render original failed: {e}")
    if rendered:
        cands.append(("rendered", rendered[0]))
    best = ("rendered", 0, -1, None)
    for src, img in cands:
        sc = _orient_score(img)
        log.info(f"[orient] {src}: score={sc}")
        if sc >= _ORIENT_MIN_SCORE:
            return (src, 0)
        if sc > best[2]:
            best = (src, 0, sc, img)
    # ยังอ่านไม่ได้ -> ลองหมุนเพิ่มจากตัวที่ดีที่สุด (ทางเลือกสุดท้าย)
    base_img = best[3]
    if base_img is not None:
        for rot in (90, 270, 180):
            sc = _orient_score(rotate_image(base_img, rot))
            log.info(f"[orient] {best[0]}+{rot}: score={sc}")
            if sc >= _ORIENT_MIN_SCORE:
                return (best[0], rot)
    return (best[0], 0)


def get_oriented_images(pdf_bytes: bytes, extra_rotation: int = 0):
    """แทน pdf_to_images + rotate_image เดิม -> (images, auto_rotation_info)"""
    rendered = pdf_to_images(pdf_bytes, dpi=200)
    if extra_rotation:  # ผู้ใช้สั่งหมุนเอง -> เคารพตามนั้น
        return [rotate_image(i, extra_rotation) for i in rendered], "user"
    key = _hashlib.md5(pdf_bytes).hexdigest()
    mode = _ORIENT_CACHE.get(key)
    if mode is None:
        mode = _decide_orientation(pdf_bytes, rendered)
        if len(_ORIENT_CACHE) > 100:
            _ORIENT_CACHE.clear()
        _ORIENT_CACHE[key] = mode
    src, rot = mode
    imgs = rendered
    if src == "orig":
        try:
            imgs, _ = pdf_to_images_orig(pdf_bytes, dpi=200)
        except Exception as e:
            log.warning(f"[orient] re-render original failed: {e}")
            imgs = rendered
    if rot:
        imgs = [rotate_image(i, rot) for i in imgs]
    log.info(f"[orient] use {src}" + (f" +{rot}°" if rot else ""))
    return imgs, f"{src}+{rot}"


# ── Profile AP09 (Input Tax Invoice): คอลัมน์ต่างจาก APN01 ──────────────────────
AP09_COL_NAMES = ["Branch", "Vendor Name", "Receive Date", "GRT No.", "Tax Invoice Date",
                  "Tax Invoice No.", "Description", "ยอดก่อนภาษี", "ยอดภาษี", "ยอดรวม"]
AP09_HEADER_KEYWORDS = {
    "Branch":           ["branch"],
    "Vendor Name":      ["vendor name", "vendor"],
    "Receive Date":     ["receive date"],
    "GRT No.":          ["grt no", "grt"],
    "Tax Invoice Date": ["tax invoice date"],
    "Tax Invoice No.":  ["tax invoice no"],
    "Description":      ["description", "desctiption", "descr"],
    "ยอดก่อนภาษี":      ["ยอดก่อน", "ก่อนภาษี"],
    "ยอดภาษี":          ["ยอดภาษี"],
    "ยอดรวม":           ["ยอดรวม"],
}
AP09_NUM_COLS = {"ยอดก่อนภาษี", "ยอดภาษี", "ยอดรวม"}
AP09_DATE_COLS = {"Receive Date", "Tax Invoice Date"}
# ตำแหน่งสำรอง (สัดส่วนความกว้างภาพ) วัดจากแผ่นจริง -- ใช้เมื่อหาหัวคอลัมน์ไม่ครบ >=3 คอลัมน์
AP09_DEFAULT_DEFS = [
    {"name": "Branch",           "x_start": 0.00,  "x_end": 0.12},
    {"name": "Vendor Name",      "x_start": 0.12,  "x_end": 0.307},
    {"name": "Receive Date",     "x_start": 0.307, "x_end": 0.369},
    {"name": "GRT No.",          "x_start": 0.369, "x_end": 0.42},
    {"name": "Tax Invoice Date", "x_start": 0.42,  "x_end": 0.49},
    {"name": "Tax Invoice No.",  "x_start": 0.49,  "x_end": 0.583},
    {"name": "Description",      "x_start": 0.583, "x_end": 0.75},
    {"name": "ยอดก่อนภาษี",      "x_start": 0.75,  "x_end": 0.81},
    {"name": "ยอดภาษี",          "x_start": 0.81,  "x_end": 0.866},
    {"name": "ยอดรวม",           "x_start": 0.866, "x_end": 1.00},
]


def detect_profile(items: list, meta: dict, prev: str = "APN") -> str:
    """เลือก Profile คอลัมน์: 'AP09' หรือ 'APN' (APN01/AP07/TRANS/IMP เดิม) -- หน้าต่อ (ไม่มีหัว) สืบทอดจากหน้าก่อน"""
    dt = str((meta or {}).get("doc_type", "")).strip().upper()
    if dt == "AP09":
        return "AP09"
    if dt in SUPPORTED_DOC_TYPES:
        return "APN"
    txt = " ".join(i["text"] for i in items).lower()
    if "grt no" in txt and "tax invoice no" in txt:
        return "AP09"
    if "gr transaction" in txt and "invoice number" in txt:
        return "APN"
    return prev


def profile_kwargs(profile: str) -> dict:
    if profile == "AP09":
        return dict(col_names=AP09_COL_NAMES, header_keywords=AP09_HEADER_KEYWORDS,
                    num_cols=AP09_NUM_COLS, date_cols=AP09_DATE_COLS, default_defs=AP09_DEFAULT_DEFS)
    return dict(col_names=COL_NAMES, header_keywords=HEADER_KEYWORDS,
                num_cols=NUM_COLS, date_cols={"Receive Date"}, default_defs=None)


def parse_rows_by_profile(cv_img, items, img_width, h_lines, v_lines, profile: str, header_cy: float = 0):
    kw = profile_kwargs(profile)
    if len(h_lines) >= 3 and len(v_lines) >= 3:
        return parse_with_grid(cv_img, h_lines, v_lines, kw["col_names"],
                               header_keywords=kw["header_keywords"], num_cols=kw["num_cols"],
                               date_cols=kw["date_cols"])
    return parse_with_ocr_fallback(items, img_width, header_cy,
                                   header_keywords=kw["header_keywords"], num_cols=kw["num_cols"],
                                   date_cols=kw["date_cols"], default_defs=kw["default_defs"])


'''
        s = rep(s, anchor, helpers + anchor, 'insert helpers')

        # ---- 2) parse_with_grid : parametrize ----
        s = rep(s, 'def parse_with_grid(cv_img, h_lines, v_lines, col_names: list) -> list:\n    """crop + OCR ทีละ cell"""\n',
                'def parse_with_grid(cv_img, h_lines, v_lines, col_names: list,\n'
                '                    header_keywords=None, num_cols=None, date_cols=None) -> list:\n'
                '    """crop + OCR ทีละ cell"""\n'
                '    header_keywords = header_keywords or HEADER_KEYWORDS  # MARKER_DOCENTER_AUTO_ORIENT_V1\n'
                '    num_cols = num_cols if num_cols is not None else NUM_COLS\n'
                '    date_cols = date_cols if date_cols is not None else {"Receive Date"}\n',
                'grid signature')
        s = rep(s, 'matched = sum(1 for kws in HEADER_KEYWORDS.values() if any(kw in row_text_combined for kw in kws))',
                'matched = sum(1 for kws in header_keywords.values() if any(kw in row_text_combined for kw in kws))', 'grid matched')
        s = rep(s, '                for col_name, keywords in HEADER_KEYWORDS.items():\n                    if any(kw in t_lower for kw in keywords):\n                        col_map[ci] = col_name',
                '                for col_name, keywords in header_keywords.items():\n                    if any(kw in t_lower for kw in keywords):\n                        col_map[ci] = col_name', 'grid colmap')
        s = rep(s, '                if col_name in NUM_COLS:\n                    text = clean_number(text) if is_number(text.replace(",", "")) else text\n                elif col_name == "Receive Date":\n                    text = parse_date(text) if text else ""\n            record[col_name] = text',
                '                if col_name in num_cols:\n                    text = clean_number(text) if is_number(text.replace(",", "")) else text\n                elif col_name in date_cols:\n                    text = parse_date(text) if text else ""\n            record[col_name] = text', 'grid cell fmt')

        # ---- 3) parse_with_ocr_fallback : parametrize ----
        s = rep(s, 'def parse_with_ocr_fallback(items: list, img_width: int, header_cy: float) -> list:\n    """Fallback OCR mode"""\n    col_cx = {}',
                'def parse_with_ocr_fallback(items: list, img_width: int, header_cy: float,\n'
                '                            header_keywords=None, num_cols=None, date_cols=None, default_defs=None) -> list:\n'
                '    """Fallback OCR mode"""\n'
                '    header_keywords = header_keywords or HEADER_KEYWORDS  # MARKER_DOCENTER_AUTO_ORIENT_V1\n'
                '    num_cols = num_cols if num_cols is not None else NUM_COLS\n'
                '    date_cols = date_cols if date_cols is not None else {"Receive Date"}\n'
                '    col_cx = {}', 'fallback signature')
        s = rep(s, '        for col_name, keywords in HEADER_KEYWORDS.items():\n            if any(kw in t for kw in keywords) and col_name not in col_cx:',
                '        for col_name, keywords in header_keywords.items():\n            if any(kw in t for kw in keywords) and col_name not in col_cx:', 'fallback header scan')
        s = rep(s, '    else:\n        col_defs = [\n            {"name": "Branch",             "x_start": 0.00, "x_end": 0.06},',
                '    elif default_defs:\n        col_defs = default_defs\n    else:\n        col_defs = [\n            {"name": "Branch",             "x_start": 0.00, "x_end": 0.06},', 'fallback defs')
        s = rep(s, '                    if col["name"] in NUM_COLS:\n                        text = clean_number(text) if is_number(text.replace(",", "")) else text\n                    elif col["name"] == "Receive Date":\n                        text = parse_date(text) if text else ""',
                '                    if col["name"] in num_cols:\n                        text = clean_number(text) if is_number(text.replace(",", "")) else text\n                    elif col["name"] in date_cols:\n                        text = parse_date(text) if text else ""', 'fallback cell fmt')

        # ---- 4) run_ocr_sync ----
        s = rep(s, '''    images_raw = pdf_to_images(pdf_bytes, dpi=200)
    # rotate ตาม user request
    images = [rotate_image(img, extra_rotation) for img in images_raw] if extra_rotation else images_raw
    log.info(f"PDF converted: {len(images)} page(s)" + (f" rotation={extra_rotation}°" if extra_rotation else ""))
''', '''    # MARKER_DOCENTER_AUTO_ORIENT_V1 -- ใช้ภาพต้นฉบับ/Auto-Orient แทนการ Render ตาม /Rotate ตรงๆ
    images, _auto_rot = get_oriented_images(pdf_bytes, extra_rotation)
    log.info(f"PDF converted: {len(images)} page(s) orient={_auto_rot}" + (f" rotation={extra_rotation}°" if extra_rotation else ""))
    _profile = "APN"
''', 'run_ocr_sync head')
        s = rep(s, '''        if page_idx == 0:
            all_metadata = parse_metadata(items)

        gray    = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)
        h_lines = detect_lines(gray, 'h')
        v_lines = detect_lines(gray, 'v')
        log.info(f"Page {page_idx+1}: {len(h_lines)} H-lines, {len(v_lines)} V-lines")

        if len(h_lines) >= 3 and len(v_lines) >= 3:
            data_rows = parse_with_grid(cv_img, h_lines, v_lines, COL_NAMES)
        else:
            log.info("Fallback OCR mode")
            header_cy = 0
            for item in items:
                if any(kw in item["text"].lower() for kw in ["branch", "vendor name"]):
                    header_cy = max(header_cy, item["cy"])
            data_rows = parse_with_ocr_fallback(items, img_width, header_cy)
''', '''        if page_idx == 0:
            all_metadata = parse_metadata(items)
        _profile = detect_profile(items, all_metadata if page_idx == 0 else parse_metadata(items), _profile)

        gray    = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)
        h_lines = detect_lines(gray, 'h')
        v_lines = detect_lines(gray, 'v')
        log.info(f"Page {page_idx+1}: {len(h_lines)} H-lines, {len(v_lines)} V-lines profile={_profile}")

        header_cy = 0
        for item in items:
            if any(kw in item["text"].lower() for kw in ["branch", "vendor name"]):
                header_cy = max(header_cy, item["cy"])
        if not (len(h_lines) >= 3 and len(v_lines) >= 3):
            log.info("Fallback OCR mode")
        data_rows = parse_rows_by_profile(cv_img, items, img_width, h_lines, v_lines, _profile, header_cy)
''', 'run_ocr_sync body')
        s = rep(s, '        "pages":       len(images),\n        "ocr_text":    all_ocr_text,',
                '        "pages":       len(images),\n        "auto_orient": _auto_rot,\n        "ocr_text":    all_ocr_text,', 'result auto_orient')

        # ---- 5) lightweight ----
        s = rep(s, '''    images_raw = pdf_to_images(pdf_bytes, dpi=200)
    images = [rotate_image(img, extra_rotation) for img in images_raw] if extra_rotation else images_raw
    log.info(f"[lightweight] PDF converted: {len(images)} page(s)" + (f" rotation={extra_rotation}°" if extra_rotation else ""))
''', '''    # MARKER_DOCENTER_AUTO_ORIENT_V1
    images, _auto_rot = get_oriented_images(pdf_bytes, extra_rotation)
    log.info(f"[lightweight] PDF converted: {len(images)} page(s) orient={_auto_rot}" + (f" rotation={extra_rotation}°" if extra_rotation else ""))
    _profile = "APN"
''', 'lightweight head')
        s = rep(s, '''        if len(h_lines) >= 3 and len(v_lines) >= 3:
            rows = parse_with_grid(cv_top, h_lines, v_lines, COL_NAMES)
        else:
            rows = parse_with_ocr_fallback(items, crop_width, 0)

        first_row = rows[0] if rows else {}''', '''        _profile = detect_profile(items, meta, _profile)
        rows = parse_rows_by_profile(cv_top, items, crop_width, h_lines, v_lines, _profile, 0)

        # MARKER_DOCENTER_SERIALCODE_TEXT_FALLBACK_V1 -- Serial Code ที่ parse_metadata จับตำแหน่งไม่ได้ -> หาจากข้อความทั้งหน้า
        if not meta.get("serial_code"):
            _all_txt = " ".join(i["text"] for i in items)
            _m = re.search(r"serial\\s*code\\s*[:：]?\\s*([A-Za-z0-9][A-Za-z0-9_.\\-]{5,})", _all_txt, re.IGNORECASE)
            if _m:
                meta["serial_code"] = _m.group(1).strip()

        first_row = rows[0] if rows else {}''', 'lightweight rows')
        s = rep(s, '''            "vendor_name":       first_row.get("Vendor Name", ""),
            "invoice_number":    first_row.get("Invoice Number", ""),
            "gr_transaction_no": first_row.get("GR Transaction No.", ""),
            "branch":            first_row.get("Branch", ""),
            "amount":            first_row.get("มูลค่ารวม", ""),''', '''            "vendor_name":       first_row.get("Vendor Name", ""),
            "invoice_number":    first_row.get("Invoice Number", "") or first_row.get("Tax Invoice No.", ""),
            "gr_transaction_no": first_row.get("GR Transaction No.", "") or first_row.get("GRT No.", ""),
            "branch":            first_row.get("Branch", ""),
            "amount":            first_row.get("มูลค่ารวม", "") or first_row.get("ยอดรวม", ""),''', 'lightweight signal')

        # ---- 6) extract-pages (image) ----
        s = rep(s, '''            images_raw = pdf_to_images(pdf_bytes, dpi=200)
            images = [rotate_image(img, rotation) for img in images_raw] if rotation else images_raw
            extracted = []''', '''            # MARKER_DOCENTER_AUTO_ORIENT_V1 -- รูป Preview/Attach ต้องตั้งตรงเหมือนที่ OCR ใช้
            images, _ = get_oriented_images(pdf_bytes, rotation)
            extracted = []''', 'extract-pages')
        wr(srv, s.replace('\n', '\r\n') if _crlf else s)
        print('[ok] server patched')

    # ====================================================================
    # NODE ROUTE
    # ====================================================================
    j = rd(route)
    if 'MARKER_DOCENTER_AP09_MATCH_KEYS_V1' in j:
        print('[skip] route patched already')
    else:
        j = rep(j, "            `SELECT id, serial_code FROM doc_collection WHERE serial_code = $1 LIMIT 1`,\n            [group.serial_code.trim()]",
                "            // MARKER_DOCENTER_AP09_MATCH_KEYS_V1 -- ไม่สนช่องว่าง/ตัวพิมพ์ (OCR อ่าน Serial Code มักเพี้ยนเรื่องช่องว่าง/ตัวใหญ่เล็ก)\n"
                "            `SELECT id, serial_code FROM doc_collection\n"
                "              WHERE lower(replace(serial_code, ' ', '')) = lower(replace($1, ' ', '')) LIMIT 1`,\n"
                "            [group.serial_code.trim()]", 'serial fastpath')
        j = rep(j, "WHERE lower(trim(re->>'Invoice Number')) = lower(trim($2))",
                "WHERE lower(trim(COALESCE(re->>'Invoice Number', re->>'Tax Invoice No.'))) = lower(trim($2))", 'candidate sql')
        j = rep(j, "            if (normMatch(r['Invoice Number']) !== normMatch(group.invoice_number)) continue;",
                "            const rInv = (r['Invoice Number'] != null && r['Invoice Number'] !== '') ? r['Invoice Number'] : r['Tax Invoice No.'];\n"
                "            if (normMatch(rInv) !== normMatch(group.invoice_number)) continue;", 'row invoice')
        j = rep(j, "Math.abs(toNumMatch(r['มูลค่ารวม']) - toNumMatch(group.amount)) < 0.01",
                "Math.abs(toNumMatch(r['มูลค่ารวม'] != null && r['มูลค่ารวม'] !== '' ? r['มูลค่ารวม'] : r['ยอดรวม']) - toNumMatch(group.amount)) < 0.01", 'row amount')
        wr(route, j)
        print('[ok] route patched')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
