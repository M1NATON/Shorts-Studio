import { describe, expect, it } from "vitest";
import { buildResearchBrief, extractFactualExcerpt, parseSearchResponse, searchSources } from "./firecrawl.js";

const MARKDOWN = [
  "# Measuring the environmental impact of AI inference",
  "",
  "We are sharing our methodology today because transparency matters to everyone.",
  "The median Gemini Apps text prompt uses 0.24 watt-hours of energy and 0.26 ml of water.",
  "That is less than nine seconds of television viewing for a single prompt request.",
  "![chart](https://example.com/chart.png)",
  "Read more in [the full paper](https://example.com/paper).",
].join("\n");

describe("extractFactualExcerpt", () => {
  it("оставляет предложения с числами и снимает markdown-разметку", () => {
    const excerpt = extractFactualExcerpt(MARKDOWN);
    expect(excerpt).toContain("0.24 watt-hours");
    // Предложение без цифр («nine seconds») отбрасывается: фильтр числовой, а не смысловой.
    expect(excerpt).not.toContain("nine seconds");
    expect(excerpt).not.toContain("transparency matters");
    expect(excerpt).not.toContain("![");
    expect(excerpt).not.toContain("https://example.com/paper");
  });

  it("не выходит за лимит символов", () => {
    expect(extractFactualExcerpt(MARKDOWN, 90).length).toBeLessThanOrEqual(90);
  });

  it("если чисел нет, берёт текст как есть", () => {
    const excerpt = extractFactualExcerpt("Plain prose without any figures at all.");
    expect(excerpt).toContain("Plain prose");
  });
});

describe("parseSearchResponse", () => {
  const payload = {
    data: {
      web: [
        { url: "https://a.example/page", title: "A", markdown: MARKDOWN },
        { url: "", title: "broken", markdown: MARKDOWN },
        { title: "no url", markdown: MARKDOWN },
        { url: "https://b.example/page", description: "Costs fell by 40 percent in 2025 across the board." },
      ],
    },
  };

  it("пропускает записи без url", () => {
    expect(parseSearchResponse(payload).map((s) => s.url)).toEqual([
      "https://a.example/page",
      "https://b.example/page",
    ]);
  });

  it("подставляет url вместо отсутствующего заголовка", () => {
    const sources = parseSearchResponse({ data: { web: [{ url: "https://c.example", markdown: MARKDOWN }] } });
    expect(sources[0]!.title).toBe("https://c.example");
  });

  it("переживает пустой и неожиданный ответ", () => {
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ data: { web: "nope" } })).toEqual([]);
    expect(parseSearchResponse(null)).toEqual([]);
  });
});

describe("buildResearchBrief", () => {
  it("нумерует источники и оставляет ссылки", () => {
    const brief = buildResearchBrief(parseSearchResponse({ data: { web: [{ url: "https://a.example", title: "A", markdown: MARKDOWN }] } }));
    expect(brief).toContain("[1] A");
    expect(brief).toContain("https://a.example");
  });

  it("на пустом списке возвращает пустую строку", () => {
    expect(buildResearchBrief([])).toBe("");
  });
});

describe("searchSources", () => {
  it("бросает на HTTP-ошибке, а не отдаёт пустой список", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 402 })) as unknown as typeof fetch;
    await expect(searchSources({ query: "q", apiKey: "k", fetchImpl })).rejects.toThrow(/402/);
  });

  it("передаёт ключ в заголовке и просит markdown", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ data: { web: [{ url: "https://a.example", markdown: MARKDOWN }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const sources = await searchSources({ query: "energy per prompt", apiKey: "secret-key", fetchImpl });

    expect(sources).toHaveLength(1);
    expect(captured!.url).toContain("/search");
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(String(captured!.init.body)).toContain("markdown");
  });
});
