/**
 * Схема базы проектов. JSON-поля хранят то, что уже провалидировано Zod-схемами
 * контрактов (тема, визуал, источники): база не дублирует их структуру колонками,
 * а читает обратно через те же схемы.
 */
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const PROJECT_STATUSES = ["generating", "draft", "ready", "stale", "failed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const JOB_KINDS = ["generate", "render", "regenerate-scene", "revoice-scene", "rewrite-scene", "thumbnail"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const VERSION_ORIGINS = ["ai", "manual", "revoice", "rewrite", "variant"] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    title: text("title"),
    format: text("format", { enum: ["shorts", "landscape"] }).notNull(),
    captionStyle: text("caption_style", { enum: ["clean", "karaoke", "boxed", "outline"] }).notNull().default("karaoke"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull(),
    /** Режим, который просил пользователь; null — выбирает модель. */
    freshnessRequested: text("freshness_requested", { enum: ["current", "evergreen"] }),
    freshness: text("freshness", { enum: ["current", "evergreen"] }),
    researchedAt: text("researched_at"),
    minutes: real("minutes"),
    theme: text("theme", { mode: "json" }),
    sources: text("sources", { mode: "json" }),
    /** Сводка источников: по ней пересобираются сцены без нового поиска. */
    brief: text("brief"),
    chapters: text("chapters", { mode: "json" }),
    thumbnailPath: text("thumbnail_path"),
    durationSec: real("duration_sec"),
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("projects_status_idx").on(t.status), index("projects_created_idx").on(t.createdAt)],
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    currentVersionId: text("current_version_id"),
  },
  (t) => [index("scenes_project_idx").on(t.projectId, t.position)],
);

export const sceneVersions = sqliteTable(
  "scene_versions",
  {
    id: text("id").primaryKey(),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    narration: text("narration").notNull(),
    intent: text("intent"),
    visual: text("visual", { mode: "json" }).notNull(),
    /** Путь относительно storage; null — озвучки ещё нет. */
    audioPath: text("audio_path"),
    audioHash: text("audio_hash"),
    audioDurationSec: real("audio_duration_sec"),
    words: text("words", { mode: "json" }),
    timingSource: text("timing_source", { enum: ["native", "estimated"] }),
    unverifiedNumbers: text("unverified_numbers", { mode: "json" }),
    origin: text("origin", { enum: VERSION_ORIGINS }).notNull(),
    /** Пожелание пользователя или подпись варианта — видно в истории версий. */
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("versions_scene_idx").on(t.sceneId, t.createdAt)],
);

export const renders = sqliteTable(
  "renders",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    manifestHash: text("manifest_hash").notNull(),
    path: text("path").notNull(),
    status: text("status", { enum: ["rendering", "done", "failed"] }).notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("renders_project_idx").on(t.projectId, t.createdAt)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: JOB_KINDS }).notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull(),
    stage: text("stage"),
    message: text("message"),
    done: integer("done"),
    total: integer("total"),
    sceneIndex: integer("scene_index"),
    payload: text("payload", { mode: "json" }),
    result: text("result", { mode: "json" }),
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt), index("jobs_project_idx").on(t.projectId)],
);

/** Настройки приложения: ключ → JSON. Провайдеры моделей, озвучки и поиска. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});
