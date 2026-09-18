/**
 * Кадры каждой сцены в PNG: на входе блоков, в середине и перед склейкой.
 * Проверка визуала за секунды, без рендера MP4.
 *
 * Использование: node scripts/render-stills.mjs [manifest.json] [outDir]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ManifestSchema } from "@shorts/contracts";
import { renderStills } from "@shorts/remotion";

const storageDir = resolve("storage");
const manifestPath = resolve(process.argv[2] ?? resolve(storageDir, "manifest.json"));
const outDir = resolve(process.argv[3] ?? resolve(storageDir, "stills"));
mkdirSync(outDir, { recursive: true });

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const frames = manifest.scenes.flatMap((scene) =>
  [0.12, 0.5, 0.85].map((share) => scene.startFrame + Math.round(scene.durationInFrames * share)),
);

const sceneOf = (frame) => manifest.scenes.findLast((s) => s.startFrame <= frame);
const written = await renderStills({
  manifest,
  storageDir,
  frames,
  outputPath: (frame) => {
    const scene = sceneOf(frame);
    const pct = Math.round(((frame - scene.startFrame) / scene.durationInFrames) * 100);
    return resolve(outDir, `${scene.sceneId}-${scene.visual.kind}-${String(pct).padStart(2, "0")}.png`);
  },
});
console.log(`${written.length} кадров → ${outDir}`);
