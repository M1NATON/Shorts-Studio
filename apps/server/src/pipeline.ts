/**
 * Что делают задачи. Каждая функция — один вид задачи из очереди; зависимости
 * (модель, озвучка, рендер) приходят снаружи, поэтому конвейер тестируется без
 * сети и без браузера.
 *
 * Правило точечной правки: меняется одна сцена — перегенерируется, озвучивается
 * и пересчитывается только она. Озвучка переиспользуется по хешу текста и голоса.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MUSIC_VOLUME,
  MUSIC_MOODS,
  visualSpecSchemaFor,
  type Manifest,
  type MusicMood,
  type PublishMeta,
  type SceneIntent,
  type SceneMedia,
  type SceneVisualSpec,
  type VideoFormat,
} from "@shorts/contracts";
import {
  audioHash,
  NotReadyError,
  projectPaths,
  type JobRecord,
  type ProjectRecord,
  type Repository,
  type SceneAudio,
  type SceneRecord,
} from "@shorts/db";
import {
  checkNumbers,
  generateLongScript,
  generatePublishMeta,
  generateScript,
  mapLimited,
  regenerateSceneVisual,
  rewriteNarration,
  type GenerationContext,
  type GenerationProgress,
  type ResearchSource,
} from "@shorts/llm-core";
import type { MediaKind, MediaOrientation, PexelsCandidate, VoicedNarration } from "@shorts/media-core";
import type { StudioEvents } from "./events.js";

export interface PipelineDeps {
  readonly repo: Repository;
  readonly events: StudioEvents;
  readonly storageDir: string;
  /**
   * Контекст генерации с прогрессом этой задачи; бросает, если модель не настроена.
   * Асинхронный: настройки провайдеров читаются на каждую задачу — правка в UI
   * действует без перезапуска сервера.
   */
  readonly generationContext: (onProgress: (p: GenerationProgress) => void) => Promise<GenerationContext>;
  /** Озвучить фразу в файл; бросает, если TTS не настроен. */
  readonly voice: (narration: string, absPath: string) => Promise<VoicedNarration>;
  /** Идентификатор голоса для хеша озвучки: смена голоса = новая озвучка. */
  readonly voiceKey: () => Promise<string>;
  readonly render: (manifest: Manifest, outputAbs: string, onProgress: (p: number) => void, signal?: AbortSignal) => Promise<void>;
  readonly still: (manifest: Manifest, frame: number, outputAbs: string) => Promise<void>;
  /** Pexels apiKey, если провайдер настроен; undefined — шаги медиа молча пропускаются. */
  readonly mediaKey: () => Promise<string | undefined>;
  /** Кандидаты по запросу (одна страница, до 10); [] — ничего не нашлось. */
  readonly searchMedia: (input: { apiKey: string; query: string; kind: MediaKind; orientation: MediaOrientation; page?: number }) => Promise<PexelsCandidate[]>;
  /** Скачать кандидата на диск (временный файл + rename внутри). */
  readonly downloadMedia: (url: string, destAbs: string) => Promise<void>;
}

/** «Проверить»/сохранить медиа без ключа Pexels — понятная 409 в app.ts, не безликая ошибка сети. */
export class NoMediaKeyError extends Error {
  override readonly name = "NoMediaKeyError";
}

export class JobError extends Error {
  override readonly name = "JobError";
}

type Progress = (patch: { stage?: string; message?: string; done?: number | null; total?: number | null }) => Promise<void>;

function progressOf(deps: PipelineDeps, job: JobRecord): Progress {
  let last = 0;
  return async (patch) => {
    // Прогресс по сценам приходит часто; база и SSE обновляются не чаще 4 раз в секунду,
    // кроме смены этапа.
    const now = Date.now();
    if (!patch.stage && now - last < 250) return;
    last = now;
    const updated = await deps.repo.updateJob(job.id, patch);
    deps.events.emit({ type: "job", job: updated });
  };
}

/**
 * Озвучка версии сцены по хешу текста и голоса: та же фраза тем же голосом не
 * синтезируется заново (повторная подготовка не тратит TTS). `fresh` — новый
 * дубль по просьбе пользователя, мимо кеша.
 */
export async function voiceScene(deps: PipelineDeps, projectId: string, narration: string, fresh = false): Promise<SceneAudio> {
  const hash = audioHash(narration, await deps.voiceKey());
  const rel = projectPaths(projectId).audio(hash);
  const abs = path.join(deps.storageDir, rel);
  if (!fresh) {
    const cached = await deps.repo.findAudio(projectId, hash);
    if (cached && existsSync(path.join(deps.storageDir, cached.path))) return cached;
  }
  const voiced = await deps.voice(narration, abs);
  return { path: rel, hash, durationSec: voiced.durationSec, words: voiced.words, timingSource: voiced.timingSource };
}

// Сцены озвучиваются параллельно; реальная сетевая параллельность всё равно
// ограничена ttsSlot(2) в main.ts, здесь только защита от лавины промисов на длинных роликах.
const VOICE_CONCURRENCY = 2;

async function voiceMissing(deps: PipelineDeps, projectId: string, report: Progress): Promise<void> {
  const scenes = await deps.repo.currentScenes(projectId);
  const pending = scenes.filter((s) => !s.version.audio);
  // Одинаковый текст — один файл озвучки (путь по хешу): синтезируем его один раз, иначе две
  // параллельные задачи писали бы один и тот же файл.
  const byText = new Map<string, ReturnType<typeof voiceScene>>();
  let done = 0;
  await mapLimited(pending, VOICE_CONCURRENCY, async (scene) => {
    const text = scene.version.narration;
    if (!byText.has(text)) byText.set(text, voiceScene(deps, projectId, text));
    await deps.repo.setAudio(scene.version.id, await byText.get(text)!);
    done++;
    await report({ stage: "voice", message: `Озвучка: ${done} из ${pending.length}`, done, total: pending.length });
  });
}

/** Обложка библиотеки: кадр первой сцены, когда её текст уже вошёл. */
export async function makeThumbnail(deps: PipelineDeps, projectId: string): Promise<void> {
  const { manifest } = await deps.repo.buildManifest(projectId);
  const first = manifest.scenes[0]!;
  const rel = projectPaths(projectId).thumbnail;
  const abs = path.join(deps.storageDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  // Без субтитров: на карточке поверх них лежат бейджи статуса и длительности.
  const clean = { ...manifest, scenes: manifest.scenes.map((s) => ({ ...s, words: [] })) };
  await deps.still(clean, first.startFrame + Math.round(first.durationInFrames * 0.8), abs);
  await deps.repo.updateProject(projectId, {
    thumbnailPath: rel,
    durationSec: Math.round((manifest.totalDurationInFrames / manifest.fps) * 10) / 10,
  });
}

/**
 * Название/описание/хэштеги для YouTube по текущим сценам и источникам проекта.
 * 409 (NotReadyError), если у проекта ещё нет сцен — так же, как у buildManifest.
 */
export async function refreshPublishMeta(deps: PipelineDeps, projectId: string): Promise<PublishMeta> {
  const project = await deps.repo.requireProject(projectId);
  const scenes = await deps.repo.currentScenes(projectId);
  if (scenes.length === 0) throw new NotReadyError("project has no scenes yet");
  const ctx = await deps.generationContext(() => undefined);
  const meta = await generatePublishMeta(ctx.llm, {
    topic: project.title ?? project.topic,
    title: project.title ?? project.topic,
    format: project.format,
    narration: scenes.map((s) => s.version.narration),
  });
  await deps.repo.setPublish(projectId, meta);
  return meta;
}

/**
 * Источники для проверки чисел. Без выдержки (ролик импортирован из CLI, где
 * хранились только ссылки) проверять не по чему — иначе любое число в кадре,
 * даже год, помечалось бы как неподтверждённое.
 */
function sourcesOf(project: ProjectRecord): ResearchSource[] {
  return project.sources.filter((s) => s.excerpt).map((s) => ({ url: s.url, title: s.title, excerpt: s.excerpt ?? "", kind: s.kind ?? "web", ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}) }));
}

export interface MusicTrack {
  readonly file: string;
  readonly mood: MusicMood | null;
}

/** Треки из storage/music; настроение — префикс имени файла (calm-drift.mp3). */
export async function listMusic(storageDir: string): Promise<MusicTrack[]> {
  const files = await readdir(path.join(storageDir, "music")).catch(() => [] as string[]);
  return files
    .filter((file) => /\.(mp3|ogg|wav|m4a)$/i.test(file))
    .sort()
    .map((file) => {
      const prefix = file.split("-")[0]!.toLowerCase();
      return { file, mood: (MUSIC_MOODS as readonly string[]).includes(prefix) ? (prefix as MusicMood) : null };
    });
}

/**
 * Трек под настроение темы. Выбор детерминирован по id проекта: повторная сборка
 * того же ролика даёт тот же трек, а разные ролики одного настроения — разные.
 */
export function pickTrack(tracks: readonly MusicTrack[], mood: MusicMood, seed: string): string | undefined {
  const matching = tracks.filter((t) => t.mood === mood);
  const pool = matching.length ? matching : tracks;
  if (!pool.length) return undefined;
  return pool[createHash("sha1").update(seed).digest().readUInt32BE(0) % pool.length]!.file;
}

/** shorts — вертикальный кадр, portrait; landscape — горизонтальный. */
function orientationFor(format: VideoFormat): MediaOrientation {
  return format === "landscape" ? "landscape" : "portrait";
}

/** Имя строит вызывающий код из sceneId+pexelsId, не из URL кандидата. */
function mediaPath(projectId: string, sceneId: string, kind: MediaKind, pexelsId: number): string {
  return `${projectPaths(projectId).base}/media/${sceneId}-${pexelsId}.${kind === "photo" ? "jpg" : "mp4"}`;
}

function toSceneMedia(kind: MediaKind, query: string, rel: string, candidate: PexelsCandidate): SceneMedia {
  return {
    kind,
    query,
    src: rel,
    width: candidate.width,
    height: candidate.height,
    ...(candidate.durationSec ? { durationSec: candidate.durationSec } : {}),
    pexelsId: candidate.pexelsId,
    credit: candidate.credit,
  };
}

/** Удалить прежний файл медиа сцены — только если он и правда лежит в её папке media. */
async function removeOldMedia(deps: PipelineDeps, projectId: string, media: SceneMedia | null): Promise<void> {
  if (!media) return;
  const mediaDir = path.resolve(deps.storageDir, projectPaths(projectId).base, "media") + path.sep;
  const abs = path.resolve(deps.storageDir, media.src);
  if (abs.startsWith(mediaDir)) await rm(abs, { force: true });
}

interface MediaJob {
  readonly sceneId: string;
  readonly query: string;
  readonly kind: MediaKind;
}

/**
 * Фото/видео фона по сценам со mediaQuery — параллельно, но скачивания ограничены
 * общим лимитом (mediaSlot в main.ts). Нет ключа → пропускается молча; ошибка на
 * одной сцене — лог и сцена без медиа, генерация не падает.
 */
async function fillMedia(deps: PipelineDeps, project: ProjectRecord, jobs: readonly MediaJob[], report: Progress): Promise<void> {
  if (jobs.length === 0) return;
  const apiKey = await deps.mediaKey();
  if (!apiKey) return;
  const orientation = orientationFor(project.format);
  let done = 0;
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const [candidate] = await deps.searchMedia({ apiKey, query: job.query, kind: job.kind, orientation });
        if (candidate) {
          const rel = mediaPath(project.id, job.sceneId, job.kind, candidate.pexelsId);
          await deps.downloadMedia(candidate.url, path.join(deps.storageDir, rel));
          await deps.repo.setSceneMedia(job.sceneId, toSceneMedia(job.kind, job.query, rel, candidate));
        }
      } catch (error) {
        console.error(`media for scene ${job.sceneId} ("${job.query}"): ${(error as Error).message}`);
      } finally {
        done++;
        await report({ stage: "media", message: `Фото и видео: ${done} из ${jobs.length}`, done, total: jobs.length });
      }
    }),
  );
}

/**
 * Кандидат после текущего по выдаче Pexels; после последнего — снова первый.
 * ponytail: смотрим первые 3 страницы (30 кандидатов), дальше круг замыкается.
 */
export async function nextCandidate(
  search: (page: number) => Promise<PexelsCandidate[]>,
  currentId: number,
): Promise<PexelsCandidate | undefined> {
  let first: PexelsCandidate | undefined;
  let seen = false;
  for (let page = 1; page <= 3; page++) {
    const list = await search(page);
    for (const candidate of list) {
      first ??= candidate;
      if (seen) return candidate;
      if (candidate.pexelsId === currentId) seen = true;
    }
    if (list.length === 0) break;
  }
  return first?.pexelsId === currentId ? undefined : first;
}

/**
 * Ручной подбор медиа сцены: `POST /api/scenes/:sceneId/media`. `next` — следующий
 * кандидат по той же (или новой) странице выдачи, по индексу текущего pexelsId.
 */
export async function setSceneMediaManual(
  deps: PipelineDeps,
  sceneId: string,
  input: { query?: string; kind?: MediaKind; next?: boolean },
): Promise<SceneRecord & { projectId: string }> {
  const scene = await deps.repo.getScene(sceneId);
  const project = await deps.repo.requireProject(scene.projectId);
  const apiKey = await deps.mediaKey();
  if (!apiKey) throw new NoMediaKeyError("Pexels не настроен: Настройки → Фото и видео (или PEXELS_API_KEY в .env)");

  const query = input.query?.trim() || scene.media?.query;
  if (!query) throw new Error("query required: scene has no existing media to refine");
  const kind = input.kind ?? scene.media?.kind ?? "photo";
  const orientation = orientationFor(project.format);

  const search = (page: number) => deps.searchMedia({ apiKey, query, kind, orientation, page });
  const candidate = input.next && scene.media ? await nextCandidate(search, scene.media.pexelsId) : (await search(1))[0];
  if (!candidate) throw new Error(`no Pexels ${kind} found for "${query}"`);

  const rel = mediaPath(project.id, scene.id, kind, candidate.pexelsId);
  await deps.downloadMedia(candidate.url, path.join(deps.storageDir, rel));
  // Сначала запись в БД, потом удаление старого файла: при сбое записи сцена не ссылается на удалённый файл.
  await deps.repo.setSceneMedia(scene.id, toSceneMedia(kind, query, rel, candidate));
  if (scene.media?.src !== rel) await removeOldMedia(deps, project.id, scene.media);
  deps.events.emit({ type: "project", projectId: project.id });
  return deps.repo.getScene(sceneId);
}

/** `DELETE /api/scenes/:sceneId/media`: убрать медиа и удалить файл. */
export async function deleteSceneMedia(deps: PipelineDeps, sceneId: string): Promise<SceneRecord & { projectId: string }> {
  const scene = await deps.repo.getScene(sceneId);
  await deps.repo.setSceneMedia(sceneId, null);
  await removeOldMedia(deps, scene.projectId, scene.media);
  deps.events.emit({ type: "project", projectId: scene.projectId });
  return deps.repo.getScene(sceneId);
}

export async function runGenerate(deps: PipelineDeps, job: JobRecord): Promise<unknown> {
  const project = await deps.repo.requireProject(job.projectId!);
  const report = progressOf(deps, job);
  await deps.repo.updateProject(project.id, { status: "generating", error: null });
  deps.events.emit({ type: "project", projectId: project.id });

  const ctx = await deps.generationContext((p) => {
    void report({ stage: p.stage, message: p.message, done: p.done ?? null, total: p.total ?? null });
  });
  const options = { ...(project.freshnessRequested ? { freshness: project.freshnessRequested } : {}) };
  const result =
    project.format === "landscape"
      ? await generateLongScript(ctx, project.topic, { ...options, minutes: project.minutes ?? 3 })
      : await generateScript(ctx, project.topic, options);

  const savedScenes = await deps.repo.saveScript(project.id, {
    script: result.script,
    theme: result.theme,
    sources: result.sources.map((s) => ({ url: s.url, title: s.title, kind: s.kind, excerpt: s.excerpt, ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}) })),
    brief: result.brief,
    freshness: result.freshness,
    researchedAt: result.researchedAt,
    chapters: "chapters" in result ? (result as { chapters: { title: string; firstScene: number }[] }).chapters : [],
    unverified: result.unverified,
  });
  const track = pickTrack(await listMusic(deps.storageDir), result.theme.musicMood ?? "calm", project.id);
  await deps.repo.setMusic(project.id, track ? { track, volume: DEFAULT_MUSIC_VOLUME } : null);
  deps.events.emit({ type: "project", projectId: project.id });

  // Сценарий знает mediaQuery только в памяти (не хранится отдельной колонкой): сцены сохранены
  // saveScript в том же порядке, что и script.scenes, поэтому позиции совпадают напрямую.
  const mediaJobs = result.script.scenes.flatMap((scene, i) =>
    scene.mediaQuery ? [{ sceneId: savedScenes[i]!.id, query: scene.mediaQuery, kind: scene.mediaKind ?? ("photo" as const) }] : [],
  );
  // Медиа, озвучка и мета публикации не зависят друг от друга (мета — только от текста
  // сцен, он уже сохранён): запускаются одновременно. Ошибка озвучки по-прежнему валит
  // всю задачу (voiceMissing не ловит её сама), медиа и публикация — как раньше, не бросают.
  await Promise.all([
    fillMedia(deps, project, mediaJobs, report),
    voiceMissing(deps, project.id, report),
    (async () => {
      await report({ stage: "publish", message: "Название и описание" });
      try {
        await refreshPublishMeta(deps, project.id);
      } catch (error) {
        console.error(`publish meta for project ${project.id}: ${(error as Error).message}`);
      }
    })(),
  ]);

  await report({ stage: "thumbnail", message: "Обложка", done: null, total: null });
  await makeThumbnail(deps, project.id);
  deps.events.emit({ type: "project", projectId: project.id });
  return { scenes: result.script.scenes.length };
}

export async function runRender(deps: PipelineDeps, job: JobRecord): Promise<unknown> {
  const projectId = job.projectId!;
  const report = progressOf(deps, job);
  await voiceMissing(deps, projectId, report);
  const { manifest, hash } = await deps.repo.buildManifest(projectId);
  const rel = projectPaths(projectId).render(hash);
  const abs = path.join(deps.storageDir, rel);

  // Тот же манифест уже рендерился — MP4 берётся из кеша.
  const cached = await deps.repo.latestRender(projectId);
  if (cached?.manifestHash === hash && existsSync(abs)) {
    await deps.repo.updateProject(projectId, { status: "ready" });
    deps.events.emit({ type: "project", projectId });
    return { path: rel, cached: true };
  }

  const renderId = await deps.repo.addRender({ projectId, manifestHash: hash, path: rel });
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await report({ stage: "render", message: "Рендер MP4", done: 0, total: 100 });
    await deps.render(manifest, abs, (p) => void report({ done: Math.round(p * 100), total: 100 }));
    await deps.repo.finishRender(renderId, "done");
  } catch (error) {
    await deps.repo.finishRender(renderId, "failed");
    await rm(abs, { force: true });
    throw error;
  }
  await deps.repo.updateProject(projectId, { status: "ready" });
  deps.events.emit({ type: "project", projectId });
  return { path: rel, cached: false };
}

interface ScenePayload {
  readonly sceneId: string;
  readonly instruction?: string;
  readonly variants?: number;
  readonly narration?: string;
  /** Новый текст задан, но кадр тоже собрать заново (новая сцена из «Добавить»). */
  readonly fillVisual?: boolean;
}

async function sceneContext(deps: PipelineDeps, sceneId: string) {
  const scene = await deps.repo.getScene(sceneId);
  const project = await deps.repo.requireProject(scene.projectId);
  const scenes = await deps.repo.currentScenes(project.id);
  const editable = scenes.map((s: SceneRecord) => ({
    narration: s.version.narration,
    visual: s.version.visual,
    ...(s.version.intent ? { intent: s.version.intent as SceneIntent } : {}),
  }));
  return { scene, project, scenes: editable };
}

/**
 * Варианты нового кадра одной сцены. Они сохраняются версиями «variant», не
 * становясь текущими: пользователь выбирает один в редакторе. Озвучка у вариантов
 * та же — текст не менялся.
 */
export async function runRegenerateScene(deps: PipelineDeps, job: JobRecord): Promise<unknown> {
  const payload = job.payload as ScenePayload;
  const { scene, project, scenes } = await sceneContext(deps, payload.sceneId);
  const report = progressOf(deps, job);
  await report({ stage: "fill", message: `Сцена ${scene.position + 1}: варианты кадра` });
  const ctx = await deps.generationContext(() => undefined);
  const variants = await regenerateSceneVisual(ctx, {
    topic: project.title ?? project.topic,
    brief: project.brief ?? "",
    scenes,
    index: scene.position,
    ...(payload.instruction ? { instruction: payload.instruction } : {}),
    variants: payload.variants ?? 2,
    format: project.format,
  });
  const sources = sourcesOf(project);
  // Сами варианты уже сгенерированы (regenerateSceneVisual ограничена llmSlot);
  // здесь только проверка чисел и запись версий — независимо друг от друга.
  const versions = await Promise.all(
    variants.map((variant) => {
      const unverified = checkNumbers([{ narration: scene.version.narration, visual: variant.visual }], sources)[0] ?? [];
      return deps.repo.addVersion(
        scene.id,
        {
          narration: scene.version.narration,
          intent: scene.version.intent,
          visual: variant.visual,
          audio: scene.version.audio,
          unverifiedNumbers: unverified,
          origin: "variant",
          batchId: job.id,
          note: payload.instruction ? `${variant.label}: ${payload.instruction}` : variant.label,
        },
        { makeCurrent: false },
      );
    }),
  );
  const ids = versions.map((v) => v.id);
  deps.events.emit({ type: "project", projectId: project.id });
  return { versionIds: ids };
}

/** Новый текст сцены: руками (narration) или моделью по пожеланию, затем озвучка и кадр. */
export async function runRewriteScene(deps: PipelineDeps, job: JobRecord): Promise<unknown> {
  const payload = job.payload as ScenePayload;
  const { scene, project, scenes } = await sceneContext(deps, payload.sceneId);
  const report = progressOf(deps, job);
  const ctx = await deps.generationContext(() => undefined);
  const brief = project.brief ?? "";
  const base = { topic: project.title ?? project.topic, brief, scenes, index: scene.position };

  await report({ stage: "outline", message: `Сцена ${scene.position + 1}: новый текст` });
  const narration = payload.narration?.trim() || (await rewriteNarration(ctx, { ...base, ...(payload.instruction ? { instruction: payload.instruction } : {}) }));

  // Кадр пересобирается под новый текст одним вариантом, если пользователь не правил текст сам.
  let visual: SceneVisualSpec = scene.version.visual;
  if (!payload.narration || payload.fillVisual) {
    await report({ stage: "fill", message: `Сцена ${scene.position + 1}: кадр` });
    const updated = scenes.map((s, i) => (i === scene.position ? { ...s, narration } : s));
    const [variant] = await regenerateSceneVisual(ctx, { ...base, scenes: updated, variants: 1, format: project.format });
    if (variant) visual = variant.visual;
  }

  await report({ stage: "voice", message: `Сцена ${scene.position + 1}: озвучка` });
  const audio = await voiceScene(deps, project.id, narration);
  const unverified = checkNumbers([{ narration, visual }], sourcesOf(project))[0] ?? [];
  const version = await deps.repo.addVersion(scene.id, {
    narration,
    intent: scene.version.intent,
    visual,
    audio,
    unverifiedNumbers: unverified,
    origin: payload.narration && !payload.fillVisual ? "manual" : "rewrite",
    note: payload.instruction ?? null,
  });
  deps.events.emit({ type: "project", projectId: project.id });
  return { versionId: version.id };
}

/** Переозвучить тот же текст (другой дубль голоса). */
export async function runRevoiceScene(deps: PipelineDeps, job: JobRecord): Promise<unknown> {
  const payload = job.payload as ScenePayload;
  const scene = await deps.repo.getScene(payload.sceneId);
  const report = progressOf(deps, job);
  await report({ stage: "voice", message: `Сцена ${scene.position + 1}: озвучка` });
  // Хеш тот же, поэтому файл перезаписывается новым дублем — мимо кеша.
  const audio = await voiceScene(deps, scene.projectId, scene.version.narration, true);
  const version = await deps.repo.addVersion(scene.id, { ...scene.version, audio, origin: "revoice", note: null });
  deps.events.emit({ type: "project", projectId: scene.projectId });
  return { versionId: version.id };
}

/**
 * Ручная правка кадра — без очереди: валидация той же схемой формата, что и
 * ответ модели, ошибки возвращаются пользователю сразу.
 */
export async function saveManualVisual(
  deps: PipelineDeps,
  sceneId: string,
  visual: unknown,
): Promise<{ ok: true; versionId: string } | { ok: false; issues: { path: string; message: string }[] }> {
  const scene = await deps.repo.getScene(sceneId);
  const project = await deps.repo.requireProject(scene.projectId);
  const parsed = visualSpecSchemaFor(project.format).safeParse(visual);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) };
  }
  const unverified = checkNumbers([{ narration: scene.version.narration, visual: parsed.data }], sourcesOf(project))[0] ?? [];
  const version = await deps.repo.addVersion(scene.id, {
    ...scene.version,
    visual: parsed.data,
    unverifiedNumbers: unverified,
    origin: "manual",
    note: null,
  });
  deps.events.emit({ type: "project", projectId: project.id });
  return { ok: true, versionId: version.id };
}

export const JOB_HANDLERS = {
  generate: runGenerate,
  render: runRender,
  "regenerate-scene": runRegenerateScene,
  "rewrite-scene": runRewriteScene,
  "revoice-scene": runRevoiceScene,
  thumbnail: async (deps: PipelineDeps, job: JobRecord) => {
    await makeThumbnail(deps, job.projectId!);
    return {};
  },
} satisfies Record<JobRecord["kind"], (deps: PipelineDeps, job: JobRecord) => Promise<unknown>>;
