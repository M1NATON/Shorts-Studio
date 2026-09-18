/**
 * Точечная правка: одна сцена ролика пересобирается, остальные не трогаются.
 *
 * Варианты различаются не температурой, а замыслом: у каждого свой главный блок и
 * скелет кадра. Три ответа с одной подсказкой почти одинаковы — выбирать не из чего.
 */
import {
  NARRATION_MAX_CHARS,
  NARRATION_TARGET_CHARS,
  SceneVisualSpecSchema,
  type SceneIntent,
  type SceneVisualSpec,
  type VideoFormat,
} from "@shorts/contracts";
import { z } from "zod";
import { dateRule, log, withFeedback, type GenerationContext } from "./context.js";
import { fillComposed, fillTemplate, narrationHasFigure, type SceneFillInput } from "./fill.js";
import { mapLimited } from "./llm-client.js";
import { sourcesBlock } from "./outline.js";
import { narrationTells, skill } from "./skills.js";
import {
  BACKDROP_BY_HERO,
  DATA_HEROES,
  dataHeroesFor,
  HEROES_BY_INTENT,
  SKELETON_ORDER,
  SKELETONS,
  type HeroBlock,
  type ScenePlan,
  type Skeleton,
} from "./plan.js";

export interface EditableScene {
  readonly narration: string;
  readonly visual: SceneVisualSpec;
  readonly intent?: SceneIntent;
}

export interface RegenerateSceneInput {
  readonly topic: string;
  readonly brief: string;
  readonly scenes: readonly EditableScene[];
  readonly index: number;
  readonly instruction?: string;
  /** Сколько вариантов вернуть: 1–3. */
  readonly variants?: number;
  readonly format?: VideoFormat;
}

export interface SceneVariant {
  readonly visual: SceneVisualSpec;
  /** Чем вариант отличается — подпись под миниатюрой в редакторе. */
  readonly label: string;
}

const ALL_HEROES: readonly HeroBlock[] = ["icon", "quote", "chips", "row", "pair", "ring", "number", "bars", "divider"];

/** Замысел сцены, если он не сохранён: по готовому кадру. */
export function inferIntent(visual: SceneVisualSpec, index: number, total: number): SceneIntent {
  if (index === 0) return "hook";
  if (index === total - 1) return "takeaway";
  switch (visual.kind) {
    case "stat-counter":
      return "number";
    case "comparison":
      return "contrast";
    case "timeline":
      return "sequence";
    case "kinetic-text":
      return "punch";
    case "icon-list":
      return "list";
    case "composed": {
      const types = new Set(visual.blocks.map((b) => b.block));
      if (types.has("ring") || types.has("number") || types.has("bars")) return "number";
      if (types.has("pair")) return "contrast";
      if (types.has("row") || types.has("chips")) return "list";
      return "fact";
    }
    default:
      return "fact";
  }
}

/** В озвучке есть число, которое стоит показать (не год и не «3 причины»). */
export const hasFigure = narrationHasFigure;

/**
 * Замыслы вариантов: главные блоки, которых в текущем кадре нет, по порядку
 * предпочтения замысла, затем остальные. Блоки данных — только если в озвучке есть
 * число: иначе модель его выдумает. Скелеты перебираются по кругу.
 */
export function variantPlans(scene: EditableScene, intent: SceneIntent, count: number): { hero: HeroBlock; skeleton: Skeleton }[] {
  const current = new Set(scene.visual.kind === "composed" ? scene.visual.blocks.map((b) => b.block) : []);
  const figure = hasFigure(scene.narration);
  const fittingData = new Set(dataHeroesFor(scene.narration));
  const candidates = [...HEROES_BY_INTENT[intent], ...ALL_HEROES]
    .filter((hero, i, all) => all.indexOf(hero) === i)
    .filter((hero) => !DATA_HEROES.has(hero) || (figure && fittingData.has(hero)))
    .filter((hero) => hero !== "divider");
  const fresh = candidates.filter((hero) => !current.has(hero));
  const ordered = [...fresh, ...candidates.filter((hero) => current.has(hero))];

  const out: { hero: HeroBlock; skeleton: Skeleton }[] = [];
  const usedData = { value: false };
  for (const hero of ordered) {
    if (out.length >= count) break;
    // Два варианта «кольцо» и «число» — это один вариант с разной обёрткой.
    if (DATA_HEROES.has(hero)) {
      if (usedData.value) continue;
      usedData.value = true;
    }
    const fits = SKELETON_ORDER.filter((s) => SKELETONS[s].fits(hero));
    out.push({ hero, skeleton: fits[out.length % fits.length]! });
  }
  return out;
}

function neighborsOf(scenes: readonly EditableScene[], index: number): SceneFillInput["neighbors"] {
  const out: NonNullable<SceneFillInput["neighbors"]>[number][] = [];
  const prev = scenes[index - 1];
  const next = scenes[index + 1];
  if (prev) out.push({ position: "previous", narration: prev.narration, visual: prev.visual });
  if (next) out.push({ position: "next", narration: next.narration, visual: next.visual });
  return out;
}

/**
 * Варианты нового кадра для одной сцены.
 *
 * С пожеланием первый вариант — «как просили»: главный блок выбирает модель,
 * чтобы «сделай столбцами» не спорило с назначенным кодом кольцом. Остальные
 * варианты — разные главные блоки и скелеты. Подача сцены (композиция, фон,
 * движение) сохраняется: соседние сцены под неё уже подобраны.
 */
export async function regenerateSceneVisual(
  ctx: GenerationContext,
  input: RegenerateSceneInput,
): Promise<SceneVariant[]> {
  const scene = input.scenes[input.index];
  if (!scene) throw new Error(`scene index ${input.index} out of range`);
  const count = Math.min(3, Math.max(1, input.variants ?? 2));
  const intent = scene.intent ?? inferIntent(scene.visual, input.index, input.scenes.length);
  const { layout, motion, backdrop, accentShift } = scene.visual;
  const presentation = { layout, motion, backdrop, accentShift };
  const base: Omit<SceneFillInput, "plan"> = {
    topic: input.topic,
    narration: scene.narration,
    brief: input.brief,
    index: input.index,
    neighbors: neighborsOf(input.scenes, input.index),
    format: input.format ?? "shorts",
    ...(input.instruction?.trim() ? { instruction: input.instruction.trim() } : {}),
  };

  type Job = { label: string; run: () => Promise<SceneVisualSpec> };
  const jobs: Job[] = [];
  if (base.instruction) {
    jobs.push({
      label: "По пожеланию",
      run: () =>
        fillComposed(ctx, {
          ...base,
          freeHero: true,
          plan: { kind: "composed", fallbackKind: "icon-list", presentation },
        }),
    });
  }
  // Шаблонная сцена (хук, финал, таймлайн) получает вариант своего же типа:
  // у них своя подача, и правка текста не должна её отнимать.
  if (scene.visual.kind !== "composed" && jobs.length < count) {
    const kind = scene.visual.kind;
    jobs.push({
      label: "Тот же тип, заново",
      run: () => fillTemplate(ctx, { ...base, plan: { kind, fallbackKind: kind, presentation } }),
    });
  }
  for (const { hero, skeleton } of variantPlans(scene, intent, count - jobs.length)) {
    const plan: ScenePlan = {
      kind: "composed",
      fallbackKind: "icon-list",
      hero,
      skeleton,
      presentation: { ...presentation, backdrop: BACKDROP_BY_HERO[hero] },
    };
    jobs.push({ label: `${hero} · ${skeleton}`, run: () => fillComposed(ctx, { ...base, plan }) });
  }

  log(ctx, `пересборка scene ${input.index + 1}: ${jobs.map((j) => j.label).join(", ")}`);
  const visuals = await mapLimited(jobs, ctx.concurrency ?? 2, (job) => job.run());
  return visuals.map((visual, i) => ({ visual: SceneVisualSpecSchema.parse(visual), label: jobs[i]!.label }));
}

const NarrationSchema = z.object({ narration: z.string().trim().min(1).max(NARRATION_MAX_CHARS) });

/**
 * Новый текст озвучки одной сцены по пожеланию. Соседние фразы в промпте — чтобы
 * новая не повторяла их и связка ролика не рвалась.
 */
export async function rewriteNarration(
  ctx: GenerationContext,
  input: Omit<RegenerateSceneInput, "variants">,
): Promise<string> {
  const scene = input.scenes[input.index];
  if (!scene) throw new Error(`scene index ${input.index} out of range`);
  const system = [
    "You rewrite the narration of one scene in an informative vertical short video, in English.",
    'Return JSON: { "narration": string }',
    `ONE spoken sentence, ${NARRATION_TARGET_CHARS.min}-${NARRATION_TARGET_CHARS.max} characters, hard maximum ${NARRATION_MAX_CHARS}.`,
    "Keep the role of the scene in the video; do not repeat the neighbouring sentences.",
    "Use only facts and numbers from the current narration and SOURCES.",
    dateRule(ctx.today),
    "",
    skill("narration"),
  ].join("\n");
  const user = [
    `Video topic: ${input.topic}`,
    "Video narration, scene by scene:",
    ...input.scenes.map((s, i) => `${i + 1}. ${s.narration}${i === input.index ? "   <- rewrite this one" : ""}`),
    input.instruction?.trim()
      ? `\nUSER REQUEST (highest priority; it may be written in any language): ${input.instruction.trim()}`
      : "\nMake it sharper and more concrete.",
    sourcesBlock(input.brief),
  ].join("\n");

  const feedback: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await ctx.llm.askJson({ system, user: withFeedback(user, feedback), maxTokens: 400, timeoutMs: 180000 });
      const parsed = NarrationSchema.safeParse(raw);
      const tells = parsed.success && attempt === 1 ? narrationTells(parsed.data.narration) : [];
      if (parsed.success && tells.length === 0) return parsed.data.narration;
      if (parsed.success) {
        feedback.splice(0, feedback.length, ...tells);
        continue;
      }
      feedback.splice(0, feedback.length, ...parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`));
    } catch (error) {
      feedback.splice(0, feedback.length);
      log(ctx, `rewrite attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  throw new Error("rewriteNarration: модель не дала валидный текст за три попытки");
}
