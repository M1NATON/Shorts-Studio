/**
 * Контекст генерации для CLI. Провайдеры те же, что у студии: сохранённые в
 * Настройках (база в storage/), иначе из .env. .env подхватывается сам, если есть.
 * Значения ключей никуда не выводятся — лог получает только сообщения этапов.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createProviderStore,
  createRepository,
  loadPreferences,
  openDatabase,
  providersFromEnv,
} from "@shorts/db";
import { createOpenAiCompatibleClient, todayIso } from "@shorts/llm-core";

if (existsSync(".env")) process.loadEnvFile(".env");

/** Провайдеры и предпочтения: из базы студии, если она есть, иначе только .env. */
export async function cliSettings() {
  const envProviders = providersFromEnv(process.env);
  const dbPath = path.resolve(process.env.STORAGE_DIR ?? "storage", process.env.DB_FILE ?? "studio.sqlite");
  if (!existsSync(dbPath)) return { providers: envProviders, preferences: undefined };
  const database = openDatabase(dbPath);
  try {
    const repo = createRepository(database);
    return {
      providers: await createProviderStore(repo, envProviders).current(),
      preferences: await loadPreferences(repo),
    };
  } finally {
    database.close();
  }
}

export async function cliContext() {
  const { providers, preferences } = await cliSettings();
  if (!providers.llm) throw new Error("модель не настроена: Настройки → Модель в студии или LLM_* в .env");
  const research = preferences?.research ?? true;
  return {
    llm: createOpenAiCompatibleClient(providers.llm),
    today: todayIso(),
    firecrawlApiKey: research ? providers.search?.apiKey : undefined,
    concurrency: 2,
    log: (message) => console.log(`  ${message}`),
  };
}

/** Настройки озвучки для voiceNarration. */
export async function cliTts() {
  const { providers } = await cliSettings();
  if (!providers.tts) throw new Error("озвучка не настроена: Настройки → Озвучка в студии или FISH_* в .env");
  return providers.tts;
}
