/**
 * Миграции — упорядоченный список SQL. Номер применённой хранится в
 * PRAGMA user_version. Миграции только добавляют: удаление колонок и таблиц
 * с данными — отдельное решение с подтверждением, не автоматическое.
 *
 * Схема Drizzle (schema.ts) и этот SQL сверяются тестом: колонки таблиц
 * после миграций совпадают с колонками схемы.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    title TEXT,
    format TEXT NOT NULL,
    status TEXT NOT NULL,
    freshness_requested TEXT,
    freshness TEXT,
    researched_at TEXT,
    minutes REAL,
    theme TEXT,
    sources TEXT,
    brief TEXT,
    chapters TEXT,
    thumbnail_path TEXT,
    duration_sec REAL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX projects_status_idx ON projects (status);
  CREATE INDEX projects_created_idx ON projects (created_at);

  CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    current_version_id TEXT
  );
  CREATE INDEX scenes_project_idx ON scenes (project_id, position);

  CREATE TABLE scene_versions (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    narration TEXT NOT NULL,
    intent TEXT,
    visual TEXT NOT NULL,
    audio_path TEXT,
    audio_hash TEXT,
    audio_duration_sec REAL,
    words TEXT,
    timing_source TEXT,
    unverified_numbers TEXT,
    origin TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX versions_scene_idx ON scene_versions (scene_id, created_at);

  CREATE TABLE renders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    manifest_hash TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX renders_project_idx ON renders (project_id, created_at);

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT,
    message TEXT,
    done INTEGER,
    total INTEGER,
    scene_index INTEGER,
    payload TEXT,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX jobs_status_idx ON jobs (status, created_at);
  CREATE INDEX jobs_project_idx ON jobs (project_id);
  `,
  // 2: стиль субтитров проекта. Только добавление колонки с дефолтом — данные не теряются.
  `ALTER TABLE projects ADD COLUMN caption_style TEXT NOT NULL DEFAULT 'karaoke';`,
  // 3: настройки провайдеров из UI. Файл базы лежит в storage/ (в .gitignore);
  // ключи отсюда читает только сервер, наружу уходят маскированными.
  `CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );`,
  // 4: пачка вариантов кадра (id задачи пересборки). Только добавление nullable-колонки.
  `ALTER TABLE scene_versions ADD COLUMN batch_id TEXT;`,
  // 5: фоновая музыка проекта (JSON: файл из storage/music и громкость). NULL — без музыки.
  `ALTER TABLE projects ADD COLUMN music TEXT;`,
  // 6: фото/видео фона сцены с Pexels (JSON, SceneMedia). Принадлежит сцене, а не
  // версии текста — переписывание и переозвучка его не теряют.
  `ALTER TABLE scenes ADD COLUMN media TEXT;`,
];
