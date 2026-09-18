import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createRepository, openDatabase, type Database, type Repository } from "@shorts/db";
import type { LlmClient } from "@shorts/llm-core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { StudioEvents, type StudioEvent } from "./events.js";
import type { PipelineDeps } from "./pipeline.js";
import { startWorker, type Worker } from "./worker.js";
import { createProviderStore } from "@shorts/db";

/** Фальшивый ключ: проверяем, что он нигде не всплывает в ответах API. */
const SECRET = "sk-test-0123456789abcdef-SECRET";

const BEATS = [
  { narration: "Batteries got ninety percent cheaper in a decade.", intent: "hook", mediaQuery: "battery factory line", mediaKind: "photo" },
  { narration: "Packs cost 115 dollars per kWh in 2024.", intent: "number" },
  { narration: "Three forces drove the price down.", intent: "list" },
  { narration: "Old chemistry versus new chemistry.", intent: "contrast" },
  { narration: "Cheap storage changes the grid.", intent: "takeaway" },
];

/** Модель-заглушка: план, кадры и новый текст сцены. */
const llm: LlmClient = {
  async askJson({ system, user }) {
    if (user.includes("Broken topic")) throw new Error("LLM HTTP 504");
    if (system.includes("visual identity")) return { error: "default theme" };
    if (system.includes("plan informative")) return { title: "Why batteries got cheap", beats: BEATS };
    if (system.includes("rewrite the narration")) return { narration: "Scale, chemistry and competition cut the price." };
    if (system.includes("composing blocks")) {
      return { blocks: [{ block: "icon", icon: "zap" }, { block: "row", text: "Scale", emphasis: true, at: 0.2 }] };
    }
    if (system.includes("outro-cta")) return { text: "Storage is the story" };
    if (system.includes("YouTube publish metadata")) {
      return {
        title: "Why battery prices collapsed in a decade",
        description:
          "Batteries got dramatically cheaper. This video explains the three forces that drove it: bigger factories, better chemistry and fierce competition between makers.",
        hashtags: ["#Batteries", "#EnergyStorage", "#Tech"],
      };
    }
    return { variant: "statement", text: "Batteries got cheap" };
  },
};

let dir: string;
let database: Database;
let repo: Repository;
let app: FastifyInstance;
let worker: Worker;
let received: StudioEvent[];
let voiced: string[];
let renders: number;
let mediaKeyConfigured: boolean;
let mediaSearches: { query: string; kind: string; page?: number }[];

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "studio-"));
  database = openDatabase(":memory:");
  repo = createRepository(database);
  const events = new StudioEvents();
  received = [];
  events.subscribe((e) => received.push(e));
  voiced = [];
  renders = 0;
  mediaKeyConfigured = true;
  mediaSearches = [];
  const deps: PipelineDeps = {
    repo,
    events,
    storageDir: dir,
    generationContext: async (onProgress) => ({ llm, today: "2026-09-18", onProgress }),
    voice: async (narration, abs) => {
      voiced.push(narration);
      await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(abs), { recursive: true }));
      await writeFile(abs, "wav");
      return { durationSec: 2, words: [{ text: narration.split(" ")[0]!, start: 0, end: 0.3 }], timingSource: "native", unmatched: 0 };
    },
    voiceKey: async () => "test-voice",
    render: async (_manifest, out, onProgress) => {
      renders++;
      onProgress(1);
      await writeFile(out, "mp4");
    },
    still: async (_manifest, _frame, out) => writeFile(out, "png"),
    mediaKey: async () => (mediaKeyConfigured ? "pexels-test-key" : undefined),
    // Заглушка Pexels: страница 1 и страница 2 дают разные id, чтобы «next» их различал.
    searchMedia: async (input) => {
      mediaSearches.push({ query: input.query, kind: input.kind, page: input.page });
      const page = input.page ?? 1;
      return Array.from({ length: 3 }, (_, i) => ({
        pexelsId: page * 100 + i,
        url: `https://images.pexels.com/photos/${page * 100 + i}/photo.jpg`,
        width: 1080,
        height: 1920,
        credit: { name: "Test Photographer", url: "https://www.pexels.com/@test" },
      }));
    },
    downloadMedia: async (_url, dest) => {
      await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(dest), { recursive: true }));
      await writeFile(dest, "jpg");
    },
  };
  worker = startWorker(deps, { pollMs: 20 });
  const config = { ...loadConfig({ LLM_BASE_URL: "https://llm.test/v1", LLM_API_KEY: SECRET, LLM_MODEL: "env-model" }, dir), storageDir: dir };
  app = await buildApp({
    ...deps,
    config,
    providers: createProviderStore(repo, config.envProviders),
    testProvider: async (kind) => ({ ok: kind === "llm", message: kind }),
    previewVoice: async (input) => Buffer.from(`RIFF:${input.referenceId ?? "saved"}`),
    worker,
  });
});

afterEach(async () => {
  await app.close();
  await worker.stop();
  database.close();
});

async function createGenerated() {
  const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Why batteries got cheap" } });
  expect(res.statusCode).toBe(201);
  await worker.idle();
  const id = res.json().project.id as string;
  return { id, detail: (await app.inject({ url: `/api/projects/${id}` })).json() };
}

describe("защита локального API", () => {
  it("чужой Host (DNS rebinding) — 403, в том числе через прокси Next", async () => {
    expect((await app.inject({ url: "/api/health", headers: { host: "evil.example:3001" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/settings", headers: { host: "127.0.0.1:3001", "x-forwarded-host": "evil.example:3100" } })).statusCode).toBe(403);
    const put = await app.inject({ method: "PUT", url: "/api/settings/llm", headers: { host: "evil.example" }, payload: { baseUrl: "https://evil.example/v1" } });
    expect(put.statusCode).toBe(403);
    expect((await app.inject({ url: "/projects/x/video.mp4", headers: { host: "evil.example" } })).statusCode).toBe(403);
    expect(JSON.stringify((await app.inject({ url: "/api/settings" })).json())).not.toContain("evil.example");
  });

  it("свои Host проходят: localhost, 127.0.0.1, [::1], прокси Next", async () => {
    for (const host of ["localhost:3100", "127.0.0.1:3001", "[::1]:3001", "localhost"]) {
      expect((await app.inject({ url: "/api/health", headers: { host } })).statusCode).toBe(200);
    }
    expect((await app.inject({ url: "/api/health", headers: { host: "127.0.0.1:3001", "x-forwarded-host": "127.0.0.1:3100" } })).statusCode).toBe(200);
  });

  it("запрос с чужого сайта — 403, свой Origin проходит", async () => {
    const foreign = await app.inject({ method: "POST", url: "/api/projects", headers: { origin: "http://evil.example" }, payload: { topic: "Heat pumps explained" } });
    expect(foreign.statusCode).toBe(403);
    const own = await app.inject({ method: "POST", url: "/api/projects", headers: { origin: "http://127.0.0.1:3100" }, payload: { topic: "Heat pumps explained" } });
    expect(own.statusCode).toBe(201);
    await worker.idle();
  });

  it("изменяющий запрос не в JSON (простая форма, text/plain) — 415 до ручки", async () => {
    const { id } = await createGenerated();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/json-foo"]) {
      const res = await app.inject({ method: "POST", url: `/api/projects/${id}/render`, headers: { "content-type": type }, payload: "x" });
      expect(res.statusCode).toBe(415);
    }
    expect(renders).toBe(0);
    // DELETE без тела — не «простой» запрос, браузер сам не отправит его с чужого сайта.
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${id}` })).statusCode).toBe(204);
  });
});

describe("API", () => {
  it("предпочтения: по умолчанию, частичное сохранение, применяются к новому ролику", async () => {
    expect((await app.inject({ url: "/api/preferences" })).json()).toEqual({
      format: "shorts", minutes: 3, freshness: "auto", captionStyle: "karaoke", research: true,
    });
    const bad = await app.inject({ method: "PUT", url: "/api/preferences", payload: { captionStyle: "neon" } });
    expect(bad.statusCode).toBe(400);
    const saved = await app.inject({ method: "PUT", url: "/api/preferences", payload: { format: "landscape", minutes: 5, captionStyle: "boxed" } });
    expect(saved.json()).toMatchObject({ format: "landscape", minutes: 5, captionStyle: "boxed", research: true });

    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Heat pumps explained" } });
    expect(created.json().project).toMatchObject({ format: "landscape", minutes: 5, captionStyle: "boxed" });
    const explicit = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Heat pumps short", format: "shorts", captionStyle: "clean" } });
    expect(explicit.json().project).toMatchObject({ format: "shorts", minutes: null, captionStyle: "clean" });
    await worker.idle();
  });

  it("образец голоса: WAV, голос из формы подставляется", async () => {
    const res = await app.inject({ method: "POST", url: "/api/settings/tts/preview", payload: { referenceId: "voice-2" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
    expect(res.body).toBe("RIFF:voice-2");
  });

  it("настройки: ключ из .env виден только маской, сохранение из UI без ключа оставляет прежний", async () => {
    const res = await app.inject({ url: "/api/settings" });
    expect(res.json().llm).toMatchObject({ configured: true, source: "env", fields: { apiKey: "••••CRET", model: "env-model" } });
    expect(res.body).not.toContain(SECRET);

    const saved = await app.inject({ method: "PUT", url: "/api/settings/llm", payload: { model: "ui-model", apiKey: "" } });
    expect(saved.json()).toMatchObject({ source: "ui", fields: { model: "ui-model", apiKey: "••••CRET" } });
    expect(saved.body).not.toContain(SECRET);

    const bad = await app.inject({ method: "PUT", url: "/api/settings/tts", payload: { apiKey: "x" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain(SECRET);
    expect((await app.inject({ method: "POST", url: "/api/settings/llm/test" })).json()).toEqual({ ok: true, message: "llm" });
  });

  it("сцены: перестановка, дубль, удаление, новая сцена с кадром и озвучкой", async () => {
    const { id, detail } = await createGenerated();
    const ids = detail.scenes.map((s: { id: string }) => s.id);
    await app.inject({ method: "POST", url: `/api/scenes/${ids[4]}/move`, payload: { position: 1 } });
    await app.inject({ method: "POST", url: `/api/scenes/${ids[0]}/duplicate` });
    await app.inject({ method: "DELETE", url: `/api/scenes/${ids[2]}` });
    const added = await app.inject({ method: "POST", url: `/api/projects/${id}/scenes`, payload: { afterPosition: 0, narration: "A brand new scene about recycling." } });
    expect(added.statusCode).toBe(201);
    await worker.idle();
    const scenes = (await app.inject({ url: `/api/projects/${id}` })).json().scenes;
    // [0,1,2,3,4] → move 4→1: [0,4,1,2,3] → дубль 0: [0,D,4,1,2,3] → удалить 2: [0,D,4,1,3] → новая после 0.
    const order = scenes.map((s: { id: string }) => s.id);
    expect([order[0], ...order.slice(3)]).toEqual([ids[0], ids[4], ids[1], ids[3]]);
    expect(scenes[2].version.note).toBe("копия");
    const newScene = scenes[1];
    expect(newScene.version).toMatchObject({ narration: "A brand new scene about recycling.", origin: "rewrite" });
    expect(newScene.version.audio).toBeTruthy();
    expect(scenes).toHaveLength(6);
    expect(scenes.map((s: { position: number }) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("та же фраза тем же голосом не озвучивается повторно, «переозвучить» — озвучивает", async () => {
    const { detail } = await createGenerated();
    const scene = detail.scenes[1];
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/narration`, payload: { narration: "Packs cost less now." } });
    await worker.idle();
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/narration`, payload: { narration: scene.version.narration } });
    await worker.idle();
    expect(voiced.filter((n) => n === scene.version.narration)).toHaveLength(1);
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/revoice` });
    await worker.idle();
    expect(voiced.filter((n) => n === scene.version.narration)).toHaveLength(2);
  });

  it("создание → генерация в очереди → озвучка → обложка → draft", async () => {
    const { id, detail } = await createGenerated();
    expect(detail.project.status).toBe("draft");
    expect(detail.project.thumbnailPath).toBe(`projects/${id}/thumb.png`);
    expect(detail.scenes).toHaveLength(5);
    expect(detail.scenes.every((s: { version: { audio: unknown } }) => s.version.audio)).toBe(true);
    expect(received.some((e) => e.type === "job" && e.job.stage === "voice")).toBe(true);
    const list = (await app.inject({ url: "/api/projects?search=batter" })).json();
    expect(list.total).toBe(1);
  });

  it("рендер: ready, повтор того же манифеста берётся из кеша, правка сцены → stale", async () => {
    const { id, detail } = await createGenerated();
    await app.inject({ method: "POST", url: `/api/projects/${id}/render` });
    await worker.idle();
    expect((await app.inject({ url: `/api/projects/${id}` })).json().project.status).toBe("ready");
    await app.inject({ method: "POST", url: `/api/projects/${id}/render` });
    await worker.idle();
    expect(renders).toBe(1);
    expect((await app.inject({ url: `/api/projects/${id}/video` })).statusCode).toBe(200);

    const scene = detail.scenes[2];
    const edited = { ...scene.version.visual, blocks: undefined, kind: "hook-statement", text: "Edited by hand" };
    const res = await app.inject({ method: "PUT", url: `/api/scenes/${scene.id}/visual`, payload: { visual: edited } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/projects/${id}` })).json().project.status).toBe("stale");
  });

  it("ручная правка с переполненным кадром — 422 с замечанием валидатора", async () => {
    const { detail } = await createGenerated();
    const scene = detail.scenes[1];
    const tall = {
      kind: "composed",
      blocks: [
        { block: "heading", text: "A very long heading that wraps onto several lines of the frame", size: "xl" },
        { block: "ring", percent: 40, label: "Share of something rather important", at: 0.1 },
        { block: "row", icon: "zap", text: "A long row that wraps onto the second line", at: 0.2 },
        { block: "row", icon: "leaf", text: "Another long row that wraps onto two lines", at: 0.3 },
      ],
    };
    const res = await app.inject({ method: "PUT", url: `/api/scenes/${scene.id}/visual`, payload: { visual: tall } });
    expect(res.statusCode).toBe(422);
    expect(res.json().issues[0].message).toMatch(/do not fit/);
  });

  it("пересборка сцены: варианты в истории, текущая не меняется, выбор варианта", async () => {
    const { detail } = await createGenerated();
    const scene = detail.scenes[2];
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/regenerate`, payload: { instruction: "меньше текста", variants: 2 } });
    await worker.idle();
    const { versions, scene: current } = (await app.inject({ url: `/api/scenes/${scene.id}/versions` })).json();
    expect(versions.filter((v: { origin: string }) => v.origin === "variant")).toHaveLength(2);
    expect(current.version.id).toBe(scene.version.id);
    // У варианта та же озвучка: текст не менялся, TTS не вызывался.
    expect(voiced).toHaveLength(5);

    const variant = versions.find((v: { origin: string }) => v.origin === "variant");
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/versions/${variant.id}/select` });
    expect((await app.inject({ url: `/api/scenes/${scene.id}/versions` })).json().scene.version.id).toBe(variant.id);
  });

  it("новый текст сцены руками — переозвучка только этой сцены", async () => {
    const { detail } = await createGenerated();
    const scene = detail.scenes[3];
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/narration`, payload: { narration: "New chemistry beat the old one." } });
    await worker.idle();
    expect(voiced.slice(5)).toEqual(["New chemistry beat the old one."]);
    const { scene: current } = (await app.inject({ url: `/api/scenes/${scene.id}/versions` })).json();
    expect(current.version).toMatchObject({ narration: "New chemistry beat the old one.", origin: "manual" });
  });

  it("переписать сцену моделью: новый текст, кадр и озвучка", async () => {
    const { detail } = await createGenerated();
    const scene = detail.scenes[2];
    await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/rewrite`, payload: { instruction: "конкретнее" } });
    await worker.idle();
    const { scene: current } = (await app.inject({ url: `/api/scenes/${scene.id}/versions` })).json();
    expect(current.version).toMatchObject({ narration: "Scale, chemistry and competition cut the price.", origin: "rewrite" });
  });

  it("упавшая генерация: failed с причиной, повтор ставит задачу", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Broken topic" } });
    const id = res.json().project.id;
    await worker.idle();
    const project = (await app.inject({ url: `/api/projects/${id}` })).json().project;
    expect(project.status).toBe("failed");
    expect(project.error).toMatch(/outline failed/);
    expect((await app.inject({ method: "POST", url: `/api/projects/${id}/retry` })).statusCode).toBe(202);
    const done = (await app.inject({ url: `/api/jobs?projectId=${id}` })).json();
    expect(done.map((j: { status: string }) => j.status)).toContain("failed");
  });

  it("удаление проекта убирает запись и файлы", async () => {
    const { id } = await createGenerated();
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/projects/${id}` })).statusCode).toBe(404);
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(dir, "projects", id))).toBe(false);
  });

  it("очередь тем: несколько проектов одним запросом", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/batch", payload: { topics: ["Topic one", "Topic two"] } });
    expect(res.json().items).toHaveLength(2);
    await worker.idle();
    expect((await app.inject({ url: "/api/projects?status=draft" })).json().total).toBe(2);
  });

  it("музыка: трек по настроению темы, смена в редакторе, чужой файл — 400, пауза между сценами", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(dir, "music"), { recursive: true });
    for (const file of ["calm-drift.mp3", "tech-pulse.mp3", "notes.txt"]) await writeFile(path.join(dir, "music", file), "x");
    expect((await app.inject({ url: "/api/music" })).json()).toEqual([
      { file: "calm-drift.mp3", mood: "calm" },
      { file: "tech-pulse.mp3", mood: "tech" },
    ]);

    // Заглушка модели не отдаёт тему → дефолтная, её настроение calm.
    const { id } = await createGenerated();
    const manifest = async () => (await app.inject({ url: `/api/projects/${id}/manifest` })).json().manifest;
    const first = await manifest();
    expect(first.music).toEqual({ src: "music/calm-drift.mp3", volume: 0.12 });
    // Озвучка 2 с = 60 кадров, плюс 0.35 с паузы у всех сцен, кроме последней.
    expect(first.scenes[0].durationInFrames).toBe(71);
    expect(first.scenes.at(-1).durationInFrames).toBe(60);

    const patch = (music: unknown) => app.inject({ method: "PATCH", url: `/api/projects/${id}`, payload: { music } });
    expect((await patch({ track: "../studio.sqlite", volume: 0.2 })).statusCode).toBe(400);
    expect((await patch({ track: "tech-pulse.mp3", volume: 0.2 })).statusCode).toBe(200);
    expect((await manifest()).music).toEqual({ src: "music/tech-pulse.mp3", volume: 0.2 });
    expect((await patch(null)).statusCode).toBe(200);
    expect((await manifest()).music).toBeUndefined();
    expect((await app.inject({ url: "/music/calm-drift.mp3" })).statusCode).toBe(200);
  });

  it("медиа: сцена с mediaQuery получает фон при генерации, «next» меняет кандидата, без ключа — 409", async () => {
    const { id, detail } = await createGenerated();
    const scene = detail.scenes[0];
    expect(scene.media).toMatchObject({ kind: "photo", query: "battery factory line", pexelsId: 100 });
    expect(scene.media.src).toBe(`projects/${id}/media/${scene.id}-100.jpg`);
    expect(detail.scenes[1].media).toBeNull();

    const manifest = (await app.inject({ url: `/api/projects/${id}/manifest` })).json().manifest;
    expect(manifest.scenes[0].media).toEqual({ kind: "photo", src: scene.media.src });

    const next = await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/media`, payload: { next: true } });
    expect(next.statusCode).toBe(200);
    expect(next.json().media).toMatchObject({ pexelsId: 101 });
    expect(mediaSearches.filter((s) => s.query === "battery factory line")).toHaveLength(2);

    const deleted = await app.inject({ method: "DELETE", url: `/api/scenes/${scene.id}/media` });
    expect(deleted.json().media).toBeNull();

    mediaKeyConfigured = false;
    const denied = await app.inject({ method: "POST", url: `/api/scenes/${scene.id}/media`, payload: { query: "server room lights" } });
    expect(denied.statusCode).toBe(409);
  });

  it("публикация: генерация даёт #Shorts первым, POST /publish перегенерирует, PATCH сохраняет правку, невалидный хэштег — 400", async () => {
    const { id, detail } = await createGenerated();
    expect(detail.project.publish).toMatchObject({
      title: "Why battery prices collapsed in a decade",
      hashtags: ["#Shorts", "#Batteries", "#EnergyStorage", "#Tech"],
    });

    const regenerated = await app.inject({ method: "POST", url: `/api/projects/${id}/publish` });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json().hashtags[0]).toBe("#Shorts");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/projects/${id}`,
      payload: { publish: { title: "Manual title, edited by hand", description: "B".repeat(60), hashtags: ["#Shorts", "#Manual", "#Edit"] } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().publish.title).toBe("Manual title, edited by hand");

    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/projects/${id}`,
      payload: { publish: { title: "Manual title, edited by hand", description: "B".repeat(60), hashtags: ["not-a-hashtag", "#A", "#B"] } },
    });
    expect(invalid.statusCode).toBe(400);

    const empty = await repo.createProject({ topic: "No scenes yet", format: "shorts" });
    expect((await app.inject({ method: "POST", url: `/api/projects/${empty.id}/publish` })).statusCode).toBe(409);
  });

  it("панель очереди: порядок, название проекта, отмена только ждущей задачи", async () => {
    await worker.stop();
    await app.inject({ method: "POST", url: "/api/projects/batch", payload: { topics: ["Topic one", "Topic two"] } });
    const queue = (await app.inject({ url: "/api/queue" })).json();
    expect(queue.queued.map((j: { projectTitle: string }) => j.projectTitle)).toEqual(["Topic one", "Topic two"]);
    const first = queue.queued[0].id;
    expect((await app.inject({ method: "POST", url: `/api/jobs/${first}/cancel` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/jobs/${first}/cancel` })).statusCode).toBe(409);
    const after = (await app.inject({ url: "/api/queue" })).json();
    expect(after.queued).toHaveLength(1);
    expect(after.recent[0]).toMatchObject({ id: first, status: "failed", error: "Отменено" });
  });

  it("SSE: событие доходит до подписчика, закрытие сервера не ждёт открытый поток", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as import("node:net").AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    const reader = res.body!.getReader();
    await reader.read(); // ": connected"
    await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Streamed topic" } });
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("event: job");
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("невалидный запрос — 400 с путём поля", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toBe("topic");
  });
});
