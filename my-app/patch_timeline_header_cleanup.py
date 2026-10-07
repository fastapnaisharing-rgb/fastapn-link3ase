# -*- coding: utf-8 -*-
# MARKER_TIMELINE_HEADER_CLEANUP_V1
# 1) เอาข้อความ "รอบ ก.ย. 2569" ข้างชื่อหน้าออก (แถบ Period บอกรอบ/วันเริ่ม/Deadline ครบแล้ว)
# 2) เพิ่มบรรทัดใต้แถบวัน: "เริ่มรอบ ..." ซ้าย / "วันนี้ ... · ครบกำหนด ..." ขวา (ตาม Mockup)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_HEADER_CLEANUP_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)
i = src.index('          <span style={{ fontSize: 13, color: "#666" }}>{period && period.periodYm ?')
j = src.index("\n", i)
src = src[:i] + "          {/* " + M + " */}" + src[j:]
rep('''            return <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: danger ? "#E24B4A" : done ? "#FAC775" : "#eeede6" }} />;
          })}
        </div>
      )}''', '''            return <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: danger ? "#E24B4A" : done ? "#FAC775" : "#eeede6" }} />;
          })}
        </div>
      )}
      {!closedP && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6, fontSize: 12, color: "#7b8794" }}>
          <span>{`เริ่มรอบ ${period.startDate.getDate()} ${TH_MONTH[period.startDate.getMonth()]}`}</span>
          <span>{`วันนี้ ${new Date().getDate()} ${TH_MONTH[new Date().getMonth()]} · ครบกำหนด ${period.deadline.getDate()} ${TH_MONTH[period.deadline.getMonth()]}`}</span>
        </div>
      )}''', "caption")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
