import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool as PgPool } from 'pg';
import * as mysql from 'mysql2/promise';

export interface ExecuteResult {
  affectedRows: number;
  insertId?: number;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pgPool: PgPool | null = null;
  private mysqlPool: mysql.Pool | null = null;
  private dbType: string;

  constructor(private config: ConfigService) {
    this.dbType = this.config.get<string>('database.type') ?? 'postgresql';
  }

  async onModuleInit() {
    const db = this.config.get<{
      host: string;
      port: number;
      username: string;
      password: string;
      name: string;
      charset: string;
    }>('database')!;

    if (this.dbType === 'mysql') {
      this.mysqlPool = mysql.createPool({
        host: db.host,
        port: db.port,
        user: db.username,
        password: db.password,
        database: db.name,
        charset: db.charset,
        waitForConnections: true,
        connectionLimit: 10,
      });
    } else {
      this.pgPool = new PgPool({
        host: db.host,
        port: db.port,
        user: db.username,
        password: db.password,
        database: db.name,
        client_encoding: db.charset,
        max: 10,
      });
    }
  }

  async onModuleDestroy() {
    if (this.pgPool) await this.pgPool.end();
    if (this.mysqlPool) await this.mysqlPool.end();
  }

  // แปลง ? → $1, $2, ... สำหรับ PostgreSQL
  private toPgPlaceholders(sql: string): string {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
  }

  // ใช้สำหรับ SELECT — คืน array ของ row
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (this.dbType === 'mysql' && this.mysqlPool) {
      const [rows] = await this.mysqlPool.query(sql, params);
      return rows as T[];
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(this.toPgPlaceholders(sql), params);
      return result.rows as T[];
    }

    throw new Error('Database not initialized');
  }

  // ใช้สำหรับ INSERT / UPDATE / DELETE — คืน affectedRows และ insertId
  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    if (this.dbType === 'mysql' && this.mysqlPool) {
      const [result] = await this.mysqlPool.execute(sql, params as any[]);
      const header = result as mysql.ResultSetHeader;
      return { affectedRows: header.affectedRows, insertId: header.insertId };
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(this.toPgPlaceholders(sql), params);
      return { affectedRows: result.rowCount ?? 0 };
    }

    throw new Error('Database not initialized');
  }
}
