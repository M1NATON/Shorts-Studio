"use client";
import Link from "next/link";
import { CircleStop, Copy, Download, Ellipsis, FolderDown, RotateCcw, Trash2 } from "lucide-react";
import { api, mediaUrl, videoUrl, type Job, type Project } from "@/lib/api";
import { formatDate, formatDuration, formatShortDate, STATUS_HINT, STATUS_LABEL } from "@/lib/format";
import { GenerationProgress } from "./GenerationProgress";
import { Popover } from "./Popover";

/**
 * Карточка ролика: статичная обложка, а не плеер — сотня плееров положит вкладку.
 * Пока ролик собирается, вместо обложки — анимация сборки.
 */
export function ProjectTile({ project, job, onChange }: { project: Project; job?: Job; onChange: () => void }) {
  const landscape = project.format === "landscape";
  const title = project.title ?? project.topic;
  const canDownload = project.status === "ready" || project.status === "stale";
  const building = job && job.kind === "generate" && (job.status === "queued" || job.status === "running");

  async function remove() {
    if (!window.confirm(`Удалить «${title}»? Сцены, озвучка и MP4 будут удалены.`)) return;
    await api.deleteProject(project.id).catch((e: Error) => window.alert(e.message));
    onChange();
  }

  async function stop() {
    if (!job || !window.confirm(`Остановить сборку «${title}»? Сделанное пропадёт, потом можно «Повторить».`)) return;
    await api.cancelJob(job.id).catch((e: Error) => window.alert(e.message));
    onChange();
  }

  async function exportToFolder() {
    try {
      const { dir } = await api.exportToFolder(project.id);
      window.alert(`Сохранено в ${dir}`);
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <article className="tile" aria-label={title}>
      <Link href={`/video/${project.id}`} className={`thumb${landscape ? " landscape" : ""}`} tabIndex={-1} aria-hidden="true">
        {building ? (
          <GenerationProgress job={job} format={project.format} topic={project.topic} />
        ) : project.thumbnailPath ? (
          // Версия в URL: после пересборки первой сцены обложка обновляется, а не берётся из кеша.
          <img src={mediaUrl(project.thumbnailPath, project.updatedAt)} alt="" loading="lazy" />
        ) : (
          <div className="placeholder">{project.status === "failed" ? "Не удалось собрать" : project.topic}</div>
        )}
      </Link>
      <div className="tile-menu">
        <Popover className="btn sm icon" label="Действия с роликом" button={<Ellipsis size={16} strokeWidth={1.75} />}>
          {(close) => (
            <>
              {canDownload ? (
                <a href={videoUrl(project.id)} onClick={close}><Download size={16} strokeWidth={1.75} />Скачать MP4</a>
              ) : null}
              {/* Только актуальный рендер: устаревший MP4 в папку класть незачем — как и на странице ролика. */}
              {project.status === "ready" ? (
                <button onClick={() => { close(); void exportToFolder(); }}><FolderDown size={16} strokeWidth={1.75} />Сохранить в папку</button>
              ) : null}
              {building ? (
                <button onClick={() => { close(); void stop(); }}><CircleStop size={16} strokeWidth={1.75} />Остановить</button>
              ) : null}
              {project.status === "failed" ? (
                <button onClick={() => { close(); void api.retry(project.id).then(onChange); }}><RotateCcw size={16} strokeWidth={1.75} />Повторить</button>
              ) : null}
              <button title="Та же тема, новая версия" onClick={() => { close(); void api.duplicate(project.id).then(onChange); }}>
                <Copy size={16} strokeWidth={1.75} />Ещё версия
              </button>
              <button className="danger" onClick={() => { close(); void remove(); }}><Trash2 size={16} strokeWidth={1.75} />Удалить</button>
            </>
          )}
        </Popover>
      </div>
      <Link href={`/video/${project.id}`} className="tile-title" title={title}>{title}</Link>
      <div className="tile-meta">
        <span className={`status ${project.status}`} title={project.error ?? STATUS_HINT[project.status]}>{STATUS_LABEL[project.status]}</span>
        {project.durationSec ? <><span>·</span><span className="mono">{formatDuration(project.durationSec)}</span></> : null}
        <span>·</span>
        <span title={project.researchedAt ? `Факты на ${formatDate(project.researchedAt)}` : undefined}>{formatShortDate(project.createdAt)}</span>
      </div>
      {project.status === "failed" && project.error ? <div className="small error">{project.error}</div> : null}
    </article>
  );
}
