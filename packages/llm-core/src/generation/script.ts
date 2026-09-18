import { ScriptSchema, type Script, type VideoTheme } from "@shorts/contracts";
import { collectVisualTexts, extractNumbers, findUnsupportedNumbers } from "../fact-check.js";
import type { ResearchSource } from "../firecrawl.js";
import { log, type GenerationContext } from "./context.js";
import { fillScene } from "./fill.js";
import { mapLimited } from "./llm-client.js";
import { DEFAULT_SCENE_COUNT, outline } from "./outline.js";
import { planScenes } from "./plan.js";
import { research, type Freshness } from "./research.js";
import { generateTheme } from "./theme.js";

export interface GenerateScriptOptions {
  /** Переопределяет режим свежести, который выбрала модель. */
  readonly freshness?: Freshness;
  readonly sceneCount?: number;
}

export interface GeneratedScript {
  readonly script: Script;
  readonly sources: ResearchSource[];
  /** Сводка источников: нужна потом для пересборки сцен без повторного поиска. */
  readonly brief: string;
  readonly theme: VideoTheme;
  /** Неподтверждённые числа по сценам, в порядке сцен. */
  readonly unverified: string[][];
  readonly freshness: Freshness;
  readonly researchedAt: string;
}

/**
 * Числа сцен, которых нет в источниках. Без источников проверять не по чему —
 * тогда пусто, а не «всё неподтверждено».
 */
export function checkNumbers(
  scenes: readonly { narration: string; visual: unknown }[],
  sources: readonly ResearchSource[],
): string[][] {
  if (sources.length === 0) return scenes.map(() => []);
  const sourceNumbers = extractNumbers(sources.map((s) => `${s.title}\n${s.excerpt}`).join("\n"));
  return scenes.map((scene) =>
    findUnsupportedNumbers([scene.narration, ...collectVisualTexts(scene.visual)], sourceNumbers),
  );
}

/**
 * Тема → сценарий. Этапы маленькие: план из тезисов, раскладка кодом, наполнение
 * по сцене. Поиск и дизайн друг от друга не зависят и идут параллельно.
 */
export async function generateScript(
  ctx: GenerationContext,
  topic: string,
  options: GenerateScriptOptions = {},
): Promise<GeneratedScript> {
  const progress = ctx.onProgress ?? (() => {});
  progress({ stage: "research", message: "Поиск источников и дизайн" });
  const [{ sources, brief, freshness }, theme] = await Promise.all([
    research(ctx, topic, options.freshness),
    generateTheme(ctx, topic),
  ]);

  progress({ stage: "outline", message: "План ролика" });
  const { title, beats } = await outline(ctx, topic, brief, options.sceneCount ?? DEFAULT_SCENE_COUNT);

  const plans = planScenes(beats);
  log(
    ctx,
    `план: ${plans.map((p) => (p.hero ? `composed/${p.hero}/${p.skeleton}` : p.kind)).join(", ")}`,
  );

  let done = 0;
  progress({ stage: "fill", message: "Сцены", done, total: beats.length });
  const visuals = await mapLimited(beats, ctx.concurrency ?? 2, async (beat, index) => {
    const visual = await fillScene(ctx, { topic, narration: beat.narration, brief, plan: plans[index]!, index });
    done++;
    progress({ stage: "fill", message: "Сцены", done, total: beats.length });
    return visual;
  });

  const script = ScriptSchema.parse({
    title,
    fps: 30,
    scenes: beats.map((beat, index) => ({
      id: `scene-${index + 1}`,
      intent: beat.intent,
      narration: beat.narration,
      visual: visuals[index],
    })),
  });

  progress({ stage: "check", message: "Проверка чисел" });
  const unverified = checkNumbers(script.scenes, sources);
  unverified.forEach((numbers, index) => {
    if (numbers.length > 0) log(ctx, `проверка: scene ${index + 1} — нет в источниках: ${numbers.join(", ")}`);
  });

  return { script, sources, brief, theme, unverified, freshness, researchedAt: ctx.today };
}
