import { describe, expect, it } from "vitest";
import { createRepository, openDatabase } from "@shorts/db";
import { StudioEvents } from "./events.js";
import type { PipelineDeps } from "./pipeline.js";
import { limiter, startWorker } from "./worker.js";

describe("воркер", () => {
  it("разные проекты идут параллельно, задачи одного проекта — по очереди", async () => {
    const database = openDatabase(":memory:");
    const repo = createRepository(database);
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deps = {
      repo,
      events: new StudioEvents(),
      storageDir: "/nonexistent",
      // Генерация «зависает» на модели, пока тест её не отпустит, затем падает — это не важно.
      generationContext: async () => {
        started.push("x");
        await gate;
        throw new Error("stop");
      },
    } as unknown as PipelineDeps;
    const a = await repo.createProject({ topic: "a", format: "shorts" });
    const b = await repo.createProject({ topic: "b", format: "shorts" });
    await repo.createJob({ kind: "generate", projectId: a.id });
    await repo.createJob({ kind: "generate", projectId: a.id });
    await repo.createJob({ kind: "generate", projectId: b.id });

    const worker = startWorker(deps, { concurrency: 3, pollMs: 10 });
    await expect.poll(() => started.length).toBe(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toHaveLength(2);
    release();
    await worker.idle();
    expect(started).toHaveLength(3);
    await worker.stop();
    database.close();
  });

  it("limiter держит не больше N вызовов сразу", async () => {
    const slot = limiter(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };
    await Promise.all(Array.from({ length: 6 }, () => slot(task)));
    expect(peak).toBe(2);
  });
});
