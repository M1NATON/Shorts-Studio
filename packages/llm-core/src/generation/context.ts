import type { LlmClient } from "./llm-client.js";

/** Этапы генерации — для прогресса в UI («Наполнение: сцена 4 из 8»). */
export type GenerationStage = "research" | "theme" | "outline" | "plan" | "fill" | "check";

export interface GenerationProgress {
  readonly stage: GenerationStage;
  readonly message: string;
  /** Для этапа по сценам: сколько готово и сколько всего. */
  readonly done?: number;
  readonly total?: number;
}

/**
 * Всё, что генерации нужно снаружи. Дата — параметр, а не `new Date()` внутри:
 * промпты с датой должны быть воспроизводимы в тестах.
 */
export interface GenerationContext {
  readonly llm: LlmClient;
  /** Сегодняшняя дата YYYY-MM-DD: уходит в каждый промпт. */
  readonly today: string;
  /** Ключ Firecrawl. Без него факты только из модели, и об этом пишется в лог. */
  readonly firecrawlApiKey?: string;
  readonly fetchImpl?: typeof fetch;
  /** Сколько запросов к модели одновременно: прокси держит два. */
  readonly concurrency?: number;
  readonly log?: (message: string) => void;
  readonly onProgress?: (progress: GenerationProgress) => void;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Сегодняшняя дата в промпте. Без неё модель пишет «из своего времени»:
 * двухлетняя цифра подаётся как текущая, а «в этом году» означает год её обучения.
 */
export function dateRule(today: string): string {
  return [
    `Today is ${today}. Describe the situation as of today.`,
    "Prefer the most recent figures from SOURCES. If a figure is from an earlier year,",
    'say its year ("in 2023, ..."); never present an old figure as current.',
  ].join("\n");
}

export const log = (ctx: GenerationContext, message: string): void => ctx.log?.(message);

/** Замечания валидатора уходят обратно в промпт: без них модель повторяет ту же ошибку. */
export function withFeedback(user: string, feedback: readonly string[]): string {
  if (feedback.length === 0) return user;
  return `${user}\n\nYour previous answer was rejected:\n${feedback.map((f) => `- ${f}`).join("\n")}\nFix exactly these problems.`;
}

/**
 * Достаёт полезную нагрузку из ответа модели.
 *
 * Модель периодически заворачивает объект: {"visual": {...}} или {"timeline": {...}}.
 * Без разворота это выглядело как «нет поля steps», и сцена уходила в откат.
 */
export function unwrapContent(content: unknown, kind: string): unknown {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  const record = content as Record<string, unknown>;
  if (record.error) throw new Error(`model returned error: ${String(record.error).slice(0, 120)}`);
  for (const key of ["visual", "scene", "data", kind]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return content;
}

export function issuesOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }, max = 4): string[] {
  return error.issues.slice(0, max).map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
}
