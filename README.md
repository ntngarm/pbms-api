docker run -d --name pbms-api --env-file .env -p 8789:8789 --restart unless-stopped pbms-api


สรุป — การดึง/คำนวณอัตราครองเตียง

ดึงข้อมูลจากไหนบ้าง:

จำนวนเตียง (totalBeds) — เรียก API psych-bed/bed-config จากค่าที่ตั้งค่าไว้หน้าเว็บ
รายชื่อเตียง (bedCodes) — ได้ list หมายเลขเตียง (bedno) ตาม config การกรอง ข้อมูลผู้ป่วยใน — query ตาราง ipt/iptadm ตามช่วงวันที่และ bedCodes ข้างต้น
คำนวณยังไง (ต่อ 1 เดือน):

แต่ละ visit คำนวณ los_days = จำนวนวันนอนที่ "ทับซ้อน" กับเดือนนั้น (ตัดวันรับเข้า/จำหน่ายให้อยู่ในขอบเขตเดือน ด้วย GREATEST/LEAST)
รวม los_days ทุกคน = total_patient_days
days_in_period = จำนวนวันในเดือนนั้น
bed_occupancy_rate = total_patient_days × 100 / (totalBeds × days_in_period)
ทำยังไงให้ได้ 12 เดือน: สร้างขอบเขตวันที่ของ 12 เดือนปฏิทินย้อนหลังจากเดือนปัจจุบัน แล้วรันสูตรข้างบนแยกทีละเดือนแบบขนาน ได้ผลลัพธ์เป็น array พร้อม field month (เช่น 2025-08)

ใช้ที่ไหน: cron (sendBedData) เรียกทุกรอบตามที่ตั้งไว้ → คำนวณ 12 เดือน → POST ไปที่ {apiUrl}/bed-occupancy