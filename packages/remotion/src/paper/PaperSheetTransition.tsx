import React from "react";
import { random, useCurrentFrame, useVideoConfig } from "remotion";

/** Длительность переезда листа — по ТЗ «за 0.9 с». */
export const SHEET_TRANSITION_SECONDS = 0.9;

/** easeOutQuad: лист быстро закрывает кадр и плавно тормозит, уходя со сцены. */
function easeOutQuad(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) * (1 - c);
}

/**
 * X-координата ведущей кромки листа: progress=0 → лист закрывает весь кадр (кромка
 * у правого края с запасом overscan), progress=1 → лист полностью ушёл влево (кромка
 * за левым краем). Чистая функция — тестируется без рендера.
 */
export function sheetEdgeX(progress: number, width: number, overscan: number): number {
  const eased = easeOutQuad(progress);
  return width + overscan - eased * (width + overscan * 2);
}

/**
 * SVG path кремового листа с синусоидальной кромкой на заданном прогрессе перехода.
 * Чистая функция от (progress, width, height, seed) — тестируется без рендера
 * и без remotion-рантайма (`random()` детерминирован по ключу).
 */
export function sheetPath(progress: number, width: number, height: number, seed: string, segments = 10): string {
  const overscan = Math.max(60, width * 0.06);
  const edgeX = sheetEdgeX(progress, width, overscan);
  const amplitude = Math.max(24, width * 0.02);
  const freq = 2 + random(`${seed}-freq`) * 1.5;
  const phase = random(`${seed}-phase`) * Math.PI * 2;

  const commands: string[] = [`M ${-overscan},0`];
  for (let i = 0; i <= segments; i++) {
    const y = (i / segments) * height;
    const x = edgeX + Math.sin((i / segments) * Math.PI * freq + phase) * amplitude;
    commands.push(`L ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  commands.push(`L ${-overscan},${height}`, "Z");
  return commands.join(" ");
}

/**
 * Переход «лист бумаги»: кремовый лист с синусоидальной кромкой проезжает по кадру
 * за 0.9 с в начале сцены, приоткрывая её слева направо.
 *
 * Склейки в ролике жёсткие (см. motion.ts — почему не TransitionSeries: перекрытие
 * сдвинуло бы звук двух сцен друг на друга). Поэтому переход не перекрывает две
 * сцены, а рисуется оверлеем поверх уже начавшейся новой сцены — визуально это тот
 * же «наезжающий лист», но без изменения тайминга аудио.
 */
export const PaperSheetTransition: React.FC<{ seed: string; fill: string }> = ({ seed, fill }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const frames = Math.round(SHEET_TRANSITION_SECONDS * fps);
  if (frame < 0 || frame >= frames) return null;
  const progress = frame / frames;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <path d={sheetPath(progress, width, height, seed)} fill={fill} />
    </svg>
  );
};
