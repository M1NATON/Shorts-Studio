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
import { createProviderStore } from "./providers.js";

/** Фальшивый ключ: проверяем, что он нигде не всплывает в ответах API. */
const SECRET = "sk-test-0123456789abcdef-SECRET";

const BEATS = [
  { narration: "Batteries got ninety percent cheaper in a decade.", intent: "hook" },
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

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "studio-"));
  database = openDatabase(":memory:");
  repo = createRepository(database);
  const events = new StudioEvents();
  received = [];
  events.subscribe((e) => received.push(e));
  voiced = [];
  renders = 0;
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
  };
  worker = startWorker(deps, { pollMs: 20 });
  const config = { ...loadConfig({ LLM_BASE_URL: "https://llm.test/v1", LLM_API_KEY: SECRET, LLM_MODEL: "env-model" }, dir), storageDir: dir };
  app = await buildApp({
    ...deps,
    config,
    providers: createProviderStore(repo, config),
    testProvider: async (kind) => ({ ok: kind === "llm", message: kind }),
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

describe("API", () => {
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
