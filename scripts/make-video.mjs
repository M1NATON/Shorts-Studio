/**
 * Вертикальный срез пайплайна: тема → сценарий (LLM) → озвучка (Fish) → манифест → MP4.
 * Запуск: set -a; . ./.env; set +a; node scripts/make-video.mjs "Тема" [--freshness=current|evergreen]
 *   [--format=shorts|landscape] [--minutes=3]
 * Без --freshness режим поиска выбирает модель по теме. --minutes только для landscape.
 *
 * Генерация сценария живёт в @shorts/llm-core (generateScript): поиск и дизайн,
 * план тезисов, раскладка кодом, наполнение по сцене. Здесь только обёртка:
 * ключи из окружения, озвучка, манифест, рендер.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FORMATS, ManifestSchema } from "@shorts/contracts";
import {
  assembleFishStream,
  mapTimingsToOriginalText,
  parseSseEvents,
  probeDurationSec,
  recomputeTimeline,
} from "@shorts/media-core";
import { renderVideo } from "@shorts/remotion";
import { generateLongScript, generateScript } from "@shorts/llm-core";
import { cliContext } from "./lib/cli-context.mjs";

const args = process.argv.slice(2);
const TOPIC = args.find((a) => !a.startsWith("--")) ?? "Will AI actually rebel in 2026";
const freshnessArg = args.find((a) => a.startsWith("--freshness="))?.split("=")[1];
if (freshnessArg && !["current", "evergreen"].includes(freshnessArg)) {
  throw new Error(`--freshness: ожидается current или evergreen, получено ${freshnessArg}`);
}
const FORMAT = args.find((a) => a.startsWith("--format="))?.split("=")[1] ?? "shorts";
if (!(FORMAT in FORMATS)) throw new Error(`--format: ожидается shorts или landscape, получено ${FORMAT}`);
const MINUTES = Number(args.find((a) => a.startsWith("--minutes="))?.split("=")[1] ?? 3);
if (!(MINUTES > 0 && MINUTES <= 20)) throw new Error("--minutes: от 1 до 20");
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

console.log(`\n1/4 Сценарий (${FORMAT}${FORMAT === "landscape" ? `, ~${MINUTES} мин` : ""}): "${TOPIC}"`);
const generated =
  FORMAT === "landscape"
    ? await generateLongScript(cliContext(), TOPIC, { freshness: freshnessArg, minutes: MINUTES })
    : await generateScript(cliContext(), TOPIC, { freshness: freshnessArg });
const { script, sources, brief, theme, unverified, freshness, researchedAt } = generated;
if (generated.chapters) {
  console.log(`  главы: ${generated.chapters.map((c) => `${c.firstScene + 1}. ${c.title}`).join(" · ")}`);
}
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
  format: FORMAT,
  width: FORMATS[FORMAT].width,
  height: FORMATS[FORMAT].height,
  totalDurationInFrames,
  theme,
  sources: sources.map(({ url, title, kind, publishedAt }) => ({ url, title, kind, publishedAt })),
  researchedAt,
  freshness,
  scenes: script.scenes.map((scene, i) => ({
    sceneId: scene.id,
    intent: scene.intent,
    visual: scene.visual,
    narration: scene.narration,
    startFrame: slots[i].startFrame,
    durationInFrames: slots[i].durationInFrames,
    audioDurationSec: audio[i].durationSec,
    audioSrc: audio[i].relPath,
    words: audio[i].words,
    timingSource: "native",
    unverifiedNumbers: unverified[i],
  })),
});
await mkdir(path.join(STORAGE, "renders"), { recursive: true });
await writeFile(path.join(STORAGE, "manifest.json"), JSON.stringify(manifest, null, 2));
// Сводка источников нужна для пересборки сцены (scripts/regen-scene.mjs) без нового поиска.
await writeFile(path.join(STORAGE, "research-brief.txt"), brief);
console.log(`  ${totalDurationInFrames} кадров = ${(totalDurationInFrames / FPS).toFixed(1)}s`);

console.log("\n4/4 Рендер MP4");
const output = path.join(STORAGE, "renders", FORMAT === "landscape" ? "landscape-slice.mp4" : "vertical-slice.mp4");
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
