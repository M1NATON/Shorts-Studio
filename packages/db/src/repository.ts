/**
 * Доступ к проектам. Сервер работает только через эти функции — SQL и JSON-поля
 * не расползаются по обработчикам запросов.
 *
 * Всё, что пришло из JSON-колонок, читается обратно через Zod-схемы контрактов:
 * битая строка в базе — громкая ошибка, а не кадр с undefined в рендере.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  FORMATS,
  ManifestSchema,
  SceneVisualSpecSchema,
  VideoThemeSchema,
  WordTimingSchema,
  type CaptionStyle,
  type Manifest,
  type SceneIntent,
  type SceneVisualSpec,
  type Script,
  type VideoFormat,
  type VideoTheme,
  type WordTiming,
} from "@shorts/contracts";
import { recomputeTimeline } from "@shorts/media-core";
import { z } from "zod";
import type { Database } from "./client.js";
import {
  jobs,
  projects,
  renders,
  scenes,
  sceneVersions,
  settings,
  type JobKind,
  type JobStatus,
  type ProjectStatus,
  type VersionOrigin,
} from "./schema.js";

export type Freshness = "current" | "evergreen";

export interface SourceRecord {
  readonly url: string;
  readonly title: string;
  readonly kind?: "web" | "news";
  readonly publishedAt?: string;
  readonly excerpt?: string;
}

export interface ProjectRecord {
  readonly id: string;
  readonly topic: string;
  readonly title: string | null;
  readonly format: VideoFormat;
  readonly captionStyle: CaptionStyle;
  readonly status: ProjectStatus;
  readonly freshnessRequested: Freshness | null;
  readonly freshness: Freshness | null;
  readonly researchedAt: string | null;
  readonly minutes: number | null;
  readonly theme: VideoTheme | null;
  readonly sources: SourceRecord[];
  readonly brief: string | null;
  readonly chapters: { title: string; firstScene: number }[];
  readonly thumbnailPath: string | null;
  readonly durationSec: number | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SceneAudio {
  readonly path: string;
  readonly hash: string;
  readonly durationSec: number;
  readonly words: WordTiming[];
  readonly timingSource: "native" | "estimated";
}

export interface SceneVersionRecord {
  readonly id: string;
  readonly sceneId: string;
  readonly narration: string;
  readonly intent: SceneIntent | null;
  readonly visual: SceneVisualSpec;
  readonly audio: SceneAudio | null;
  readonly unverifiedNumbers: string[];
  readonly origin: VersionOrigin;
  readonly note: string | null;
  readonly batchId: string | null;
  readonly createdAt: string;
}

export interface SceneRecord {
  readonly id: string;
  readonly position: number;
  readonly version: SceneVersionRecord;
}

export interface JobRecord {
  readonly id: string;
  readonly projectId: string | null;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly stage: string | null;
  readonly message: string | null;
  readonly done: number | null;
  readonly total: number | null;
  readonly sceneIndex: number | null;
  readonly payload: unknown;
  readonly result: unknown;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const stamp = (): string => new Date().toISOString();

const SourcesSchema = z
  .array(
    z.object({
      url: z.string(),
      title: z.string(),
      kind: z.enum(["web", "news"]).optional(),
      publishedAt: z.string().optional(),
      excerpt: z.string().optional(),
    }),
  )
  .catch([]);
const ChaptersSchema = z.array(z.object({ title: z.string(), firstScene: z.number().int() })).catch([]);
const WordsSchema = z.array(WordTimingSchema);

type ProjectRow = typeof projects.$inferSelect;
type VersionRow = typeof sceneVersions.$inferSelect;
type JobRow = typeof jobs.$inferSelect;

function toProject(row: ProjectRow): ProjectRecord {
  return {
    ...row,
    format: row.format,
    theme: row.theme ? VideoThemeSchema.parse(row.theme) : null,
    sources: SourcesSchema.parse(row.sources ?? []),
    chapters: ChaptersSchema.parse(row.chapters ?? []),
  };
}

function toVersion(row: VersionRow): SceneVersionRecord {
  const audio: SceneAudio | null =
    row.audioPath && row.audioHash && row.audioDurationSec !== null && row.timingSource
      ? {
          path: row.audioPath,
          hash: row.audioHash,
          durationSec: row.audioDurationSec,
          words: WordsSchema.parse(row.words ?? []),
          timingSource: row.timingSource,
        }
      : null;
  return {
    id: row.id,
    sceneId: row.sceneId,
    narration: row.narration,
    intent: (row.intent as SceneIntent | null) ?? null,
    visual: SceneVisualSpecSchema.parse(row.visual),
    audio,
    unverifiedNumbers: z.array(z.string()).catch([]).parse(row.unverifiedNumbers ?? []),
    origin: row.origin,
    note: row.note,
    batchId: row.batchId,
    createdAt: row.createdAt,
  };
}

const toJob = (row: JobRow): JobRecord => ({ ...row });

/** Пути файлов проекта относительно storage: по проекту и по хешу содержимого. */
export function projectPaths(projectId: string) {
  const base = `projects/${projectId}`;
  return {
    base,
    audio: (hash: string) => `${base}/audio/${hash}.wav`,
    render: (manifestHash: string) => `${base}/renders/${manifestHash}.mp4`,
    thumbnail: `${base}/thumb.png`,
  };
}

/** Хеш озвучки: текст + параметры голоса. Тот же хеш — тот же файл, TTS не нужен. */
export function audioHash(narration: string, voice: string): string {
  return createHash("sha256").update(JSON.stringify({ narration, voice })).digest("hex").slice(0, 20);
}

/** Хеш манифеста без поля sourceHash: одинаковый ролик — одинаковый MP4 в кеше. */
export function manifestHash(manifest: Omit<Manifest, "sourceHash"> & { sourceHash?: string }): string {
  const { sourceHash: _ignored, ...rest } = manifest;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 20);
}

export interface ListProjectsQuery {
  readonly search?: string;
  readonly status?: ProjectStatus;
  readonly format?: VideoFormat;
  readonly limit?: number;
  readonly offset?: number;
}

export interface NewVersion {
  readonly narration: string;
  readonly intent?: SceneIntent | null;
  /** Вход схемы, а не выход: дефолты подачи дописывает парсинг, как для ответа модели. */
  readonly visual: z.input<typeof SceneVisualSpecSchema>;
  readonly audio?: SceneAudio | null;
  readonly unverifiedNumbers?: string[];
  readonly origin: VersionOrigin;
  readonly note?: string | null;
  readonly batchId?: string | null;
}

export function createRepository(database: Database) {
  const { db } = database;

  async function getProject(id: string): Promise<ProjectRecord | undefined> {
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    return row ? toProject(row) : undefined;
  }

  async function requireProject(id: string): Promise<ProjectRecord> {
    const project = await getProject(id);
    if (!project) throw new NotFoundError(`project ${id} not found`);
    return project;
  }

  /** Правка готового ролика делает его MP4 устаревшим — бейдж «stale» в библиотеке. */
  async function markEdited(tx: typeof db, projectId: string): Promise<void> {
    const [row] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
    await tx
      .update(projects)
      .set({ status: row?.status === "ready" ? "stale" : row?.status, updatedAt: stamp() })
      .where(eq(projects.id, projectId));
  }

  async function currentScenes(projectId: string): Promise<SceneRecord[]> {
    const rows = await db
      .select({ scene: scenes, version: sceneVersions })
      .from(scenes)
      .innerJoin(sceneVersions, eq(sceneVersions.id, scenes.currentVersionId))
      .where(eq(scenes.projectId, projectId))
      .orderBy(asc(scenes.position));
    return rows.map(({ scene, version }) => ({ id: scene.id, position: scene.position, version: toVersion(version) }));
  }

  return {
    getProject,
    requireProject,

    async createProject(input: {
      topic: string;
      format: VideoFormat;
      freshness?: Freshness;
      minutes?: number;
      captionStyle?: CaptionStyle;
    }): Promise<ProjectRecord> {
      const id = randomUUID();
      await db.insert(projects).values({
        id,
        topic: input.topic,
        format: input.format,
        status: "generating",
        freshnessRequested: input.freshness ?? null,
        minutes: input.minutes ?? null,
        ...(input.captionStyle ? { captionStyle: input.captionStyle } : {}),
      });
      return requireProject(id);
    },

    async listProjects(query: ListProjectsQuery = {}): Promise<{ items: ProjectRecord[]; total: number }> {
      const conditions = [
        query.status ? eq(projects.status, query.status) : undefined,
        query.format ? eq(projects.format, query.format) : undefined,
        query.search?.trim()
          ? or(like(projects.title, `%${query.search.trim()}%`), like(projects.topic, `%${query.search.trim()}%`))
          : undefined,
      ].filter((c) => c !== undefined);
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = Math.min(Math.max(query.limit ?? 24, 1), 100);
      const rows = await db
        .select()
        .from(projects)
        .where(where)
        .orderBy(desc(projects.createdAt))
        .limit(limit)
        .offset(Math.max(query.offset ?? 0, 0));
      const [total] = await db.select({ value: count() }).from(projects).where(where);
      return { items: rows.map(toProject), total: total?.value ?? 0 };
    },

    async updateProject(
      id: string,
      patch: Partial<Pick<ProjectRecord, "status" | "title" | "error" | "thumbnailPath" | "durationSec">>,
    ): Promise<void> {
      await db.update(projects).set({ ...patch, updatedAt: stamp() }).where(eq(projects.id, id));
    },

    /** Стиль субтитров меняет MP4, поэтому готовый ролик становится stale. */
    async setCaptionStyle(id: string, captionStyle: CaptionStyle): Promise<void> {
      await database.transaction(async (tx) => {
        await tx.update(projects).set({ captionStyle }).where(eq(projects.id, id));
        await markEdited(tx, id);
      });
    },

    /** Удаление проекта с его сценами, версиями, рендерами и задачами (каскад). Файлы удаляет вызывающий. */
    async deleteProject(id: string): Promise<void> {
      await db.delete(projects).where(eq(projects.id, id));
    },

    /**
     * Сценарий от генерации: сцены и первые версии (origin "ai"). Повторный вызов
     * заменяет сцены — так работает «повторить» после упавшей генерации.
     */
    async saveScript(
      projectId: string,
      input: {
        script: Script;
        theme: VideoTheme;
        sources: SourceRecord[];
        brief: string;
        freshness: Freshness;
        researchedAt: string;
        chapters?: { title: string; firstScene: number }[];
        unverified: string[][];
      },
    ): Promise<SceneRecord[]> {
      await database.transaction(async (tx) => {
        await tx.delete(scenes).where(eq(scenes.projectId, projectId));
        for (const [position, scene] of input.script.scenes.entries()) {
          const sceneId = randomUUID();
          const versionId = randomUUID();
          await tx.insert(scenes).values({ id: sceneId, projectId, position, currentVersionId: versionId });
          await tx.insert(sceneVersions).values({
            id: versionId,
            sceneId,
            narration: scene.narration,
            intent: scene.intent ?? null,
            visual: scene.visual,
            unverifiedNumbers: input.unverified[position] ?? [],
            origin: "ai",
          });
        }
        await tx
          .update(projects)
          .set({
            title: input.script.title,
            theme: input.theme,
            sources: input.sources,
            brief: input.brief,
            freshness: input.freshness,
            researchedAt: input.researchedAt,
            chapters: input.chapters ?? [],
            status: "draft",
            error: null,
            updatedAt: stamp(),
          })
          .where(eq(projects.id, projectId));
      });
      return currentScenes(projectId);
    },

    currentScenes,

    async getScene(sceneId: string): Promise<SceneRecord & { projectId: string }> {
      const [row] = await db
        .select({ scene: scenes, version: sceneVersions })
        .from(scenes)
        .innerJoin(sceneVersions, eq(sceneVersions.id, scenes.currentVersionId))
        .where(eq(scenes.id, sceneId));
      if (!row) throw new NotFoundError(`scene ${sceneId} not found`);
      return { id: row.scene.id, position: row.scene.position, projectId: row.scene.projectId, version: toVersion(row.version) };
    },

    /** Новая версия сцены. Старые не удаляются: плохая перегенерация не губит хороший исходник. */
    async addVersion(sceneId: string, input: NewVersion, options: { makeCurrent?: boolean } = {}): Promise<SceneVersionRecord> {
      const visual = SceneVisualSpecSchema.parse(input.visual);
      const id = randomUUID();
      await database.transaction(async (tx) => {
        const [scene] = await tx.select().from(scenes).where(eq(scenes.id, sceneId));
        if (!scene) throw new NotFoundError(`scene ${sceneId} not found`);
        await tx.insert(sceneVersions).values({
          id,
          sceneId,
          narration: input.narration,
          intent: input.intent ?? null,
          visual,
          audioPath: input.audio?.path ?? null,
          audioHash: input.audio?.hash ?? null,
          audioDurationSec: input.audio?.durationSec ?? null,
          words: input.audio?.words ?? null,
          timingSource: input.audio?.timingSource ?? null,
          unverifiedNumbers: input.unverifiedNumbers ?? [],
          origin: input.origin,
          note: input.note ?? null,
          batchId: input.batchId ?? null,
          createdAt: stamp(),
        });
        if (options.makeCurrent ?? true) {
          await tx.update(scenes).set({ currentVersionId: id }).where(eq(scenes.id, sceneId));
          await markEdited(tx, scene.projectId);
        }
      });
      const [row] = await db.select().from(sceneVersions).where(eq(sceneVersions.id, id));
      return toVersion(row!);
    },

    /** Озвучка к существующей версии — после TTS, без новой версии. */
    async setAudio(versionId: string, audio: SceneAudio): Promise<void> {
      await db
        .update(sceneVersions)
        .set({
          audioPath: audio.path,
          audioHash: audio.hash,
          audioDurationSec: audio.durationSec,
          words: audio.words,
          timingSource: audio.timingSource,
        })
        .where(eq(sceneVersions.id, versionId));
    },

    async listVersions(sceneId: string): Promise<SceneVersionRecord[]> {
      const rows = await db
        .select()
        .from(sceneVersions)
        .where(eq(sceneVersions.sceneId, sceneId))
        .orderBy(desc(sceneVersions.createdAt));
      return rows.map(toVersion);
    },

    /** Вернуть любую прежнюю версию сцены. */
    async selectVersion(sceneId: string, versionId: string): Promise<void> {
      await database.transaction(async (tx) => {
        const [version] = await tx
          .select({ id: sceneVersions.id })
          .from(sceneVersions)
          .where(and(eq(sceneVersions.id, versionId), eq(sceneVersions.sceneId, sceneId)));
        if (!version) throw new NotFoundError(`version ${versionId} of scene ${sceneId} not found`);
        const [scene] = await tx.select().from(scenes).where(eq(scenes.id, sceneId));
        await tx.update(scenes).set({ currentVersionId: versionId }).where(eq(scenes.id, sceneId));
        await markEdited(tx, scene!.projectId);
      });
    },

    /**
     * Манифест из текущих версий сцен. Не хранится — поэтому не может разойтись
     * с тем, что в редакторе. Без озвучки у какой-то сцены манифеста нет.
     */
    async buildManifest(projectId: string, fps: 24 | 25 | 30 = 30): Promise<{ manifest: Manifest; hash: string }> {
      const project = await requireProject(projectId);
      const list = await currentScenes(projectId);
      const missing = list.filter((s) => !s.version.audio).map((s) => s.position + 1);
      if (missing.length > 0) throw new NotReadyError(`scenes without audio: ${missing.join(", ")}`);
      const { slots, totalDurationInFrames } = recomputeTimeline(
        list.map((s) => ({ sceneId: s.id, audioDurationSec: s.version.audio!.durationSec })),
        fps,
      );
      const size = FORMATS[project.format];
      const draft = {
        version: 1 as const,
        projectId,
        title: project.title ?? project.topic,
        fps,
        format: project.format,
        captionStyle: project.captionStyle,
        width: size.width,
        height: size.height,
        totalDurationInFrames,
        ...(project.theme ? { theme: project.theme } : {}),
        sources: project.sources.map(({ url, title, kind, publishedAt }) => ({
          url,
          title,
          ...(kind ? { kind } : {}),
          ...(publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? { publishedAt } : {}),
        })),
        ...(project.researchedAt ? { researchedAt: project.researchedAt } : {}),
        ...(project.freshness ? { freshness: project.freshness } : {}),
        scenes: list.map((s, i) => ({
          sceneId: s.id,
          ...(s.version.intent ? { intent: s.version.intent } : {}),
          visual: s.version.visual,
          narration: s.version.narration,
          startFrame: slots[i]!.startFrame,
          durationInFrames: slots[i]!.durationInFrames,
          audioDurationSec: s.version.audio!.durationSec,
          audioSrc: s.version.audio!.path,
          words: s.version.audio!.words,
          timingSource: s.version.audio!.timingSource,
          unverifiedNumbers: s.version.unverifiedNumbers,
        })),
      };
      const parsed = ManifestSchema.parse({ ...draft, sourceHash: "pending" });
      const hash = manifestHash(parsed);
      return { manifest: { ...parsed, sourceHash: hash }, hash };
    },

    /**
     * Озвучка с тем же хешем (текст + голос), уже сделанная в этом проекте:
     * повторная подготовка не тратит TTS.
     */
    async findAudio(projectId: string, hash: string): Promise<SceneAudio | undefined> {
      const rows = await db
        .select({ version: sceneVersions })
        .from(sceneVersions)
        .innerJoin(scenes, eq(scenes.id, sceneVersions.sceneId))
        .where(and(eq(scenes.projectId, projectId), eq(sceneVersions.audioHash, hash)))
        .limit(1);
      return rows[0] ? (toVersion(rows[0].version).audio ?? undefined) : undefined;
    },

    // ── сцены: порядок, дубли, удаление, новые ─────────────────────────────

    /** Сдвинуть сцену на новую позицию; остальные сдвигаются, порядок без дыр. */
    async moveScene(sceneId: string, toPosition: number): Promise<void> {
      await database.transaction(async (tx) => {
        const [scene] = await tx.select().from(scenes).where(eq(scenes.id, sceneId));
        if (!scene) throw new NotFoundError(`scene ${sceneId} not found`);
        const list = await tx.select().from(scenes).where(eq(scenes.projectId, scene.projectId)).orderBy(asc(scenes.position));
        const order = list.filter((s) => s.id !== sceneId);
        order.splice(Math.max(0, Math.min(toPosition, order.length)), 0, scene);
        for (const [position, item] of order.entries()) {
          await tx.update(scenes).set({ position }).where(eq(scenes.id, item.id));
        }
        await markEdited(tx, scene.projectId);
      });
    },

    /**
     * Новая сцена после `afterPosition` (-1 — в начало) с первой версией.
     * Используется для «дублировать» (копия версии) и «добавить» (черновик до ИИ).
     */
    async insertScene(projectId: string, afterPosition: number, first: NewVersion): Promise<string> {
      const sceneId = randomUUID();
      const versionId = randomUUID();
      const visual = SceneVisualSpecSchema.parse(first.visual);
      await database.transaction(async (tx) => {
        const list = await tx.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));
        for (const item of list) {
          if (item.position > afterPosition) await tx.update(scenes).set({ position: item.position + 1 }).where(eq(scenes.id, item.id));
        }
        await tx.insert(scenes).values({ id: sceneId, projectId, position: afterPosition + 1, currentVersionId: versionId });
        await tx.insert(sceneVersions).values({
          id: versionId,
          sceneId,
          narration: first.narration,
          intent: first.intent ?? null,
          visual,
          audioPath: first.audio?.path ?? null,
          audioHash: first.audio?.hash ?? null,
          audioDurationSec: first.audio?.durationSec ?? null,
          words: first.audio?.words ?? null,
          timingSource: first.audio?.timingSource ?? null,
          unverifiedNumbers: first.unverifiedNumbers ?? [],
          origin: first.origin,
          note: first.note ?? null,
          createdAt: stamp(),
        });
        await markEdited(tx, projectId);
      });
      return sceneId;
    },

    /** Удалить сцену с её версиями; последнюю сцену ролика удалить нельзя. */
    async deleteScene(sceneId: string): Promise<void> {
      await database.transaction(async (tx) => {
        const [scene] = await tx.select().from(scenes).where(eq(scenes.id, sceneId));
        if (!scene) throw new NotFoundError(`scene ${sceneId} not found`);
        const list = await tx.select().from(scenes).where(eq(scenes.projectId, scene.projectId)).orderBy(asc(scenes.position));
        if (list.length <= 1) throw new NotReadyError("cannot delete the only scene");
        await tx.delete(scenes).where(eq(scenes.id, sceneId));
        let position = 0;
        for (const item of list) {
          if (item.id === sceneId) continue;
          await tx.update(scenes).set({ position: position++ }).where(eq(scenes.id, item.id));
        }
        await markEdited(tx, scene.projectId);
      });
    },

    // ── настройки ───────────────────────────────────────────────────────────

    async getSetting<T>(key: string): Promise<T | undefined> {
      const [row] = await db.select().from(settings).where(eq(settings.key, key));
      return row?.value as T | undefined;
    },

    async setSetting(key: string, value: unknown): Promise<void> {
      await db
        .insert(settings)
        .values({ key, value, updatedAt: stamp() })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: stamp() } });
    },

    // ── задачи ──────────────────────────────────────────────────────────────

    async createJob(input: { projectId?: string; kind: JobKind; payload?: unknown; sceneIndex?: number }): Promise<JobRecord> {
      const id = randomUUID();
      await db.insert(jobs).values({
        id,
        projectId: input.projectId ?? null,
        kind: input.kind,
        status: "queued",
        payload: input.payload ?? null,
        sceneIndex: input.sceneIndex ?? null,
        createdAt: stamp(),
        updatedAt: stamp(),
      });
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
      return toJob(row!);
    },

    async getJob(id: string): Promise<JobRecord | undefined> {
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
      return row ? toJob(row) : undefined;
    },

    async listJobs(query: { projectId?: string; statuses?: JobStatus[]; limit?: number } = {}): Promise<JobRecord[]> {
      const conditions = [
        query.projectId ? eq(jobs.projectId, query.projectId) : undefined,
        query.statuses?.length ? inArray(jobs.status, query.statuses) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(jobs)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(jobs.createdAt))
        .limit(query.limit ?? 50);
      return rows.map(toJob);
    },

    async updateJob(
      id: string,
      patch: Partial<Pick<JobRecord, "status" | "stage" | "message" | "done" | "total" | "result" | "error">>,
    ): Promise<JobRecord> {
      await db.update(jobs).set({ ...patch, updatedAt: stamp() }).where(eq(jobs.id, id));
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
      return toJob(row!);
    },

    /**
     * Самая старая задача в очереди → running. Атомарно: две выборки не возьмут одну задачу.
     * Проект, у которого задача уже идёт, пропускается: его задачи выполняются по одной,
     * иначе рендер мог бы собрать сцену, которую в это время переписывают.
     */
    async claimNextJob(): Promise<JobRecord | undefined> {
      return database.transaction(async (tx) => {
        const running = alias(jobs, "running");
        const busy = tx
          .select({ projectId: running.projectId })
          .from(running)
          .where(and(eq(running.status, "running"), isNotNull(running.projectId)));
        const [next] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.status, "queued"), or(isNull(jobs.projectId), notInArray(jobs.projectId, busy))))
          .orderBy(asc(jobs.createdAt))
          .limit(1);
        if (!next) return undefined;
        await tx.update(jobs).set({ status: "running", updatedAt: stamp() }).where(eq(jobs.id, next.id));
        return toJob({ ...next, status: "running" });
      });
    },

    /**
     * Отменить задачу, пока она ждёт в очереди; начатую не трогаем. Отменённая генерация
     * оставляет проект в «Ошибке» — там уже есть «Повторить».
     */
    async cancelJob(id: string): Promise<JobRecord | undefined> {
      return database.transaction(async (tx) => {
        const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.status, "queued")));
        if (!job) return undefined;
        const reason = "Отменено";
        await tx.update(jobs).set({ status: "failed", error: reason, updatedAt: stamp() }).where(eq(jobs.id, id));
        if (job.kind === "generate" && job.projectId) {
          await tx.update(projects).set({ status: "failed", error: reason, updatedAt: stamp() }).where(eq(projects.id, job.projectId));
        }
        return toJob({ ...job, status: "failed", error: reason });
      });
    },

    /**
     * После рестарта сервера незавершённые задачи — failed с понятной причиной;
     * проект, застрявший в generating, тоже failed с кнопкой «повторить» в UI.
     */
    async failInterruptedJobs(): Promise<number> {
      return database.transaction(async (tx) => {
        const running = await tx.select().from(jobs).where(eq(jobs.status, "running"));
        const reason = "Сервер был перезапущен во время выполнения";
        for (const job of running) {
          await tx.update(jobs).set({ status: "failed", error: reason, updatedAt: stamp() }).where(eq(jobs.id, job.id));
          if (job.kind === "generate" && job.projectId) {
            await tx
              .update(projects)
              .set({ status: "failed", error: reason, updatedAt: stamp() })
              .where(and(eq(projects.id, job.projectId), eq(projects.status, "generating")));
          }
        }
        return running.length;
      });
    },

    // ── рендеры ─────────────────────────────────────────────────────────────

    async addRender(input: { projectId: string; manifestHash: string; path: string }): Promise<string> {
      const id = randomUUID();
      await db.insert(renders).values({ id, ...input, status: "rendering", createdAt: stamp() });
      return id;
    },

    async finishRender(id: string, status: "done" | "failed"): Promise<void> {
      await db.update(renders).set({ status }).where(eq(renders.id, id));
    },

    async latestRender(projectId: string): Promise<{ id: string; manifestHash: string; path: string; status: string; createdAt: string } | undefined> {
      const [row] = await db
        .select()
        .from(renders)
        .where(and(eq(renders.projectId, projectId), eq(renders.status, "done")))
        .orderBy(desc(renders.createdAt))
        .limit(1);
      return row;
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}
export class NotReadyError extends Error {
  override readonly name = "NotReadyError";
}
