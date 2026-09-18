/**
 * Импорт ролика, собранного CLI (storage/manifest.json), в библиотеку студии:
 * проект, сцены с озвучкой (файлы копируются в каталог проекта) и обложка.
 *
 * Запуск: node scripts/import-manifest.mjs [storage/manifest.json] [--topic="Тема"]
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ManifestSchema } from "@shorts/contracts";
import { createRepository, openDatabase, projectPaths } from "@shorts/db";
import { renderStills } from "@shorts/remotion";

const args = process.argv.slice(2);
const storageDir = path.resolve(process.env.STORAGE_DIR ?? "storage");
const manifestPath = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(storageDir, "manifest.json"));
const topic = args.find((a) => a.startsWith("--topic="))?.slice(8);

const manifest = ManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
const database = openDatabase(path.join(storageDir, process.env.DB_FILE ?? "studio.sqlite"));
const repo = createRepository(database);

const project = await repo.createProject({ topic: topic ?? manifest.title, format: manifest.format });
const briefPath = path.join(path.dirname(manifestPath), "research-brief.txt");
const brief = await readFile(briefPath, "utf8").catch(() => "");
const scenes = await repo.saveScript(project.id, {
  script: {
    title: manifest.title,
    language: "en",
    fps: manifest.fps,
    format: manifest.format,
    scenes: manifest.scenes.map((s) => ({ id: s.sceneId, narration: s.narration, visual: s.visual, ...(s.intent ? { intent: s.intent } : {}) })),
  },
  theme: manifest.theme,
  sources: manifest.sources,
  brief,
  freshness: manifest.freshness ?? "evergreen",
  researchedAt: manifest.researchedAt ?? new Date().toISOString().slice(0, 10),
  unverified: manifest.scenes.map((s) => s.unverifiedNumbers),
});

for (const [i, scene] of scenes.entries()) {
  const source = manifest.scenes[i];
  const hash = `import-${project.id.slice(0, 8)}-${i + 1}`;
  const rel = projectPaths(project.id).audio(hash);
  await mkdir(path.dirname(path.join(storageDir, rel)), { recursive: true });
  await copyFile(path.join(storageDir, source.audioSrc), path.join(storageDir, rel));
  await repo.setAudio(scene.version.id, {
    path: rel,
    hash,
    durationSec: source.audioDurationSec,
    words: source.words,
    timingSource: source.timingSource,
  });
}

const built = await repo.buildManifest(project.id);
const first = built.manifest.scenes[0];
const thumb = projectPaths(project.id).thumbnail;
await renderStills({
  // Обложка без субтитров — как у сервера (makeThumbnail).
  manifest: { ...built.manifest, scenes: built.manifest.scenes.map((s) => ({ ...s, words: [] })) },
  storageDir,
  frames: [first.startFrame + Math.round(first.durationInFrames * 0.8)],
  outputPath: () => path.join(storageDir, thumb),
});
await repo.updateProject(project.id, {
  thumbnailPath: thumb,
  durationSec: Math.round((built.manifest.totalDurationInFrames / built.manifest.fps) * 10) / 10,
});
database.close();
console.log(`Импортирован: ${manifest.title} → проект ${project.id}`);
