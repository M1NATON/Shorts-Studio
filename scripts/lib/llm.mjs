/**
 * Тонкий клиент LLM для скриптов пайплайна.
 *
 * Стриминг обязателен: прокси обрывает соединение, если ответ не начал поступать
 * за 30 с ("Direct response did not start within 30000ms"), а reasoning-модель
 * думает дольше. Стрим отдаёт первый байт сразу.
 *
 * Параллелизм ограничен двумя запросами: на трёх одновременных прокси отдавал 504.
 */

/** Собирает content из SSE-стрима OpenAI-совместимого ответа. */
async function collectStream(res) {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        content += JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
      } catch {
        // неполный кадр — придёт в следующем чанке
      }
    }
  }
  return content;
}

/** Один запрос к модели с ответом-объектом. Бросает при HTTP-ошибке или невалидном JSON. */
export async function askJson({ system, user, maxTokens = 1500, timeoutMs = 120000, temperature = 0.8 }) {
  const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
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
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const content = await collectStream(res);
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`LLM returned non-JSON (${content.length} chars)`);
  }
}

/** Выполняет задачи пачками по `limit` — прокси не держит больше двух запросов. */
export async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
