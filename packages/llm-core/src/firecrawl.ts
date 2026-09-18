/**
 * Поиск фактов в сети через Firecrawl.
 *
 * Зачем в пайплайне: без источников модель выдумывает цифры — она уже присылала
 * счётчик «1 required» и статистику без основания. Со сводкой из реальных страниц
 * число в кадре можно проверить по ссылке, а ссылки складываются в манифест.
 */

export interface ResearchSource {
  readonly url: string;
  readonly title: string;
  /** Выжимка из страницы: предложения с числами в исходном порядке. */
  readonly excerpt: string;
  readonly kind: "web" | "news";
  /**
   * Дата публикации YYYY-MM-DD, если её удалось узнать. Без даты модель не отличит
   * прошлогоднюю цифру от сегодняшней.
   */
  readonly publishedAt?: string;
}

/** Насколько свежими должны быть результаты. */
export type SearchRecency = "any" | "week" | "month" | "year";

export interface SearchOptions {
  readonly query: string;
  readonly apiKey: string;
  readonly limit?: number;
  /** Фильтр по давности (Firecrawl `tbs`, `qdr:*`). */
  readonly recency?: SearchRecency;
  /** Искать и в новостях: у них есть дата, и они свежее обычной выдачи. */
  readonly news?: boolean;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
  /** Подменяется в тестах. */
  readonly fetchImpl?: typeof fetch;
}

const RECENCY_TBS: Record<Exclude<SearchRecency, "any">, string> = {
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

const DEFAULT_BASE_URL = "https://api.firecrawl.dev/v2";
const MAX_EXCERPT_CHARS = 900;

/**
 * Выбирает из текста предложения, несущие числа.
 *
 * Для коротких роликов ценны именно измеримые утверждения ("0.24 watt-hours"),
 * а не вводные абзацы. Порядок предложений сохраняется, чтобы не склеить
 * несвязанные куски в ложное утверждение.
 */
export function extractFactualExcerpt(markdown: string, maxChars = MAX_EXCERPT_CHARS): string {
  const plain = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = plain.split(/(?<=[.!?])\s+/);
  const withNumbers = sentences.filter((sentence) => /\d/.test(sentence) && sentence.length > 40);
  const chosen = withNumbers.length > 0 ? withNumbers : sentences;

  let excerpt = "";
  for (const sentence of chosen) {
    if (excerpt.length + sentence.length + 1 > maxChars) break;
    excerpt = excerpt ? `${excerpt} ${sentence}` : sentence;
  }
  return excerpt || plain.slice(0, maxChars);
}

const DAY_MS = 86_400_000;
const RELATIVE_UNITS: Record<string, number> = {
  minute: DAY_MS / 1440,
  hour: DAY_MS / 24,
  day: DAY_MS,
  week: DAY_MS * 7,
  month: DAY_MS * 30,
  year: DAY_MS * 365,
};

/**
 * Дата в YYYY-MM-DD. Новости Firecrawl отдают и ISO, и «3 days ago» — относительную
 * дату считаем от `now`, поэтому функция детерминирована и тестируема.
 */
export function normalizeDate(raw: unknown, now: Date): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const relative = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i.exec(value.trim());
  if (relative) {
    const ms = Number(relative[1]) * RELATIVE_UNITS[relative[2]!.toLowerCase()]!;
    return new Date(now.getTime() - ms).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  const date = new Date(parsed);
  // Дата из будущего — мусор в метаданных страницы, а не свежий факт.
  if (date.getTime() > now.getTime() + DAY_MS) return undefined;
  return date.toISOString().slice(0, 10);
}

/** Ключи метаданных страницы, где сайты кладут дату публикации. */
const DATE_KEYS = [
  "publishedTime",
  "article:published_time",
  "og:article:published_time",
  "datePublished",
  "dcterms.date",
  "date",
  "modifiedTime",
  "article:modified_time",
];

function pageDate(metadata: unknown, now: Date): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const record = metadata as Record<string, unknown>;
  for (const key of DATE_KEYS) {
    const date = normalizeDate(record[key], now);
    if (date) return date;
  }
  return undefined;
}

/** Превращает ответ Firecrawl в источники. Формат: { data: { web: [...], news: [...] } }. */
export function parseSearchResponse(payload: unknown, now: Date = new Date()): ResearchSource[] {
  if (payload === null || typeof payload !== "object") return [];
  const data = (payload as { data?: { web?: unknown[]; news?: unknown[] } }).data;
  const sources: ResearchSource[] = [];

  const collect = (items: unknown, kind: ResearchSource["kind"]) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const entry = item as {
        url?: unknown;
        title?: unknown;
        markdown?: unknown;
        description?: unknown;
        snippet?: unknown;
        date?: unknown;
        metadata?: unknown;
      };
      if (typeof entry.url !== "string" || entry.url.length === 0) continue;
      const body =
        typeof entry.markdown === "string" && entry.markdown.length > 0
          ? entry.markdown
          : String(entry.description ?? entry.snippet ?? "");
      const excerpt = extractFactualExcerpt(body);
      if (excerpt.length === 0) continue;
      const publishedAt = normalizeDate(entry.date, now) ?? pageDate(entry.metadata, now);
      sources.push({
        url: entry.url,
        title: typeof entry.title === "string" ? entry.title : entry.url,
        excerpt,
        kind,
        ...(publishedAt ? { publishedAt } : {}),
      });
    }
  };

  collect(data?.web, "web");
  collect(data?.news, "news");
  return sources;
}

/**
 * Свежие источники первыми, без даты — в конце. Дубликаты по URL убираются:
 * разные запросы по одной теме часто приводят на одну и ту же страницу.
 */
export function rankSources(sources: readonly ResearchSource[], max: number): ResearchSource[] {
  const seen = new Set<string>();
  const unique = sources.filter((source) => {
    const key = source.url.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique
    .map((source, index) => ({ source, index }))
    .sort((a, b) => {
      const da = a.source.publishedAt ?? "";
      const db = b.source.publishedAt ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return a.index - b.index;
    })
    .slice(0, max)
    .map(({ source }) => source);
}

/** Сводка для промпта: пронумерованные источники, на которые модель может ссылаться. */
export function buildResearchBrief(sources: readonly ResearchSource[]): string {
  if (sources.length === 0) return "";
  return sources
    .map((source, index) => {
      const date = source.publishedAt ? `published ${source.publishedAt}` : "date unknown";
      const kind = source.kind === "news" ? "news, " : "";
      return `[${index + 1}] ${source.title} (${kind}${date})\n${source.url}\n${source.excerpt}`;
    })
    .join("\n\n");
}

export async function searchSources(options: SearchOptions): Promise<ResearchSource[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${options.baseUrl ?? DEFAULT_BASE_URL}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: options.query,
      limit: options.limit ?? 4,
      sources: [{ type: "web" }, ...(options.news ? [{ type: "news" }] : [])],
      ...(options.recency && options.recency !== "any" ? { tbs: RECENCY_TBS[options.recency] } : {}),
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120000),
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
  return parseSearchResponse(await res.json());
}

/**
 * Несколько запросов параллельно: один запрос по сырой теме находит одну грань темы,
 * а для ролика нужны и свежие новости, и опорные цифры. Упавший запрос не роняет
 * остальные — источников просто меньше.
 */
export async function searchMany(
  options: Omit<SearchOptions, "query"> & { queries: readonly string[]; maxSources?: number },
): Promise<ResearchSource[]> {
  const { queries, maxSources = 6, ...rest } = options;
  const settled = await Promise.allSettled(queries.map((query) => searchSources({ ...rest, query })));
  const found = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (found.length === 0) {
    const failure = settled.find((result) => result.status === "rejected");
    if (failure) throw (failure as PromiseRejectedResult).reason;
  }
  return rankSources(found, maxSources);
}
