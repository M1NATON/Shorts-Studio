/**
 * Рендер уже готового манифеста без повторной генерации скрипта и озвучки.
 * Нужен при работе над визуалом: итерация занимает секунды, а не минуты, и не жжёт квоты API.
 *
 * Использование: node scripts/render-manifest.mjs [out.mp4]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ManifestSchema } from "@shorts/contracts";
import { renderVideo } from "@shorts/remotion";

const storageDir = resolve("storage");
const manifest = ManifestSchema.parse(JSON.parse(readFileSync(resolve(storageDir, "manifest.json"), "utf8")));
const outputPath = resolve(storageDir, "renders", process.argv[2] ?? "preview.mp4");

let last = -1;
await renderVideo({
  manifest,
  outputPath,
  storageDir,
  onProgress: (p) => {
    const pct = Math.round(p * 100);
    if (pct >= last + 20) {
      last = pct;
      console.log(`  ${pct}%`);
    }
  },
});
console.log(`Готово: ${outputPath}`);
