import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { DEFAULT_VIDEO_THEME, ManifestSchema, type Script } from "@shorts/contracts";
import { openDatabase, type Database } from "./client.js";
import { audioHash, createRepository, NotReadyError, projectPaths, type Repository } from "./repository.js";
import { MIGRATIONS } from "./migrations.js";
import * as schema from "./schema.js";

const visual = (text: string) => ({ kind: "hook-statement", text }) as const;
const script: Script = {
  title: "Why batteries got cheap",
  language: "en",
  fps: 30,
  format: "shorts",
  scenes: Array.from({ length: 5 }, (_, i) => ({
    id: `scene-${i + 1}`,
    narration: `Narration ${i + 1}`,
    intent: i === 0 ? "hook" : "fact",
    visual: { ...visual(`Scene ${i + 1}`), variant: "statement", emphasisWords: [], layout: "center", motion: "rise", backdrop: "plain", accentShift: 0 },
  })) as Script["scenes"],
};
const audio = (n: number) => ({
  path: projectPaths("p").audio(`h${n}`),
  hash: `h${n}`,
  durationSec: 3 + n,
  words: [{ text: "Narration", start: 0, end: 0.5 }],
  timingSource: "native" as const,
});

let database: Database;
let repo: Repository;
beforeEach(() => {
  database = openDatabase(":memory:");
  repo = createRepository(database);
});
afterEach(() => database.close());

async function projectWithScript() {
  const project = await repo.createProject({ topic: "Batteries", format: "shorts" });
  const saved = await repo.saveScript(project.id, {
    script,
    theme: DEFAULT_VIDEO_THEME,
    sources: [{ url: "https://x.test/a", title: "A", kind: "news", publishedAt: "2026-09-01", excerpt: "115 $/kWh" }],
    brief: "[1] A",
    freshness: "current",
    researchedAt: "2026-09-18",
    unverified: [[], ["139"], [], [], []],
  });
  return { project, saved };
}

describe("миграции", () => {
  it("таблицы после миграций совпадают со схемой Drizzle — SQL и схема не разошлись", () => {
    for (const table of [schema.projects, schema.scenes, schema.sceneVersions, schema.renders, schema.jobs, schema.settings]) {
      const actual = (database.raw.prepare(`PRAGMA table_info(${getTableName(table)})`).all() as { name: string }[])
        .map((c) => c.name)
        .sort();
      const expected = Object.values(getTableColumns(table)).map((c) => c.name).sort();
      expect(actual).toEqual(expected);
    }
  });

  it("повторное открытие не применяет миграции заново", () => {
    expect(Number((database.raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(MIGRATIONS.length);
  });
});

describe("проекты", () => {
  it("создание, сценарий → draft, поиск и фильтры", async () => {
    const { project, saved } = await projectWithScript();
    expect(project.status).toBe("generating");
    expect(saved).toHaveLength(5);
    expect(saved[1]!.version.unverifiedNumbers).toEqual(["139"]);
    expect(saved[0]!.version.intent).toBe("hook");

    await repo.createProject({ topic: "Heat pumps", format: "landscape", minutes: 3 });
    const all = await repo.listProjects();
    expect(all.total).toBe(2);
    expect((await repo.listProjects({ search: "batter" })).items.map((p) => p.title)).toEqual(["Why batteries got cheap"]);
    expect((await repo.listProjects({ format: "landscape" })).items).toHaveLength(1);
    expect((await repo.listProjects({ status: "draft" })).items[0]!.freshness).toBe("current");
  });

  it("удаление каскадом убирает сцены и версии", async () => {
    const { project } = await projectWithScript();
    await repo.deleteProject(project.id);
    expect(database.raw.prepare("SELECT count(*) AS n FROM scene_versions").get()).toMatchObject({ n: 0 });
  });
});

describe("версии сцен", () => {
  it("новая версия становится текущей, старая остаётся в истории; готовый ролик становится stale", async () => {
    const { project, saved } = await projectWithScript();
    await repo.updateProject(project.id, { status: "ready" });
    const scene = saved[2]!;
    const edited = await repo.addVersion(scene.id, {
      narration: scene.version.narration,
      visual: visual("Edited by hand"),
      origin: "manual",
    });
    expect((await repo.getScene(scene.id)).version.id).toBe(edited.id);
    expect((await repo.listVersions(scene.id)).map((v) => v.origin)).toEqual(["manual", "ai"]);
    expect((await repo.requireProject(project.id)).status).toBe("stale");

    await repo.selectVersion(scene.id, scene.version.id);
    expect((await repo.getScene(scene.id)).version.visual).toMatchObject({ text: "Scene 3" });
  });

  it("вариант без makeCurrent не меняет текущую версию", async () => {
    const { saved } = await projectWithScript();
    await repo.addVersion(saved[0]!.id, { narration: "x", visual: visual("Variant"), origin: "variant" }, { makeCurrent: false });
    expect((await repo.getScene(saved[0]!.id)).version.id).toBe(saved[0]!.version.id);
  });

  it("невалидный визуал не попадает в базу", async () => {
    const { saved } = await projectWithScript();
    await expect(
      repo.addVersion(saved[0]!.id, { narration: "x", visual: { kind: "hook-statement" } as never, origin: "manual" }),
    ).rejects.toThrow();
  });
});

describe("манифест", () => {
  it("без озвучки не собирается, с озвучкой — валиден и хеш стабилен", async () => {
    const { project, saved } = await projectWithScript();
    await expect(repo.buildManifest(project.id)).rejects.toBeInstanceOf(NotReadyError);
    for (const [i, scene] of saved.entries()) await repo.setAudio(scene.version.id, audio(i));

    const first = await repo.buildManifest(project.id);
    expect(ManifestSchema.safeParse(first.manifest).success).toBe(true);
    expect(first.manifest.scenes[1]!.startFrame).toBe(first.manifest.scenes[0]!.durationInFrames);
    expect(first.manifest.sources[0]).toMatchObject({ kind: "news", publishedAt: "2026-09-01" });
    expect((await repo.buildManifest(project.id)).hash).toBe(first.hash);

    await repo.addVersion(saved[1]!.id, { ...saved[1]!.version, visual: visual("Other"), audio: audio(1), origin: "manual" });
    expect((await repo.buildManifest(project.id)).hash).not.toBe(first.hash);
  });

  it("стиль субтитров попадает в манифест и делает готовый ролик stale", async () => {
    const { project, saved } = await projectWithScript();
    for (const [i, scene] of saved.entries()) await repo.setAudio(scene.version.id, audio(i));
    await repo.updateProject(project.id, { status: "ready" });
    await repo.setCaptionStyle(project.id, "outline");
    expect((await repo.buildManifest(project.id)).manifest.captionStyle).toBe("outline");
    expect((await repo.requireProject(project.id)).status).toBe("stale");
  });

  it("хеш озвучки зависит от текста и голоса", () => {
    expect(audioHash("a", "v1")).toBe(audioHash("a", "v1"));
    expect(audioHash("a", "v1")).not.toBe(audioHash("a", "v2"));
  });
});

describe("задачи", () => {
  it("очередь по порядку, одна задача не выдаётся дважды", async () => {
    const a = await repo.createJob({ kind: "generate" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await repo.createJob({ kind: "render" });
    const [first, second, third] = await Promise.all([repo.claimNextJob(), repo.claimNextJob(), repo.claimNextJob()]);
    expect([first?.id, second?.id]).toEqual([a.id, b.id]);
    expect(third).toBeUndefined();
  });

  it("задачи одного проекта идут по одной, другой проект не ждёт", async () => {
    const a = await repo.createProject({ topic: "a", format: "shorts" });
    const b = await repo.createProject({ topic: "b", format: "shorts" });
    const tick = () => new Promise((r) => setTimeout(r, 2));
    const a1 = await repo.createJob({ kind: "generate", projectId: a.id });
    await tick();
    const a2 = await repo.createJob({ kind: "render", projectId: a.id });
    await tick();
    const b1 = await repo.createJob({ kind: "render", projectId: b.id });
    expect((await repo.claimNextJob())?.id).toBe(a1.id);
    expect((await repo.claimNextJob())?.id).toBe(b1.id);
    expect(await repo.claimNextJob()).toBeUndefined();
    await repo.updateJob(a1.id, { status: "done" });
    expect((await repo.claimNextJob())?.id).toBe(a2.id);
  });

  it("отменить можно только ждущую задачу; отменённая генерация — проект в ошибке", async () => {
    const project = await repo.createProject({ topic: "x", format: "shorts" });
    const running = await repo.createJob({ kind: "render" });
    await repo.claimNextJob();
    const queued = await repo.createJob({ kind: "generate", projectId: project.id });
    expect(await repo.cancelJob(running.id)).toBeUndefined();
    expect((await repo.cancelJob(queued.id))?.status).toBe("failed");
    expect((await repo.requireProject(project.id)).status).toBe("failed");
    expect(await repo.claimNextJob()).toBeUndefined();
  });

  it("после рестарта running → failed, проект в generating → failed", async () => {
    const project = await repo.createProject({ topic: "x", format: "shorts" });
    await repo.createJob({ kind: "generate", projectId: project.id });
    await repo.claimNextJob();
    expect(await repo.failInterruptedJobs()).toBe(1);
    expect((await repo.requireProject(project.id)).status).toBe("failed");
    expect((await repo.listJobs({ projectId: project.id }))[0]!.error).toMatch(/перезапущен/);
  });

  it("ошибка внутри транзакции откатывает всё", async () => {
    const project = await repo.createProject({ topic: "x", format: "shorts" });
    await expect(
      database.transaction(async (tx) => {
        await tx.update(schema.projects).set({ title: "changed" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await repo.requireProject(project.id)).title).toBeNull();
  });
});

describe("операции со сценами", () => {
  const order = async (projectId: string) => (await repo.currentScenes(projectId)).map((s) => s.version.visual).map((v) => ("text" in v ? v.text : "?"));

  it("перестановка, вставка и удаление держат позиции без дыр", async () => {
    const { project, saved } = await projectWithScript();
    await repo.moveScene(saved[4]!.id, 0);
    expect((await order(project.id))[0]).toBe("Scene 5");
    await repo.insertScene(project.id, 1, { narration: "Inserted", visual: visual("Inserted"), origin: "manual" });
    expect(await order(project.id)).toEqual(["Scene 5", "Scene 1", "Inserted", "Scene 2", "Scene 3", "Scene 4"]);
    await repo.deleteScene(saved[0]!.id);
    const positions = (await repo.currentScenes(project.id)).map((s) => s.position);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });

  it("озвучка находится по хешу внутри проекта", async () => {
    const { project, saved } = await projectWithScript();
    await repo.setAudio(saved[0]!.version.id, audio(7));
    expect((await repo.findAudio(project.id, "h7"))?.durationSec).toBe(10);
    expect(await repo.findAudio(project.id, "missing")).toBeUndefined();
  });

  it("настройки: запись и перезапись", async () => {
    await repo.setSetting("llm", { model: "a" });
    await repo.setSetting("llm", { model: "b" });
    expect(await repo.getSetting("llm")).toEqual({ model: "b" });
  });
});
