/**
 * Настройки сервера из окружения. Ключи провайдеров живут только здесь и в
 * клиентах, которые из них созданы: в ответы API уходят флаги «настроен / нет»
 * и имена моделей, но не значения ключей.
 */
import path from "node:path";
import { providersFromEnv, type Providers } from "@shorts/db";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly storageDir: string;
  readonly dbPath: string;
  /** Провайдеры из .env — запасные: сохранённые в UI важнее. .env необязателен. */
  readonly envProviders: Providers;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const storageDir = path.resolve(cwd, env.STORAGE_DIR ?? "storage");
  return {
    // Только localhost: приложение локальное, на одного пользователя, без авторизации.
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 3001),
    storageDir,
    dbPath: path.resolve(storageDir, env.DB_FILE ?? "studio.sqlite"),
    envProviders: providersFromEnv(env),
  };
}

