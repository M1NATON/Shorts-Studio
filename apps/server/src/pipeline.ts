/**
 * Что делают задачи. Каждая функция — один вид задачи из очереди; зависимости
 * (модель, озвучка, рендер) приходят снаружи, поэтому конвейер тестируется без
 * сети и без браузера.
 *
 * Правило точечной правки: меняется одна сцена — перегенерируется, озвучивается
 * и пересчитывается только она. Озвучка переиспользуется по хешу текста и голоса.
 */
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { visualSpecSchemaFor, type Manifest, type SceneIntent, type SceneVisualSpec } from "@shorts/contracts";
import {
  audioHash,
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
  generateScript,
  regenerateSceneVisual,
  rewriteNarration,
  type GenerationContext,
  type GenerationProgress,
  type ResearchSource,
} from "@shorts/llm-core";
import type { VoicedNarration } from "@shorts/media-core";
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
  readonly render: (manifest: Manifest, outputAbs: string, onProgress: (p: number) => void) => Promise<void>;
  readonly still: (manifest: Manifest, frame: number, outputAbs: string) => Promise<void>;
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

async function voiceMissing(deps: PipelineDeps, projectId: string, report: Progress): Promise<void> {
  const scenes = await deps.repo.currentScenes(projectId);
  const pending = scenes.filter((s) => !s.version.audio);
  for (const [i, scene] of pending.entries()) {
    await report({ stage: "voice", message: `Озвучка: сцена ${scene.position + 1} из ${scenes.length}`, done: i, total: pending.length });
    await deps.repo.setAudio(scene.version.id, await voiceScene(deps, projectId, scene.version.narration));
  }
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
 * Источники для проверки чисел. Без выдержки (ролик импортирован из CLI, где
 * хранились только ссылки) проверять не по чему — иначе любое число в кадре,
 * даже год, помечалось бы как неподтверждённое.
 */
function sourcesOf(project: ProjectRecord): ResearchSource[] {
  return project.sources.filter((s) => s.excerpt).map((s) => ({ url: s.url, title: s.title, excerpt: s.excerpt ?? "", kind: s.kind ?? "web", ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}) }));
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

  await deps.repo.saveScript(project.id, {
    script: result.script,
    theme: result.theme,
    sources: result.sources.map((s) => ({ url: s.url, title: s.title, kind: s.kind, excerpt: s.excerpt, ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}) })),
    brief: result.brief,
    freshness: result.freshness,
    researchedAt: result.researchedAt,
    chapters: "chapters" in result ? (result as { chapters: { title: string; firstScene: number }[] }).chapters : [],
    unverified: result.unverified,
  });
  deps.events.emit({ type: "project", projectId: project.id });

  await voiceMissing(deps, project.id, report);
  await report({ stage: "thumbnail", message: "Обложка" });
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
  const ids: string[] = [];
  for (const variant of variants) {
    const unverified = checkNumbers([{ narration: scene.version.narration, visual: variant.visual }], sources)[0] ?? [];
    const version = await deps.repo.addVersion(
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
    ids.push(version.id);
  }
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
