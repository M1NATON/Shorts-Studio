/**
 * Пересборка визуала одной сцены готового ролика — без переозвучки и без
 * трогания остальных сцен. Варианты пишутся отдельными манифестами с кадром
 * каждого; исходный манифест не меняется.
 *
 * Запуск (ключи из Настроек студии или .env):
 *   node scripts/regen-scene.mjs <номер сцены с 1> ["пожелание"] [--variants=2] [--manifest=storage/manifest.json]
 * Применить вариант: cp storage/variants/variant-N.json storage/manifest.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ManifestSchema } from "@shorts/contracts";
import { regenerateSceneVisual } from "@shorts/llm-core";
import { renderStills } from "@shorts/remotion";
import { cliContext } from "./lib/cli-context.mjs";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const sceneNumber = Number(positional[0]);
const instruction = positional[1];
const variants = Number(option("variants") ?? 2);
const storageDir = resolve("storage");
const manifestPath = resolve(option("manifest") ?? resolve(storageDir, "manifest.json"));

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > manifest.scenes.length) {
  throw new Error(`номер сцены: от 1 до ${manifest.scenes.length}`);
}
const index = sceneNumber - 1;
const briefPath = resolve(storageDir, "research-brief.txt");
const brief = existsSync(briefPath) ? readFileSync(briefPath, "utf8") : "";

console.log(`Сцена ${sceneNumber}: «${manifest.scenes[index].narration}»${instruction ? `\nПожелание: ${instruction}` : ""}`);
const result = await regenerateSceneVisual(await cliContext(), {
  topic: manifest.title,
  brief,
  scenes: manifest.scenes.map((s) => ({ narration: s.narration, visual: s.visual, intent: s.intent })),
  index,
  instruction,
  variants,
  format: manifest.format,
});

const outDir = resolve(storageDir, "variants");
mkdirSync(outDir, { recursive: true });
const scene = manifest.scenes[index];
const frame = scene.startFrame + Math.round(scene.durationInFrames * 0.85);
for (const [i, variant] of result.entries()) {
  const next = ManifestSchema.parse({
    ...manifest,
    scenes: manifest.scenes.map((s, j) => (j === index ? { ...s, visual: variant.visual } : s)),
  });
  const file = resolve(outDir, `variant-${i + 1}.json`);
  writeFileSync(file, JSON.stringify(next, null, 2));
  await renderStills({ manifest: next, storageDir, frames: [frame], outputPath: () => resolve(outDir, `variant-${i + 1}.png`) });
  console.log(`  ${i + 1}. ${variant.label} → ${file}`);
}
