
# PBMS API

## การติดตั้ง (Installation)

```bash
cp .env.example .env
docker compose up -d --build
docker logs pbms-api
```

1. **`cp .env.example .env`** — คัดลอกไฟล์ตัวอย่าง env มาเป็นไฟล์ `.env` จริงที่โปรเจกต์จะอ่านค่าไปใช้ (เช่น `DB_HOST`, `CLIENT_ID`, `SECRET_KEY`, `PORT` ฯลฯ) จากนั้นต้องแก้ค่าใน `.env` ให้ตรงกับสภาพแวดล้อมจริงก่อนรันขึ้น

2. **`docker compose up -d --build`** — build image ตาม `Dockerfile` (ติดตั้ง dependency ด้วย `npm ci`, `npm run build` แล้ว copy ผลลัพธ์ที่ compile แล้วไปรันด้วย `node dist/main`) แล้ว start container ชื่อ `pbms-api` ขึ้นมาแบบ background (`-d`) โดยดึงค่า env จากไฟล์ `.env` และ map พอร์ตตาม `PORT` ที่ตั้งไว้ (ดู [`docker-compose.yml`](docker-compose.yml))

3. **`docker logs pbms-api`** — ดู log ของ container เพื่อตรวจสอบว่า service เริ่มทำงานปกติหรือไม่ (เช่น เชื่อมต่อฐานข้อมูลสำเร็จ, cron job ลงทะเบียนถูกต้อง) หรือใช้ตรวจ error หากรันไม่ขึ้น

## อัตราครองเตียง (Bed Occupancy Rate)

คำนวณอัตราครองเตียงย้อนหลังแบบรายเดือน (default 12 เดือน) จากข้อมูลผู้ป่วยใน (`ipt` / `iptadm`)

### แหล่งข้อมูล

| ข้อมูล | ที่มา |
|---|---|
| จำนวนเตียงทั้งหมด (`totalBeds`) | เรียก `GET {BED_API_URL}/psych-bed/bed-config` อ่านค่า `resBed.bedCount`; ถ้าเรียกไม่สำเร็จ fallback เป็น `OCCUPANCY_TOTAL_BEDS` ใน `.env` |
| รายชื่อเตียงที่นับ (`bedCodes`) | ดึงจาก `getBeds()` (bed-config API เดียวกัน) ได้ list หมายเลขเตียง (`bedno`) ตาม config การกรอง |
| ข้อมูลผู้ป่วยใน | ตาราง `ipt` (regdate, dchdate, ward) join `iptadm` (bedno) |

### ขั้นตอนคำนวณ (ต่อ 1 เดือน)

ตัดช่วงเป็นเดือนปฏิทิน (`startDate` = วันที่ 1, `endDate` = วันสุดท้ายของเดือน) แล้วสำหรับผู้ป่วยแต่ละคนที่ช่วงการนอนทับซ้อนกับเดือนนั้น คำนวณ `los_days` (จำนวนวันนอนที่ตกอยู่ในเดือนนี้):

```sql
CASE
  -- จำหน่ายจริงในเดือนนี้ → เตียงว่างให้คนไข้คนใหม่ได้ วันจำหน่ายจึงไม่นับเป็นวันเต็ม
  WHEN dchdate IS NOT NULL AND dchdate <= endDate THEN
    DATEDIFF(dchdate, GREATEST(regdate, startDate))
  -- ยังไม่จำหน่ายภายในเดือนนี้ (นอนต่อเดือนถัดไป หรือยังไม่ discharge) → นับ endDate เป็นวันเต็ม (+1)
  ELSE
    DATEDIFF(endDate, GREATEST(regdate, startDate)) + 1
END AS los_days
```

หลักการ: นับแบบ **midnight census** — ผู้ป่วยครองเตียงในวันไหน ดูจาก ณ เที่ยงคืนของวันนั้นยังอยู่ในเตียงหรือไม่
- วันรับเข้า → นับ
- วันจำหน่าย **จริง** → ไม่นับ (เตียงว่างให้คนใหม่ใช้วันเดียวกันได้)
- ยังไม่จำหน่าย (นอนต่อเนื่องข้ามเดือน) → วันสุดท้ายของเดือนต้องนับด้วย เพราะเตียงไม่ได้ว่าง

ผู้ป่วยที่นอนคาบเกี่ยวหลายเดือนจะถูก "ตัด" ให้แต่ละเดือนนับเฉพาะวันที่ตกอยู่ในเดือนนั้น รวมทุกเดือนแล้วเท่ากับจำนวนวันนอนจริงทั้งหมด ไม่มีการนับซ้ำหรือขาดหาย

### สูตรอัตราครองเตียง

```
total_patient_days = SUM(los_days) ของผู้ป่วยทุกคนในเดือนนั้น
days_in_period     = จำนวนวันในเดือนนั้น (DATEDIFF(endDate, startDate) + 1)

bed_occupancy_rate  = total_patient_days × 100 / (totalBeds × days_in_period)
```

### รายเดือนย้อนหลัง

`getMonthlyBedOccupancyRate(months = 12)` สร้างขอบเขตวันที่ของแต่ละเดือนปฏิทิน ย้อนหลังจากเดือนปัจจุบัน (รวมเดือนปัจจุบันเป็นเดือนล่าสุด) แล้วคำนวณสูตรด้านบนแยกทีละเดือนแบบขนาน ผลลัพธ์เป็น array เรียงจากเก่าไปใหม่:

```json
[
  {
    "month": "2025-08",
    "startDate": "2025-08-01",
    "endDate": "2025-08-31",
    "totalPatientDays": 1555,
    "totalBeds": 120,
    "daysInPeriod": 31,
    "bedOccupancyRate": 41.8
  }
]
```

### Endpoints ที่เกี่ยวข้อง

- `GET /send-bed/occupancy-rate?months=12&beds=101,102,103&totalBeds=120` — เรียกดูอัตราครองเตียงรายเดือนแบบ ad-hoc (parameter เป็น optional, ไม่ใส่ = ดึงอัตโนมัติจาก bed-config API)
- Cron (`sendBedData`, ตั้งความถี่ด้วย `SET_SCHEDULE`) — คำนวณอัตราครองเตียงย้อนหลัง 12 เดือน แล้ว `POST` ไปที่ `{BED_API_URL}/bed-occupancy` พร้อมกับส่งสถานะเตียงปัจจุบันไปที่ `{BED_API_URL}/psych-bed/report` ตามเดิม

Implementation: [`src/send-bed/send-bed.service.ts`](src/send-bed/send-bed.service.ts)
