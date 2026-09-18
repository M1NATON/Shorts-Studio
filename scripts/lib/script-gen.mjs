/**
 * Генерация сценария в три этапа вместо одного большого запроса.
 *
 * Почему так: единый промпт содержал контракт всех пяти типов сцен, 50 имён иконок,
 * поля подачи и квоты разнообразия. Он получался тяжёлым (модель не укладывалась в
 * таймаут), а любая ошибка в одной сцене заставляла перегенерировать весь сценарий.
 *
 * Этапы:
 *  1) план — один короткий запрос: заголовок и восемь тезисов озвучки;
 *  2) раскладка — КОД распределяет типы сцен, композиции и движение. Разнообразие
 *     перестаёт быть просьбой к модели и становится свойством пайплайна;
 *  3) наполнение — по одному маленькому запросу на сцену, в промпте только контракт
 *     нужного типа. Ошибка чинится повтором одной сцены, а не всего сценария.
 */
import {
  BLOCK_AT_MAX,
  DEFAULT_VIDEO_THEME,
  FONT_FAMILIES,
  IconNameSchema,
  NARRATION_MAX_CHARS,
  NARRATION_TARGET_CHARS,
  SceneVisualSpecSchema,
  ScriptSchema,
  SPEECH_CHARS_PER_SEC,
  VideoThemeSchema,
} from "@shorts/contracts";
import { buildResearchBrief, searchSources } from "@shorts/llm-core";
import { askJson, mapLimited } from "./llm.mjs";

const SCENE_COUNT = 8;
/** Прокси отдавал 504 на трёх одновременных запросах. */
const CONCURRENCY = 2;

const INTENTS = ["hook", "fact", "number", "contrast", "list", "sequence", "punch", "takeaway"];

/**
 * Поиск источников. Без ключа этап пропускается — пайплайн продолжает работать,
 * но модель опирается только на свои знания, и числам в кадре верить нельзя.
 */
async function research(topic) {
  if (!process.env.FIRECRAWL_API_KEY) {
    console.log("  research: FIRECRAWL_API_KEY не задан, факты только из модели");
    return { sources: [], brief: "" };
  }
  try {
    const sources = await searchSources({
      query: topic,
      apiKey: process.env.FIRECRAWL_API_KEY,
      limit: 4,
    });
    console.log(`  research: ${sources.length} источников`);
    return { sources, brief: buildResearchBrief(sources) };
  } catch (error) {
    console.log(`  research: пропущен (${error.message})`);
    return { sources: [], brief: "" };
  }
}

const THEME_SYSTEM = [
  "You design the visual identity of one short video. Return JSON only.",
  "",
  "Fields:",
  '{ "mood": short phrase, "canvas": "#rrggbb" (background), "surface": "#rrggbb" (cards),',
  '  "surfaceStrong": "#rrggbb", "border": "#rrggbb", "text": "#rrggbb" (main copy),',
  '  "muted": "#rrggbb" (secondary copy), "accent": "#rrggbb", "accentSoft": "#rrggbb",',
  `  "fontFamily": one of ${FONT_FAMILIES.join(" | ")},`,
  '  "headingWeight": 600 | 700 | 800, "letterSpacing": -0.06..0.04 (em),',
  '  "cornerRadius": 0..36, "backdropOpacity": 0.04..0.4,',
  '  "motion": { "easing": [x1,y1,x2,y2] cubic-bezier, "enterFrames": 5..24,',
  '    "staggerFrames": 1..10, "travelPx": 8..160 } }',
  "",
  "Rules:",
  "- The palette must carry the topic: cold and metallic for industry, warm for human stories,",
  "  clinical for medicine, high-contrast neon only when the topic is loud.",
  "- Contrast on canvas is checked and enforced: text at least 7:1, accent at least 3.5:1,",
  "  muted at least 3:1. A beautiful but unreadable palette is rejected.",
  "- Light backgrounds are allowed and welcome when they fit the topic.",
  "- Motion must match the tone: calm topics get long enterFrames and small travelPx,",
  "  urgent topics get short enterFrames and snappy easing.",
  `Example: ${JSON.stringify(DEFAULT_VIDEO_THEME)}`,
].join("\n");

/**
 * Дизайн-система под тему ролика.
 *
 * Модель задаёт палитру, шрифт и кривые движения числами, а не кодом: такой ответ
 * проверяется. Контраст считается по WCAG прямо в схеме, и нечитаемая тема уходит
 * на повтор вместе с конкретными цифрами контраста. Если три попытки не дали
 * валидной темы, ролик собирается на дефолтной — прогон не падает.
 */
async function generateTheme(topic) {
  const feedback = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const user =
        feedback.length === 0
          ? `Video topic: ${topic}`
          : `Video topic: ${topic}\n\nYour previous palette was rejected:\n${feedback
              .map((f) => `- ${f}`)
              .join("\n")}\nFix exactly these problems.`;
      const raw = await askJson({ system: THEME_SYSTEM, user, maxTokens: 900, timeoutMs: 150000 });
      const parsed = VideoThemeSchema.safeParse(unwrapContent(raw, "theme"));
      if (parsed.success) {
        console.log(`  тема: ${parsed.data.mood} · ${parsed.data.fontFamily} · ${parsed.data.canvas}`);
        return parsed.data;
      }
      feedback.length = 0;
      feedback.push(...parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`));
      console.log(`  тема attempt ${attempt}: ${feedback.join("; ")}`);
    } catch (error) {
      console.log(`  тема attempt ${attempt}: ${error.message}`);
    }
  }
  console.log("  тема: откат на дефолтную");
  return DEFAULT_VIDEO_THEME;
}

const OUTLINE_SYSTEM = [
  "You plan informative vertical short videos (9:16), in English.",
  "",
  `Return JSON: { "title": string (max 110 chars), "beats": [ { "narration": string, "intent": string } ] }`,
  `Exactly ${SCENE_COUNT} beats.`,
  "",
  `narration: ONE spoken sentence, ${NARRATION_TARGET_CHARS.min}-${NARRATION_TARGET_CHARS.max} characters,`,
  `hard maximum ${NARRATION_MAX_CHARS}. Speech runs at ~${SPEECH_CHARS_PER_SEC} characters per second,`,
  "so a long sentence freezes the scene. One idea per beat, no filler.",
  "",
  `intent: one of ${INTENTS.join(", ")}.`,
  'The first beat is "hook", the last is "takeaway".',
  'Use "number" only for a real, widely documented figure worth animating; never invent one.',
  'Use "contrast" for A-versus-B, "list" for two to four parallel points,',
  '"sequence" for ordered steps or a chronology, "punch" for a short emotional line',
  'that works split across two or three lines, "fact" otherwise.',
  "Aim for a mix: at least one number or contrast, and at least two lists.",
].join("\n");

/** Контракт одного типа сцены — в промпт уходит только нужный кусок. */
const KIND_CONTRACT = {
  "hook-statement": [
    '{ "variant": "statement" | "quote", "text": string max 90,',
    '  "emphasisWords": array of up to 3 words copied exactly from text,',
    '  "attribution": string max 40, only with variant "quote" }',
  ].join("\n"),
  "stat-counter": [
    '{ "label": string max 48, "fromValue": number, "toValue": number,',
    '  "unit": string max 8 (optional), "decimals": 0 | 1 | 2, "icon": icon name (optional) }',
    "fromValue is where the counter starts (usually 0), toValue is the real documented figure.",
    "|toValue - fromValue| must be at least 2, unless decimals > 0.",
  ].join("\n"),
  "icon-list": [
    '{ "title": string max 48 (optional), "items": 2 to 4 of { "icon": icon name, "text": string max 48 } }',
  ].join("\n"),
  comparison: [
    '{ "title": string max 48 (optional),',
    '  "items": 2 or 3 of { "label": string max 20, "value": string max 36, "icon": icon name (optional) } }',
  ].join("\n"),
  "outro-cta": ['{ "text": string max 70, "subtext": string max 60 (optional) }'].join("\n"),
};

/**
 * Пример ответа для каждого типа.
 *
 * Без примера модель на расплывчатом тезисе отвечала описанием вместо данных:
 * {"visual": "1. Extract and prepare materials"} — валидация трижды падала, и сцена
 * откатывалась на hook-statement. Пример снимает двусмысленность слова "visual".
 */
const KIND_EXAMPLE = {
  "hook-statement": '{"variant":"statement","text":"Fusion has missed every deadline","emphasisWords":["every"]}',
  "stat-counter": '{"label":"Median prompt energy","fromValue":0,"toValue":0.24,"unit":"Wh","decimals":2,"icon":"zap"}',
  "icon-list": '{"title":"What drives cost","items":[{"icon":"cpu","text":"Chip supply"},{"icon":"factory","text":"Plant capacity"}]}',
  comparison: '{"title":"Two approaches","items":[{"label":"Tokamak","value":"Magnetic confinement"},{"label":"Laser","value":"Inertial confinement"}]}',
  "kinetic-text": '{"lines":["Ten years away","for fifty years"],"emphasisLine":1}',
  timeline: '{"title":"Electrode line","steps":[{"label":"Coating","text":"Apply active material"},{"label":"Drying","text":"Remove solvent"}]}',
  "outro-cta": '{"text":"Watch the energy, not the hype","subtext":"Numbers beat promises"}',
};

const NEEDS_ICONS = new Set(["stat-counter", "icon-list", "comparison"]);

/** Тип сцены по замыслу тезиса. */
const KIND_BY_INTENT = {
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
const ALTERNATIVES = {
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
const DIVERSIFY_ORDER = ["kinetic-text", "timeline", "comparison", "icon-list", "stat-counter"];

/** Замыслы, где порядок шагов действительно есть. */
const ORDERED_INTENTS = new Set(["sequence", "list"]);

const LAYOUTS = ["center", "top", "left", "stacked"];
const MOTIONS = ["rise", "slide", "pop", "fade"];
const ACCENT_SHIFTS = [0, 12, -10, 16, -14, 8, -6, 14];

/** Фактура фона по типу сцены: смысл кадра и его материал должны совпадать. */
const BACKDROP_BY_KIND = {
  "hook-statement": "rays",
  "stat-counter": "spotlight",
  "icon-list": "dots",
  comparison: "grid",
  "kinetic-text": "plain",
  timeline: "grid",
  "outro-cta": "spotlight",
};
/** Чем заменить фактуру, если соседняя сцена уже её использует. */
const BACKDROP_FALLBACK = ["grid", "dots", "rays", "plain", "spotlight"];

/**
 * Раскладка: типы сцен, композиция, движение и оттенок акцента.
 *
 * Делается кодом, а не моделью: модель уже игнорировала текстовые квоты в промпте
 * (брала hook-statement 3 раза из 5), а детерминированная раскладка даёт разнообразие
 * без ретраев и одинаково работает на любой теме.
 */
export function planScenes(beats) {
  const kinds = beats.map((beat, index) => {
    if (index === 0) return "hook-statement";
    if (index === beats.length - 1) return "outro-cta";
    return KIND_BY_INTENT[beat.intent] ?? "icon-list";
  });

  // Разводим соседей одного типа: подряд идущие одинаковые сцены и есть «всё одинаковое».
  // timeline подставляем только там, где в тезисе есть порядок — иначе шаги будут выдуманными.
  const isOrdered = (index) => ORDERED_INTENTS.has(beats[index]?.intent);
  for (let i = 1; i < kinds.length - 1; i++) {
    if (kinds[i] !== kinds[i - 1]) continue;
    const options = ALTERNATIVES[kinds[i]] ?? ["icon-list"];
    kinds[i] =
      options.find(
        (option) =>
          option !== kinds[i - 1] &&
          option !== kinds[i + 1] &&
          (option !== "timeline" || isOrdered(i)),
      ) ?? options[0];
  }

  // Доля текстовых сцен: лишние переводим в список.
  const textLimit = Math.max(1, Math.floor(beats.length * 0.3));
  const TEXT_KINDS = new Set(["hook-statement", "kinetic-text"]);
  let textCount = kinds.filter((kind) => TEXT_KINDS.has(kind)).length;
  for (let i = kinds.length - 2; i > 0 && textCount > textLimit; i--) {
    if (!TEXT_KINDS.has(kinds[i])) continue;
    if (kinds[i - 1] === "icon-list" || kinds[i + 1] === "icon-list") continue;
    kinds[i] = "icon-list";
    textCount--;
  }

  /**
   * Разнообразие типов как инвариант, а не как надежда на модель.
   *
   * Модель раздаёт замыслы неравномерно: на одном прогоне из восьми тезисов вышло
   * три hook-statement и ни одного timeline или kinetic-text. Поэтому тип, занятый
   * больше двух раз, переводится в неиспользованный. timeline берём только там, где
   * в тезисе действительно есть порядок — иначе шаги будут выдуманными.
   */
  const usage = new Map();
  for (const kind of kinds) usage.set(kind, (usage.get(kind) ?? 0) + 1);

  for (let i = 1; i < kinds.length - 1; i++) {
    if ((usage.get(kinds[i]) ?? 0) <= MAX_PER_KIND) continue;
    const candidate = DIVERSIFY_ORDER.find(
      (option) =>
        (usage.get(option) ?? 0) < MAX_PER_KIND &&
        option !== kinds[i - 1] &&
        option !== kinds[i + 1] &&
        (option !== "timeline" || isOrdered(i)),
    );
    if (!candidate) continue;
    usage.set(kinds[i], usage.get(kinds[i]) - 1);
    usage.set(candidate, (usage.get(candidate) ?? 0) + 1);
    kinds[i] = candidate;
  }

  const backdrops = kinds.map((kind) => BACKDROP_BY_KIND[kind] ?? "plain");
  // Две соседние сцены с одинаковой фактурой сливаются в одну длинную сцену.
  for (let i = 1; i < backdrops.length; i++) {
    if (backdrops[i] !== backdrops[i - 1]) continue;
    backdrops[i] =
      BACKDROP_FALLBACK.find((option) => option !== backdrops[i - 1] && option !== backdrops[i + 1]) ??
      "plain";
  }

  const heroes = assignHeroes(beats, kinds);
  // Фактура композиции — по главному блоку: у кольца свет, у столбцов сетка.
  heroes.forEach((hero, index) => {
    if (hero) backdrops[index] = BACKDROP_BY_HERO[hero] ?? backdrops[index];
  });
  for (let i = 1; i < backdrops.length; i++) {
    if (backdrops[i] !== backdrops[i - 1]) continue;
    backdrops[i] =
      BACKDROP_FALLBACK.find((option) => option !== backdrops[i - 1] && option !== backdrops[i + 1]) ??
      "plain";
  }

  return kinds.map((kind, index) => ({
    // Сцена с главным блоком собирается моделью; исходный тип остаётся запасным.
    kind: heroes[index] ? "composed" : kind,
    fallbackKind: kind,
    hero: heroes[index],
    presentation: {
      backdrop: backdrops[index],
      // Смещаем циклы друг относительно друга, чтобы соседние сцены не совпали
      // сразу по композиции и по движению.
      layout: LAYOUTS[index % LAYOUTS.length],
      motion: MOTIONS[(index * 3) % MOTIONS.length],
      accentShift: ACCENT_SHIFTS[index % ACCENT_SHIFTS.length],
    },
  }));
}


/**
 * Какие сцены собирает модель из блоков и вокруг какого блока.
 *
 * Свобода модели — в выборе и порядке остальных блоков. Главный блок назначает
 * код, по кругу из допустимых для замысла: иначе модель на каждом тезисе брала бы
 * одно и то же «заголовок + строки», и разнообразие снова стало бы просьбой.
 *
 * timeline и kinetic-text остаются шаблонами: у них своя сильная подача, которую
 * блоки не повторяют. Хук и финал — тоже: первый кадр должен быть надёжным.
 */
const HEROES_BY_INTENT = {
  number: ["ring", "number", "bars"],
  contrast: ["pair", "bars", "divider"],
  list: ["row", "chips", "icon"],
  fact: ["icon", "quote", "chips", "row", "pair"],
  hook: ["icon", "quote", "chips"],
  punch: ["quote", "icon"],
  sequence: ["row", "chips"],
  takeaway: ["icon", "row"],
};
const COMPOSABLE_KINDS = new Set(["icon-list", "comparison", "stat-counter", "hook-statement"]);
const BACKDROP_BY_HERO = {
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

export function assignHeroes(beats, kinds) {
  const used = new Map();
  return kinds.map((kind, index) => {
    if (index === 0 || index === kinds.length - 1 || !COMPOSABLE_KINDS.has(kind)) return undefined;
    const options = HEROES_BY_INTENT[beats[index]?.intent] ?? HEROES_BY_INTENT.fact;
    // Самый редкий в ролике из допустимых; при равенстве — по порядку предпочтения.
    const hero = [...options].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
    used.set(hero, (used.get(hero) ?? 0) + 1);
    return hero;
  });
}

/** Контракт блоков для промпта — компактно, как KIND_CONTRACT. */
const BLOCK_CONTRACT = [
  '{ "blocks": [ 1 to 5 blocks, top to bottom ] }',
  "Every block may carry:",
  `  "at": when it appears, share of the scene 0..${BLOCK_AT_MAX} (first block 0; never decreasing),`,
  '  "motion": "rise" | "slide" | "pop" | "fade" (optional).',
  "Blocks:",
  '  { "block": "heading", "text": max 90, "emphasisWords": up to 3 words from text, "size": "xl" | "l" | "m" }',
  '  { "block": "caption", "text": max 60 }  secondary line',
  '  { "block": "number", "value": number, "from": number (default 0), "unit": max 8, "decimals": 0..2, "caption": max 48 }',
  '  { "block": "ring", "percent": 0..100, "label": max 40 }  share of a whole',
  '  { "block": "bars", "items": 2-4 of { "label": max 18, "value": number >= 0 }, "unit": max 8 }',
  '  { "block": "row", "icon": icon name (optional), "label": max 20 (optional), "text": max 48, "emphasis": boolean }',
  '  { "block": "chips", "items": 2-5 strings, each max 16 }  tags, names, categories',
  '  { "block": "badge", "text": max 18 }  small kicker above a heading: year, rubric',
  '  { "block": "icon", "icon": icon name, "caption": max 30 (optional) }  one big symbol',
  '  { "block": "divider", "variant": "line" | "vs" | "arrow" }  only between two blocks',
  '  { "block": "quote", "text": max 90, "attribution": max 40 (optional) }',
  '  { "block": "pair", "items": exactly 2 of { "label": max 16, "value": max 24, "icon": optional } }',
  "Rules checked by code:",
  "- at most one of number / ring / bars; at least one block that is not heading, caption, badge or divider;",
  "- the frame holds about 1000px: two rows plus a ring already fill it, so prefer 2-4 blocks;",
  "- number: |value - from| >= 2 unless decimals > 0.",
].join("\n");

const BLOCK_EXAMPLE = JSON.stringify({
  blocks: [
    { block: "badge", text: "Since 2010" },
    { block: "heading", text: "Battery packs got cheaper", emphasisWords: ["cheaper"], size: "l" },
    { block: "ring", percent: 89, label: "Drop in price per kWh", at: 0.2, motion: "pop" },
    { block: "caption", text: "BloombergNEF survey", at: 0.5 },
  ],
});

/** Что главный блок значит для модели: без пояснения она ставит кольцо на любое число. */
const HERO_HINT = {
  ring: "a ring: the narration states a share or percentage of a whole",
  number: "a number: one real figure from the narration or sources, counted up",
  bars: "bars: two to four comparable values of the same unit",
  pair: "a pair: two sides, before/after or A versus B",
  divider: 'a "vs" or "arrow" divider between two contrasting blocks',
  row: "rows: one to four short points, the key one with emphasis",
  chips: "chips: several short names, tags or categories",
  icon: "a big icon: one symbol that carries the idea",
  quote: "a quote: a striking line, attributed only if the narration names who said it",
};
const DATA_HEROES = new Set(["ring", "number", "bars"]);

const iconList = IconNameSchema.options.join(", ");

/**
 * Достаёт полезную нагрузку из ответа модели.
 *
 * Модель периодически заворачивает объект: {"visual": {...}} или {"timeline": {...}}.
 * Раньше это выглядело как «нет поля steps», сцена дважды не проходила валидацию и
 * откатывалась на hook-statement — из-за чего в ролике снова оказывалось три
 * текстовые сцены вместо запланированных timeline и kinetic-text.
 */
function unwrapContent(content, kind) {
  if (!content || typeof content !== "object") return content;
  if (content.error) throw new Error(`model returned error: ${String(content.error).slice(0, 120)}`);

  for (const key of ["visual", "scene", "data", kind]) {
    const nested = content[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return content;
}

async function fillVisual(beat, plan, index) {
  const system = [
    `You fill the visual of one scene in an informative vertical short video.`,
    "",
    `Scene kind: ${plan.kind}. Return a JSON object with exactly these fields:`,
    KIND_CONTRACT[plan.kind],
    "",
    `Example of a valid answer (shape, not content): ${KIND_EXAMPLE[plan.kind]}`,
    "Return the object itself: no wrapper key, no prose, no description of the visual.",
    NEEDS_ICONS.has(plan.kind) ? `\nAllowed icon values: ${iconList}` : "",
    "",
    "The visual must show what the narration says, in fewer words than the narration.",
    "Never invent numbers, names or sources. No markdown, no extra fields.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Video topic: ${beat.topic}`,
    `Scene narration: ${beat.narration}`,
    // Источники нужны только там, где на экране появляется число.
    plan.kind === "stat-counter" && beat.brief ? `\nSOURCES:\n${beat.brief}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const feedback = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Замечания предыдущей попытки уходят обратно в промпт: без них модель три раза
      // подряд присылала один шаг там, где схема требует минимум два.
      const attemptUser =
        feedback.length === 0
          ? user
          : `${user}\n\nYour previous answer was rejected:\n${feedback.map((f) => `- ${f}`).join("\n")}\nFix exactly these problems.`;
      const raw = await askJson({ system, user: attemptUser, maxTokens: 700, timeoutMs: 180000 });
      const content = unwrapContent(raw, plan.kind);
      // kind и подача идут ПОСЛЕ содержимого: модель иногда возвращает своё поле
      // kind, и оно перетирало запланированный тип — в ролике снова оказывались
      // три hook-statement подряд, хотя план был другим.
      const candidate = { ...content, kind: plan.kind, ...plan.presentation };
      const parsed = SceneVisualSpecSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
      feedback.length = 0;
      feedback.push(...issues);
      console.log(
        `  scene ${index + 1} (${plan.kind}) attempt ${attempt}: ${issues.join("; ")} | сырой ответ: ${JSON.stringify(raw).slice(0, 220)}`,
      );
    } catch (error) {
      console.log(`  scene ${index + 1} (${plan.kind}) attempt ${attempt}: ${error.message}`);
    }
  }

  // Детерминированный откат: сцена всё равно должна попасть в ролик.
  const words = beat.narration.split(/\s+/);
  let text = "";
  for (const word of words) {
    if ((text + " " + word).trim().length > 90) break;
    text = (text + " " + word).trim();
  }
  console.log(`  scene ${index + 1}: откат на hook-statement`);
  return SceneVisualSpecSchema.parse({ kind: "hook-statement", text, ...plan.presentation });
}


/**
 * Сцена из блоков. Главный блок обязателен (иначе разнообразие не гарантировано),
 * остальное модель решает сама. Три неудачи — откат на шаблонный тип этой сцены.
 */
async function fillComposed(beat, plan, index) {
  const allowed = [plan.hero, ...(DATA_HEROES.has(plan.hero) ? [...DATA_HEROES] : [])];
  const system = [
    "You design one scene of an informative vertical short video by composing blocks.",
    "You decide which blocks, their order, emphasis, timing and motion. Make the frame visual,",
    "not a paragraph: fewer words than the narration, one idea, a clear focal point.",
    "",
    `This scene must be built around ${HERO_HINT[plan.hero]}.`,
    DATA_HEROES.has(plan.hero)
      ? "If the narration has no figure for it, use another of number / ring / bars that fits the real figure. Never invent numbers."
      : "",
    "",
    "Return JSON:",
    BLOCK_CONTRACT,
    "",
    `Example (shape, not content): ${BLOCK_EXAMPLE}`,
    "Return the object itself: no wrapper key, no prose.",
    `\nAllowed icon values: ${iconList}`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Video topic: ${beat.topic}`,
    `Scene narration: ${beat.narration}`,
    DATA_HEROES.has(plan.hero) && beat.brief ? `\nSOURCES:\n${beat.brief}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const feedback = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const attemptUser =
        feedback.length === 0
          ? user
          : `${user}\n\nYour previous answer was rejected:\n${feedback.map((f) => `- ${f}`).join("\n")}\nFix exactly these problems.`;
      const raw = await askJson({ system, user: attemptUser, maxTokens: 1100, timeoutMs: 180000 });
      const content = unwrapContent(raw, "composed");
      const blocks = Array.isArray(content) ? content : content?.blocks;
      const candidate = { kind: "composed", blocks, ...plan.presentation };

      let parsed = SceneVisualSpecSchema.safeParse(candidate);
      // Не влезло только из-за композиции со сдвигом центра — центр даёт больше высоты,
      // и это дешевле, чем ещё один запрос к модели.
      if (!parsed.success && plan.presentation.layout !== "center" &&
          parsed.error.issues.every((i) => i.message.includes("do not fit"))) {
        parsed = SceneVisualSpecSchema.safeParse({ ...candidate, layout: "center" });
      }

      const issues = parsed.success ? [] : parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`);
      if (parsed.success && !parsed.data.blocks.some((b) => allowed.includes(b.block))) {
        issues.push(`the scene must contain a "${plan.hero}" block`);
      }
      if (issues.length === 0) return parsed.data;

      feedback.length = 0;
      feedback.push(...issues);
      console.log(`  scene ${index + 1} (composed/${plan.hero}) attempt ${attempt}: ${issues.join("; ")}`);
    } catch (error) {
      console.log(`  scene ${index + 1} (composed/${plan.hero}) attempt ${attempt}: ${error.message}`);
    }
  }
  console.log(`  scene ${index + 1}: композиция не собралась, откат на ${plan.fallbackKind}`);
  return fillVisual(beat, { ...plan, kind: plan.fallbackKind }, index);
}

export async function generateScript(topic) {
  const { sources, brief } = await research(topic);
  const theme = await generateTheme(topic);
  const sourceBlock = brief
    ? [
        "",
        "SOURCES (use only facts and numbers that appear here; do not invent figures):",
        brief,
      ].join("\n")
    : "";

  const outline = await askJson({
    system: OUTLINE_SYSTEM,
    user: `Topic: ${topic}${sourceBlock}`,
    maxTokens: 1600,
    timeoutMs: 180000,
  });
  const beats = (outline.beats ?? []).slice(0, SCENE_COUNT).map((beat) => ({ ...beat, topic }));
  if (beats.length < 5) throw new Error(`outline returned ${beats.length} beats`);

  const plans = planScenes(beats);
  console.log(`  план: ${plans.map((p) => (p.hero ? `composed/${p.hero}` : p.kind)).join(", ")}`);

  const visuals = await mapLimited(beats, CONCURRENCY, (beat, index) =>
    plans[index].kind === "composed"
      ? fillComposed({ ...beat, brief }, plans[index], index)
      : fillVisual({ ...beat, brief }, plans[index], index),
  );

  const script = ScriptSchema.parse({
    title: (outline.title ?? topic).slice(0, 120),
    fps: 30,
    scenes: beats.map((beat, index) => ({
      id: `scene-${index + 1}`,
      narration: beat.narration,
      visual: visuals[index],
    })),
  });

  return { script, sources, theme };
}
