"""
ocr_grouping_safety_net.py
================================================================
Safety net สำหรับบั๊ก "หน้าค้างที่ pending_grouping ตลอดไป"

ต้นเหตุ: resolveGrouping() ฝั่ง frontend เรียก Gemini/backend หลายจุด
ถ้าจุดไหนจุดหนึ่งค้าง (ก่อนแก้ timeout ใน geminiSplitMerge.js) จะไม่มีวัน
เรียก apply-groups หรือ skip-grouping เลย หน้าที่ insert ไว้ตอน upload
(status='pending_grouping') จะไม่มีวันถูก worker หยิบไปทำ

Script นี้ทำหน้าที่เดียวกับ POST /api/ocr/skip-grouping/:batchId
แค่ทำแบบ "กวาดทุก batch ที่ค้างเกิน STALE_MINUTES" แทนที่จะรอ frontend
เรียกทีละ batch — เป็นเครือข่ายกันตายชั้นที่ 2 ต่อให้ frontend พังแบบไหน
ก็ตาม (ตั้งใจให้ทำงานได้แม้ตอนที่ timeout fix ใน geminiSplitMerge.js
ไม่ทำงานตามที่คาดหวังด้วยเหตุผลอื่นที่ยังไม่เจอ)

สำคัญ: ปล่อยไปที่ 'local_grouping' ไม่ใช่ 'pending' ตรงๆ —
เพื่อให้ยังผ่าน Local Grouping (ocr_worker_v2.py ทำ header-crop OCR
หาจุดตัดเอกสารก่อน) เหมือน Flow ปกติ ไม่ใช่ปล่อยเข้าคิว Full OCR
แบบไม่รู้จุดตัดเลย (ซึ่งจะย้อนกลับไปเป็นปัญหาเดิมที่เพิ่งแก้ไป)

วิธีติดตั้ง: ตั้งเป็น Scheduled Task รันทุก 3-5 นาที (แบบเดียวกับ
KillZombiePS ที่มีอยู่แล้ว) ด้วย python-3.13 embeddable runtime เดิม
================================================================
"""
import sys
import psycopg2

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "fastapn-link3ase",
    "user": "postgres",
    "password": "postgres",
}

# หน้าที่ค้างเกินกี่นาทีถึงจะถือว่า "แน่นอนแล้วว่า frontend ไม่มาปลดล็อกให้"
# resolveGrouping ปกติควรจบภายในไม่กี่สิบวินาที (แม้แต่ timeout สูงสุดที่
# ตั้งไว้ใน geminiSplitMerge.js ก็แค่ 45 วิ) ตั้ง 5 นาทีเผื่อไว้กว้างๆ
STALE_MINUTES = 5


def release_stale_pages(conn) -> tuple[list[dict], int]:
    """หา batch ที่มีหน้าค้างที่ pending_grouping นานเกิน STALE_MINUTES
    แล้วปลดล็อกให้ worker หยิบไปทำได้เลย (เหมือน skip-grouping)
    คืนค่า (รายชื่อ batch ที่โดน, จำนวนหน้าที่ปลดล็อกทั้งหมด)"""
    with conn.cursor() as cur:
        # หา batch ที่ค้าง ก่อน (เพื่อ log ให้เห็นว่าโดน batch ไหนบ้าง)
        cur.execute(
            """
            SELECT DISTINCT b.id AS batch_id, b.source_file_name, b.uploaded_by,
                   COUNT(p.id) AS stale_page_count,
                   MIN(p.created_at) AS oldest_page_created_at
            FROM ocr_upload_batches b
            JOIN ocr_queue_pages p ON p.batch_id = b.id
            WHERE p.status = 'pending_grouping'
              AND p.created_at < NOW() - INTERVAL '%s minutes'
            GROUP BY b.id, b.source_file_name, b.uploaded_by
            """,
            (STALE_MINUTES,),
        )
        stale_batches = cur.fetchall()

        if not stale_batches:
            return [], 0

        # ปลดล็อกจริง — เงื่อนไขเดียวกับ /skip-grouping ทุกประการ
        # (status เป้าหมายเป็น 'local_grouping' ไม่ใช่ 'pending' —
        # ให้ Worker หา จุดตัดเอกสารก่อนเข้าคิว Full OCR เหมือน Flow ปกติ)
        cur.execute(
            """
            UPDATE ocr_queue_pages
            SET status = 'local_grouping'
            WHERE status = 'pending_grouping'
              AND created_at < NOW() - INTERVAL '%s minutes'
            """,
            (STALE_MINUTES,),
        )
        released_count = cur.rowcount
        conn.commit()

        return [
            {
                "batch_id": row[0],
                "source_file_name": row[1],
                "uploaded_by": row[2],
                "stale_page_count": row[3],
                "oldest_page_created_at": str(row[4]),
            }
            for row in stale_batches
        ], released_count


def main():
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        stale_batches, released_count = release_stale_pages(conn)
        if not stale_batches:
            print("[safety-net] ไม่มี batch ไหนค้าง — ไม่ต้องทำอะไร")
            return

        print(f"[safety-net] ปลดล็อก {released_count} หน้า จาก {len(stale_batches)} batch ที่ค้าง:")
        for b in stale_batches:
            print(
                f"  - {b['source_file_name']} (batch={b['batch_id']}, "
                f"uploaded_by={b['uploaded_by']}, ค้าง {b['stale_page_count']} หน้า, "
                f"เก่าสุดตั้งแต่ {b['oldest_page_created_at']})"
            )
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[safety-net] ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)