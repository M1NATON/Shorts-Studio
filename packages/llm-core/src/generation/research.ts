import { z } from "zod";
import { buildResearchBrief, searchMany, type ResearchSource } from "../firecrawl.js";
import { log, type GenerationContext } from "./context.js";

export type Freshness = "current" | "evergreen";

export interface ResearchResult {
  readonly sources: ResearchSource[];
  /** Сводка для промптов; пустая строка, если источников нет. */
  readonly brief: string;
  readonly freshness: Freshness;
}

export function researchSystem(today: string): string {
  const year = today.slice(0, 4);
  return [
    "You plan web research for one informative short video. Return JSON only:",
    '{ "freshness": "current" | "evergreen", "queries": [3 or 4 search queries] }',
    "",
    `Today is ${today}.`,
    '"current": the topic depends on recent events, prices, releases, rankings or statistics',
    'that change within a year. "evergreen": science, history, how things work.',
    "Queries: short keyword queries in English (max 10 words), each from a different angle:",
    `the latest figures or news (include ${year}), key statistics, an authoritative explainer.`,
  ].join("\n");
}

const ResearchPlanSchema = z.object({
  freshness: z.enum(["current", "evergreen"]).catch("evergreen"),
  queries: z.array(z.unknown()).catch([]),
});

/** Разбор ответа модели: мусорные запросы отбрасываются, а не валят этап. */
export function parseResearchPlan(raw: unknown): { freshness: Freshness; queries: string[] } | undefined {
  const parsed = ResearchPlanSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const queries = parsed.data.queries
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim().slice(0, 200))
    .slice(0, 4);
  return queries.length > 0 ? { freshness: parsed.data.freshness, queries } : undefined;
}

/**
 * Поиск источников в два шага: модель составляет запросы и решает, насколько тема
 * зависит от свежести, код ищет по всем запросам сразу.
 *
 * Один запрос по сырой теме находил одну грань и без даты: модель получала
 * прошлогоднюю статью и подавала её цифры как сегодняшние. Для «current»-тем
 * включаются новости и фильтр «за последний год», источники идут от новых к старым.
 */
export async function research(
  ctx: GenerationContext,
  topic: string,
  freshnessOverride?: Freshness,
): Promise<ResearchResult> {
  const empty: ResearchResult = { sources: [], brief: "", freshness: freshnessOverride ?? "evergreen" };
  if (!ctx.firecrawlApiKey) {
    log(ctx, "research: ключ Firecrawl не задан, факты только из модели");
    return empty;
  }

  let plan: { freshness: Freshness; queries: string[] } = {
    freshness: "evergreen",
    queries: [topic, `${topic} ${ctx.today.slice(0, 4)}`],
  };
  try {
    // Таймаут как у остальных этапов: прокси отдаёт первый байт медленно даже на коротком ответе.
    const raw = await ctx.llm.askJson({
      system: researchSystem(ctx.today),
      user: `Video topic: ${topic}`,
      maxTokens: 400,
      timeoutMs: 180000,
    });
    plan = parseResearchPlan(raw) ?? plan;
  } catch (error) {
    log(ctx, `research: запросы по умолчанию (${(error as Error).message})`);
  }
  const freshness = freshnessOverride ?? plan.freshness;
  log(ctx, `research: ${freshness}, запросы: ${plan.queries.map((q) => `«${q}»`).join(", ")}`);

  try {
    const sources = await searchMany({
      queries: plan.queries,
      apiKey: ctx.firecrawlApiKey,
      limit: 3,
      maxSources: 6,
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      ...(freshness === "current" ? { news: true, recency: "year" as const } : {}),
    });
    const dated = sources.filter((s) => s.publishedAt).length;
    log(ctx, `research: ${sources.length} источников, с датой ${dated}`);
    return { sources, brief: buildResearchBrief(sources), freshness };
  } catch (error) {
    log(ctx, `research: пропущен (${(error as Error).message})`);
    return { ...empty, freshness };
  }
}
