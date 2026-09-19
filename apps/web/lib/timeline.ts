/**
 * Раскладка таймлайна: ширина клипа ∝ длительности, но не уже minWidth —
 * иначе короткую сцену не попасть мышью. Поэтому время → x кусочно-линейное:
 * внутри клипа кадр ложится пропорционально ширине этого клипа.
 */
export interface ClipSpan {
  start: number;
  dur: number;
}

export interface TimelineLayout {
  lefts: number[];
  widths: number[];
  width: number;
  frameToX: (frame: number) => number;
  xToFrame: (x: number) => number;
}

export function layoutTimeline(clips: ClipSpan[], available: number, minWidth = 64, gap = 3): TimelineLayout {
  const total = clips.reduce((sum, c) => sum + c.dur, 0) || 1;
  const perFrame = Math.max(0, available - gap * Math.max(0, clips.length - 1)) / total;
  const widths = clips.map((c) => Math.max(minWidth, c.dur * perFrame));
  const lefts: number[] = [];
  let x = 0;
  for (const w of widths) {
    lefts.push(x);
    x += w + gap;
  }
  const width = Math.max(0, x - gap);
  const frameToX = (frame: number): number => {
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]!;
      if (frame < c.start + c.dur) return lefts[i]! + (Math.max(0, frame - c.start) / c.dur) * widths[i]!;
    }
    return width;
  };
  const xToFrame = (px: number): number => {
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]!;
      if (px < lefts[i]! + widths[i]! + gap) return c.start + Math.round((Math.min(Math.max(0, px - lefts[i]!), widths[i]!) / widths[i]!) * (c.dur - 1));
    }
    const last = clips[clips.length - 1];
    return last ? last.start + last.dur - 1 : 0;
  };
  return { lefts, widths, width, frameToX, xToFrame };
}

/** Шаг делений линейки в секундах: деления не ближе ~56 px. */
export function rulerStep(pxPerSecond: number): number {
  return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pxPerSecond >= 56) ?? 600;
}

export interface ZoomResult {
  pxPerSecond: number;
  scrollLeft: number;
}

/**
 * Масштаб (px/сек) вокруг точки под курсором: после смены масштаба время,
 * которое было под anchorX, остаётся под ним же (курсор — «якорь» зума).
 */
export function zoomAtAnchor(pxPerSecond: number, factor: number, anchorX: number, scrollLeft: number, min: number, max: number): ZoomResult {
  const next = Math.min(max, Math.max(min, pxPerSecond * factor));
  const timeAtAnchor = pxPerSecond > 0 ? (scrollLeft + anchorX) / pxPerSecond : 0;
  return { pxPerSecond: next, scrollLeft: Math.max(0, timeAtAnchor * next - anchorX) };
}

export type ClipLabelLevel = "full" | "number" | "none";

/** Что поместится в бейдж клипа: номер+длительность, только номер, или ничего (узко). */
export function clipLabelLevel(width: number): ClipLabelLevel {
  if (width >= 90) return "full";
  if (width >= 30) return "number";
  return "none";
}
