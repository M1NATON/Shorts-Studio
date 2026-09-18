/**
 * Контекст генерации для CLI: клиент модели и ключ поиска из окружения.
 * Значения ключей никуда не выводятся — лог получает только сообщения этапов.
 */
import { createOpenAiCompatibleClient, todayIso } from "@shorts/llm-core";

export function cliContext() {
  for (const name of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]) {
    if (!process.env[name]) throw new Error(`не задана переменная окружения ${name} (запуск: set -a && . ./.env && set +a)`);
  }
  return {
    llm: createOpenAiCompatibleClient({
      baseUrl: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
    }),
    today: todayIso(),
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY || undefined,
    concurrency: 2,
    log: (message) => console.log(`  ${message}`),
  };
}
