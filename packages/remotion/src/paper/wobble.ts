import { random } from "remotion";

/** Точка контура в дизайн-пикселях (или в единицах локальной системы координат SVG). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Дрожание контура — «боление» линии, как в кадр-за-кадром нарисованной от руки
 * анимации. Смещение точки — детерминированный шум remotion `random()`, ключ
 * которого меняется раз в 4 кадра, а не каждый кадр: иначе дрожание слишком
 * быстрое и читается как шум экрана, а не как неровная рука художника.
 *
 * Чистая функция без побочных эффектов — компонент передаёт ей текущий кадр,
 * а не читает его сам, поэтому она тестируется без рендера.
 */
export function wobble(points: readonly Point[], seed: string, amount: number, frame: number): Point[] {
  const bucket = Math.floor(frame / 4);
  return points.map((point, i) => {
    const key = `${seed}-${bucket}-${i}`;
    const dx = (random(`${key}-x`) - 0.5) * 2 * amount;
    const dy = (random(`${key}-y`) - 0.5) * 2 * amount;
    return { x: point.x + dx, y: point.y + dy };
  });
}
