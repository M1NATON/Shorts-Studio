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
  /** Отменить идущую задачу; false — такой задачи сейчас нет в работе. */
  cancel(jobId: string): boolean;
}

export const CANCELLED = "Отменено";

/**
 * Зависимости одной задачи, которые перестают работать после отмены: следующий
 * запрос к модели, озвучка, поиск и скачивание медиа, шаг прогресса бросают,
 * рендер Remotion прерывается сам.
 * Уже идущий запрос к модели дорабатывает, но записать результат в базу задача уже не сможет.
 */
function cancellable(deps: PipelineDeps, signal: AbortSignal): PipelineDeps {
  const guard = <T extends { askJson: (...args: never[]) => unknown }>(client: T): T =>
    ({ ...client, askJson: (...args: Parameters<T["askJson"]>) => (signal.throwIfAborted(), client.askJson(...args)) }) as T;
  return {
    ...deps,
    // Любое обращение отменённой задачи к базе бросает: иначе запрос к модели, начатый до
    // отмены, дописал бы сценарий (saveScript ставит проект в draft) поверх «Отменено».
    repo: Object.fromEntries(
      Object.entries(deps.repo).map(([name, method]) => [
        name,
        typeof method === "function"
          ? (...args: unknown[]) => (signal.throwIfAborted(), (method as (...a: unknown[]) => unknown)(...args))
          : method,
      ]),
    ) as PipelineDeps["repo"],
    generationContext: async (onProgress) => {
      const ctx = await deps.generationContext(onProgress);
      return { ...ctx, llm: guard(ctx.llm), ...(ctx.llmFast ? { llmFast: guard(ctx.llmFast) } : {}) };
    },
    voice: (narration, absPath) => (signal.throwIfAborted(), deps.voice(narration, absPath)),
    // Медиа ловит свои ошибки по сцене — после отмены каждый поиск и скачивание просто не начнутся.
    searchMedia: (input) => (signal.throwIfAborted(), deps.searchMedia(input)),
    downloadMedia: (url, dest) => (signal.throwIfAborted(), deps.downloadMedia(url, dest)),
    render: (manifest, outputAbs, onProgress) => deps.render(manifest, outputAbs, onProgress, signal),
  };
}

/**
 * Не больше `max` вызовов одновременно; остальные ждут своей очереди.
 * `max` — функция: значение из настроек (maxConcurrency) читается на каждую проверку,
 * правка в UI действует без перезапуска сервера.
 */
export function limiter(max: number | (() => number)): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = typeof max === "function" ? max : () => max;
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    while (active >= limit()) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      // Будим всех: каждый перепроверит лимит сам — так рост maxConcurrency на лету сразу занимает новые места.
      waiting.splice(0).forEach((wake) => wake());
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
  const controllers = new Map<string, AbortController>();

  const kick = () => {
    kicked = true;
    wake?.();
  };

  async function process(job: JobRecord): Promise<void> {
    deps.events.emit({ type: "job", job });
    const controller = new AbortController();
    controllers.set(job.id, controller);
    try {
      const work = JOB_HANDLERS[job.kind](cancellable(deps, controller.signal), job);
      // После отмены задача закрывается сразу; сам обработчик остановится на ближайшей проверке сигнала.
      work.catch(() => undefined);
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error(CANCELLED)), { once: true }),
      );
      const result = await Promise.race([work, aborted]);
      const done = await deps.repo.updateJob(job.id, { status: "done", result: result ?? null, stage: "done", message: null });
      deps.events.emit({ type: "job", job: done });
    } catch (error) {
      const message = controller.signal.aborted ? CANCELLED : error instanceof Error ? error.message : String(error);
      options.log?.(`job ${job.kind} ${job.id} failed: ${message}`);
      const failed = await deps.repo.updateJob(job.id, { status: "failed", error: message });
      deps.events.emit({ type: "job", job: failed });
      if (job.kind === "generate" && job.projectId) {
        await deps.repo.updateProject(job.projectId, { status: "failed", error: message });
        deps.events.emit({ type: "project", projectId: job.projectId });
      }
    } finally {
      controllers.delete(job.id);
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
    cancel(jobId) {
      const controller = controllers.get(jobId);
      controller?.abort();
      return Boolean(controller);
    },
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        kick();
      }),
  };
}
