/**
 * Выровнять громкость и сгладить края у озвучки, сделанной до двухпроходного
 * loudnorm: storage/projects/<id>/audio/*.wav. Без обрезки и ускорения — тайминги
 * слов остаются верными. Файлы уже на целевой громкости пропускаются.
 *
 * Перед перезаписью оригиналы копируются в storage/audio-backup-<дата>/.
 * Запуск: node scripts/normalize-audio.mjs [--storage=storage]
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { normalizeNarration } from "@shorts/media-core";

const storage = process.argv.find((a) => a.startsWith("--storage="))?.split("=")[1] ?? "storage";
const projectsDir = path.join(storage, "projects");
const files = readdirSync(projectsDir).flatMap((id) => {
  const dir = path.join(projectsDir, id, "audio");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => path.join(dir, f)) : [];
});

const backup = path.join(storage, `audio-backup-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}`);
for (const file of files) {
  const target = path.join(backup, path.relative(projectsDir, file));
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(file, target);
}
console.log(`Копия ${files.length} файлов: ${backup}`);

const counts = { normalized: 0, skipped: 0, failed: 0 };
for (const [i, file] of files.entries()) {
  try {
    counts[await normalizeNarration(file)]++;
  } catch (error) {
    counts.failed++;
    console.error(`${file}: ${error.message}`);
  }
  if ((i + 1) % 25 === 0) console.log(`${i + 1} из ${files.length}`);
}
console.log(`Готово: выровнено ${counts.normalized}, уже в норме ${counts.skipped}, ошибок ${counts.failed}.`);
