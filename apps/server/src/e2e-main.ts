/**
 * Сервер для сквозного теста в браузере: настоящие база, очередь, SSE, Remotion
 * (обложки и MP4), но детерминированная модель и тихая озвучка. Реальные
 * провайдеры медленные, платные и недетерминированные — e2e проверяет студию,
 * а не их. Ключей здесь нет вообще.
 *
 * Запуск (его делает playwright.config.ts): STORAGE_DIR=… PORT=3201 node apps/server/dist/e2e-main.js
 */
import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRepository, openDatabase } from "@shorts/db";
import type { LlmClient } from "@shorts/llm-core";
import { renderStills, renderVideo } from "@shorts/remotion";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { StudioEvents } from "./events.js";
import type { PipelineDeps } from "./pipeline.js";
import { createProviderStore } from "@shorts/db";
import { startWorker } from "./worker.js";

const BEATS = [
  { narration: "Batteries got ninety percent cheaper in a decade.", intent: "hook" },
  { narration: "Packs cost 115 dollars per kWh in 2024.", intent: "number" },
  { narration: "Three forces drove the price down together.", intent: "list" },
  { narration: "Old chemistry versus the new cheaper one.", intent: "contrast" },
  { narration: "Cheap storage changes the whole grid.", intent: "takeaway" },
];

/** Модель-заглушка: отвечает по виду промпта, как в unit-тестах сервера. */
const llm: LlmClient = {
  async askJson({ system, user }) {
    if (system.includes("visual identity")) return { error: "default theme" };
    if (system.includes("plan web research")) return { freshness: "evergreen", queries: ["x"] };
    if (system.includes("plan informative")) return { title: `Video: ${user.split("\n")[0]!.replace("Topic: ", "")}`, beats: BEATS };
    if (system.includes("rewrite the narration")) return { narration: "Scale, chemistry and competition cut the price." };
    if (system.includes("composing blocks")) {
      return {
        blocks: [
          { block: "heading", text: "Scale wins", size: "l", at: 0 },
          { block: "icon", icon: "zap", at: 0.2 },
          { block: "row", text: "Bigger factories", emphasis: true, at: 0.35 },
        ],
      };
    }
    if (system.includes("outro-cta")) return { text: "Storage is the story" };
    if (system.includes("kinetic-text")) return { lines: ["Cheaper", "every year"], emphasisLine: 1 };
    if (system.includes("timeline")) return { steps: [{ label: "Mine", text: "Lithium" }, { label: "Refine", text: "Cells" }] };
    return { variant: "statement", text: "Batteries got cheap" };
  },
};

/** Тихий WAV: длительность по числу слов, тайминги слов равномерные. */
async function silentVoice(narration: string, absPath: string) {
  const words = narration.split(/\s+/).filter(Boolean);
  const durationSec = Math.max(1.5, words.length * 0.32);
  const rate = 22050;
  const samples = Math.round(durationSec * rate);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, Buffer.concat([header, Buffer.alloc(samples * 2)]));
  const step = durationSec / words.length;
  return {
    durationSec,
    words: words.map((text, i) => ({ text, start: i * step, end: (i + 1) * step })),
    timingSource: "native" as const,
    unmatched: 0,
  };
}

// Окружение намеренно не читается целиком: только каталог и порт, никаких ключей.
const config = loadConfig({ STORAGE_DIR: process.env.STORAGE_DIR, PORT: process.env.PORT ?? "3201" });
mkdirSync(config.storageDir, { recursive: true });
const database = openDatabase(config.dbPath);
const repo = createRepository(database);
const events = new StudioEvents();

const deps: PipelineDeps = {
  repo,
  events,
  storageDir: config.storageDir,
  generationContext: async (onProgress) => ({ llm, today: "2026-09-18", onProgress }),
  voice: silentVoice,
  voiceKey: async () => "e2e-silent",
  render: async (manifest, outputPath, onProgress) => {
    await renderVideo({ manifest, outputPath, storageDir: config.storageDir, onProgress });
  },
  still: async (manifest, frame, output) => {
    await renderStills({ manifest, storageDir: config.storageDir, frames: [frame], outputPath: () => output });
  },
};

const worker = startWorker(deps, { pollMs: 300, log: (m) => console.error(m) });
const app = await buildApp({
  ...deps,
  config,
  providers: createProviderStore(repo, config.envProviders),
  testProvider: async (kind) => ({ ok: true, message: `e2e ${kind}` }),
  previewVoice: async () => Buffer.from("RIFF"),
  worker,
});
await app.listen({ host: config.host, port: config.port });
console.log(`e2e API: http://${config.host}:${config.port}`);
