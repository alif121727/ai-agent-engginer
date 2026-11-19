import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { paths, ensureDir } from '../core/fsx.ts';
import { SCHEMA_SQLITE, USERNAME_INDEX } from './schema.ts';

export type Row = Record<string, unknown>;
export type Param = string | number | boolean | null | undefined;

export interface Db {
  kind: 'sqlite' | 'postgres';
  all<T extends Row = Row>(sql: string, params?: Param[]): Promise<T[]>;
  get<T extends Row = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  /** Resolves with the number of rows actually changed. */
  run(sql: string, params?: Param[]): Promise<number>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

function normalize(params: Param[] = []): (string | number | null)[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

class SqliteDb implements Db {
  kind = 'sqlite' as const;
  #db: DatabaseSync;

  constructor(file: string) {
    ensureDir(path.dirname(file));
    this.#db = new DatabaseSync(file);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec('PRAGMA foreign_keys = ON;');
    this.#db.exec(SCHEMA_SQLITE);
    const columns = this.#db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'username')) {
      this.#db.exec('ALTER TABLE users ADD COLUMN username TEXT');
    }
    this.#db.exec(USERNAME_INDEX);
  }

  async all<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T[]> {
    return this.#db.prepare(sql).all(...normalize(params)) as T[];
  }

  async get<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T | undefined> {
    return this.#db.prepare(sql).get(...normalize(params)) as T | undefined;
  }

  async run(sql: string, params: Param[] = []): Promise<number> {
    const result = this.#db.prepare(sql).run(...normalize(params));
    return Number(result.changes ?? 0);
  }

  async exec(sql: string): Promise<void> {
    this.#db.exec(sql);
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PostgresDb implements Db {
  kind = 'postgres' as const;
  #pool: pg.Pool;

  constructor(url: string) {
    this.#pool = new pg.Pool({ connectionString: url });
  }

  async all<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T[]> {
    const res = await this.#pool.query(toPg(sql), normalize(params));
    return res.rows as T[];
  }

  async get<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  async run(sql: string, params: Param[] = []): Promise<number> {
    const result = await this.#pool.query(toPg(sql), normalize(params));
    return result.rowCount ?? 0;
  }

  async exec(sql: string): Promise<void> {
    await this.#pool.query(sql);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

let instance: Db | null = null;

export function openDb(overrides?: { kind?: 'sqlite' | 'postgres'; file?: string; url?: string }): Db {
  const kind = overrides?.kind ?? (process.env.DB_KIND === 'postgres' ? 'postgres' : 'sqlite');
  if (kind === 'postgres') {
    const url = overrides?.url ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DB_KIND=postgres but DATABASE_URL is missing');
    instance = new PostgresDb(url);
    return instance;
  }
  const file = overrides?.file ?? process.env.DB_PATH ?? path.join(paths.data, 'studio.db');
  instance = new SqliteDb(file);
  return instance;
}

export function db(): Db {
  if (!instance) instance = openDb();
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

export function uuid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function now(): string {
  return new Date().toISOString();
}
