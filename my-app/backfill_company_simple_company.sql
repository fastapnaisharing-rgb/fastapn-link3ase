-- เติม company_list."Simple Company" ให้ BU ที่ยังว่าง (ไม่ทับค่าที่มีอยู่)
-- ลำดับ: (1) Simple Company ที่พบมากที่สุดของ BU นั้นใน branch_list  (2) Segment3-English Company Name
-- รันหลัง add_simple_company_to_company_list.sql
-- ขั้นที่ 1: ดูตัวอย่างก่อน (ยังไม่แก้ข้อมูล)
SELECT c.bu,
       COALESCE(b.sc, NULLIF(TRIM(c."SEGMENT3"), '') || '-' || NULLIF(TRIM(c."ENGLISH COMPANY NAME"), '')) AS new_simple_company,
       CASE WHEN b.sc IS NOT NULL THEN 'branch_list' ELSE 'segment3-english' END AS source
FROM company_list c
LEFT JOIN (
  SELECT DISTINCT ON (LOWER(TRIM(bu))) LOWER(TRIM(bu)) AS bu_key, "Simple Company" AS sc
  FROM branch_list
  WHERE TRIM(COALESCE("Simple Company", '')) <> ''
  GROUP BY LOWER(TRIM(bu)), "Simple Company"
  ORDER BY LOWER(TRIM(bu)), COUNT(*) DESC
) b ON b.bu_key = LOWER(TRIM(c.bu))
WHERE TRIM(COALESCE(c."Simple Company", '')) = ''
ORDER BY c.bu;

-- ขั้นที่ 2: ถ้าตัวอย่างถูกต้อง รันคำสั่งนี้
UPDATE company_list c
SET "Simple Company" = COALESCE(b.sc, NULLIF(TRIM(c."SEGMENT3"), '') || '-' || NULLIF(TRIM(c."ENGLISH COMPANY NAME"), ''))
FROM (
  SELECT DISTINCT ON (LOWER(TRIM(bu))) LOWER(TRIM(bu)) AS bu_key, "Simple Company" AS sc
  FROM branch_list
  WHERE TRIM(COALESCE("Simple Company", '')) <> ''
  GROUP BY LOWER(TRIM(bu)), "Simple Company"
  ORDER BY LOWER(TRIM(bu)), COUNT(*) DESC
) b
WHERE b.bu_key = LOWER(TRIM(c.bu))
  AND TRIM(COALESCE(c."Simple Company", '')) = '';

-- BU ที่ไม่มี Branch ที่มี Simple Company เลย: เติมจาก Segment3-English
UPDATE company_list
SET "Simple Company" = NULLIF(TRIM("SEGMENT3"), '') || '-' || NULLIF(TRIM("ENGLISH COMPANY NAME"), '')
WHERE TRIM(COALESCE("Simple Company", '')) = ''
  AND NULLIF(TRIM("SEGMENT3"), '') IS NOT NULL AND NULLIF(TRIM("ENGLISH COMPANY NAME"), '') IS NOT NULL;
