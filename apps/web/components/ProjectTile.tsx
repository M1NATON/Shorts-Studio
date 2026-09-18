"use client";
import Link from "next/link";
import { api, mediaUrl, videoUrl, type Job, type Project } from "@/lib/api";
import { formatDate, formatDuration, jobProgress, STATUS_HINT, STATUS_LABEL } from "@/lib/format";

/**
 * Карточка ролика: статичная обложка, а не плеер — сотня плееров положит вкладку.
 */
export function ProjectTile({ project, job, onChange }: { project: Project; job?: Job; onChange: () => void }) {
  const landscape = project.format === "landscape";
  const title = project.title ?? project.topic;
  const canDownload = project.status === "ready" || project.status === "stale";

  async function remove() {
    if (!window.confirm(`Удалить «${title}»? Сцены, озвучка и MP4 будут удалены.`)) return;
    await api.deleteProject(project.id).catch((e: Error) => window.alert(e.message));
    onChange();
  }

  return (
    <div className={`tile${landscape ? " landscape" : ""}`}>
      <Link href={`/video/${project.id}`} className={`thumb${landscape ? " landscape" : ""}`}>
        {project.thumbnailPath ? (
          // Версия в URL: после пересборки первой сцены обложка обновляется, а не берётся из кеша.
          <img src={mediaUrl(project.thumbnailPath, project.updatedAt)} alt="" loading="lazy" />
        ) : (
          <div className="placeholder">{project.status === "failed" ? "Не удалось" : project.topic}</div>
        )}
        <div className="overlay">
          <span className={`badge ${project.status}`} title={project.error ?? STATUS_HINT[project.status]}>
            {STATUS_LABEL[project.status]}
          </span>
          {project.durationSec ? <span className="badge">{formatDuration(project.durationSec)}</span> : null}
          {landscape ? <span className="badge">16:9</span> : null}
          {project.researchedAt ? (
            <span className="badge" title={project.freshness === "current" ? "Свежие источники: новости за год" : "Обычный поиск"}>
              факты на {formatDate(project.researchedAt)}
            </span>
          ) : null}
        </div>
      </Link>
      {job && (job.status === "queued" || job.status === "running") ? (
        <div className="stack" style={{ gap: 4 }}>
          <div className="small muted">{jobProgress(job)}</div>
          <div className="progress">
            <div style={{ width: `${job.total ? Math.round(((job.done ?? 0) / job.total) * 100) : job.status === "running" ? 8 : 0}%` }} />
          </div>
        </div>
      ) : null}
      <Link href={`/video/${project.id}`} className="tile-title">{title}</Link>
      <div className="small muted">{formatDate(project.createdAt)}</div>
      {project.status === "failed" && project.error ? <div className="small error">{project.error}</div> : null}
      <div className="tile-actions">
        {canDownload ? <a className="btn sm" href={videoUrl(project.id)}>MP4</a> : null}
        {project.status === "failed" ? (
          <button className="btn sm" onClick={() => api.retry(project.id).then(onChange)}>Повторить</button>
        ) : null}
        <button className="btn sm ghost" title="Та же тема, новая версия" onClick={() => api.duplicate(project.id).then(onChange)}>Ещё версия</button>
        <button className="btn sm ghost danger" onClick={() => void remove()}>Удалить</button>
      </div>
    </div>
  );
}
