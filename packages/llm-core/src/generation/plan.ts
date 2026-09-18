/**
 * Раскладка сцен: тип, главный блок, скелет кадра и подача.
 *
 * Делается кодом, а не моделью: модель игнорировала текстовые квоты в промпте
 * (брала hook-statement 3 раза из 5), а детерминированная раскладка даёт
 * разнообразие без ретраев и одинаково работает на любой теме.
 */
import {
  DATA_BLOCKS,
  VISUAL_BLOCKS,
  type Block,
  type BlockType,
  type Presentation,
  type SceneBackdrop,
  type SceneIntent,
  type SceneLayout,
  type SceneMotionKind,
  type SceneVisualKind,
  type VideoFormat,
} from "@shorts/contracts";

export interface Beat {
  readonly narration: string;
  readonly intent: SceneIntent;
  /** Короткий поисковый запрос для фото/видео фона сцены на Pexels; не у каждого тезиса. */
  readonly mediaQuery?: string;
  readonly mediaKind?: "photo" | "video";
}

/** Главный блок сцены: вокруг него модель собирает кадр. */
export type HeroBlock = Extract<BlockType, "ring" | "number" | "bars" | "pair" | "divider" | "row" | "chips" | "icon" | "quote">;

/**
 * Скелет кадра — где главный блок и что вокруг него.
 *
 * Главный блок один дал разнообразие по «что показать», но не по «как»: модель в
 * четырёх сценах из пяти собирала «заголовок + главный блок + подпись». Скелет
 * назначает код, по кругу, как и главный блок.
 */
export type Skeleton = "lead" | "classic" | "duo" | "reveal" | "kicker";

export interface ScenePlan {
  readonly kind: SceneVisualKind;
  /** Шаблонный тип: им сцена собирается, если композиция не прошла валидацию. */
  readonly fallbackKind: Exclude<SceneVisualKind, "composed">;
  readonly hero?: HeroBlock;
  readonly skeleton?: Skeleton;
  readonly presentation: Presentation;
}

type TemplateKind = Exclude<SceneVisualKind, "composed">;

const KIND_BY_INTENT: Record<SceneIntent, TemplateKind> = {
  hook: "hook-statement",
  number: "stat-counter",
  contrast: "comparison",
  list: "icon-list",
  sequence: "timeline",
  punch: "kinetic-text",
  fact: "icon-list",
  takeaway: "outro-cta",
};

/** Чем заменить тип, если он повторяется подряд. */
const ALTERNATIVES: Partial<Record<TemplateKind, TemplateKind[]>> = {
  "icon-list": ["timeline", "comparison", "kinetic-text"],
  comparison: ["icon-list", "kinetic-text", "timeline"],
  "hook-statement": ["kinetic-text", "icon-list", "comparison"],
  "stat-counter": ["icon-list", "comparison", "timeline"],
  "kinetic-text": ["icon-list", "comparison", "timeline"],
  timeline: ["icon-list", "comparison", "kinetic-text"],
};

/** Больше двух сцен одного типа на ролик — уже однообразие. */
const MAX_PER_KIND = 2;
/** Порядок замены: сначала типы, которых в ролике ещё не было. */
const DIVERSIFY_ORDER: TemplateKind[] = ["kinetic-text", "timeline", "comparison", "icon-list", "stat-counter"];
/** Замыслы, где порядок шагов действительно есть: timeline только для них, иначе шаги выдуманы. */
const ORDERED_INTENTS = new Set<SceneIntent>(["sequence", "list"]);
const TEXT_KINDS = new Set<TemplateKind>(["hook-statement", "kinetic-text"]);

const LAYOUTS: Record<VideoFormat, SceneLayout[]> = {
  shorts: ["center", "top", "left", "stacked"],
  // В 16:9 кадр низкий: top и stacked съели бы половину высоты. Разнообразие
  // даёт split — он назначается отдельно, по скелету.
  landscape: ["center", "left"],
};
/** Скелеты, где есть и текст, и визуал, — только их имеет смысл разводить на две колонки. */
const SPLIT_SKELETONS = new Set<Skeleton>(["classic", "reveal", "kicker"]);
const MOTIONS: SceneMotionKind[] = ["rise", "slide", "pop", "fade"];
const ACCENT_SHIFTS = [0, 12, -10, 16, -14, 8, -6, 14];

/** Фактура фона по типу сцены: смысл кадра и его материал должны совпадать. */
const BACKDROP_BY_KIND: Record<TemplateKind, SceneBackdrop> = {
  "hook-statement": "rays",
  "stat-counter": "spotlight",
  "icon-list": "dots",
  comparison: "grid",
  "kinetic-text": "plain",
  timeline: "grid",
  "outro-cta": "spotlight",
};
const BACKDROP_FALLBACK: SceneBackdrop[] = ["grid", "dots", "rays", "plain", "spotlight"];

/**
 * Какие главные блоки подходят замыслу. timeline и kinetic-text остаются шаблонами:
 * у них своя сильная подача. Хук и финал — тоже: первый кадр должен быть надёжным.
 */
export const HEROES_BY_INTENT: Record<SceneIntent, readonly HeroBlock[]> = {
  number: ["ring", "number", "bars"],
  contrast: ["pair", "bars", "divider"],
  list: ["row", "chips", "icon"],
  fact: ["icon", "quote", "chips", "row", "pair"],
  hook: ["icon", "quote", "chips"],
  punch: ["quote", "icon"],
  sequence: ["row", "chips"],
  takeaway: ["icon", "row"],
};
const COMPOSABLE_KINDS = new Set<TemplateKind>(["icon-list", "comparison", "stat-counter", "hook-statement"]);

export const BACKDROP_BY_HERO: Record<HeroBlock, SceneBackdrop> = {
  ring: "spotlight",
  number: "spotlight",
  bars: "grid",
  pair: "rays",
  divider: "rays",
  row: "dots",
  chips: "dots",
  icon: "spotlight",
  quote: "plain",
};

export const DATA_HEROES: ReadonlySet<HeroBlock> = new Set(["ring", "number", "bars"]);

/** Какие блоки засчитываются за главный: вместо кольца годится любой блок данных. */
export function heroAlternatives(hero: HeroBlock): BlockType[] {
  return DATA_HEROES.has(hero) ? [...DATA_BLOCKS] : [hero];
}

/**
 * Какие блоки данных честно подходят фразе. Кольцо — только доле («62%», «a third»),
 * столбцы — только нескольким числам. Иначе модель рисовала кольцо «100%» на фразе
 * про «+$500 к цене»: блок назначен, а доли в тексте нет.
 */
export function dataHeroesFor(narration: string): HeroBlock[] {
  const text = narration.toLowerCase();
  const share = /\d\s*%|\bper\s?cent\b|\bpercent|\bshare\b|\bhalf\b|\bthird\b|\bquarter\b|\bout of\b/.test(text);
  const numbers = (text.match(/\d[\d,.]*/g) ?? []).filter((n) => !/^(19|20)\d\d$/.test(n));
  const fits: HeroBlock[] = [];
  if (share) fits.push("ring");
  if (numbers.length >= 2) fits.push("bars");
  fits.push("number");
  return fits;
}

export function assignHeroes(beats: readonly Beat[], kinds: readonly TemplateKind[]): (HeroBlock | undefined)[] {
  const used = new Map<HeroBlock, number>();
  return kinds.map((kind, index) => {
    if (index === 0 || index === kinds.length - 1 || !COMPOSABLE_KINDS.has(kind)) return undefined;
    const beat = beats[index];
    const allowedData = new Set(dataHeroesFor(beat?.narration ?? ""));
    const options = HEROES_BY_INTENT[beat?.intent ?? "fact"].filter((hero) => !DATA_HEROES.has(hero) || allowedData.has(hero));
    // Самый редкий в ролике из допустимых; при равенстве — по порядку предпочтения.
    const hero = [...options].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]!;
    used.set(hero, (used.get(hero) ?? 0) + 1);
    return hero;
  });
}

export interface SkeletonSpec {
  /** Что сказать модели. */
  readonly hint: string;
  /** С какими главными блоками скелет физически возможен. */
  readonly fits: (hero: HeroBlock) => boolean;
  /** Проверка готового кадра: undefined — скелет соблюдён, иначе замечание для модели. */
  readonly check: (blocks: readonly Block[], hero: HeroBlock) => string | undefined;
}

const isHero = (block: Block, hero: HeroBlock) => heroAlternatives(hero).includes(block.block);

/** Порядок перебора: сначала самые непохожие на «заголовок + блок + подпись». */
export const SKELETON_ORDER: readonly Skeleton[] = ["lead", "duo", "classic", "reveal", "kicker"];

export const SKELETONS: Record<Skeleton, SkeletonSpec> = {
  lead: {
    hint: "open with the main block itself at at: 0, no heading above it; below it at most one heading or caption that interprets it",
    // Разделитель не может стоять первым.
    fits: (hero) => hero !== "divider",
    check: (blocks, hero) =>
      blocks[0] && isHero(blocks[0], hero)
        ? undefined
        : `skeleton "lead": the first block must be the main "${hero}" block, not ${blocks[0]?.block}`,
  },
  duo: {
    hint: "no heading at all: the main block plus one more visual block of another kind (row, icon, chips, quote or pair), optionally a caption",
    fits: () => true,
    check: (blocks) => {
      if (blocks.some((b) => b.block === "heading")) return 'skeleton "duo": remove the heading';
      const visual = new Set(blocks.filter((b) => VISUAL_BLOCKS.has(b.block)).map((b) => b.block));
      return visual.size >= 2 ? undefined : 'skeleton "duo": add a second visual block of another kind';
    },
  },
  classic: {
    hint: "a heading on top, the main block below it, an optional caption at the bottom",
    fits: () => true,
    check: (blocks) => (blocks[0]?.block === "heading" ? undefined : 'skeleton "classic": start with a heading'),
  },
  reveal: {
    hint: "a heading that sets up tension or a question comes first alone; the main block is the payoff and appears later, at at >= 0.35",
    fits: () => true,
    check: (blocks, hero) => {
      if (blocks[0]?.block !== "heading") return 'skeleton "reveal": start with a heading';
      const main = blocks.find((b) => isHero(b, hero));
      return main && main.at >= 0.35 ? undefined : `skeleton "reveal": the "${hero}" block must appear at at >= 0.35`;
    },
  },
  kicker: {
    hint: "a small badge on top (a year, a scale or a rubric), then a heading, then the main block",
    fits: () => true,
    check: (blocks) =>
      blocks[0]?.block === "badge" && blocks.some((b) => b.block === "heading")
        ? undefined
        : 'skeleton "kicker": start with a badge, then a heading',
  },
};

/**
 * Скелеты по сценам: самый редкий из подходящих, и не такой же, как у предыдущей
 * собранной сцены — соседние кадры с одинаковым порядком блоков сливаются.
 */
export function assignSkeletons(heroes: readonly (HeroBlock | undefined)[]): (Skeleton | undefined)[] {
  const used = new Map<Skeleton, number>();
  let previous: Skeleton | undefined;
  return heroes.map((hero) => {
    if (!hero) return undefined;
    const options = SKELETON_ORDER.filter((s) => SKELETONS[s].fits(hero) && s !== previous);
    const skeleton = [...options].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]!;
    used.set(skeleton, (used.get(skeleton) ?? 0) + 1);
    previous = skeleton;
    return skeleton;
  });
}

function spreadBackdrops(backdrops: SceneBackdrop[]): void {
  // Две соседние сцены с одинаковой фактурой сливаются в одну длинную сцену.
  for (let i = 1; i < backdrops.length; i++) {
    if (backdrops[i] !== backdrops[i - 1]) continue;
    backdrops[i] =
      BACKDROP_FALLBACK.find((option) => option !== backdrops[i - 1] && option !== backdrops[i + 1]) ?? "plain";
  }
}

/** Подача сцены по её позиции: циклы сдвинуты, чтобы соседи не совпали сразу во всём. */
export function presentationAt(
  index: number,
  backdrop: SceneBackdrop,
  format: VideoFormat = "shorts",
  skeleton?: Skeleton,
): Presentation {
  const layouts = LAYOUTS[format];
  return {
    backdrop,
    layout: format === "landscape" && skeleton && SPLIT_SKELETONS.has(skeleton) ? "split" : layouts[index % layouts.length]!,
    motion: MOTIONS[(index * 3) % MOTIONS.length]!,
    accentShift: ACCENT_SHIFTS[index % ACCENT_SHIFTS.length]!,
  };
}

export function planScenes(beats: readonly Beat[], format: VideoFormat = "shorts"): ScenePlan[] {
  const kinds: TemplateKind[] = beats.map((beat, index) => {
    if (index === 0) return "hook-statement";
    if (index === beats.length - 1) return "outro-cta";
    return KIND_BY_INTENT[beat.intent] ?? "icon-list";
  });
  const isOrdered = (index: number) => ORDERED_INTENTS.has(beats[index]?.intent ?? "fact");

  // Разводим соседей одного типа: подряд идущие одинаковые сцены и есть «всё одинаковое».
  for (let i = 1; i < kinds.length - 1; i++) {
    if (kinds[i] !== kinds[i - 1]) continue;
    const options = ALTERNATIVES[kinds[i]!] ?? ["icon-list"];
    kinds[i] =
      options.find(
        (option) =>
          option !== kinds[i - 1] && option !== kinds[i + 1] && (option !== "timeline" || isOrdered(i)),
      ) ?? options[0]!;
  }

  // Доля текстовых сцен: лишние переводим в список.
  const textLimit = Math.max(1, Math.floor(beats.length * 0.3));
  let textCount = kinds.filter((kind) => TEXT_KINDS.has(kind)).length;
  for (let i = kinds.length - 2; i > 0 && textCount > textLimit; i--) {
    if (!TEXT_KINDS.has(kinds[i]!)) continue;
    if (kinds[i - 1] === "icon-list" || kinds[i + 1] === "icon-list") continue;
    kinds[i] = "icon-list";
    textCount--;
  }

  // Тип, занятый больше двух раз, переводится в неиспользованный.
  const usage = new Map<TemplateKind, number>();
  for (const kind of kinds) usage.set(kind, (usage.get(kind) ?? 0) + 1);
  for (let i = 1; i < kinds.length - 1; i++) {
    const current = kinds[i]!;
    if ((usage.get(current) ?? 0) <= MAX_PER_KIND) continue;
    const candidate = DIVERSIFY_ORDER.find(
      (option) =>
        (usage.get(option) ?? 0) < MAX_PER_KIND &&
        option !== kinds[i - 1] &&
        option !== kinds[i + 1] &&
        (option !== "timeline" || isOrdered(i)),
    );
    if (!candidate) continue;
    usage.set(current, (usage.get(current) ?? 0) - 1);
    usage.set(candidate, (usage.get(candidate) ?? 0) + 1);
    kinds[i] = candidate;
  }

  const backdrops = kinds.map((kind) => BACKDROP_BY_KIND[kind]);
  spreadBackdrops(backdrops);
  const heroes = assignHeroes(beats, kinds);
  // Фактура композиции — по главному блоку: у кольца свет, у столбцов сетка.
  heroes.forEach((hero, index) => {
    if (hero) backdrops[index] = BACKDROP_BY_HERO[hero];
  });
  spreadBackdrops(backdrops);
  const skeletons = assignSkeletons(heroes);

  return kinds.map((kind, index) => {
    const hero = heroes[index];
    const skeleton = skeletons[index];
    return {
      kind: hero ? "composed" : kind,
      fallbackKind: kind,
      ...(hero ? { hero } : {}),
      ...(skeleton ? { skeleton } : {}),
      presentation: presentationAt(index, backdrops[index]!, format, skeleton),
    };
  });
}
