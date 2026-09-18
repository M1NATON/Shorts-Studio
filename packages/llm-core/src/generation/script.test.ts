import { describe, expect, it } from "vitest";
import { ScriptSchema } from "@shorts/contracts";
import { collectStreamContent, createOpenAiCompatibleClient } from "./llm-client.js";
import { parseResearchPlan } from "./research.js";
import { checkNumbers, generateScript } from "./script.js";
import { fakeLlm, testContext } from "./test-helpers.js";

const BEATS = [
  { narration: "Batteries got ninety percent cheaper in a decade.", intent: "hook" },
  { narration: "Packs cost 115 dollars per kWh in 2024.", intent: "number" },
  { narration: "Three forces drove the price down.", intent: "list" },
  { narration: "Old chemistry versus new chemistry.", intent: "contrast" },
  { narration: "Factories got enormous.", intent: "fact" },
  { narration: "Mining, refining, cell making, packing.", intent: "sequence" },
  { narration: "Cheap storage changes the grid.", intent: "takeaway" },
];

const llm = fakeLlm((req) => {
  if (req.system.includes("visual identity")) return { error: "no theme today" };
  if (req.system.includes("plan informative")) return { title: "Why batteries got cheap", beats: BEATS };
  if (req.system.includes("composing blocks")) {
    return { blocks: [{ block: "icon", icon: "zap", at: 0 }, { block: "caption", text: "Scale", at: 0.4 }] };
  }
  if (req.system.includes("Scene kind: timeline")) {
    return { steps: [{ label: "Mine", text: "Lithium ore" }, { label: "Refine", text: "Battery grade" }] };
  }
  if (req.system.includes("Scene kind: outro-cta")) return { text: "Storage is the story" };
  return { variant: "statement", text: "Batteries got 90% cheaper" };
});

describe("generateScript", () => {
  it("собирает валидный сценарий, сохраняет замысел и отчитывается по этапам", async () => {
    const stages: string[] = [];
    const ctx = testContext(llm, { onProgress: (p) => stages.push(`${p.stage}${p.done !== undefined ? `:${p.done}/${p.total}` : ""}`) });
    const result = await generateScript(ctx, "Batteries");

    expect(ScriptSchema.safeParse(result.script).success).toBe(true);
    expect(result.script.scenes).toHaveLength(7);
    expect(result.script.scenes[1]!.intent).toBe("number");
    expect(result.theme.mood).toBeDefined(); // откат на дефолтную тему
    expect(result.freshness).toBe("evergreen");
    expect(result.researchedAt).toBe("2026-09-18");
    expect(stages).toContain("fill:7/7");
    expect(stages.at(-1)).toBe("check");
    expect(ctx.logs.some((l) => l.includes("ключ Firecrawl не задан"))).toBe(true);
  });
});

describe("checkNumbers", () => {
  it("без источников ничего не помечает", () => {
    expect(checkNumbers([{ narration: "Costs 115 dollars", visual: {} }], [])).toEqual([[]]);
  });
  it("помечает число, которого нет в источниках", () => {
    const sources = [{ url: "https://x.test", title: "Prices", excerpt: "Packs averaged 115 $/kWh.", kind: "web" as const }];
    expect(checkNumbers([{ narration: "Packs cost 139 dollars", visual: { value: 115 } }], sources)).toEqual([["139"]]);
  });
});

describe("parseResearchPlan", () => {
  it("отбрасывает мусорные запросы и неизвестный режим", () => {
    expect(parseResearchPlan({ freshness: "urgent", queries: ["a", 5, " ", "b"] })).toEqual({ freshness: "evergreen", queries: ["a", "b"] });
    expect(parseResearchPlan({ queries: [] })).toBeUndefined();
    expect(parseResearchPlan("nope")).toBeUndefined();
  });
});

describe("llm client", () => {
  async function* chunks(...parts: string[]) {
    for (const part of parts) yield new TextEncoder().encode(part);
  }

  it("склеивает content из SSE, в том числе кадр, разрезанный между чанками", async () => {
    const text = await collectStreamContent(
      chunks('data: {"choices":[{"delta":{"content":"{\\"a\\""}}]}\ndata: {"choices":[{"del', 'ta":{"content":":1}"}}]}\ndata: [DONE]\n'),
    );
    expect(text).toBe('{"a":1}');
  });

  it("ключ уходит только в заголовок, HTTP-ошибка без тела ответа", async () => {
    let seen: RequestInit | undefined;
    const client = createOpenAiCompatibleClient({
      baseUrl: "https://llm.test/v1",
      apiKey: "test-key",
      model: "m",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = init;
        return new Response("secret details", { status: 504 });
      }) as unknown as typeof fetch,
    });
    await expect(client.askJson({ system: "s", user: "u" })).rejects.toThrow(/^LLM HTTP 504$/);
    expect((seen!.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(String(seen!.body)).not.toContain("test-key");
  });
});
