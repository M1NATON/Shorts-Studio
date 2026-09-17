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
}

export interface SearchOptions {
  readonly query: string;
  readonly apiKey: string;
  readonly limit?: number;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
  /** Подменяется в тестах. */
  readonly fetchImpl?: typeof fetch;
}

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

/** Превращает ответ Firecrawl в источники. Формат ответа: { data: { web: [...] } }. */
export function parseSearchResponse(payload: unknown): ResearchSource[] {
  if (payload === null || typeof payload !== "object") return [];
  const data = (payload as { data?: { web?: unknown[] } }).data;
  const web = Array.isArray(data?.web) ? data.web : [];
  const sources: ResearchSource[] = [];

  for (const item of web) {
    const entry = item as { url?: unknown; title?: unknown; markdown?: unknown; description?: unknown };
    if (typeof entry.url !== "string" || entry.url.length === 0) continue;
    const body = typeof entry.markdown === "string" ? entry.markdown : String(entry.description ?? "");
    const excerpt = extractFactualExcerpt(body);
    if (excerpt.length === 0) continue;
    sources.push({
      url: entry.url,
      title: typeof entry.title === "string" ? entry.title : entry.url,
      excerpt,
    });
  }
  return sources;
}

/** Сводка для промпта: пронумерованные источники, на которые модель может ссылаться. */
export function buildResearchBrief(sources: readonly ResearchSource[]): string {
  if (sources.length === 0) return "";
  return sources
    .map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.excerpt}`)
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
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120000),
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
  return parseSearchResponse(await res.json());
}
