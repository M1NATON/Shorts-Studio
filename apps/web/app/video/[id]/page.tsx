"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Captions, Download, ExternalLink, FileDown, FolderDown, Library, Megaphone, Music, RotateCcw, ScanLine, TriangleAlert, Upload } from "lucide-react";
import type { PlayerRef } from "@remotion/player";
import { FORMATS, type CaptionStyle, type Manifest } from "@shorts/contracts";
import { CaptionPicker } from "@/components/CaptionPicker";
import { ExportMenu } from "@/components/ExportMenu";
import { GenerationProgress } from "@/components/GenerationProgress";
import { MusicPicker, trackLabel } from "@/components/MusicPicker";
import { Popover } from "@/components/Popover";
import { PublishPanel } from "@/components/PublishPanel";
import { SceneInspector } from "@/components/SceneInspector";
import { Topbar } from "@/components/Topbar";
import { Transport } from "@/components/Transport";
import { api, videoUrl, type Job, type ProjectDetail } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { CAPTION_LABEL, formatDate, jobProgress, STATUS_HINT, STATUS_LABEL } from "@/lib/format";

// Плеер и таймлайн только в браузере: Remotion трогает window при импорте.
const VideoPlayer = dynamic(() => import("@/components/VideoPlayer").then((m) => m.VideoPlayer), { ssr: false });
const Timeline = dynamic(() => import("@/components/Timeline").then((m) => m.Timeline), { ssr: false });

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export default function VideoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ProjectDetail>();
  const [manifest, setManifest] = useState<Manifest>();
  const [selected, setSelected] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>();
  const [safeZone, setSafeZone] = useState(false);
  // Ссылка и состояние: транспорт и таймлайн подписываются на события плеера, когда он появится.
  const player = useRef<PlayerRef | null>(null);
  const [playerApi, setPlayerApi] = useState<PlayerRef | null>(null);
  const attachPlayer = useCallback((ref: PlayerRef | null) => {
    player.current = ref;
    setPlayerApi(ref);
  }, []);

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

  const scenes = detail?.scenes ?? [];
  const act = (action: () => Promise<unknown>) => void action().then(load).catch((e: Error) => setError(e.message));

  const selectScene = useCallback((index: number) => {
    setSelected(index);
    const target = manifest?.scenes[index];
    if (target) player.current?.seekTo(target.startFrame);
  }, [manifest]);

  // Во время воспроизведения выбранная сцена идёт за плейхедом.
  useEffect(() => {
    if (!playerApi || !manifest) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      if (!playerApi.isPlaying()) return;
      const index = manifest.scenes.findIndex((s) => e.detail.frame < s.startFrame + s.durationInFrames);
      if (index >= 0) setSelected((prev) => (prev === index ? prev : index));
    };
    playerApi.addEventListener("frameupdate", onFrame);
    return () => playerApi.removeEventListener("frameupdate", onFrame);
  }, [playerApi, manifest]);

  // Пробел — пуск/пауза; ←/→ — соседняя сцена; Alt+←/→ — переставить сцену.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      const count = scenes.length;
      const scene = scenes[selected];
      if (e.key === " ") {
        e.preventDefault();
        player.current?.toggle();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = selected + (e.key === "ArrowRight" ? 1 : -1);
        if (next < 0 || next >= count) return;
        e.preventDefault();
        if (e.altKey && scene) {
          setSelected(next);
          act(() => api.moveScene(scene.id, next));
        } else selectScene(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!detail) {
    return (
      <>
        <Topbar title="…" />
        <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Загрузка…</p>}</main>
      </>
    );
  }
  const { project } = detail;
  const scene = scenes[selected];
  const renderJob = jobs.find((j) => j.kind === "render");
  const generateJob = jobs.find((j) => j.kind === "generate");
  const sceneJob = scene ? jobs.find((j) => j.sceneIndex === scene.position && j.kind !== "render" && j.kind !== "generate") : undefined;
  const busyScene = jobs.find((j) => j.sceneIndex !== null && j.kind !== "render" && j.kind !== "generate")?.sceneIndex ?? undefined;
  const barJob = generateJob ?? renderJob ?? sceneJob;
  const barShare = barJob?.total ? (barJob.done ?? 0) / barJob.total : undefined;
  const title = project.title ?? project.topic;

  return (
    <>
      <Topbar title={title}>
        <span className="pill" title={STATUS_HINT[project.status]}>
          {project.format === "landscape" ? "16:9" : "9:16"} · <span className={`status ${project.status}`}>{STATUS_LABEL[project.status].toLowerCase()}</span>
        </span>
        {project.sources.length > 0 ? (
          <Popover
            className="btn ghost"
            label={`Источники: ${project.sources.length}`}
            button={<><Library {...ICON} />Источники <span className="mono muted">{project.sources.length}</span></>}
          >
            {() => (
              <>
                {project.researchedAt ? <p className="small muted" style={{ padding: "4px 8px" }}>Факты на {formatDate(project.researchedAt)}</p> : null}
                {project.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ maxWidth: 420 }}>
                    <ExternalLink size={14} strokeWidth={1.75} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
                    <span className="muted small">{s.publishedAt ? formatDate(s.publishedAt) : ""}{s.kind === "news" ? " · новости" : ""}</span>
                  </a>
                ))}
              </>
            )}
          </Popover>
        ) : null}
        <Popover
          label={`Субтитры: ${CAPTION_LABEL[project.captionStyle]}`}
          menuClass="menu wide"
          button={<><Captions {...ICON} />{CAPTION_LABEL[project.captionStyle]}</>}
        >
          {(close) => (
            <div className="stack">
              <p className="small muted">Стиль меняет MP4 — после смены ролик нужно экспортировать заново.</p>
              <CaptionPicker
                value={project.captionStyle}
                onChange={(style: CaptionStyle) => { close(); act(() => api.setCaptionStyle(id, style)); }}
              />
            </div>
          )}
        </Popover>
        <Popover
          label={project.music ? `Музыка: ${trackLabel(project.music.track)}` : "Музыка: нет"}
          menuClass="menu wide"
          button={<><Music {...ICON} />{project.music ? "Музыка" : "Без музыки"}</>}
        >
          {() => <MusicPicker value={project.music} onChange={(music) => act(() => api.setMusic(id, music))} />}
        </Popover>
        <Popover label="Экспорт содержимого ролика" button={<><FileDown {...ICON} />Экспорт</>}>
          {() => <ExportMenu project={project} scenes={scenes} />}
        </Popover>
        <Popover label="Публикация на YouTube" menuClass="menu wide" button={<><Megaphone {...ICON} />Публикация</>}>
          {() => <PublishPanel projectId={id} value={project.publish} onChanged={() => void load()} />}
        </Popover>
        <button className="btn" aria-pressed={safeZone} onClick={() => setSafeZone((v) => !v)} title="Рамка зоны контента: снаружи — интерфейс платформы и субтитры">
          <ScanLine {...ICON} />Safe-зона
        </button>
        {project.status === "failed" ? (
          <button className="btn" onClick={() => act(() => api.retry(id))}><RotateCcw {...ICON} />Повторить генерацию</button>
        ) : null}
        {project.status === "stale" ? <span className="warn small row" style={{ gap: 4 }}><TriangleAlert size={14} strokeWidth={1.75} />MP4 устарел</span> : null}
        {detail.render && project.status === "ready" ? (
          <>
            <button className="btn icon" disabled={Boolean(renderJob)} onClick={() => act(() => api.render(id))} aria-label="Экспортировать снова" title="Экспортировать снова">
              <RotateCcw {...ICON} />
            </button>
            <a className="btn pri" href={videoUrl(id)}><Download {...ICON} />Скачать MP4</a>
            <button className="btn" onClick={() => act(() => api.exportToFolder(id).then(({ dir }) => window.alert(`Сохранено в ${dir}`)))}>
              <FolderDown {...ICON} />Сохранить в папку
            </button>
          </>
        ) : (
          <>
            {detail.render ? <a className="btn ghost" href={videoUrl(id)}><Download {...ICON} />Скачать старый</a> : null}
            <button className="btn pri" disabled={!manifest || Boolean(renderJob)} onClick={() => act(() => api.render(id))}>
              <Upload {...ICON} />Экспорт MP4
            </button>
          </>
        )}
      </Topbar>

      <div className="editor">
        {barJob || error ? (
          <div className="jobs-bar" role="status">
            {barJob ? <span>{barJob.kind === "render" ? "Экспорт: " : ""}{jobProgress(barJob)}</span> : null}
            {error ? <span className="error">{error}</span> : null}
            {barJob ? <div className={`bar${barShare === undefined ? " indeterminate" : ""}`} style={{ width: `${(barShare ?? 0) * 100}%` }} /> : null}
          </div>
        ) : <div />}

        <div className="editor-main">
          <section className="stage" aria-label="Превью">
            <div className="player-wrap">
              {manifest ? (
                <div className="player-stage" style={{ aspectRatio: `${manifest.width} / ${manifest.height}` }}>
                  <VideoPlayer ref={attachPlayer} manifest={manifest} controls={false} />
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
              ) : generateJob ? (
                <GenerationProgress job={generateJob} format={project.format} topic={project.topic} large />
              ) : (
                <p className="stage-empty">{project.status === "failed" ? "Генерация не удалась" : "Превью появится, когда у всех сцен будет озвучка"}</p>
              )}
            </div>
            {manifest ? (
              <Transport
                player={playerApi}
                fps={manifest.fps}
                total={manifest.totalDurationInFrames}
                canPrev={selected > 0}
                canNext={selected < scenes.length - 1}
                onPrev={() => selectScene(selected - 1)}
                onNext={() => selectScene(selected + 1)}
              />
            ) : null}
          </section>

          <aside className="inspector-pane" aria-label="Инспектор сцены">
            {scene ? (
              <SceneInspector
                key={scene.id}
                scene={scene}
                count={scenes.length}
                format={project.format}
                {...(manifest ? { manifest } : {})}
                {...(sceneJob ? { activeJob: sceneJob } : {})}
                onChanged={() => void load()}
                onSelect={setSelected}
                act={act}
                projectId={id}
              />
            ) : (
              <p className="muted" style={{ padding: 16 }}>Сцен пока нет.</p>
            )}
          </aside>
        </div>

        <Timeline
          {...(manifest ? { manifest } : {})}
          scenes={scenes}
          chapters={project.chapters}
          selected={selected}
          {...(busyScene !== undefined ? { busyScene } : {})}
          player={playerApi}
          onSelect={selectScene}
        />
      </div>
    </>
  );
}
