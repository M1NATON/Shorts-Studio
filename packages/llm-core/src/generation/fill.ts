/**
 * Наполнение одной сцены: по одному маленькому запросу на сцену, в промпте только
 * контракт нужного типа. Ошибка чинится повтором одной сцены, а не всего сценария.
 *
 * Та же функция пересобирает сцену в редакторе: тогда к запросу добавляются
 * пожелание пользователя и соседние сцены.
 */
import {
  blockSignature,
  BLOCK_TYPES,
  DATA_BLOCKS,
  IconNameSchema,
  SceneVisualSpecSchema,
  visualSpecSchemaFor,
  type Block,
  type IconName,
  type SceneVisualSpec,
  type VideoFormat,
} from "@shorts/contracts";
import { dateRule, issuesOf, log, unwrapContent, withFeedback, type GenerationContext } from "./context.js";
import {
  dataHeroesFor,
  DATA_HEROES,
  heroAlternatives,
  narrationHasFigure,
  SKELETONS,
  type ScenePlan,
} from "./plan.js";
import {
  BLOCK_CONTRACT,
  HERO_EXAMPLE,
  HERO_HINT,
  ICON_LIST,
  KIND_CONTRACT,
  KIND_EXAMPLE,
  NEEDS_ICONS,
} from "./prompts.js";
import { skill } from "./skills.js";

// narrationHasFigure переехала в plan.ts (план тоже должен знать, есть ли цифра),
// но regenerate.ts по-прежнему берёт её отсюда — переэкспортируем.
export { narrationHasFigure };

export interface SceneFillInput {
  readonly topic: string;
  readonly narration: string;
  /** Сводка источников: получает каждая сцена, факт без числа тоже бывает устаревшим. */
  readonly brief: string;
  readonly plan: ScenePlan;
  /** Номер сцены — только для лога. */
  readonly index: number;
  /** Пожелание пользователя из редактора («сделай столбцами», «меньше текста»). */
  readonly instruction?: string;
  /** Соседние сцены: чтобы новый кадр не повторял предыдущий и следующий. */
  readonly neighbors?: readonly { readonly position: "previous" | "next"; readonly narration: string; readonly visual: SceneVisualSpec }[];
  /**
   * Главный блок выбирает модель, а не код. Для варианта «как просил пользователь»:
   * пожелание «сделай столбцами» не должно спорить с назначенным кольцом.
   */
  readonly freeHero?: boolean;
  /** Формат ролика: от него зависят ёмкость кадра и раскладка split. По умолчанию shorts. */
  readonly format?: VideoFormat;
  /** Счётчик попыток/отката для итоговой строки в лог; вызывающий код сам решает, агрегировать или нет. */
  readonly stats?: SceneFillStats;
}

/** Как назвать ролик в промпте. */
export const videoNoun = (format: VideoFormat = "shorts"): string =>
  format === "landscape" ? "horizontal 16:9 explainer video" : "vertical short video";

/** Что модели нужно знать про раскладку split — только для 16:9. */
const SPLIT_NOTE =
  'Layout is "split": heading, caption, badge and quote go to the LEFT column, every other block to the RIGHT column. Use at least one block of each kind; each column holds about 1000px.';

const ATTEMPTS = 3;

/**
 * Счётчик исхода наполнения одной сцены — для итоговой строки в лог после ролика.
 * Объект передаётся по ссылке через SceneFillInput.stats и меняется на месте:
 * так fillTemplate/fillComposed сообщают результат, не меняя сигнатуру fillScene.
 */
export interface SceneFillStats {
  /** На какой попытке кадр прошёл валидацию (без учёта отдельного отката). */
  attempts: number;
  /** Сцена не прошла с планом целиком и откатилась на другой тип/шаблон. */
  fellBack: boolean;
}

/** Отметить успех попытки — но только если сцена ещё не откатилась на другой план. */
function recordAttempt(stats: SceneFillStats | undefined, attempt: number): void {
  if (stats && !stats.fellBack) stats.attempts = attempt;
}

/** Отметить откат сцены на другой тип: это отдельная категория, не «повтор». */
function recordFallback(stats: SceneFillStats | undefined): void {
  if (stats) stats.fellBack = true;
}

const ICON_NAMES = IconNameSchema.options;
/** Нет ни точного, ни близкого совпадения в реестре — нейтральная иконка вместо отказа сцены. */
const ICON_FALLBACK: IconName = "sparkles";

const iconTokens = (name: string): string[] => name.split(/[-_\s]+/).filter(Boolean);

/**
 * Ближайшая существующая иконка вместо выдуманной моделью: точное совпадение без
 * учёта регистра, иначе подстрока или общее слово («chart-bar» → «chart-column»),
 * иначе нейтральный fallback. Синонимов пока нет: подстроки хватает почти всегда.
 */
export function repairIcon(name: string): IconName {
  const normalized = name.trim().toLowerCase();
  const exact = ICON_NAMES.find((n) => n === normalized);
  if (exact) return exact;
  const tokens = new Set(iconTokens(normalized));
  const near = ICON_NAMES.find(
    (n) => normalized.includes(n) || n.includes(normalized) || iconTokens(n).some((t) => tokens.has(t)),
  );
  return near ?? ICON_FALLBACK;
}

/**
 * Ремонт сырого JSON модели перед валидацией: чинит то, что чинится без модели,
 * и экономит повторные запросы. Пустая строка в необязательном поле — как будто
 * поля нет (обязательное всё равно поймает валидатор); неизвестная иконка — на
 * ближайшую из реестра. Смысл кадра не трогает.
 */
function repairValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(repairValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() === "") continue;
      out[key] = key === "icon" && typeof v === "string" ? repairIcon(v) : repairValue(v);
    }
    return out;
  }
  return value;
}

const KNOWN_BLOCK_TYPES = new Set<string>(BLOCK_TYPES);

/**
 * Ремонт композиции сверх repairValue: блок неизвестного типа (модель выдумала
 * discriminator) — долой, а не в отказ; divider — только между двумя блоками,
 * подряд идущие и стоящие в начале/конце убираются.
 */
function repairBlocks(blocks: readonly unknown[]): unknown[] {
  const known = blocks.filter(
    (b) => b && typeof b === "object" && KNOWN_BLOCK_TYPES.has(String((b as { block?: unknown }).block)),
  ) as { block: string }[];
  const deduped: { block: string }[] = [];
  for (const block of known) {
    if (block.block === "divider" && deduped.at(-1)?.block === "divider") continue;
    deduped.push(block);
  }
  while (deduped[0]?.block === "divider") deduped.shift();
  while (deduped.at(-1)?.block === "divider") deduped.pop();
  // Первый блок обязан начинаться с at: 0; после удаления блоков перед ним время могло остаться чужим.
  const first = deduped[0] as { at?: unknown } | undefined;
  if (first && typeof first.at === "number" && first.at !== 0) deduped[0] = { ...deduped[0]!, at: 0 } as { block: string };
  return deduped;
}

/** Короткое описание кадра для промпта: «composed: heading+ring+caption». */
export function describeVisual(visual: SceneVisualSpec): string {
  return visual.kind === "composed" ? `composed: ${blockSignature(visual.blocks)}` : visual.kind;
}

function userPrompt(input: SceneFillInput): string {
  return [
    `Video topic: ${input.topic}`,
    `Scene narration: ${input.narration}`,
    ...(input.neighbors ?? []).map(
      (n) => `The ${n.position} scene says "${n.narration}" and shows ${describeVisual(n.visual)}; look different from it.`,
    ),
    input.instruction
      ? `\nUSER REQUEST for this scene (highest priority; it may be written in any language): ${input.instruction}`
      : "",
    input.brief ? `\nSOURCES:\n${input.brief}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Детерминированный откат: сцена всё равно должна попасть в ролик. */
export function fallbackStatement(narration: string, plan: ScenePlan): SceneVisualSpec {
  let text = "";
  for (const word of narration.split(/\s+/)) {
    if (`${text} ${word}`.trim().length > 90) break;
    text = `${text} ${word}`.trim();
  }
  // split у шаблона не бывает: откат всегда в центр.
  const layout = plan.presentation.layout === "split" ? "center" : plan.presentation.layout;
  return SceneVisualSpecSchema.parse({ kind: "hook-statement", text: text || narration.slice(0, 90), ...plan.presentation, layout });
}

/** Сцена шаблонного типа. Три неудачи — откат на hook-statement. */
export async function fillTemplate(ctx: GenerationContext, input: SceneFillInput): Promise<SceneVisualSpec> {
  const kind = input.plan.kind === "composed" ? input.plan.fallbackKind : input.plan.kind;
  const system = [
    `You fill the visual of one scene in an informative ${videoNoun(input.format)}.`,
    "",
    `Scene kind: ${kind}. Return a JSON object with exactly these fields:`,
    KIND_CONTRACT[kind] ?? "",
    "",
    `Example of a valid answer (shape, not content): ${KIND_EXAMPLE[kind] ?? "{}"}`,
    "Return the object itself: no wrapper key, no prose, no description of the visual.",
    NEEDS_ICONS.has(kind) ? `\nAllowed icon values: ${ICON_LIST}` : "",
    "",
    "The visual must show what the narration says, in fewer words than the narration.",
    "Never invent numbers, names or sources: use only the narration and SOURCES. No markdown, no extra fields.",
    dateRule(ctx.today),
    "",
    skill("on-screen"),
  ]
    .filter(Boolean)
    .join("\n");

  const user = userPrompt(input);
  const feedback: string[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const raw = await (ctx.llmFast ?? ctx.llm).askJson({ system, user: withFeedback(user, feedback), maxTokens: 700, timeoutMs: 180000 });
      const content = repairValue(unwrapContent(raw, kind));
      // kind и подача идут ПОСЛЕ содержимого: модель иногда возвращает своё поле kind,
      // и оно перетирало запланированный тип.
      const presentation = { ...input.plan.presentation, layout: input.plan.presentation.layout === "split" ? "center" : input.plan.presentation.layout };
      const parsed = visualSpecSchemaFor(input.format ?? "shorts").safeParse({ ...(content as object), kind, ...presentation });
      if (parsed.success) {
        recordAttempt(input.stats, attempt);
        return parsed.data;
      }
      feedback.splice(0, feedback.length, ...issuesOf(parsed.error, 3));
      log(ctx, `scene ${input.index + 1} (${kind}) attempt ${attempt}: ${feedback.join("; ")}`);
    } catch (error) {
      log(ctx, `scene ${input.index + 1} (${kind}) attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  recordFallback(input.stats);
  log(ctx, `scene ${input.index + 1}: откат на hook-statement`);
  return fallbackStatement(input.narration, input.plan);
}

/**
 * Замечания к кадру сверх схемы: главный блок и скелет.
 *
 * Скелет — мягкое требование: на последней попытке кадр без нужного скелета
 * принимается. Кадр, который валиден, но собран по-другому, лучше отката на шаблон.
 */
export function compositionIssues(
  blocks: readonly Block[],
  plan: ScenePlan,
  strictSkeleton: boolean,
  narration?: string,
): string[] {
  const issues: string[] = [];
  // Блок данных без числа в озвучке — выдуманная цифра: модель рисовала «88%+»
  // на фразе «LFP pushed prices down further».
  if (narration !== undefined && !narrationHasFigure(narration)) {
    const data = blocks.find((b) => DATA_BLOCKS.has(b.block));
    if (data) issues.push(`the narration has no figure: remove the "${data.block}" block and show the idea without numbers`);
  }
  // Кольцо и столбцы честны только части фраз: кольцо — доле, столбцы — нескольким числам.
  // Иначе модель рисовала кольцо «99%» на фразе про «+$500 к цене» — число есть, доли нет.
  if (narration !== undefined) {
    const fits = new Set(dataHeroesFor(narration));
    for (const block of blocks) {
      if (block.block !== "ring" && block.block !== "bars") continue;
      if (fits.has(block.block)) continue;
      issues.push(
        block.block === "ring"
          ? 'the narration has no share: replace the "ring" block with a "number" block'
          : 'the narration does not have several numbers: replace the "bars" block with a "number" block',
      );
    }
  }
  if (!plan.hero) return issues;
  const allowed = heroAlternatives(plan.hero);
  if (!blocks.some((b) => allowed.includes(b.block))) {
    issues.push(`the scene must contain a "${plan.hero}" block`);
    return issues;
  }
  if (strictSkeleton && plan.skeleton) {
    const problem = SKELETONS[plan.skeleton].check(blocks, plan.hero);
    if (problem) issues.push(problem);
  }
  return issues;
}

/**
 * Сцена из блоков. Главный блок обязателен (иначе разнообразие не гарантировано),
 * скелет желателен, остальное модель решает сама. Три неудачи — шаблонный тип.
 */
export async function fillComposed(ctx: GenerationContext, input: SceneFillInput): Promise<SceneVisualSpec> {
  const { plan } = input;
  const hero = input.freeHero ? undefined : plan.hero;
  const effectivePlan: ScenePlan = hero ? plan : { ...plan, hero: undefined, skeleton: undefined };
  const system = [
    `You design one scene of an informative ${videoNoun(input.format)} by composing blocks.`,
    "You decide which blocks, their order, emphasis, timing and motion. Make the frame visual,",
    "not a paragraph: fewer words than the narration, one idea, a clear focal point.",
    "",
    hero ? `This scene must be built around ${HERO_HINT[hero]}.` : "Choose the main block that shows the idea best.",
    narrationHasFigure(input.narration) ? "" : "The narration has no figure: do not use number, ring or bars, and do not add numbers.",
    hero
      ? `Exact shape of that block (the values are placeholders from another video; write your own from the narration, never copy them): ${JSON.stringify(HERO_EXAMPLE[hero])}`
      : "",
    hero && DATA_HEROES.has(hero)
      ? "A ring is only for a share of a whole; money, counts and sizes go to number. If the narration has no figure for this block, use another of number / ring / bars that fits the real figure. Never invent numbers."
      : "",
    hero && plan.skeleton ? `Frame structure: ${SKELETONS[plan.skeleton].hint}.` : "",
    "",
    plan.presentation.layout === "split" ? SPLIT_NOTE : "",
    "Return JSON:",
    BLOCK_CONTRACT,
    "",
    "Return the object itself: no wrapper key, no prose.",
    "Use only facts and numbers from the narration and SOURCES.",
    dateRule(ctx.today),
    `\nAllowed icon values: ${ICON_LIST}`,
    "",
    skill("on-screen"),
  ]
    .filter(Boolean)
    .join("\n");
  // Общий пример кадра убран сознательно: модель копировала его скелет
  // «badge + heading + ring + caption» в каждую сцену. Форма главного блока и
  // скелет задаются выше, по отдельности.

  const user = userPrompt(input);
  const label = `scene ${input.index + 1} (composed/${hero ?? "free"}${hero && plan.skeleton ? `/${plan.skeleton}` : ""})`;
  const feedback: string[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const raw = await (ctx.llmFast ?? ctx.llm).askJson({ system, user: withFeedback(user, feedback), maxTokens: 1100, timeoutMs: 180000 });
      const content = unwrapContent(raw, "composed");
      const blocksRaw = Array.isArray(content) ? content : (content as { blocks?: unknown } | null)?.blocks;
      const blocks = Array.isArray(blocksRaw) ? repairBlocks(repairValue(blocksRaw) as unknown[]) : blocksRaw;
      const candidate = { kind: "composed", blocks, ...plan.presentation };

      const schema = visualSpecSchemaFor(input.format ?? "shorts");
      let parsed = schema.safeParse(candidate);
      // Не влезло только из-за композиции со сдвигом центра — центр даёт больше высоты,
      // и это дешевле, чем ещё один запрос к модели. split остаётся split: в центре
      // две колонки превратились бы в одну длинную стопку.
      if (
        !parsed.success &&
        !["center", "split"].includes(plan.presentation.layout) &&
        parsed.error.issues.every((i) => i.message.includes("do not fit"))
      ) {
        parsed = schema.safeParse({ ...candidate, layout: "center" });
      }

      const issues = parsed.success
        ? parsed.data.kind === "composed"
          ? compositionIssues(parsed.data.blocks, effectivePlan, attempt < ATTEMPTS, input.narration)
          : []
        : issuesOf(parsed.error);
      if (parsed.success && issues.length === 0) {
        recordAttempt(input.stats, attempt);
        return parsed.data;
      }
      feedback.splice(0, feedback.length, ...issues);
      log(ctx, `${label} attempt ${attempt}: ${issues.join("; ")}`);
    } catch (error) {
      log(ctx, `${label} attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  recordFallback(input.stats);
  log(ctx, `scene ${input.index + 1}: композиция не собралась, откат на ${plan.fallbackKind}`);
  return fillTemplate(ctx, { ...input, plan: { ...plan, kind: plan.fallbackKind } });
}

/**
 * Проверка готового кадра так же, как в fillComposed: схема формата, главный
 * блок и (строго) скелет. Для пакетного наполнения глав 16:9.
 */
export function acceptComposed(raw: unknown, input: SceneFillInput): { visual?: SceneVisualSpec; issues: string[] } {
  const content = unwrapContent(raw, "composed");
  const blocksRaw = Array.isArray(content) ? content : (content as { blocks?: unknown } | null)?.blocks;
  // Тот же ремонт, что в fillComposed: иначе пачка глав теряет сцену на пустом поле или чужой иконке.
  const blocks = Array.isArray(blocksRaw) ? repairBlocks(repairValue(blocksRaw) as unknown[]) : blocksRaw;
  const parsed = visualSpecSchemaFor(input.format ?? "shorts").safeParse({ kind: "composed", blocks, ...input.plan.presentation });
  if (!parsed.success) return { issues: issuesOf(parsed.error) };
  const issues = parsed.data.kind === "composed" ? compositionIssues(parsed.data.blocks, input.plan, true, input.narration) : [];
  return issues.length === 0 ? { visual: parsed.data, issues } : { issues };
}

/** Наполнение сцены по плану: из блоков или шаблоном. */
export function fillScene(ctx: GenerationContext, input: SceneFillInput): Promise<SceneVisualSpec> {
  return input.plan.kind === "composed" ? fillComposed(ctx, input) : fillTemplate(ctx, input);
}

/** Новый пустой счётчик исхода одной сцены — заполняется fillTemplate/fillComposed по ссылке. */
export function newFillStats(): SceneFillStats {
  return { attempts: 0, fellBack: false };
}

/** Итог по ролику: сколько кадров прошло с первой попытки, с повторами и откатов. */
export function fillStatsSummary(stats: readonly SceneFillStats[]): string {
  const fellBack = stats.filter((s) => s.fellBack).length;
  const firstTry = stats.filter((s) => !s.fellBack && s.attempts <= 1).length;
  const retried = stats.length - fellBack - firstTry;
  return `кадры: ${firstTry} с первой попытки, ${retried} с повторами, ${fellBack} откатов из ${stats.length}`;
}
