/**
 * Воркер очереди: несколько задач сразу, но по одной на проект (это держит
 * claimNextJob). Узкие места — прокси модели, озвучка, рендер — ограничены не здесь,
 * а общими лимитами на сами вызовы (limiter в main.ts): пока одна задача ждёт модель,
 * другая может рендерить.
 */
import type { JobRecord } from "@shorts/db";
import { JOB_HANDLERS, type PipelineDeps } from "./pipeline.js";

export interface Worker {
  /** Разбудить воркер: в очереди появилась задача. */
  kick(): void;
  stop(): Promise<void>;
  /** Дождаться, пока очередь опустеет (для тестов). */
  idle(): Promise<void>;
}

/** Не больше `max` вызовов одновременно; остальные ждут своей очереди. */
export function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    while (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export function startWorker(
  deps: PipelineDeps,
  options: { concurrency?: number; pollMs?: number; log?: (m: string) => void } = {},
): Worker {
  const concurrency = options.concurrency ?? 1;
  const active = new Set<Promise<void>>();
  let stopped = false;
  let kicked = false;
  let wake: (() => void) | undefined;
  const idleWaiters: (() => void)[] = [];

  const kick = () => {
    kicked = true;
    wake?.();
  };

  async function process(job: JobRecord): Promise<void> {
    deps.events.emit({ type: "job", job });
    try {
      const result = await JOB_HANDLERS[job.kind](deps, job);
      const done = await deps.repo.updateJob(job.id, { status: "done", result: result ?? null, stage: "done", message: null });
      deps.events.emit({ type: "job", job: done });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.log?.(`job ${job.kind} ${job.id} failed: ${message}`);
      const failed = await deps.repo.updateJob(job.id, { status: "failed", error: message });
      deps.events.emit({ type: "job", job: failed });
      if (job.kind === "generate" && job.projectId) {
        await deps.repo.updateProject(job.projectId, { status: "failed", error: message });
        deps.events.emit({ type: "project", projectId: job.projectId });
      }
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      kicked = false;
      if (active.size < concurrency) {
        const job = await deps.repo.claimNextJob();
        if (job) {
          const run: Promise<void> = process(job).finally(() => {
            active.delete(run);
            kick();
          });
          active.add(run);
          continue;
        }
        if (active.size === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
      }
      // Задача могла закончиться, пока шла выборка: тогда не спим до следующего опроса.
      if (kicked) continue;
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, options.pollMs ?? 2000);
      });
    }
    await Promise.all(active);
  }

  const running = loop();
  return {
    kick,
    async stop() {
      stopped = true;
      wake?.();
      await running;
    },
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        kick();
      }),
  };
}
