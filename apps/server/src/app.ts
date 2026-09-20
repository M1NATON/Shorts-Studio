/**
 * HTTP API студии. Долгие операции (генерация, рендер, пересборка сцены) не живут
 * внутри запроса: ручка ставит задачу в очередь и сразу отвечает её id, прогресс
 * приходит через SSE (/api/events).
 */
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { PublishMetaSchema } from "@shorts/contracts";
import {
  loadPreferences,
  NotFoundError,
  NotReadyError,
  PROJECT_STATUSES,
  projectPaths,
  savePreferences,
  type JobKind,
  type Repository,
} from "@shorts/db";
import { fallbackStatement, presentationAt } from "@shorts/llm-core";
import { z } from "zod";
import type { ServerConfig } from "./config.js";
import type { ProviderKind, ProviderStore } from "@shorts/db";
import { deleteSceneMedia, listMusic, NoMediaKeyError, refreshPublishMeta, saveManualVisual, setSceneMediaManual, type PipelineDeps } from "./pipeline.js";
import type { Worker } from "./worker.js";

// Не переданные формат, свежесть и длина берутся из предпочтений (Настройки).
const CreateOptions = {
  format: z.enum(["shorts", "landscape"]).optional(),
  captionStyle: z.enum(["clean", "karaoke", "boxed", "outline"]).optional(),
  freshness: z.enum(["current", "evergreen"]).optional(),
  minutes: z.number().min(1).max(20).optional(),
};
const CreateProjectBody = z.object({ topic: z.string().trim().min(3).max(200), ...CreateOptions });
const BatchBody = z.object({ topics: z.array(z.string().trim().min(3).max(200)).min(1).max(20), ...CreateOptions });
const ListQuery = z.object({
  search: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  format: z.enum(["shorts", "landscape"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const RegenerateBody = z.object({
  instruction: z.string().trim().max(500).optional(),
  variants: z.number().int().min(1).max(3).default(2),
});
const RewriteBody = z.object({ instruction: z.string().trim().max(500).optional() });
const NarrationBody = z.object({ narration: z.string().trim().min(1).max(320) });
const VisualBody = z.object({ visual: z.unknown() });
const ProjectPatchBody = z.object({
  captionStyle: z.enum(["clean", "karaoke", "boxed", "outline"]).optional(),
  /** null — без музыки. Файл проверяется по списку storage/music, не по пути из запроса. */
  music: z.object({ track: z.string().min(1), volume: z.number().min(0).max(1) }).nullable().optional(),
  /** Ручная правка названия/описания/хэштегов; null — сбросить. */
  publish: PublishMetaSchema.nullable().optional(),
});

const MoveBody = z.object({ position: z.number().int().min(0) });
const AddSceneBody = z.object({
  afterPosition: z.number().int().min(-1),
  narration: z.string().trim().min(1).max(320),
});
const ProviderParam = z.enum(["llm", "tts", "search", "media"]);
const SceneMediaBody = z.object({
  query: z.string().trim().min(2).max(80).optional(),
  kind: z.enum(["photo", "video"]).optional(),
  next: z.boolean().optional(),
});
const VoicePreviewBody = z.object({
  text: z.string().trim().min(1).max(200).optional(),
  referenceId: z.string().trim().min(1).max(200).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

export interface AppDeps extends PipelineDeps {
  readonly config: ServerConfig;
  readonly providers: ProviderStore;
  /** Лёгкий запрос к провайдеру по кнопке «Проверить»; ключ в ответ не попадает. */
  readonly testProvider: (kind: ProviderKind) => Promise<{ ok: boolean; message: string }>;
  /** Образец голоса (WAV). Голос и модель можно подставить из формы до сохранения; ключ — всегда сохранённый. */
  readonly previewVoice: (input: z.infer<typeof VoicePreviewBody>) => Promise<Buffer>;
  readonly worker?: Worker;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Имя хоста из Host / X-Forwarded-Host / Origin; нечитаемое значение — не локальное. */
function isLocal(value: string, withScheme = false): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(withScheme ? value : `http://${value}`).hostname);
  } catch {
    return false;
  }
}

/** Имя файла/папки ролика: буквы, цифры, пробел, «_»/«-»; иначе «video». */
function videoName(project: { title: string | null; topic: string }): string {
  return (project.title ?? project.topic).replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 80).trim() || "video";
}

/**
 * Папка ролика внутри папки экспорта. Своя папка запоминается за проектом: повторный
 * экспорт после пересборки обновляет ту же папку, а «Ещё версия» с тем же названием
 * получает соседнюю («Название 2»), а не затирает чужие файлы — в папке лежат обложка
 * и черновики пользователя.
 */
async function exportDirFor(repo: Repository, projectId: string, base: string, name: string): Promise<string> {
  const key = `export.dir.${projectId}`;
  const remembered = await repo.getSetting<string>(key);
  if (remembered && path.dirname(remembered) === base) return remembered;
  let dir = path.join(base, name);
  for (let i = 2; i < 100 && existsSync(dir); i++) dir = path.join(base, `${name} ${i}`);
  await repo.setSetting(key, dir);
  return dir;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const { repo, events } = deps;

  // Авторизации нет, поэтому API отвечает только своим. Чужой Host — DNS rebinding:
  // страница evil.example, перепривязанная на 127.0.0.1, иначе прочитала бы проекты и
  // переписала baseUrl LLM, уведя сохранённый ключ. X-Forwarded-Host ставит прокси Next.
  // Чужой Origin и не-JSON тело (форма, text/plain — «простые» запросы без preflight)
  // отсекают CSRF. Хук стоит до статики, чтобы закрывать и /projects/.
  app.addHook("onRequest", async (request, reply) => {
    const forwarded = request.headers["x-forwarded-host"];
    const hosts = [request.headers.host ?? "", ...(forwarded === undefined ? [] : [forwarded].flat())];
    if (!hosts.every((host) => isLocal(host))) return reply.code(403).send({ error: "forbidden host" });
    const origin = request.headers.origin;
    if (origin !== undefined && !isLocal(origin, true)) return reply.code(403).send({ error: "forbidden origin" });
    if (MUTATING.has(request.method)) {
      const type = request.headers["content-type"];
      const hasBody = Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"] !== undefined;
      if (type === undefined ? hasBody : !/^application\/json\s*(;|$)/i.test(type)) {
        return reply.code(415).send({ error: "expected application/json" });
      }
    }
  });

  // Файлы проектов (озвучка для плеера, обложки, MP4). Путь в манифесте —
  // "projects/<id>/audio/<hash>.wav", staticFile в плеере даёт "/projects/…".
  await app.register(fastifyStatic, {
    root: path.join(deps.config.storageDir, "projects"),
    prefix: "/projects/",
    decorateReply: false,
  });

  // Фоновая музыка: storage/music, в манифесте — "music/<файл>", staticFile даёт "/music/…".
  await mkdir(path.join(deps.config.storageDir, "music"), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(deps.config.storageDir, "music"),
    prefix: "/music/",
    decorateReply: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof NotReadyError) return reply.code(409).send({ error: error.message });
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "invalid request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    return reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ error: (error as Error).message });
  });

  async function enqueue(kind: JobKind, projectId: string, extra: { payload?: unknown; sceneIndex?: number } = {}) {
    const job = await repo.createJob({ kind, projectId, ...extra });
    events.emit({ type: "job", job });
    deps.worker?.kick();
    return job;
  }

  app.get("/api/health", async () => ({ ok: true }));
  // ── настройки провайдеров ────────────────────────────────────────────────
  app.get("/api/settings", async () => deps.providers.describe());

  app.put<{ Params: { kind: string } }>("/api/settings/:kind", async (request) => {
    const kind = ProviderParam.parse(request.params.kind);
    await deps.providers.save(kind, z.record(z.string(), z.unknown()).parse(request.body));
    return (await deps.providers.describe())[kind];
  });

  app.post<{ Params: { kind: string } }>("/api/settings/:kind/test", async (request) => {
    const kind = ProviderParam.parse(request.params.kind);
    try {
      return await deps.testProvider(kind);
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });

  app.post("/api/settings/tts/preview", async (request, reply) => {
    const audio = await deps.previewVoice(VoicePreviewBody.parse(request.body ?? {}));
    return reply.type("audio/wav").header("cache-control", "no-store").send(audio);
  });

  app.get("/api/music", async () => listMusic(deps.config.storageDir));

  app.get("/api/preferences", async () => loadPreferences(repo));
  app.put("/api/preferences", async (request) => savePreferences(repo, request.body));

  /** Параметры нового ролика: переданные в запросе, иначе из предпочтений. */
  async function createOptions(body: {
    format?: "shorts" | "landscape";
    captionStyle?: "clean" | "karaoke" | "boxed" | "outline";
    freshness?: "current" | "evergreen";
    minutes?: number;
  }) {
    const prefs = await loadPreferences(repo);
    const format = body.format ?? prefs.format;
    const freshness = body.freshness ?? (prefs.freshness === "auto" ? undefined : prefs.freshness);
    return {
      format,
      captionStyle: body.captionStyle ?? prefs.captionStyle,
      ...(freshness ? { freshness } : {}),
      ...(format === "landscape" ? { minutes: body.minutes ?? prefs.minutes } : {}),
    };
  }

  // ── библиотека ────────────────────────────────────────────────────────────
  app.get("/api/projects", async (request) => repo.listProjects(ListQuery.parse(request.query)));

  app.post("/api/projects", async (request, reply) => {
    const { topic, ...options } = CreateProjectBody.parse(request.body);
    const project = await repo.createProject({ topic, ...(await createOptions(options)) });
    const job = await enqueue("generate", project.id);
    return reply.code(201).send({ project, job });
  });

  /** Очередь тем: генерируются по одной, в порядке ввода. */
  app.post("/api/projects/batch", async (request, reply) => {
    const { topics, ...options } = BatchBody.parse(request.body);
    const resolved = await createOptions(options);
    const created = [];
    for (const topic of topics) {
      const project = await repo.createProject({ topic, ...resolved });
      created.push({ project, job: await enqueue("generate", project.id) });
    }
    return reply.code(201).send({ items: created });
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const project = await repo.requireProject(request.params.id);
    const [scenes, render, jobs] = await Promise.all([
      repo.currentScenes(project.id),
      repo.latestRender(project.id),
      repo.listJobs({ projectId: project.id, statuses: ["queued", "running"] }),
    ]);
    return { project, scenes, render: render ?? null, jobs };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const project = await repo.requireProject(request.params.id);
    const body = ProjectPatchBody.parse(request.body);
    if (body.music) {
      const track = body.music.track;
      if (!(await listMusic(deps.config.storageDir)).some((t) => t.file === track)) {
        return reply.code(400).send({ error: `unknown music track: ${track}` });
      }
    }
    if (body.captionStyle) await repo.setCaptionStyle(project.id, body.captionStyle);
    if (body.music !== undefined) await repo.setMusic(project.id, body.music);
    if (body.publish !== undefined) await repo.setPublish(project.id, body.publish);
    events.emit({ type: "project", projectId: project.id });
    return repo.requireProject(project.id);
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const project = await repo.requireProject(request.params.id);
    const active = await repo.listJobs({ projectId: project.id, statuses: ["running"] });
    if (active.length > 0) return reply.code(409).send({ error: "project has a running job" });
    await repo.deleteProject(project.id);
    // Только каталог этого проекта внутри storage/projects — путь из id, не из запроса.
    await rm(path.join(deps.config.storageDir, projectPaths(project.id).base), { recursive: true, force: true });
    events.emit({ type: "project", projectId: project.id });
    return reply.code(204).send();
  });

  /** «Та же тема, новая версия». */
  app.post<{ Params: { id: string } }>("/api/projects/:id/duplicate", async (request, reply) => {
    const source = await repo.requireProject(request.params.id);
    const project = await repo.createProject({
      topic: source.topic,
      format: source.format,
      ...(source.freshnessRequested ? { freshness: source.freshnessRequested } : {}),
      ...(source.minutes ? { minutes: source.minutes } : {}),
    });
    return reply.code(201).send({ project, job: await enqueue("generate", project.id) });
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/retry", async (request, reply) => {
    const project = await repo.requireProject(request.params.id);
    if (project.status !== "failed") return reply.code(409).send({ error: "only failed projects can be retried" });
    return reply.code(202).send({ job: await enqueue("generate", project.id) });
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/manifest", async (request) => {
    const { manifest, hash } = await repo.buildManifest(request.params.id);
    return { manifest, hash };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/render", async (request, reply) => {
    await repo.requireProject(request.params.id);
    return reply.code(202).send({ job: await enqueue("render", request.params.id) });
  });

  /** Перегенерировать название/описание/хэштеги по текущим сценам; 409 без сцен. */
  app.post<{ Params: { id: string } }>("/api/projects/:id/publish", async (request) => {
    const meta = await refreshPublishMeta(deps, request.params.id);
    events.emit({ type: "project", projectId: request.params.id });
    return meta;
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/video", async (request, reply) => {
    const project = await repo.requireProject(request.params.id);
    const render = await repo.latestRender(project.id);
    const file = render ? path.join(deps.config.storageDir, render.path) : undefined;
    if (!file || !existsSync(file)) return reply.code(404).send({ error: "no rendered video yet" });
    const name = videoName(project);
    return reply
      .header("Content-Type", "video/mp4")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}.mp4`)
      .send(createReadStream(file));
  });

  /** Кладёт готовый MP4 (и описание для публикации) в подпапку папки экспорта — студия локальная, файл нужен на диске пользователя. */
  app.post<{ Params: { id: string } }>("/api/projects/:id/export", async (request, reply) => {
    const prefs = await loadPreferences(repo);
    if (!prefs.exportDir) return reply.code(400).send({ error: "Папка для экспорта не задана — укажите её в Настройках" });
    const project = await repo.requireProject(request.params.id);
    const render = await repo.latestRender(project.id);
    const file = render ? path.join(deps.config.storageDir, render.path) : undefined;
    if (!file || !existsSync(file)) return reply.code(404).send({ error: "no rendered video yet" });
    const name = videoName(project);
    const dir = await exportDirFor(repo, project.id, prefs.exportDir, name);
    await mkdir(dir, { recursive: true });
    await copyFile(file, path.join(dir, `${name}.mp4`));
    if (project.publish) {
      const { title, description, hashtags, thumbnailPrompt } = project.publish;
      const text = [
        `Название:\n${title}`,
        `Описание:\n${description}`,
        `Хэштеги:\n${hashtags.join(" ")}`,
        ...(thumbnailPrompt ? [`Промпт для обложки:\n${thumbnailPrompt}`] : []),
      ].join("\n\n");
      await writeFile(path.join(dir, "описание.txt"), text, "utf8");
    }
    return { dir };
  });

  // ── сцены ─────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/api/scenes/:id/versions", async (request) => ({
    scene: await repo.getScene(request.params.id),
    versions: await repo.listVersions(request.params.id),
  }));

  /** Ручная правка блоков: мгновенно, с ошибками валидатора в ответе. */
  app.put<{ Params: { id: string } }>("/api/scenes/:id/visual", async (request, reply) => {
    const { visual } = VisualBody.parse(request.body);
    const result = await saveManualVisual(deps, request.params.id, visual);
    return result.ok ? result : reply.code(422).send(result);
  });

  app.post<{ Params: { id: string } }>("/api/scenes/:id/regenerate", async (request, reply) => {
    const scene = await repo.getScene(request.params.id);
    const body = RegenerateBody.parse(request.body ?? {});
    const job = await enqueue("regenerate-scene", scene.projectId, { payload: { sceneId: scene.id, ...body }, sceneIndex: scene.position });
    return reply.code(202).send({ job });
  });

  app.post<{ Params: { id: string } }>("/api/scenes/:id/rewrite", async (request, reply) => {
    const scene = await repo.getScene(request.params.id);
    const body = RewriteBody.parse(request.body ?? {});
    const job = await enqueue("rewrite-scene", scene.projectId, { payload: { sceneId: scene.id, ...body }, sceneIndex: scene.position });
    return reply.code(202).send({ job });
  });

  /** Текст озвучки руками: переозвучка этой сцены, кадр прежний. */
  app.post<{ Params: { id: string } }>("/api/scenes/:id/narration", async (request, reply) => {
    const scene = await repo.getScene(request.params.id);
    const { narration } = NarrationBody.parse(request.body);
    const job = await enqueue("rewrite-scene", scene.projectId, { payload: { sceneId: scene.id, narration }, sceneIndex: scene.position });
    return reply.code(202).send({ job });
  });

  app.post<{ Params: { id: string } }>("/api/scenes/:id/revoice", async (request, reply) => {
    const scene = await repo.getScene(request.params.id);
    const job = await enqueue("revoice-scene", scene.projectId, { payload: { sceneId: scene.id }, sceneIndex: scene.position });
    return reply.code(202).send({ job });
  });

  /** Подбор фона сцены на Pexels: без очереди — один запрос + скачивание, как правка кадра. */
  app.post<{ Params: { sceneId: string } }>("/api/scenes/:sceneId/media", async (request, reply) => {
    const body = SceneMediaBody.parse(request.body ?? {});
    try {
      return await setSceneMediaManual(deps, request.params.sceneId, body);
    } catch (error) {
      if (error instanceof NoMediaKeyError) return reply.code(409).send({ error: error.message });
      if (error instanceof NotFoundError) throw error;
      return reply.code(502).send({ error: (error as Error).message });
    }
  });

  app.delete<{ Params: { sceneId: string } }>("/api/scenes/:sceneId/media", async (request) => deleteSceneMedia(deps, request.params.sceneId));

  // ── порядок и состав сцен ────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/api/scenes/:id/move", async (request) => {
    const scene = await repo.getScene(request.params.id);
    await repo.moveScene(scene.id, MoveBody.parse(request.body).position);
    events.emit({ type: "project", projectId: scene.projectId });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/scenes/:id/duplicate", async (request, reply) => {
    const scene = await repo.getScene(request.params.id);
    const id = await repo.insertScene(scene.projectId, scene.position, { ...scene.version, origin: "manual", note: "копия" });
    events.emit({ type: "project", projectId: scene.projectId });
    return reply.code(201).send({ sceneId: id });
  });

  app.delete<{ Params: { id: string } }>("/api/scenes/:id", async (request, reply) => {
    const scene = await repo.getScene(request.params.id);
    await repo.deleteScene(scene.id);
    events.emit({ type: "project", projectId: scene.projectId });
    return reply.code(204).send();
  });

  /**
   * Новая сцена по тексту: сразу появляется черновиком (текст в кадре), а кадр
   * и озвучку собирает задача — как при «переписать сцену».
   */
  app.post<{ Params: { id: string } }>("/api/projects/:id/scenes", async (request, reply) => {
    const project = await repo.requireProject(request.params.id);
    const body = AddSceneBody.parse(request.body);
    const plan = { kind: "hook-statement" as const, fallbackKind: "hook-statement" as const, presentation: presentationAt(body.afterPosition + 1, "plain", project.format) };
    const sceneId = await repo.insertScene(project.id, body.afterPosition, {
      narration: body.narration,
      visual: fallbackStatement(body.narration, plan),
      origin: "manual",
      note: "новая сцена",
    });
    const job = await enqueue("rewrite-scene", project.id, {
      payload: { sceneId, narration: body.narration, fillVisual: true },
      sceneIndex: body.afterPosition + 1,
    });
    return reply.code(201).send({ sceneId, job });
  });

  app.post<{ Params: { id: string; versionId: string } }>("/api/scenes/:id/versions/:versionId/select", async (request) => {
    const scene = await repo.getScene(request.params.id);
    await repo.selectVersion(scene.id, request.params.versionId);
    events.emit({ type: "project", projectId: scene.projectId });
    return { ok: true };
  });

  // ── задачи и события ──────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string; active?: string } }>("/api/jobs", async (request) =>
    repo.listJobs({
      ...(request.query.projectId ? { projectId: request.query.projectId } : {}),
      ...(request.query.active === "1" ? { statuses: ["queued", "running"] as const satisfies readonly ("queued" | "running")[] } : {}),
    } as Parameters<typeof repo.listJobs>[0]),
  );

  /** Очередь всех проектов для панели: что идёт, что ждёт (по порядку), что недавно закончилось. */
  app.get("/api/queue", async () => {
    const [active, recent] = await Promise.all([
      repo.listJobs({ statuses: ["queued", "running"], limit: 500 }),
      repo.listJobs({ statuses: ["done", "failed"], limit: 10 }),
    ]);
    const ids = [...new Set([...active, ...recent].map((j) => j.projectId).filter((id) => id !== null))];
    // getProject, а не require: проект могли удалить между двумя запросами — панель не должна падать целиком.
    const projects = (await Promise.all(ids.map((id) => repo.getProject(id)))).filter((p) => p !== undefined);
    const titles = new Map(projects.map((p) => [p.id, p.title ?? p.topic]));
    const withTitle = (job: (typeof active)[number]) => ({ ...job, projectTitle: job.projectId ? (titles.get(job.projectId) ?? null) : null });
    const ordered = active.reverse().map(withTitle);
    return {
      running: ordered.filter((j) => j.status === "running"),
      queued: ordered.filter((j) => j.status === "queued"),
      recent: recent.map(withTitle),
    };
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request, reply) => {
    // Идущую задачу останавливает воркер: статус «Отменено» и событие придут от него.
    if (deps.worker?.cancel(request.params.id)) return reply.code(202).send({ cancelling: true });
    const job = await repo.cancelJob(request.params.id);
    if (!job) return reply.code(409).send({ error: "job is not queued or running" });
    events.emit({ type: "job", job });
    if (job.kind === "generate" && job.projectId) events.emit({ type: "project", projectId: job.projectId });
    return job;
  });

  // Открытые SSE-потоки: без их закрытия app.close() ждёт вкладки браузера вечно,
  // и сервер не останавливается по SIGTERM.
  const streams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
    streams.clear();
  });

  app.get("/api/events", (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    streams.add(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    const unsubscribe = events.subscribe((event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    // Прокси и браузеры рвут молчащее соединение; комментарий раз в 15 с держит его.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  });

  return app;
}
