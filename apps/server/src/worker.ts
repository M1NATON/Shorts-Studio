/**
 * Воркер очереди: одна задача за раз. Параллельно нельзя — прокси модели отдаёт
 * 504 уже на трёх одновременных запросах, а рендер занимает все ядра.
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

export function startWorker(deps: PipelineDeps, options: { pollMs?: number; log?: (m: string) => void } = {}): Worker {
  let stopped = false;
  let wake: (() => void) | undefined;
  const idleWaiters: (() => void)[] = [];

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
      const job = await deps.repo.claimNextJob();
      if (job) {
        await process(job);
        continue;
      }
      idleWaiters.splice(0).forEach((resolve) => resolve());
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, options.pollMs ?? 2000);
      });
    }
  }

  const running = loop();
  return {
    kick: () => wake?.(),
    async stop() {
      stopped = true;
      wake?.();
      await running;
    },
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        wake?.();
      }),
  };
}
