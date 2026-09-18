/**
 * Настройки сервера из окружения. Ключи провайдеров живут только здесь и в
 * клиентах, которые из них созданы: в ответы API уходят флаги «настроен / нет»
 * и имена моделей, но не значения ключей.
 */
import path from "node:path";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly storageDir: string;
  readonly dbPath: string;
  readonly llm?: { readonly baseUrl: string; readonly apiKey: string; readonly model: string };
  readonly fish?: { readonly apiKey: string; readonly model: string; readonly referenceId: string };
  readonly firecrawlApiKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const storageDir = path.resolve(cwd, env.STORAGE_DIR ?? "storage");
  return {
    // Только localhost: приложение локальное, на одного пользователя, без авторизации.
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 3001),
    storageDir,
    dbPath: path.resolve(storageDir, env.DB_FILE ?? "studio.sqlite"),
    ...(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL
      ? { llm: { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL } }
      : {}),
    ...(env.FISH_API_KEY && env.FISH_MODEL && env.FISH_REFERENCE_ID
      ? { fish: { apiKey: env.FISH_API_KEY, model: env.FISH_MODEL, referenceId: env.FISH_REFERENCE_ID } }
      : {}),
    ...(env.FIRECRAWL_API_KEY ? { firecrawlApiKey: env.FIRECRAWL_API_KEY } : {}),
  };
}

