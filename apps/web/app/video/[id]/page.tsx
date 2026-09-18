"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import type { PlayerRef } from "@remotion/player";
import { FORMATS, type Manifest } from "@shorts/contracts";
import { SceneInspector } from "@/components/SceneInspector";
import { api, videoUrl, type Job, type ProjectDetail } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { formatDate, jobProgress, STATUS_HINT, STATUS_LABEL } from "@/lib/format";

// Плеер только в браузере: Remotion трогает window при импорте.
const VideoPlayer = dynamic(() => import("@/components/VideoPlayer").then((m) => m.VideoPlayer), { ssr: false });

/** Короткое описание кадра для списка сцен: «ring + caption». */
function describe(visual: ProjectDetail["scenes"][number]["version"]["visual"]): string {
  return visual.kind === "composed" ? visual.blocks.map((b) => b.block).join(" + ") : visual.kind;
}

export default function VideoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ProjectDetail>();
  const [manifest, setManifest] = useState<Manifest>();
  const [selected, setSelected] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>();
  const [safeZone, setSafeZone] = useState(false);
  const player = useRef<PlayerRef>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.project(id);
      setDetail(next);
      setJobs(next.jobs);
      setError(undefined);
      // Манифест есть, когда у всех сцен есть озвучка.
      const m = await api.manifest(id).catch(() => undefined);
      setManifest(m?.manifest);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useStudioEvents((event) => {
    if (event.type === "project" && event.projectId === id) void load();
    if (event.type === "job" && event.job.projectId === id) {
      setJobs((prev) => [event.job, ...prev.filter((j) => j.id !== event.job.id)].filter((j) => j.status === "queued" || j.status === "running"));
      if (event.job.status === "done" || event.job.status === "failed") void load();
      if (event.job.status === "failed") setError(`${event.job.kind}: ${event.job.error}`);
    }
  });

  // ↑/↓ — соседняя сцена, когда фокус не в поле ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const count = detail?.scenes.length ?? 0;
      if (e.key === "ArrowDown" && selected < count - 1) { e.preventDefault(); selectScene(selected + 1); }
      if (e.key === "ArrowUp" && selected > 0) { e.preventDefault(); selectScene(selected - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const act = (action: () => Promise<unknown>) => void action().then(load).catch((e: Error) => setError(e.message));

  const selectScene = (index: number) => {
    setSelected(index);
    const target = manifest?.scenes[index];
    // В начале сцены блоки ещё не вошли — показываем момент, когда кадр собран.
    if (target) player.current?.seekTo(target.startFrame + Math.round(target.durationInFrames * 0.6));
  };

  if (!detail) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Загрузка…</p>}</main>;
  const { project, scenes } = detail;
  const scene = scenes[selected];
  const renderJob = jobs.find((j) => j.kind === "render");
  const generateJob = jobs.find((j) => j.kind === "generate");
  const sceneJob = scene ? jobs.find((j) => j.sceneIndex === scene.position && j.kind !== "render" && j.kind !== "generate") : undefined;
  const chapterAt = new Map(project.chapters.map((c) => [c.firstScene, c.title]));

  return (
    <div className="editor">
      <aside className="card pane">
        <div style={{ padding: 12 }}>
          <div style={{ fontWeight: 600 }}>{project.title ?? project.topic}</div>
          <div className="small muted">
            <span className={`badge ${project.status}`} title={STATUS_HINT[project.status]}>{STATUS_LABEL[project.status]}</span>{" "}
            {project.format === "landscape" ? "16:9" : "9:16"}
            {project.researchedAt ? ` · факты на ${formatDate(project.researchedAt)}` : ""}
          </div>
        </div>
        {scenes.map((s, i) => (
          <div key={s.id}>
            {chapterAt.has(i) ? <div className="chapter-label">{chapterAt.get(i)}</div> : null}
            <div className={`scene-item${i === selected ? " on" : ""}`}>
              <button className="scene-select" onClick={() => selectScene(i)} aria-current={i === selected ? "true" : undefined}>
                <span className="meta">
                  <span>{i + 1}</span>
                  <span>{describe(s.version.visual)}</span>
                  {s.version.audio ? <span>{s.version.audio.durationSec.toFixed(1)} с</span> : null}
                  {s.version.unverifiedNumbers.length ? <span className="warn" title="Числа не подтверждены источниками">⚠ {s.version.unverifiedNumbers.join(", ")}</span> : null}
                  {!s.version.audio ? <span className="warn">без озвучки</span> : null}
                </span>
                <span className="small">{s.version.narration}</span>
              </button>
              {i === selected ? (
                <div className="scene-actions" role="toolbar" aria-label="Действия со сценой">
                  <button className="btn sm ghost" disabled={i === 0} title="Выше" aria-label="Переместить выше" onClick={() => act(() => api.moveScene(s.id, i - 1))}>↑</button>
                  <button className="btn sm ghost" disabled={i === scenes.length - 1} title="Ниже" aria-label="Переместить ниже" onClick={() => act(() => api.moveScene(s.id, i + 1))}>↓</button>
                  <button className="btn sm ghost" onClick={() => act(() => api.duplicateScene(s.id))}>Дублировать</button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      const text = window.prompt("Текст озвучки новой сцены (кадр и озвучку соберёт ИИ):");
                      if (text?.trim()) act(() => api.addScene(id, i, text.trim()));
                    }}
                  >
                    + сцена после
                  </button>
                  <button
                    className="btn sm ghost danger"
                    disabled={scenes.length <= 1}
                    onClick={() => {
                      if (window.confirm(`Удалить сцену ${i + 1}? Её версии тоже будут удалены.`)) {
                        setSelected(Math.max(0, i - 1));
                        act(() => api.deleteScene(s.id));
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {scenes.length === 0 && generateJob ? <p className="small muted" style={{ padding: 12 }}>{jobProgress(generateJob)}</p> : null}
        {project.sources.length > 0 ? (
          <details style={{ padding: 12 }}>
            <summary>Источники ({project.sources.length})</summary>
            <div className="stack small" style={{ marginTop: 8 }}>
              {project.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="muted">
                  {s.title}{s.publishedAt ? ` · ${formatDate(s.publishedAt)}` : ""}{s.kind === "news" ? " · новости" : ""}
                </a>
              ))}
            </div>
          </details>
        ) : null}
      </aside>

      <section className="center">
        <div className="jobs-bar">
          {generateJob ? <span>⏳ {jobProgress(generateJob)}</span> : null}
          {renderJob ? <span>⏳ {jobProgress(renderJob)}</span> : null}
          {error ? <span className="error">{error}</span> : null}
          <div className="spacer" />
          <label className="row small muted" title="Меняет MP4 — после смены ролик нужно экспортировать заново">
            Субтитры
            <select className="select" value={project.captionStyle} onChange={(e) => void api.setCaptionStyle(id, e.target.value as typeof project.captionStyle).then(load)}>
              <option value="karaoke">караоке</option>
              <option value="clean">чистые</option>
              <option value="boxed">на плашке</option>
              <option value="outline">с обводкой</option>
            </select>
          </label>
          {project.status === "failed" ? <button className="btn" onClick={() => void api.retry(id).then(load)}>Повторить генерацию</button> : null}
          <button className="btn primary" disabled={!manifest || Boolean(renderJob)} onClick={() => void api.render(id).then(load)}>
            {project.status === "ready" ? "Экспортировать снова" : "Экспорт MP4"}
          </button>
          {detail.render ? <a className="btn" href={videoUrl(id)}>Скачать{project.status === "stale" ? " (устарел)" : ""}</a> : null}
        </div>
        <div className="player-wrap">
          {manifest ? (
            <div className="player-stage" style={{ aspectRatio: `${manifest.width} / ${manifest.height}` }}>
              <VideoPlayer ref={player} manifest={manifest} />
              {safeZone ? (() => {
                // Зона контента формата: сюда валидатор укладывает блоки; снаружи — UI платформы и субтитры.
                const f = FORMATS[manifest.format];
                return (
                  <div
                    className="safe-zone"
                    style={{
                      top: `${(f.zone.top / f.height) * 100}%`,
                      bottom: `${(f.zone.bottom / f.height) * 100}%`,
                      left: `${(f.zone.side / f.width) * 100}%`,
                      right: `${(f.zone.side / f.width) * 100}%`,
                    }}
                  />
                );
              })() : null}
            </div>
          ) : (
            <p className="muted">{generateJob ? jobProgress(generateJob) : "Превью появится, когда у всех сцен будет озвучка"}</p>
          )}
        </div>
        <label className="row small muted">
          <input type="checkbox" checked={safeZone} onChange={(e) => setSafeZone(e.target.checked)} /> Рамка safe-зоны
        </label>
      </section>

      <aside className="card pane">
        {scene ? (
          <SceneInspector
            key={scene.id}
            scene={scene}
            format={project.format}
            {...(manifest ? { manifest } : {})}
            {...(sceneJob ? { activeJob: sceneJob } : {})}
            onChanged={() => void load()}
          />
        ) : (
          <p className="muted" style={{ padding: 16 }}>Сцен пока нет.</p>
        )}
      </aside>
    </div>
  );
}
