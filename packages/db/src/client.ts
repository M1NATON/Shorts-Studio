/**
 * Подключение к SQLite через встроенный node:sqlite и Drizzle (sqlite-proxy).
 *
 * Почему не better-sqlite3: нативная сборка при установке — ещё одно разрешение
 * в allowBuilds и ещё одна точка отказа при обновлении Node. node:sqlite в Node 24
 * встроен и синхронен, Drizzle видит его как асинхронный прокси.
 *
 * Соединение одно на процесс. Запись идёт через `transaction`, который держит
 * мьютекс: между await-ами одной транзакции не вклинится запрос другой задачи.
 */
import { DatabaseSync } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { MIGRATIONS } from "./migrations.js";
import * as schema from "./schema.js";

export type Db = SqliteRemoteDatabase<typeof schema>;

export interface Database {
  readonly db: Db;
  /** Последовательная транзакция: BEGIN … COMMIT под мьютексом, ROLLBACK при ошибке. */
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): void;
  /** Для тестов и диагностики: сырое соединение. */
  readonly raw: DatabaseSync;
}

/** Применяет недостающие миграции. Возвращает номер версии схемы после применения. */
export function migrate(raw: DatabaseSync): number {
  const current = Number((raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let version = current; version < MIGRATIONS.length; version++) {
    raw.exec("BEGIN");
    try {
      raw.exec(MIGRATIONS[version]!);
      raw.exec(`PRAGMA user_version = ${version + 1}`);
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }
  return MIGRATIONS.length;
}

/** `path` — файл базы или ":memory:" для тестов. */
export function openDatabase(path: string): Database {
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") {
    // WAL: сервер пишет прогресс задач, пока UI читает список — без блокировок.
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA busy_timeout = 5000");
  }
  migrate(raw);

  const db = drizzle(
    async (sql, params, method) => {
      const statement = raw.prepare(sql);
      if (method === "run") {
        statement.run(...(params as never[]));
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      if (method === "get") {
        const row = statement.get(...(params as never[]));
        return { rows: (row ?? undefined) as unknown as unknown[] };
      }
      return { rows: statement.all(...(params as never[])) as unknown as unknown[] };
    },
    { schema },
  );

  let queue: Promise<unknown> = Promise.resolve();
  const transaction = <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
    const run = async () => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(db);
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  return { db, transaction, close: () => raw.close(), raw };
}
