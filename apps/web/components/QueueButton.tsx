"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ListOrdered, X } from "lucide-react";
import { api, type Job, type Queue, type QueueJob } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { jobProgress } from "@/lib/format";
import { Popover } from "./Popover";

const JOB_LABEL: Record<Job["kind"], string> = {
  generate: "Генерация",
  render: "Рендер MP4",
  "regenerate-scene": "Варианты кадра",
  "rewrite-scene": "Новый текст сцены",
  "revoice-scene": "Переозвучка",
  thumbnail: "Обложка",
};

const EMPTY: Queue = { running: [], queued: [], recent: [] };

function Row({ job, onCancel }: { job: QueueJob; onCancel?: () => void }) {
  const what = `${JOB_LABEL[job.kind]}${job.sceneIndex !== null ? ` · сцена ${job.sceneIndex + 1}` : ""}`;
  const detail = job.status === "failed" ? job.error : job.status === "running" ? jobProgress(job) : null;
  return (
    <li className={`queue-row ${job.status}`}>
      <div className="queue-text">
        {job.projectId ? <Link href={`/video/${job.projectId}`}>{job.projectTitle ?? "Проект"}</Link> : <span>—</span>}
        <span className="small muted">{what}{detail ? ` · ${detail}` : ""}</span>
        {job.status === "running" && job.total ? (
          <progress max={job.total} value={job.done ?? 0} aria-label={`${what}: прогресс`} />
        ) : null}
      </div>
      {onCancel ? (
        <button className="btn ghost icon" aria-label="Отменить" title="Отменить" onClick={onCancel}>
          <X size={14} strokeWidth={1.75} />
        </button>
      ) : null}
    </li>
  );
}

/** Очередь всех проектов: что делается сейчас, что ждёт и в каком порядке. */
export function QueueButton() {
  const [queue, setQueue] = useState<Queue>(EMPTY);
  const load = useCallback(() => api.queue().then(setQueue).catch(() => undefined), []);
  useEffect(() => void load(), [load]);

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
  const busy = queue.running.length + queue.queued.length;

  return (
    <Popover
      label="Очередь"
      className="btn ghost"
      menuClass="menu queue"
      button={
        <>
          <ListOrdered size={16} strokeWidth={1.75} />
          {busy > 0 ? <span className="mono">{busy}</span> : null}
        </>
      }
    >
      {() => (
        <>
          <h3 className="queue-title">Выполняется</h3>
          {queue.running.length ? (
            <ul className="queue-list">{queue.running.map((j) => <Row key={j.id} job={j} />)}</ul>
          ) : (
            <p className="small muted">Ничего не выполняется</p>
          )}
          {queue.queued.length ? (
            <>
              <h3 className="queue-title">Ждут · по порядку</h3>
              <ol className="queue-list">{queue.queued.map((j) => <Row key={j.id} job={j} onCancel={() => cancel(j.id)} />)}</ol>
            </>
          ) : null}
          {queue.recent.length ? (
            <>
              <h3 className="queue-title">Недавние</h3>
              <ul className="queue-list">{queue.recent.map((j) => <Row key={j.id} job={j} />)}</ul>
            </>
          ) : null}
        </>
      )}
    </Popover>
  );
}
