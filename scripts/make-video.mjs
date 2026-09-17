/**
 * Вертикальный срез пайплайна: тема → сценарий (LLM) → озвучка (Fish) → манифест → MP4.
 * Запуск: set -a; . ./.env; set +a; node scripts/make-video.mjs "Тема"
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ManifestSchema,
  NARRATION_MAX_CHARS,
  NARRATION_TARGET_CHARS,
  SCENE_COUNT_RANGE,
  SHORTS_SIZE,
  SPEECH_CHARS_PER_SEC,
  ScriptSchema,
  SceneVisualSpecSchema,
} from "@shorts/contracts";
import {
  assembleFishStream,
  mapTimingsToOriginalText,
  parseSseEvents,
  probeDurationSec,
  recomputeTimeline,
} from "@shorts/media-core";
import { renderVideo } from "@shorts/remotion";

const TOPIC = process.argv[2] ?? "Will AI actually rebel in 2026";
const STORAGE = path.resolve("storage");
const FPS = 30;
/**
 * Целевое число сцен. Схема допускает 5..9; берём верх диапазона, потому что при
 * лимите озвучки 110 символов (~8 с) именно число сцен задаёт темп: 8 сцен по 4 с
 * читаются как динамичный клип, 5 сцен по 7 с — как слайд-шоу.
 */
const SCENE_COUNT = 8;
/** Не больше такой доли сцен без визуальных данных — иначе видео превращается в титры. */
const MAX_TEXT_SCENE_SHARE = 0.4;

const visualJsonSchema = z.toJSONSchema(SceneVisualSpecSchema, { target: "draft-2020-12" });

const SYSTEM = [
  "You write informative vertical short videos (9:16, 30-40 seconds), in English.",
  "",
  'Return JSON: { "title": string, "scenes": [ { "narration": string, "visual": <SceneVisualSpec> } ] }',
  `${SCENE_COUNT} scenes (${SCENE_COUNT_RANGE.min}-${SCENE_COUNT_RANGE.max} allowed).`,
  "",
  `narration: ONE short spoken sentence, ${NARRATION_TARGET_CHARS.min}-${NARRATION_TARGET_CHARS.max} characters,`,
  `hard maximum ${NARRATION_MAX_CHARS}. Speech runs at ~${SPEECH_CHARS_PER_SEC} characters per second,`,
  "so a long sentence freezes the scene. One idea per scene, no filler, no throat-clearing.",
  "",
  "visual must validate against this JSON Schema:",
  JSON.stringify(visualJsonSchema),
  "",
  'Structure: scene 1 is a hook (kind "hook-statement"), the last scene is "outro-cta".',
  "VISUAL VARIETY (mandatory, checked programmatically — violations are rejected):",
  `- At most ${Math.floor(SCENE_COUNT * MAX_TEXT_SCENE_SHARE)} text-only scenes (hook-statement) in the whole video.`,
  "- Never two scenes of the same kind in a row.",
  '- Use at least two different visual kinds among "icon-list", "stat-counter", "comparison".',
  '- Data-bearing kinds require real verifiable values; if unsure, use "icon-list" with claims, not invented numbers.',
].join("\n");

/**
 * Программная проверка баланса.
 *
 * Промпт с квотами модель уже игнорировала (в прошлом прогоне взяла hook-statement
 * 3 раза из 5), поэтому правила проверяются кодом, а нарушения возвращаются модели
 * текстом — так ретрай исправляет ошибку, а не бросает кости заново.
 */
function findBalanceViolations(script) {
  const kinds = script.scenes.map((scene) => scene.visual.kind);
  const violations = [];

  if (kinds[0] !== "hook-statement") violations.push('scene 1 must be "hook-statement"');
  if (kinds[kinds.length - 1] !== "outro-cta") violations.push('the last scene must be "outro-cta"');

  const textScenes = kinds.filter((kind) => kind === "hook-statement").length;
  const textLimit = Math.max(1, Math.floor(script.scenes.length * MAX_TEXT_SCENE_SHARE));
  if (textScenes > textLimit) {
    violations.push(`too many text-only scenes: ${textScenes} hook-statement, limit ${textLimit}`);
  }

  for (let i = 1; i < kinds.length; i++) {
    if (kinds[i] === kinds[i - 1]) {
      violations.push(`scenes ${i} and ${i + 1} have the same kind "${kinds[i]}"`);
    }
  }

  const visualKinds = new Set(kinds.filter((kind) => kind === "icon-list" || kind === "stat-counter" || kind === "comparison"));
  if (visualKinds.size < 2) {
    violations.push('use at least two different kinds among "icon-list", "stat-counter", "comparison"');
  }

  const tooLong = script.scenes.filter((scene) => scene.narration.length > NARRATION_TARGET_CHARS.max);
  if (tooLong.length > Math.ceil(script.scenes.length / 3)) {
    violations.push(
      `${tooLong.length} scenes exceed ${NARRATION_TARGET_CHARS.max} characters of narration — shorten them`,
    );
  }

  return violations;
}

/** Собирает content из SSE-стрима OpenAI-совместимого ответа. */
async function collectStream(res) {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        content += JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
      } catch {
        // неполный кадр — придёт в следующем чанке
      }
    }
  }
  return content;
}

async function generateScript() {
  const feedback = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Topic: ${TOPIC}` },
    ];
    if (feedback.length > 0) {
      messages.push({
        role: "user",
        content: `Your previous answer was rejected:\n${feedback.map((f) => `- ${f}`).join("\n")}\nReturn the full corrected JSON.`,
      });
    }

    const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.8,
        // Прокси обрывает соединение, если ответ не начал поступать за 30 с
        // ("Direct response did not start within 30000ms"), а reasoning-модель думает дольше.
        // Стриминг отдаёт первый байт сразу, поэтому лимит не срабатывает.
        stream: true,
        max_tokens: 6000,
      }),
      signal: AbortSignal.timeout(240000),
    });
    if (!res.ok) {
      console.log(`  attempt ${attempt}: HTTP ${res.status}, retry`);
      continue;
    }

    let raw;
    try {
      raw = JSON.parse(await collectStream(res));
    } catch (error) {
      console.log(`  attempt ${attempt}: ответ не JSON (${error.message}), retry`);
      continue;
    }

    const withIds = { ...raw, scenes: (raw.scenes ?? []).map((s, i) => ({ ...s, id: `scene-${i + 1}` })) };
    const parsed = ScriptSchema.safeParse(withIds);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`);
      console.log(`  attempt ${attempt}: schema error → ${issues.join("; ")}`);
      feedback.length = 0;
      feedback.push(...issues);
      continue;
    }

    const violations = findBalanceViolations(parsed.data);
    if (violations.length === 0) return parsed.data;

    console.log(`  attempt ${attempt}: баланс → ${violations.join("; ")}`);
    feedback.length = 0;
    feedback.push(...violations);
  }
  throw new Error("LLM failed to produce a valid script in 3 attempts");
}

async function synthesize(scene) {
  const res = await fetch("https://api.fish.audio/v1/tts/stream/with-timestamp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FISH_API_KEY}`,
      "Content-Type": "application/json",
      model: process.env.FISH_MODEL,
    },
    body: JSON.stringify({
      text: scene.narration,
      reference_id: process.env.FISH_REFERENCE_ID,
      format: "wav",
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Fish HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { audio, words } = assembleFishStream(parseSseEvents(await res.text()));

  const relPath = path.join("audio", `${scene.id}.wav`);
  const absPath = path.join(STORAGE, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, audio);

  const durationSec = await probeDurationSec(absPath);
  const mapped = mapTimingsToOriginalText(scene.narration, words);
  return { relPath, durationSec, words: mapped.words, unmatched: mapped.unmatched };
}

console.log(`\n1/4 Сценарий: "${TOPIC}"`);
const script = await generateScript();
console.log(`  «${script.title}» — ${script.scenes.length} сцен: ${script.scenes.map((s) => s.visual.kind).join(", ")}`);

console.log("\n2/4 Озвучка по сценам (Fish)");
const audio = [];
for (const scene of script.scenes) {
  const result = await synthesize(scene);
  audio.push(result);
  console.log(`  ${scene.id}: ${result.durationSec.toFixed(2)}s, ${result.words.length} слов, unmatched=${result.unmatched}`);
}

console.log("\n3/4 Манифест");
const { slots, totalDurationInFrames } = recomputeTimeline(
  script.scenes.map((s, i) => ({ sceneId: s.id, audioDurationSec: audio[i].durationSec })),
  FPS,
);
const manifest = ManifestSchema.parse({
  version: 1,
  projectId: "vertical-slice",
  sourceHash: `slice-${Date.now()}`,
  title: script.title,
  fps: FPS,
  ...SHORTS_SIZE,
  totalDurationInFrames,
  scenes: script.scenes.map((scene, i) => ({
    sceneId: scene.id,
    visual: scene.visual,
    narration: scene.narration,
    startFrame: slots[i].startFrame,
    durationInFrames: slots[i].durationInFrames,
    audioDurationSec: audio[i].durationSec,
    audioSrc: audio[i].relPath,
    words: audio[i].words,
    timingSource: "native",
  })),
});
await mkdir(path.join(STORAGE, "renders"), { recursive: true });
await writeFile(path.join(STORAGE, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`  ${totalDurationInFrames} кадров = ${(totalDurationInFrames / FPS).toFixed(1)}s`);

console.log("\n4/4 Рендер MP4");
const output = path.join(STORAGE, "renders", "vertical-slice.mp4");
let lastLogged = -1;
await renderVideo({
  manifest,
  outputPath: output,
  storageDir: STORAGE,
  onProgress: (p) => {
    const pct = Math.floor(p * 100);
    if (pct >= lastLogged + 20) {
      lastLogged = pct;
      console.log(`  ${pct}%`);
    }
  },
});
console.log(`\nГотово: ${output}`);
