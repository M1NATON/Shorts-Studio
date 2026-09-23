import type { Point } from "./wobble.js";

/** Точки на эллипсе (или окружности при rx === ry), равномерно по углу. */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, count = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

/** Прямоугольник с несколькими точками на каждой стороне — иначе сторона не «боится» отдельно от углов. */
export function rectPoints(x: number, y: number, width: number, height: number, perSide = 3): Point[] {
  const points: Point[] = [];
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
  };
  edge(x, y, x + width, y);
  edge(x + width, y, x + width, y + height);
  edge(x + width, y + height, x, y + height);
  edge(x, y + height, x, y);
  return points;
}

/**
 * Пилюля (стадион): прямая сверху/снизу, полукруглые торцы радиусом height/2.
 * Используется для «бумажных» столбцов и плашек-таблеток.
 */
export function capsulePoints(
  x: number,
  y: number,
  width: number,
  height: number,
  perSide = 3,
  arcPoints = 6,
): Point[] {
  const r = Math.min(height / 2, width / 2);
  const cx1 = x + r;
  const cx2 = x + width - r;
  const cy = y + r;
  const points: Point[] = [];

  for (let i = 0; i <= perSide; i++) {
    const t = i / perSide;
    points.push({ x: cx1 + (cx2 - cx1) * t, y });
  }
  for (let i = 1; i < arcPoints; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / arcPoints;
    points.push({ x: cx2 + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  for (let i = 0; i <= perSide; i++) {
    const t = i / perSide;
    points.push({ x: cx2 - (cx2 - cx1) * t, y: y + height });
  }
  for (let i = 1; i < arcPoints; i++) {
    const angle = Math.PI / 2 + (Math.PI * i) / arcPoints;
    points.push({ x: cx1 + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}
