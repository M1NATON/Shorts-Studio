import type { GenerationContext } from "./context.js";
import type { LlmClient, LlmRequest } from "./llm-client.js";

/**
 * Модель-заглушка: ответ выбирается по промпту. Запросы записываются, чтобы
 * проверять, что именно ушло в модель (пожелание, скелет, замечания).
 */
export function fakeLlm(respond: (request: LlmRequest, call: number) => unknown): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async askJson(request) {
      calls.push(request);
      const answer = respond(request, calls.length);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

export function testContext(llm: LlmClient, extra: Partial<GenerationContext> = {}): GenerationContext & { logs: string[] } {
  const logs: string[] = [];
  return { llm, today: "2026-09-18", log: (m) => logs.push(m), logs, ...extra };
}
