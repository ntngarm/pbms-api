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
          (
            b.bed_status_type_id = 1
            OR b.bed_status_type_id IS NULL
            OR b.bed_status_type_id = ""
          )
          AND b.bedno IN (${placeBed})`;
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
            (
              b.bed_status_type_id = 1
              OR b.bed_status_type_id IS NULL
              OR b.bed_status_type_id = ""
            )
            ${
              placeWard!.length > 0
                ? `AND
              w.ward IN(${placeWard})`
                : ''
            }`;
          console.log(sql);
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

    const beds = bedsArray.map((row: { bedno: string; statusBed: number }) => ({
      bedName: row.bedno,
      statusAvailable: row.statusBed,
    }));

    const headers = {
      'x-client-id': clientId,
      'x-secret-key': secretKey,
      'Content-Type': 'application/json',
    };

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
