/**
 * Вертикальный срез пайплайна: тема → сценарий (LLM) → озвучка (Fish) → манифест → MP4.
 * Запуск: set -a; . ./.env; set +a; node scripts/make-video.mjs "Тема"
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ManifestSchema, SHORTS_SIZE, ScriptSchema, SceneVisualSpecSchema } from "@shorts/contracts";
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
const SCENE_COUNT = 5;

const visualJsonSchema = z.toJSONSchema(SceneVisualSpecSchema, { target: "draft-2020-12" });

const SYSTEM = [
  "You write informative vertical short videos (9:16, ~25 seconds), in English.",
  "",
  'Return JSON: { "title": string, "scenes": [ { "narration": string, "visual": <SceneVisualSpec> } ] }',
  `Exactly ${SCENE_COUNT} scenes.`,
  "",
  "narration: one spoken sentence, max 240 characters, one fact per scene.",
  "visual must validate against this JSON Schema:",
  JSON.stringify(visualJsonSchema),
  "",
  'Structure: scene 1 is a hook (kind "hook-statement"), the last scene is "outro-cta".',
  "VISUAL VARIETY (mandatory):",
  "- Never use more than 2 text-only scenes (hook-statement) in a row.",
  '- Include at least one "stat-counter" built on a real, widely documented figure.',
  '- Data-bearing kinds require real verifiable values; if unsure, use "hook-statement".',
].join("\n");


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
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Topic: ${TOPIC}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.8,
        // Прокси обрывает соединение, если ответ не начал поступать за 30 с
        // ("Direct response did not start within 30000ms"), а reasoning-модель думает дольше.
        // Стриминг отдаёт первый байт сразу, поэтому лимит не срабатывает.
        stream: true,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      console.log(`  attempt ${attempt}: HTTP ${res.status}, retry`);
      continue;
    }
    const raw = JSON.parse(await collectStream(res));
    const withIds = { ...raw, scenes: (raw.scenes ?? []).map((s, i) => ({ ...s, id: `scene-${i + 1}` })) };
    const parsed = ScriptSchema.safeParse(withIds);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
    console.log(`  attempt ${attempt}: schema error → ${issues.join("; ")}`);
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
