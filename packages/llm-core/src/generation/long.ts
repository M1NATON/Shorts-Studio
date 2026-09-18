/**
 * Длинный ролик 16:9 по главам.
 *
 * Те же маленькие шаги, что у Shorts, только на уровень выше: план глав → поиск и
 * тезисы по каждой главе → раскладка кодом → наполнение пачкой на главу. Один
 * запрос «напиши 10-минутный сценарий» модель не вытягивает ни по таймауту, ни по
 * качеству, а ошибка в нём стоила бы всего ролика.
 */
import {
  FORMATS,
  SceneIntentSchema,
  ScriptSchema,
  SceneVisualSpecSchema,
  type SceneVisualSpec,
  type VideoTheme,
} from "@shorts/contracts";
import { z } from "zod";
import { buildResearchBrief, searchMany, type ResearchSource } from "../firecrawl.js";
import { dateRule, log, withFeedback, type GenerationContext } from "./context.js";
import { acceptComposed, fillScene, videoNoun, type SceneFillInput } from "./fill.js";
import { mapLimited } from "./llm-client.js";
import { beatTells, sourcesBlock } from "./outline.js";
import { skill } from "./skills.js";
import { planScenes, SKELETONS, type Beat, type ScenePlan } from "./plan.js";
import { BLOCK_CONTRACT, HERO_EXAMPLE, HERO_HINT, ICON_LIST } from "./prompts.js";
import { research, type Freshness } from "./research.js";
import { checkNumbers, type GeneratedScript } from "./script.js";
import { generateTheme } from "./theme.js";

const PACING = FORMATS.landscape.pacing.narration;
/**
 * Сцен на минуту. Замер на прогоне 16:9: средняя сцена 7.5 с вместе с карточками
 * глав (3 с), поэтому 5 сцен в минуту давали 90 с вместо 2 минут.
 */
const SCENES_PER_MINUTE = 7;

export interface LongVideoOptions {
  readonly minutes?: number;
  readonly freshness?: Freshness;
}

export interface ChapterPlan {
  readonly title: string;
  readonly summary: string;
}

export interface LongOutline {
  readonly title: string;
  readonly hook: Beat[];
  readonly chapters: ChapterPlan[];
  readonly takeaway: Beat;
}

/** Сколько глав и тезисов на главу для заданной длины. */
export function longShape(minutes: number): { chapters: number; beatsPerChapter: number } {
  const scenes = Math.max(8, Math.round(minutes * SCENES_PER_MINUTE));
  const chapters = Math.min(8, Math.max(2, Math.round(minutes / 2)));
  const beatsPerChapter = Math.min(8, Math.max(3, Math.round((scenes - 3) / chapters)));
  return { chapters, beatsPerChapter };
}

const narration = z.string().trim().min(1).max(PACING.hardMax);
const BeatSchema = z.object({ narration, intent: SceneIntentSchema.catch("fact") });

const LongOutlineSchema = z.object({
  title: z.string().trim().min(1).transform((t) => t.slice(0, 120)),
  hook: z.array(BeatSchema).min(1).max(3),
  chapters: z.array(z.object({ title: z.string().trim().min(1).max(60), summary: z.string().trim().min(1).max(400) })).min(2).max(8),
  takeaway: BeatSchema,
});

function narrationRule(): string {
  return [
    `narration: one to three spoken sentences, ${PACING.min}-${PACING.max} characters, hard maximum ${PACING.hardMax}.`,
    "Speech runs at ~13 characters per second: one scene is 6 to 15 seconds.",
  ].join("\n");
}

export async function longOutline(
  ctx: GenerationContext,
  topic: string,
  brief: string,
  chapterCount: number,
): Promise<LongOutline> {
  const system = [
    `You plan an informative ${videoNoun("landscape")} in English. Return JSON:`,
    '{ "title": string max 110, "hook": [1-2 beats], "chapters": [ { "title": max 60, "summary": what the chapter covers, max 300 } ],',
    '  "takeaway": beat }',
    'A beat is { "narration": string, "intent": "hook" | "takeaway" }.',
    `Exactly ${chapterCount} chapters, each a distinct angle, in a logical order.`,
    narrationRule(),
    dateRule(ctx.today),
    "",
    skill("narration"),
  ].join("\n");
  const feedback: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await ctx.llm.askJson({ system, user: withFeedback(`Topic: ${topic}${sourcesBlock(brief)}`, feedback), maxTokens: 2000 });
      const parsed = LongOutlineSchema.safeParse(raw);
      const tells = parsed.success && attempt === 1
        ? beatTells(parsed.data.title, [...parsed.data.hook, parsed.data.takeaway])
        : [];
      if (tells.length > 0) {
        feedback.splice(0, feedback.length, ...tells);
        log(ctx, `главы attempt ${attempt}: штампы: ${tells.join("; ")}`);
        continue;
      }
      if (parsed.success) {
        return {
          ...parsed.data,
          hook: parsed.data.hook.map((b) => ({ ...b, intent: "hook" as const })),
          takeaway: { ...parsed.data.takeaway, intent: "takeaway" as const },
        };
      }
      feedback.splice(0, feedback.length, ...parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`));
    } catch (error) {
      feedback.splice(0, feedback.length);
      log(ctx, `главы attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  throw new Error("long outline failed after 3 attempts");
}

export async function chapterBeats(
  ctx: GenerationContext,
  input: { topic: string; outline: LongOutline; chapterIndex: number; brief: string; count: number },
): Promise<Beat[]> {
  const chapter = input.outline.chapters[input.chapterIndex]!;
  const system = [
    `You write one chapter of an informative ${videoNoun("landscape")}, in English. Return JSON:`,
    '{ "beats": [ { "narration": string, "intent": string } ] }',
    `Exactly ${input.count} beats, each one idea that the next builds on.`,
    narrationRule(),
    `intent: one of ${SceneIntentSchema.options.filter((i) => i !== "hook" && i !== "takeaway").join(", ")}.`,
    'Use "number" only for a real figure from SOURCES; "contrast" for A-versus-B; "list" for 2-4 parallel points;',
    '"sequence" for ordered steps; "punch" for a short striking line; "fact" otherwise. Mix them.',
    "Do not repeat what other chapters cover. Use only facts and numbers from SOURCES.",
    dateRule(ctx.today),
    "",
    skill("narration"),
  ].join("\n");
  const others = input.outline.chapters.map((c, i) => `${i + 1}. ${c.title}${i === input.chapterIndex ? "   <- write this one" : ""}`);
  const user = [
    `Video: ${input.outline.title}`,
    "Chapters:",
    ...others,
    `\nThis chapter: ${chapter.title} — ${chapter.summary}`,
    sourcesBlock(input.brief),
  ].join("\n");
  const Schema = z.object({ beats: z.array(BeatSchema).min(Math.max(2, input.count - 2)) });
  const feedback: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await ctx.llm.askJson({ system, user: withFeedback(user, feedback), maxTokens: 2500 });
      const parsed = Schema.safeParse(raw);
      const tells = parsed.success && attempt === 1 ? beatTells("", parsed.data.beats) : [];
      if (tells.length > 0) {
        feedback.splice(0, feedback.length, ...tells);
        log(ctx, `глава ${input.chapterIndex + 1} attempt ${attempt}: штампы: ${tells.join("; ")}`);
        continue;
      }
      if (parsed.success) {
        // Хук и вывод есть у ролика целиком; внутри главы они превратились бы в шаблонные кадры.
        return parsed.data.beats.slice(0, input.count).map((b) => ({
          narration: b.narration,
          intent: b.intent === "hook" || b.intent === "takeaway" ? "fact" : b.intent,
        }));
      }
      feedback.splice(0, feedback.length, ...parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`));
    } catch (error) {
      feedback.splice(0, feedback.length);
      log(ctx, `глава ${input.chapterIndex + 1} attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  throw new Error(`chapter ${input.chapterIndex + 1}: no beats after 3 attempts`);
}

/** Карточка главы — кодом, без модели: номер и название известны из плана. */
export function chapterCard(index: number, title: string): SceneVisualSpec {
  return SceneVisualSpecSchema.parse({
    kind: "composed",
    layout: "center",
    motion: "fade",
    backdrop: "plain",
    accentShift: 0,
    blocks: [{ block: "chapter", index, title, kicker: `Chapter ${index}` }],
  });
}

/** Озвучка карточки главы: короткая фраза, чтобы у сцены была длительность и голос. */
export const chapterNarration = (index: number, title: string): string => `Chapter ${index}. ${title}.`;

/**
 * Наполнение сцен главы одним запросом. Модель видит всю главу сразу и сама
 * разводит кадры; каждая сцена проверяется отдельно, и только не прошедшие
 * уходят на обычное наполнение по одной — с замечаниями валидатора.
 */
export async function fillChapterBatch(
  ctx: GenerationContext,
  inputs: readonly SceneFillInput[],
): Promise<SceneVisualSpec[]> {
  const composed = inputs.filter((i) => i.plan.kind === "composed" && i.plan.hero);
  const accepted = new Map<number, SceneVisualSpec>();

  if (composed.length > 1) {
    const system = [
      `You design several consecutive scenes of an informative ${videoNoun("landscape")} by composing blocks.`,
      "Each scene is one frame: fewer words than its narration, one idea, a clear focal point.",
      'Return JSON: { "scenes": [ { "blocks": [...] } ] } — one entry per scene, in the given order.',
      'Scenes marked layout "split": heading, caption, badge and quote go to the LEFT column, all other blocks to the RIGHT; use both.',
      "",
      BLOCK_CONTRACT,
      "",
      "Use only facts and numbers from the narration and SOURCES.",
      dateRule(ctx.today),
      `\nAllowed icon values: ${ICON_LIST}`,
      "",
      skill("on-screen"),
    ].join("\n");
    const user = [
      `Video topic: ${composed[0]!.topic}`,
      ...composed.map((input, n) => {
        const hero = input.plan.hero!;
        return [
          `\nScene ${n + 1} (layout ${input.plan.presentation.layout}): "${input.narration}"`,
          `  main block: ${HERO_HINT[hero]}; shape (placeholder values, never copy them) ${JSON.stringify(HERO_EXAMPLE[hero])}`,
          input.plan.skeleton ? `  structure: ${SKELETONS[input.plan.skeleton].hint}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
      composed[0]!.brief ? `\nSOURCES:\n${composed[0]!.brief}` : "",
    ].join("\n");
    try {
      const raw = (await ctx.llm.askJson({ system, user, maxTokens: 900 * composed.length + 400 })) as { scenes?: unknown[] };
      const answers = Array.isArray(raw?.scenes) ? raw.scenes : [];
      composed.forEach((input, n) => {
        const result = acceptComposed(answers[n], input);
        if (result.visual) accepted.set(input.index, result.visual);
        else log(ctx, `scene ${input.index + 1} из пачки: ${result.issues.slice(0, 2).join("; ")} — наполняю отдельно`);
      });
    } catch (error) {
      log(ctx, `пачка сцен ${composed.map((c) => c.index + 1).join(",")}: ${(error as Error).message} — по одной`);
    }
  }

  return mapLimited(inputs, ctx.concurrency ?? 2, async (input) => accepted.get(input.index) ?? fillScene(ctx, input));
}

export interface GeneratedLongScript extends GeneratedScript {
  /** Номер первой сцены каждой главы — для навигации в редакторе и оглавления. */
  readonly chapters: { readonly title: string; readonly firstScene: number }[];
}

/** Поиск по главе: общий поиск по теме находит одну-две грани, а глав шесть. */
async function chapterResearch(ctx: GenerationContext, topic: string, chapter: ChapterPlan): Promise<ResearchSource[]> {
  if (!ctx.firecrawlApiKey) return [];
  try {
    return await searchMany({
      queries: [`${topic} ${chapter.title}`],
      apiKey: ctx.firecrawlApiKey,
      limit: 3,
      maxSources: 3,
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    });
  } catch (error) {
    log(ctx, `поиск по главе «${chapter.title}»: пропущен (${(error as Error).message})`);
    return [];
  }
}

export async function generateLongScript(
  ctx: GenerationContext,
  topic: string,
  options: LongVideoOptions = {},
): Promise<GeneratedLongScript> {
  const progress = ctx.onProgress ?? (() => {});
  const shape = longShape(options.minutes ?? 3);
  progress({ stage: "research", message: "Поиск источников и дизайн" });
  const [{ sources, brief, freshness }, theme]: [Awaited<ReturnType<typeof research>>, VideoTheme] = await Promise.all([
    research(ctx, topic, options.freshness),
    generateTheme(ctx, topic),
  ]);

  progress({ stage: "outline", message: "План глав" });
  const plan = await longOutline(ctx, topic, brief, shape.chapters);
  log(ctx, `главы: ${plan.chapters.map((c) => `«${c.title}»`).join(", ")}`);

  const allSources = [...sources];
  const chapterBriefs: string[] = [];
  const chapterBeatLists: Beat[][] = [];
  let done = 0;
  progress({ stage: "outline", message: "Тезисы глав", done, total: plan.chapters.length });
  // Главы по очереди парами: поиск по главе и тезисы, прокси держит два запроса.
  await mapLimited(plan.chapters, ctx.concurrency ?? 2, async (chapter, index) => {
    const found = await chapterResearch(ctx, topic, chapter);
    for (const source of found) if (!allSources.some((s) => s.url === source.url)) allSources.push(source);
    // Общая сводка по теме + свои источники главы.
    const chapterBrief = buildResearchBrief([...found, ...sources.slice(0, 3)].filter((s, i, all) => all.findIndex((o) => o.url === s.url) === i));
    chapterBriefs[index] = chapterBrief;
    chapterBeatLists[index] = await chapterBeats(ctx, { topic, outline: plan, chapterIndex: index, brief: chapterBrief, count: shape.beatsPerChapter });
    done++;
    progress({ stage: "outline", message: "Тезисы глав", done, total: plan.chapters.length });
  });

  // Раскладка по всем тезисам сразу: разнообразие считается на весь ролик, а не на главу.
  const beats: Beat[] = [...plan.hook, ...chapterBeatLists.flat(), plan.takeaway];
  const plans = planScenes(beats, "landscape");
  type Slot = { kind: "card"; chapter: number } | { kind: "beat"; beat: number; chapter: number };
  const slots: Slot[] = [];
  let cursor = 0;
  plan.hook.forEach(() => slots.push({ kind: "beat", beat: cursor++, chapter: -1 }));
  chapterBeatLists.forEach((list, chapter) => {
    slots.push({ kind: "card", chapter });
    list.forEach(() => slots.push({ kind: "beat", beat: cursor++, chapter }));
  });
  slots.push({ kind: "beat", beat: cursor++, chapter: -1 });

  const fillInputs = (chapter: number): SceneFillInput[] =>
    slots.flatMap((slot, position) =>
      slot.kind === "beat" && slot.chapter === chapter
        ? [{
            topic,
            narration: beats[slot.beat]!.narration,
            brief: chapter >= 0 ? chapterBriefs[chapter]! : brief,
            plan: plans[slot.beat]! as ScenePlan,
            index: position,
            format: "landscape" as const,
          }]
        : [],
    );

  const visuals = new Map<number, SceneVisualSpec>();
  const groups = [-1, ...plan.chapters.map((_, i) => i)];
  let filled = 0;
  for (const group of groups) {
    const inputs = fillInputs(group);
    const result = await fillChapterBatch(ctx, inputs);
    inputs.forEach((input, n) => visuals.set(input.index, result[n]!));
    filled += inputs.length;
    progress({ stage: "fill", message: group >= 0 ? `Глава ${group + 1}` : "Вступление и финал", done: filled, total: beats.length });
  }

  const chapters: { title: string; firstScene: number }[] = [];
  const scenes = slots.map((slot, position) => {
    if (slot.kind === "card") {
      const title = plan.chapters[slot.chapter]!.title;
      chapters.push({ title, firstScene: position });
      return {
        id: `scene-${position + 1}`,
        narration: chapterNarration(slot.chapter + 1, title),
        visual: chapterCard(slot.chapter + 1, title),
      };
    }
    return {
      id: `scene-${position + 1}`,
      intent: beats[slot.beat]!.intent,
      narration: beats[slot.beat]!.narration,
      visual: visuals.get(position)!,
    };
  });

  const script = ScriptSchema.parse({ title: plan.title, fps: 30, format: "landscape", scenes });
  progress({ stage: "check", message: "Проверка чисел" });
  const unverified = checkNumbers(script.scenes, allSources);
  return { script, sources: allSources, brief, theme, unverified, freshness, researchedAt: ctx.today, chapters };
}
