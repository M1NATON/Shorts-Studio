"use client";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { Thumbnail, type PlayerRef } from "@remotion/player";
import type { Manifest } from "@shorts/contracts";
import { ShortsVideo } from "@shorts/remotion/browser";
import type { Scene } from "@/lib/api";
import { timecode, usePlayerFrame, usePlaying } from "@/lib/player";
import { layoutTimeline, rulerStep, type TimelineLayout } from "@/lib/timeline";
import { sceneManifest } from "./VideoPlayer";

const FALLBACK_FPS = 30;

/** Кадр сцены в клипе: рисует браузер из манифеста, сервер не рендерит ничего. */
const ClipPoster = memo(function ClipPoster({ manifest, index, cover }: { manifest: Manifest; index: number; cover: "width" | "height" }) {
  const single = useMemo(() => {
    const m = sceneManifest(manifest, index);
    return { ...m, scenes: m.scenes.map((s) => ({ ...s, words: [] })) };
  }, [manifest, index]);
  const scene = single.scenes[0]!;
  return (
    <Thumbnail
      component={ShortsVideo as never}
      inputProps={{ manifest: single }}
      frameToDisplay={Math.round(scene.durationInFrames * 0.6)}
      durationInFrames={single.totalDurationInFrames}
      compositionWidth={manifest.width}
      compositionHeight={manifest.height}
      fps={manifest.fps}
      // Кадр заполняет клип целиком (как object-fit: cover): лишнее обрезается по краям.
      style={{ [cover]: "100%", flex: "none", aspectRatio: `${manifest.width} / ${manifest.height}` }}
    />
  );
});

function Playhead({ player, layout, scroller, fps, dragging, onScrubStart }: {
  player: PlayerRef | null;
  layout: TimelineLayout;
  scroller: HTMLDivElement | null;
  fps: number;
  dragging: boolean;
  onScrubStart: (e: ReactPointerEvent) => void;
}) {
  const frame = usePlayerFrame(player);
  const playing = usePlaying(player);
  const x = layout.frameToX(frame);
  // Длинный ролик: плейхед не уходит за край — лента едет за ним.
  useEffect(() => {
    if (!scroller) return;
    const view = scroller.clientWidth - 32;
    if (x < scroller.scrollLeft || x > scroller.scrollLeft + view) scroller.scrollLeft = Math.max(0, x - 40);
  }, [x, scroller]);
  return (
    <div
      className={`playhead${playing && !dragging ? " playing" : ""}${dragging ? " dragging" : ""}`}
      // При воспроизведении переход длиной в кадр сглаживает шаги между кадрами.
      style={{ transform: `translateX(${x}px)`, transitionDuration: playing && !dragging ? `${1000 / fps}ms` : undefined }}
    >
      <div className="playhead-knob" onPointerDown={onScrubStart} title="Перетащите, чтобы перемотать">
        <span className="playhead-time">{timecode(frame, fps)}</span>
      </div>
    </div>
  );
}

/**
 * Таймлайн: линейка, главы, клипы сцен (ширина ∝ длительности), текст озвучки.
 * Клик по клипу — выбрать сцену, по линейке — перемотать.
 */
export function Timeline({
  manifest,
  scenes,
  chapters,
  selected,
  busyScene,
  player,
  onSelect,
}: {
  manifest?: Manifest;
  scenes: Scene[];
  chapters: { title: string; firstScene: number }[];
  selected: number;
  busyScene?: number;
  player: PlayerRef | null;
  onSelect: (index: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [clipHeight, setClipHeight] = useState(110);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setAvailable(el.clientWidth - 32);
      const clips = el.querySelector(".clips");
      if (clips) setClipHeight(clips.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fps = manifest?.fps ?? FALLBACK_FPS;
  const spans = useMemo(() => {
    if (manifest) return manifest.scenes.map((s) => ({ start: s.startFrame, dur: s.durationInFrames }));
    let start = 0;
    return scenes.map((s) => {
      const dur = Math.round((s.version.audio?.durationSec ?? 3) * FALLBACK_FPS);
      const span = { start, dur };
      start += dur;
      return span;
    });
  }, [manifest, scenes]);
  const layout = useMemo(() => layoutTimeline(spans, available), [spans, available]);
  const totalFrames = spans.reduce((sum, s) => sum + s.dur, 0);
  const seconds = totalFrames / fps;
  const step = rulerStep(layout.width / Math.max(1, seconds));
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step);

  // Перемотка перетаскиванием: с линейки или за ручку плейхеда. На время перетаскивания плеер на паузе.
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const scrubStart = (e: ReactPointerEvent) => {
    if (!player || !track.current || e.button !== 0) return;
    e.preventDefault();
    const wasPlaying = player.isPlaying();
    if (wasPlaying) player.pause();
    const seek = (clientX: number) => player.seekTo(layout.xToFrame(clientX - track.current!.getBoundingClientRect().left));
    seek(e.clientX);
    setDragging(true);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(false);
      if (wasPlaying) player.play();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <section className="timeline" aria-label="Таймлайн">
      <div className="timeline-scroll" ref={scroller}>
        {scenes.length === 0 ? (
          <p className="muted small" style={{ padding: 20 }}>Сцены появятся здесь, когда модель напишет план ролика.</p>
        ) : (
          <div className={`timeline-track${dragging ? " scrubbing" : ""}`} style={{ width: layout.width }} ref={track}>
            <div className="ruler" onPointerDown={scrubStart} title="Нажмите или потяните, чтобы перемотать">
              {ticks.map((t) => (
                <span key={t} style={{ left: layout.frameToX(t * fps) }}>{timecode(t * fps, fps, false)}</span>
              ))}
            </div>
            <div className="chapters">
              {chapters.map((c, i) => {
                const left = layout.lefts[c.firstScene] ?? 0;
                const next = chapters[i + 1];
                const right = next ? (layout.lefts[next.firstScene] ?? layout.width) : layout.width;
                return <span key={c.firstScene} style={{ left, width: right - left }} title={c.title}>{c.title}</span>;
              })}
            </div>
            <div className="clips">
              {scenes.map((s, i) => (
                <button
                  key={s.id}
                  className="clip"
                  style={{ left: layout.lefts[i], width: layout.widths[i] }}
                  aria-current={i === selected ? "true" : undefined}
                  aria-label={`Сцена ${i + 1}: ${s.version.narration}`}
                  title={s.version.narration}
                  onClick={() => onSelect(i)}
                >
                  <span className="poster">{manifest && manifest.scenes[i] ? <ClipPoster manifest={manifest} index={i} cover={(layout.widths[i] ?? 0) > (clipHeight * manifest.width) / manifest.height ? "width" : "height"} /> : null}</span>
                  <span className="n">{i + 1} · {((spans[i]?.dur ?? 0) / fps).toFixed(1)}с</span>
                  {s.version.unverifiedNumbers.length || !s.version.audio ? (
                    <span className="flag" title={s.version.audio ? `Нет в источниках: ${s.version.unverifiedNumbers.join(", ")}` : "Без озвучки"}>
                      <TriangleAlert size={12} strokeWidth={2} />
                    </span>
                  ) : null}
                  {busyScene === i ? <span className="busy" /> : null}
                </button>
              ))}
            </div>
            <div className="lines" aria-hidden="true">
              {scenes.map((s, i) => (
                <div key={s.id} className={`line${i === selected ? " on" : ""}`} style={{ left: layout.lefts[i], width: layout.widths[i] }} onClick={() => onSelect(i)}>
                  {s.version.narration}
                </div>
              ))}
            </div>
            {manifest ? <Playhead player={player} layout={layout} scroller={scroller.current} fps={fps} dragging={dragging} onScrubStart={scrubStart} /> : null}
          </div>
        )}
      </div>
    </section>
  );
}
