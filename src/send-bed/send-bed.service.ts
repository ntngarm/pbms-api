import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DatabaseService } from 'src/database/database.service';
import { BED_API_URL } from 'src/constants';

export interface BedRow {
  id: number;
  bed_no: string;
  ward: string;
  status: string;
  patient_hn: string | null;
  updated_at: Date;
}

export interface BedOccupancyRow {
  month: string; // YYYY-MM
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalPatientDays: number;
  totalBeds: number;
  daysInPeriod: number;
  bedOccupancyRate: number;
}

@Injectable()
export class SendBedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SendBedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private db: DatabaseService,
  ) {}

  onApplicationBootstrap() {
    const minutes = this.config.get<number>('schedule', 60);
    const cronExpression = `0 */${minutes} * * * *`;
    console.log(`Registering cron job with expression: ${cronExpression}`);
    const job = new CronJob(
      cronExpression,
      () => void this.handleCronSendBed(),
    );
    this.schedulerRegistry.addCronJob('send-bed', job);
    job.start();
    this.logger.log(`Cron registered: every ${minutes} minutes`);
    void this.handleCronSendBed();
  }

  async getBeds() {
    const apiUrl = BED_API_URL;
    const clientId = this.config.get<string>('client.id');
    const secretKey = this.config.get<string>('client.secretKey');

    try {
      const response = await axios.get(`${apiUrl}/psych-bed/bed-config`, {
        headers: {
          'x-client-id': clientId,
          'x-secret-key': secretKey,
        },
      });
      if (response.data.statusCode == 200) {
        const resBed = response.data.results;
        
        if (resBed.filterMode == 'BED_ID_LIST') {
          const bedIds: string[] = resBed.bedIds;
          if (!bedIds || bedIds.length === 0) return [];
          const placeBed = bedIds.map((id) => `'${id}'`).join(', ');
          const sql = `SELECT
          b.bedno,
          w.name AS wardName,
          vs.pdx,
          vs.dx0,
          vs.dx1,
          vs.dx2,
          vs.dx3,
          vs.dx4,
          vs.dx5,
          IF(
            EXISTS (
              SELECT
                1
              FROM
                iptadm a
                INNER JOIN ipt ON ipt.an = a.an
              WHERE
                a.bedno = b.bedno
                AND ipt.confirm_discharge = 'N'
            ),
            0,
            1
          ) AS statusBed
        FROM
          bedno b
          LEFT JOIN iptadm ia ON b.bedno = ia.bedno
          AND ia.an = (
            SELECT
              i2.an
            FROM
              iptadm a2
              INNER JOIN ipt i2 ON i2.an = a2.an
            WHERE
              a2.bedno = b.bedno
            ORDER BY
              i2.regdate DESC,
              i2.regtime DESC
            LIMIT
              1
          )
          LEFT JOIN ipt i ON ia.an = i.an
          LEFT JOIN ovst o ON i.vn = o.vn
          LEFT JOIN vn_stat vs ON o.vn = vs.vn
          LEFT JOIN roomno r ON r.roomno = b.roomno
          LEFT JOIN ward w ON r.ward = w.ward
        WHERE
          b.bedno IN (${placeBed})`;
          // console.log(sql)
          const query: any = await this.db.query(sql);
          return query;
        } else if (resBed.filterMode == 'ALL') {
          const placeWard = resBed?.includedWardCodes
            ?.map((id) => `'${id}'`)
            .join(', ');
          const sql = `
          SELECT
            b.bedno,
            w.name AS wardName,
            vs.pdx,
            vs.dx0,
            vs.dx1,
            vs.dx2,
            vs.dx3,
            vs.dx4,
            vs.dx5,
            IF(
              EXISTS (
                SELECT
                  1
                FROM
                  iptadm a
                  INNER JOIN ipt ON ipt.an = a.an
                WHERE
                  a.bedno = b.bedno
                  AND ipt.confirm_discharge = 'N'
              ),
              0,
              1
            ) AS statusBed
          FROM
            bedno b
            LEFT JOIN iptadm ia ON b.bedno = ia.bedno
            AND ia.an = (
              SELECT
                i2.an
              FROM
                iptadm a2
                INNER JOIN ipt i2 ON i2.an = a2.an
              WHERE
                a2.bedno = b.bedno
              ORDER BY
                i2.regdate DESC,
                i2.regtime DESC
              LIMIT
                1
            )
            LEFT JOIN ipt i ON ia.an = i.an
            LEFT JOIN ovst o ON i.vn = o.vn
            LEFT JOIN vn_stat vs ON o.vn = vs.vn
            LEFT JOIN roomno r ON r.roomno = b.roomno
            LEFT JOIN ward w ON r.ward = w.ward
          WHERE
            w.ward IN(${placeWard})`;
          // console.log(sql)
          const query: any = await this.db.query(sql);
          return { beds: query, config: response.data.results };
        }
      }
    } catch (error: any) {
      console.log(error.message);
      return null;
    }

    return [];
  }

  // จำนวนเตียงจริง — ดึงจาก resBed.bedCount (bed-config API) โดยตรง, fallback เป็นค่า config ถ้าเรียก API ไม่สำเร็จ
  private async resolveTotalBeds(totalBeds?: number): Promise<number> {
    if (totalBeds !== undefined) return totalBeds;

    const apiUrl = BED_API_URL;
    const clientId = this.config.get<string>('client.id');
    const secretKey = this.config.get<string>('client.secretKey');

    try {
      const response = await axios.get(`${apiUrl}/psych-bed/bed-config`, {
        headers: {
          'x-client-id': clientId,
          'x-secret-key': secretKey,
        },
      });
      const bedCount = response.data?.results?.bedCount;
      if (response.data.statusCode == 200 && typeof bedCount === 'number') {
        return bedCount;
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to fetch bedCount from bed-config, falling back to config default: ${error.message}`,
      );
    }

    return this.config.get<number>('occupancy.totalBeds', 0);
  }

  // รายชื่อเตียงที่ใช้คำนวณอัตราครองเตียง — ดึงจาก bed-config API เดียวกับ getBeds()
  private async getConfiguredBedCodes(): Promise<string[]> {
    const rawBeds = await this.getBeds();
    if (rawBeds === null) return [];
    const bedsArray = Array.isArray(rawBeds) ? rawBeds : (rawBeds?.beds ?? []);
    return bedsArray
      .map((row: { bedno: string }) => row.bedno)
      .filter(Boolean);
  }

  // อัตราครองเตียงของช่วงวันที่ที่กำหนด (1 ช่วง = 1 แถวผลลัพธ์)
  async getBedOccupancyRateForPeriod(
    startDate: string,
    endDate: string,
    bedCodes: string[],
    totalBedsInput?: number,
  ): Promise<Omit<BedOccupancyRow, 'month'>> {
    const totalBeds = await this.resolveTotalBeds(totalBedsInput);

    if (bedCodes.length === 0) {
      const daysInPeriod =
        Math.round(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) /
            86400000,
        ) + 1;
      return {
        startDate,
        endDate,
        totalPatientDays: 0,
        totalBeds,
        daysInPeriod,
        bedOccupancyRate: 0,
      };
    }

    const bedPlaceholders = bedCodes.map(() => '?').join(', ');
    const sql = `
      SELECT
        SUM(sub.los_days) AS total_patient_days,
        ? AS total_beds,
        (DATEDIFF(?, ?) + 1) AS days_in_period,
        ROUND(
          (SUM(sub.los_days) * 100)
          / (? * (DATEDIFF(?, ?) + 1)),
          2
        ) AS bed_occupancy_rate
      FROM (
        SELECT
          i.an,
          i.ward,
          i.regdate,
          i.dchdate,
          CASE
            -- จำหน่ายจริงในช่วงนี้ → เตียงว่างให้คนไข้คนใหม่ได้ วันจำหน่ายจึงไม่นับเป็นวันเต็ม
            WHEN i.dchdate IS NOT NULL AND i.dchdate <= ? THEN
              DATEDIFF(i.dchdate, GREATEST(i.regdate, ?))
            -- ยังไม่จำหน่ายภายในช่วงนี้ → คนไข้ยังครองเตียงถึงเที่ยงคืนของวันสุดท้าย จึงนับ endDate เป็นวันเต็ม (+1)
            ELSE
              DATEDIFF(?, GREATEST(i.regdate, ?)) + 1
          END AS los_days
        FROM ipt i
        LEFT JOIN iptadm ia ON i.an = ia.an
        WHERE
          ia.bedno IN (${bedPlaceholders})
      ) AS sub
    `;

    const params = [
      totalBeds,
      endDate,
      startDate, // days_in_period
      totalBeds,
      endDate,
      startDate, // denominator
      endDate, // dchdate <= endDate (จำหน่ายจริงในช่วงนี้ไหม)
      startDate, // GREATEST(regdate, startDate) — กรณีจำหน่ายจริง
      endDate, // DATEDIFF(endDate, ...) — กรณียังไม่จำหน่าย
      startDate, // GREATEST(regdate, startDate) — กรณียังไม่จำหน่าย
      endDate, // regdate <= endDate
      startDate, // dchdate >= startDate
      ...bedCodes,
    ];

    const rows = await this.db.query<{
      total_patient_days: number | null;
      total_beds: number;
      days_in_period: number;
      bed_occupancy_rate: number | null;
    }>(sql, params);

    const row = rows[0];
    return {
      startDate,
      endDate,
      totalPatientDays: Number(row?.total_patient_days ?? 0),
      totalBeds,
      daysInPeriod: Number(row?.days_in_period ?? 0),
      bedOccupancyRate: Number(row?.bed_occupancy_rate ?? 0),
    };
  }

  // อัตราครองเตียงรายเดือน ย้อนหลัง N เดือน (เดือนปัจจุบันนับเป็นเดือนล่าสุด)
  async getMonthlyBedOccupancyRate(
    months = 12,
    bedCodesInput?: string[],
    totalBedsInput?: number,
  ): Promise<BedOccupancyRow[]> {
    // resolve ครั้งเดียว แล้วส่งต่อทุกเดือน กัน call bed-config API ซ้ำ 12 ครั้ง
    const [bedCodes, totalBeds] = await Promise.all([
      bedCodesInput ?? this.getConfiguredBedCodes(),
      this.resolveTotalBeds(totalBedsInput),
    ]);
    const now = new Date();

    const periods = Array.from({ length: months }, (_, idx) => {
      const offset = months - 1 - idx;
      const first = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const last = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
      return {
        month: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`,
        startDate: this.formatDate(first),
        endDate: this.formatDate(last),
      };
    });

    const results = await Promise.all(
      periods.map(({ startDate, endDate }) =>
        this.getBedOccupancyRateForPeriod(
          startDate,
          endDate,
          bedCodes,
          totalBeds,
        ),
      ),
    );

    return periods.map((period, idx) => ({
      month: period.month,
      ...results[idx],
    }));
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async sendBedData(): Promise<{ success: boolean; count: number }> {
    const apiUrl = BED_API_URL;
    const clientId = this.config.get<string>('client.id');
    const secretKey = this.config.get<string>('client.secretKey');

    if (!apiUrl) {
      this.logger.warn('BED_API_URL is not configured');
      return { success: false, count: 0 };
    }
    const rawBeds = await this.getBeds();
    if (rawBeds === null) {
      this.logger.warn('getBeds failed — skipping send to psych-bed/report');
      return { success: false, count: 0 };
    }
    const bedsArray = Array.isArray(rawBeds) ? rawBeds : (rawBeds?.beds ?? []);

    const headers = {
      'x-client-id': clientId,
      'x-secret-key': secretKey,
      'Content-Type': 'application/json',
    };

    const bedCodes = bedsArray.map((row: { bedno: string }) => row.bedno);
    const occupancy = await this.getMonthlyBedOccupancyRate(12, bedCodes);
    try {
      await axios.post(
        `${apiUrl}/bed-occupancy`,
        { data: occupancy },
        { headers },
      );
      this.logger.log(
        `Sent ${occupancy.length} bed occupancy records to ${apiUrl}/bed-occupancy`,
      );
    } catch (err: any) {
      this.logger.error(
        'sendBedOccupancyRate POST failed',
        err.response?.data ?? err.message,
      );
    }

    const beds = bedsArray.map(
      (row: {
        bedno: string;
        statusBed: number;
        wardName: string;
        pdx: string;
        dx0: string;
        dx1: string;
        dx2: string;
        dx3: string;
        dx4: string;
        dx5: string;
      }) => ({
        bedName: row.bedno,
        statusAvailable: row.statusBed,
        wardName: row.wardName,
        pdx: row.pdx,
        dx0: row.dx0,
        dx1: row.dx1,
        dx2: row.dx2,
        dx3: row.dx3,
        dx4: row.dx4,
        dx5: row.dx5,
      }),
    );

    try {
      await axios.post(
        `${apiUrl}/psych-bed/report`,
        { beds: beds, sendType: 'API' },
        { headers },
      );
    } catch (err: any) {
      this.logger.error(
        'sendBedData POST failed',
        err.response?.data ?? err.message,
      );
      throw err;
    }

    this.logger.log(
      `Sent ${beds.length} bed records to ${apiUrl}/psych-bed/report`,
    );
    return { success: true, count: beds.length };
  }

  async handleCronSendBed() {
    this.logger.log('Cron: sending bed data...');
    try {
      const result = await this.sendBedData();
      this.logger.log(
        `----------------------------------------Cron: done — sent ${result.count} records----------------------------------------`,
      );
    } catch (err) {
      this.logger.error(
        'Cron: failed to send bed data',
        (err as Error).message,
      );
    }
  }
}
