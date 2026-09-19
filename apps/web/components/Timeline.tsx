"use client";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { Thumbnail, type PlayerRef } from "@remotion/player";
import type { Manifest } from "@shorts/contracts";
import { ShortsVideo } from "@shorts/remotion/browser";
import type { Scene } from "@/lib/api";
import { timecode, usePlayerFrame, usePlaying } from "@/lib/player";
import { clipLabelLevel, layoutTimeline, rulerStep, zoomAtAnchor, type TimelineLayout } from "@/lib/timeline";
import { sceneManifest } from "./VideoPlayer";

const FALLBACK_FPS = 30;
const ZOOM_STEP = 1.4;
const MAX_PX_PER_SECOND = 400;
// Насколько за пределами видимой области ещё держим постеры отрисованными, чтобы не мигали при скролле.
const POSTER_BUFFER = 400;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
  // Длинный ролик: во время воспроизведения плейхед плавно держим у ~1/3 ширины,
  // на паузе/перемотке — просто подтягиваем ленту, когда плейхед уходит за край.
  useEffect(() => {
    if (!scroller) return;
    const view = scroller.clientWidth;
    if (playing && !dragging) {
      const target = Math.max(0, x - view / 3);
      // ponytail: линейное демпфирование вместо scrollTo({behavior:"smooth"}) — не конфликтует
      // с частыми апдейтами кадра; при желании точнее — заменить на requestAnimationFrame-lerp.
      scroller.scrollLeft = prefersReducedMotion() ? target : scroller.scrollLeft + (target - scroller.scrollLeft) * 0.25;
    } else if (x < scroller.scrollLeft || x > scroller.scrollLeft + view - 32) {
      scroller.scrollLeft = Math.max(0, x - 40);
    }
  }, [x, scroller, playing, dragging]);
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
 * Клик по клипу — выбрать сцену, по линейке — перемотать. Масштаб — кнопки/Ctrl+колесо,
 * обычное колесо крутит по горизонтали, ←/→ при фокусе в таймлайне листают сцены.
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
  const [scrollLeft, setScrollLeft] = useState(0);
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
  const totalFrames = spans.reduce((sum, s) => sum + s.dur, 0);
  const seconds = totalFrames / fps;

  // Масштаб: null — «весь ролик» (авто, под ширину панели), число — явный px/сек (зум).
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const autoFit = zoomOverride === null;
  const fitPxPerSecond = seconds > 0 ? available / seconds : 0;
  const pxPerSecond = zoomOverride ?? fitPxPerSecond;
  const trackWidth = autoFit ? available : pxPerSecond * seconds;
  // В режиме «весь ролик» минимум ширины клипа меньше — иначе десятки коротких сцен не влезут без скролла.
  const layout = useMemo(() => layoutTimeline(spans, trackWidth, autoFit ? 24 : 64, 3), [spans, trackWidth, autoFit]);
  const step = rulerStep(layout.width / Math.max(1, seconds));
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step);

  const clampZoom = (v: number) => Math.min(MAX_PX_PER_SECOND, Math.max(fitPxPerSecond, v));
  const zoomIn = () => setZoomOverride(clampZoom(pxPerSecond * ZOOM_STEP));
  const zoomOut = () => setZoomOverride(clampZoom(pxPerSecond / ZOOM_STEP));
  const zoomFit = () => setZoomOverride(null);

  // Ctrl/⌘+колесо зумит относительно курсора; обычное колесо крутит ленту по горизонтали.
  // Слушатель нативный (не passive), т.к. React делает onWheel passive и preventDefault не сработает.
  const pendingScroll = useRef<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchorX = e.clientX - el.getBoundingClientRect().left;
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const next = zoomAtAnchor(pxPerSecond, factor, anchorX, el.scrollLeft, fitPxPerSecond, MAX_PX_PER_SECOND);
        pendingScroll.current = next.scrollLeft;
        setZoomOverride(next.pxPerSecond);
      } else if (e.deltaX === 0 && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pxPerSecond, fitPxPerSecond]);
  // Ширина ленты применяется после зума колесом — только тогда двигаем scrollLeft под якорь.
  useLayoutEffect(() => {
    if (pendingScroll.current == null || !scroller.current) return;
    scroller.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [layout.width]);

  // Постеры вне видимой области не рендерим — на 60 сценах это главный тормоз.
  const isVisible = (i: number) => {
    const left = layout.lefts[i] ?? 0;
    const width = layout.widths[i] ?? 0;
    return left + width >= scrollLeft - POSTER_BUFFER && left <= scrollLeft + available + POSTER_BUFFER;
  };

  // ←/→ при фокусе в таймлайне — соседняя сцена; выбранный клип прокручивается в видимую область.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onSelect(e.key === "ArrowLeft" ? Math.max(0, selected - 1) : Math.min(scenes.length - 1, selected + 1));
  };
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [selected]);

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
      <div className="timeline-toolbar">
        <button type="button" aria-label="Уменьшить масштаб" onClick={zoomOut}>−</button>
        <button type="button" aria-label="Увеличить масштаб" onClick={zoomIn}>+</button>
        <button type="button" aria-label="Показать весь ролик" aria-pressed={autoFit} onClick={zoomFit}>Весь ролик</button>
      </div>
      <div className="timeline-scroll" ref={scroller} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)} onKeyDown={onKeyDown}>
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
                return (
                  <span key={c.firstScene} className="chapter" style={{ left, width: right - left }}>
                    <b>{c.title}</b>
                  </span>
                );
              })}
            </div>
            {chapters.slice(1).map((c) => (
              <div key={`div-${c.firstScene}`} className="chapter-line" style={{ left: layout.lefts[c.firstScene] ?? 0 }} />
            ))}
            <div className="clips">
              {scenes.map((s, i) => {
                const width = layout.widths[i] ?? 0;
                const label = clipLabelLevel(width);
                return (
                  <button
                    key={s.id}
                    className="clip"
                    data-index={i}
                    style={{ left: layout.lefts[i], width }}
                    aria-current={i === selected ? "true" : undefined}
                    aria-label={`Сцена ${i + 1}: ${s.version.narration}`}
                    title={s.version.narration}
                    onClick={() => onSelect(i)}
                  >
                    <span className="poster">
                      {manifest && manifest.scenes[i] && isVisible(i) ? (
                        <ClipPoster manifest={manifest} index={i} cover={width > (clipHeight * manifest.width) / manifest.height ? "width" : "height"} />
                      ) : null}
                    </span>
                    {label === "none" ? null : (
                      <span className="n">{i + 1}{label === "full" ? ` · ${((spans[i]?.dur ?? 0) / fps).toFixed(1)}с` : ""}</span>
                    )}
                    {s.version.unverifiedNumbers.length || !s.version.audio ? (
                      <span className="flag" title={s.version.audio ? `Нет в источниках: ${s.version.unverifiedNumbers.join(", ")}` : "Без озвучки"}>
                        <TriangleAlert size={12} strokeWidth={2} />
                      </span>
                    ) : null}
                    {busyScene === i ? <span className="busy" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="lines" aria-hidden="true">
              {scenes.map((s, i) => (
                <div key={s.id} className={`line${i === selected ? " on" : ""}`} style={{ left: layout.lefts[i], width: layout.widths[i] }} onClick={() => onSelect(i)}>
                  {(layout.widths[i] ?? 0) >= 70 ? s.version.narration : null}
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
