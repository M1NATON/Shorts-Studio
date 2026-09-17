/**
 * Вертикальный срез пайплайна: тема → сценарий (LLM) → озвучка (Fish) → манифест → MP4.
 * Запуск: set -a; . ./.env; set +a; node scripts/make-video.mjs "Тема"
 *
 * Генерация сценария живёт в scripts/lib/script-gen.mjs — три маленьких этапа
 * вместо одного большого запроса.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ManifestSchema, SHORTS_SIZE } from "@shorts/contracts";
import {
  assembleFishStream,
  mapTimingsToOriginalText,
  parseSseEvents,
  probeDurationSec,
  recomputeTimeline,
} from "@shorts/media-core";
import { renderVideo } from "@shorts/remotion";
import { generateScript } from "./lib/script-gen.mjs";

const TOPIC = process.argv[2] ?? "Will AI actually rebel in 2026";
const STORAGE = path.resolve("storage");
const FPS = 30;

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
const { script, sources } = await generateScript(TOPIC);
console.log(
  `  «${script.title}» — ${script.scenes.length} сцен: ${script.scenes
    .map((s) => `${s.visual.kind}/${s.visual.layout}/${s.visual.motion}`)
    .join(", ")}`,
);

console.log("\n2/4 Озвучка по сценам (Fish)");
const audio = [];
for (const scene of script.scenes) {
  const result = await synthesize(scene);
  audio.push(result);
  console.log(
    `  ${scene.id}: ${result.durationSec.toFixed(2)}s, ${result.words.length} слов, unmatched=${result.unmatched}`,
  );
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
  sources: sources.map(({ url, title }) => ({ url, title })),
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
