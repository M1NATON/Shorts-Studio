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
  IconNameSchema,
  NARRATION_MAX_CHARS,
  NARRATION_TARGET_CHARS,
  SceneVisualSpecSchema,
  ScriptSchema,
  SPEECH_CHARS_PER_SEC,
} from "@shorts/contracts";
import { askJson, mapLimited } from "./llm.mjs";

const SCENE_COUNT = 8;
/** Прокси отдавал 504 на трёх одновременных запросах. */
const CONCURRENCY = 2;

const INTENTS = ["hook", "fact", "number", "contrast", "list", "takeaway"];

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
  'Use "contrast" for A-versus-B, "list" for two to four parallel points, "fact" otherwise.',
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

const NEEDS_ICONS = new Set(["stat-counter", "icon-list", "comparison"]);

/** Тип сцены по замыслу тезиса. */
const KIND_BY_INTENT = {
  hook: "hook-statement",
  number: "stat-counter",
  contrast: "comparison",
  list: "icon-list",
  fact: "icon-list",
  takeaway: "outro-cta",
};

/** Чем заменить тип, если он повторяется подряд. */
const ALTERNATIVES = {
  "icon-list": ["comparison", "hook-statement"],
  comparison: ["icon-list", "hook-statement"],
  "hook-statement": ["icon-list", "comparison"],
  "stat-counter": ["icon-list", "comparison"],
};

const LAYOUTS = ["center", "top", "left", "stacked"];
const MOTIONS = ["rise", "slide", "pop", "fade"];
const ACCENT_SHIFTS = [0, 12, -10, 16, -14, 8, -6, 14];

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
  for (let i = 1; i < kinds.length - 1; i++) {
    if (kinds[i] !== kinds[i - 1]) continue;
    const options = ALTERNATIVES[kinds[i]] ?? ["icon-list"];
    kinds[i] = options.find((option) => option !== kinds[i - 1] && option !== kinds[i + 1]) ?? options[0];
  }

  // Доля текстовых сцен: лишние переводим в список.
  const textLimit = Math.max(1, Math.floor(beats.length * 0.4));
  let textCount = kinds.filter((kind) => kind === "hook-statement").length;
  for (let i = kinds.length - 2; i > 0 && textCount > textLimit; i--) {
    if (kinds[i] !== "hook-statement") continue;
    if (kinds[i - 1] === "icon-list" || kinds[i + 1] === "icon-list") continue;
    kinds[i] = "icon-list";
    textCount--;
  }

  return kinds.map((kind, index) => ({
    kind,
    presentation: {
      // Смещаем циклы друг относительно друга, чтобы соседние сцены не совпали
      // сразу по композиции и по движению.
      layout: LAYOUTS[index % LAYOUTS.length],
      motion: MOTIONS[(index * 3) % MOTIONS.length],
      accentShift: ACCENT_SHIFTS[index % ACCENT_SHIFTS.length],
    },
  }));
}

const iconList = IconNameSchema.options.join(", ");

async function fillVisual(beat, plan, index) {
  const system = [
    `You fill the visual of one scene in an informative vertical short video.`,
    "",
    `Scene kind: ${plan.kind}. Return JSON with exactly these fields:`,
    KIND_CONTRACT[plan.kind],
    NEEDS_ICONS.has(plan.kind) ? `\nAllowed icon values: ${iconList}` : "",
    "",
    "The visual must show what the narration says, in fewer words than the narration.",
    "Never invent numbers, names or sources. No markdown, no extra fields.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [`Video topic: ${beat.topic}`, `Scene narration: ${beat.narration}`].join("\n");

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const content = await askJson({ system, user, maxTokens: 700, timeoutMs: 90000 });
      const candidate = { kind: plan.kind, ...content, ...plan.presentation };
      const parsed = SceneVisualSpecSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      const issues = parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`);
      console.log(`  scene ${index + 1} (${plan.kind}) attempt ${attempt}: ${issues.join("; ")}`);
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

export async function generateScript(topic) {
  const outline = await askJson({
    system: OUTLINE_SYSTEM,
    user: `Topic: ${topic}`,
    maxTokens: 1600,
    timeoutMs: 180000,
  });
  const beats = (outline.beats ?? []).slice(0, SCENE_COUNT).map((beat) => ({ ...beat, topic }));
  if (beats.length < 5) throw new Error(`outline returned ${beats.length} beats`);

  const plans = planScenes(beats);
  console.log(`  план: ${plans.map((p) => p.kind).join(", ")}`);

  const visuals = await mapLimited(beats, CONCURRENCY, (beat, index) =>
    fillVisual(beat, plans[index], index),
  );

  return ScriptSchema.parse({
    title: (outline.title ?? topic).slice(0, 120),
    fps: 30,
    scenes: beats.map((beat, index) => ({
      id: `scene-${index + 1}`,
      narration: beat.narration,
      visual: visuals[index],
    })),
  });
}
