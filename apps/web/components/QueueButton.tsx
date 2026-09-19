"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, ListOrdered, LoaderCircle, RotateCcw, X } from "lucide-react";
import { api, type Job, type Queue, type QueueJob } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { formatDuration, stageText, timeAgo } from "@/lib/format";

const JOB_LABEL: Record<Job["kind"], string> = {
  generate: "Генерация",
  render: "Рендер MP4",
  "regenerate-scene": "Варианты кадра",
  "rewrite-scene": "Новый текст сцены",
  "revoice-scene": "Переозвучка",
  thumbnail: "Обложка",
};

const EMPTY: Queue = { running: [], queued: [], recent: [] };
const RECENT_ERROR_MS = 10 * 60_000;

const what = (job: QueueJob) => `${JOB_LABEL[job.kind]}${job.sceneIndex !== null ? ` · сцена ${job.sceneIndex + 1}` : ""}`;

const ProjectLink = ({ job }: { job: QueueJob }) =>
  job.projectId ? <Link href={`/video/${job.projectId}`}>{job.projectTitle ?? "Проект"}</Link> : <span>—</span>;

/** Крупная карточка идущей задачи: этап, прогресс, сколько уже длится. */
function RunningCard({ job, now, onCancel }: { job: QueueJob; now: number; onCancel: () => void }) {
  const elapsedSec = Math.max(0, Math.round((now - new Date(job.startedAt ?? job.createdAt).getTime()) / 1000));
  const pct = job.total ? Math.round(((job.done ?? 0) / job.total) * 100) : null;
  return (
    <li className="queue-card">
      <div className="queue-card-head">
        <ProjectLink job={job} />
        {/* От перехода в running; createdAt — только у задач, взятых до миграции 8. */}
        <span className="small muted mono">идёт {formatDuration(elapsedSec) || "0:00"}</span>
        <button className="btn ghost icon sm" aria-label={`Остановить: ${what(job)}`} title="Остановить" onClick={onCancel}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="small muted">{what(job)} · {stageText(job)}</div>
      <div className="queue-progress">
        <progress max={job.total ?? undefined} value={job.total ? (job.done ?? 0) : undefined} aria-label={`${what(job)}: прогресс${pct !== null ? `, ${pct}%` : ""}`} />
        {pct !== null ? <span className="small mono">{pct}% · {job.done ?? 0} из {job.total}</span> : null}
      </div>
    </li>
  );
}

/** Почему задача ещё не началась: тот же проект уже выполняется, свободных слотов нет, или вот-вот начнётся. */
function waitReason(job: QueueJob, queue: Queue): string {
  const sameProject = queue.running.find((r) => r.projectId === job.projectId);
  if (sameProject) return `ждёт завершения: ${what(sameProject)}`;
  if (queue.running.length >= 3) return "ждёт свободного места";
  return "скоро начнётся";
}

function QueuedRow({ job, queue, onCancel }: { job: QueueJob; queue: Queue; onCancel: () => void }) {
  return (
    <li className="queue-row">
      <div className="queue-text">
        <ProjectLink job={job} />
        <span className="small">{what(job)}</span>
        <span className="small muted">{waitReason(job, queue)}</span>
      </div>
      <button className="btn ghost icon" aria-label="Отменить" title="Отменить" onClick={onCancel}>
        <X size={14} strokeWidth={1.75} />
      </button>
    </li>
  );
}

function RecentRow({ job, onRetry }: { job: QueueJob; onRetry?: () => void }) {
  const failed = job.status === "failed";
  return (
    <li className={`queue-row recent ${job.status}`}>
      {failed ? <CircleX size={14} strokeWidth={1.75} aria-hidden /> : <CircleCheck size={14} strokeWidth={1.75} aria-hidden />}
      <div className="queue-text">
        <ProjectLink job={job} />
        <span className="small muted">{what(job)} · {timeAgo(job.updatedAt)}</span>
        {failed && job.error ? <span className="small queue-error" title={job.error}>{job.error}</span> : null}
      </div>
      {onRetry ? (
        <button className="btn ghost icon" aria-label="Повторить" title="Повторить" onClick={onRetry}>
          <RotateCcw size={14} strokeWidth={1.75} />
        </button>
      ) : null}
    </li>
  );
}

/** Очередь всех проектов: что делается сейчас, что ждёт и в каком порядке. */
export function QueueButton() {
  const [queue, setQueue] = useState<Queue>(EMPTY);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => api.queue().then(setQueue).catch(() => undefined), []);
  useEffect(() => void load(), [load]);

  // Время идущих задач тикает раз в секунду, но только пока панель открыта.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  useStudioEvents((event) => {
    if (event.type !== "job") return;
    const job = event.job;
    // Прогресс идущей задачи — на месте; смена статуса меняет списки — перечитываем.
    const known = queue.running.find((j) => j.id === job.id);
    if (known && job.status === "running") {
      setQueue((q) => ({ ...q, running: q.running.map((j) => (j.id === job.id ? { ...j, ...job } : j)) }));
    } else {
      void load();
    }
  });

  const cancel = (id: string) => void api.cancelJob(id).catch(() => undefined).then(load);
  // Остановка идущей задачи теряет сделанное, поэтому с подтверждением.
  const stop = (job: QueueJob) => {
    if (window.confirm(`Остановить «${what(job)}»${job.projectTitle ? ` — ${job.projectTitle}` : ""}? Сделанное в этой задаче пропадёт.`)) cancel(job.id);
  };
  const retry = (projectId: string) => void api.retry(projectId).catch(() => undefined).then(load);
  const dialog = useRef<HTMLDialogElement>(null);
  // Упавшую генерацию можно повторить, если проект всё ещё в ошибке (сервер проверит сам).
  const retryable = (j: QueueJob) => j.status === "failed" && j.kind === "generate" && j.projectId !== null;

  const busy = queue.running.length + queue.queued.length;
  const summary = busy === 0
    ? "Очередь"
    : [
        queue.running.length ? `${queue.running.length} в работе` : "",
        queue.queued.length ? `${queue.queued.length} ${queue.queued.length === 1 ? "ждёт" : "ждут"}` : "",
      ].filter(Boolean).join(" · ");
  const recentFailed = queue.recent.find((j) => j.status === "failed" && Date.now() - new Date(j.updatedAt).getTime() < RECENT_ERROR_MS);
  const empty = busy === 0 && queue.recent.length === 0;

  return (
    <>
      <button
        type="button"
        className="btn ghost"
        aria-haspopup="dialog"
        title="Очередь"
        onClick={() => { void load(); setOpen(true); dialog.current?.showModal(); }}
      >
        <ListOrdered size={16} strokeWidth={1.75} />
        {busy > 0 ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" aria-hidden /> : null}
        {summary}
        {recentFailed ? (
          <span className="queue-alert" role="img" aria-label={`Недавняя ошибка: ${recentFailed.projectTitle ?? "проект"} — ${recentFailed.error ?? "не удалось"}`} title={`Ошибка: ${recentFailed.projectTitle ?? "проект"} — ${recentFailed.error ?? "не удалось"}`} />
        ) : null}
      </button>
      {/* Нативный dialog: Escape, фокус внутри и затемнение фона даёт браузер; клик по фону закрывает. */}
      <dialog
        ref={dialog}
        className="drawer"
        aria-label="Очередь задач"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        onClose={() => setOpen(false)}
      >
        <div className="drawer-body">
          <header className="drawer-head">
            <h2>Очередь</h2>
            <span className="small muted" role="status" aria-live="polite">{busy > 0 ? summary : "пусто"}</span>
            <div className="spacer" />
            <button className="btn ghost icon" aria-label="Закрыть" onClick={() => dialog.current?.close()}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </header>
          {empty ? (
            <p className="small muted queue-empty">Сейчас ничего не делается. Новые ролики и рендеры появятся здесь.</p>
          ) : (
            <>
              <h3 className="queue-title">Выполняется · {queue.running.length}</h3>
              {queue.running.length ? (
                <ul className="queue-list cards">{queue.running.map((j) => <RunningCard key={j.id} job={j} now={now} onCancel={() => stop(j)} />)}</ul>
              ) : (
                <p className="small muted">Ничего не выполняется</p>
              )}
              <h3 className="queue-title">Ждут по порядку · {queue.queued.length}</h3>
              {queue.queued.length ? (
                <ol className="queue-list numbered">{queue.queued.map((j) => <QueuedRow key={j.id} job={j} queue={queue} onCancel={() => cancel(j.id)} />)}</ol>
              ) : (
                <p className="small muted">Очередь пуста</p>
              )}
              {queue.recent.length ? (
                <>
                  <h3 className="queue-title">Недавние</h3>
                  <ul className="queue-list">
                    {queue.recent.map((j) => <RecentRow key={j.id} job={j} {...(retryable(j) ? { onRetry: () => retry(j.projectId!) } : {})} />)}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
