/**
 * Клиент модели для генерации.
 *
 * Интерфейс, а не функция с process.env: сервер и CLI создают клиент из своих
 * настроек, тесты подставляют заглушку со сценарием ответов. Ключ живёт только
 * внутри клиента и никуда не логируется.
 */

export interface LlmRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly temperature?: number;
}

export interface LlmClient {
  /** Ответ-объект JSON. Бросает при HTTP-ошибке, таймауте или невалидном JSON. */
  askJson(request: LlmRequest): Promise<unknown>;
}

export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetchImpl?: typeof fetch;
}

/** Собирает content из SSE-стрима OpenAI-совместимого ответа. */
export async function collectStreamContent(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
      content += parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      // неполный кадр — придёт в следующем чанке
    }
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(consume);
  }
  consume(buffer);
  return content;
}

/**
 * Клиент OpenAI-совместимого прокси.
 *
 * Стриминг обязателен: прокси обрывает соединение, если ответ не начал поступать
 * за 30 с, а reasoning-модель думает дольше. Стрим отдаёт первый байт сразу.
 */
export function createOpenAiCompatibleClient(options: OpenAiCompatibleOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async askJson({ system, user, maxTokens = 1500, timeoutMs = 180000, temperature = 0.8 }) {
      const res = await fetchImpl(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature,
          stream: true,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`);
      const content = await collectStreamContent(res.body as unknown as AsyncIterable<Uint8Array>);
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new Error(`LLM returned non-JSON (${content.length} chars)`);
      }
    },
  };
}

/** Выполняет задачи не больше `limit` одновременно: прокси отдаёт 504 уже на трёх. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}
