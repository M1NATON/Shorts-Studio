import type { FormatSpec, VideoFormat } from "@shorts/contracts";

/**
 * Полоса зоны контента, зарезервированная под бумажный полароид (см.
 * SceneMedia.tsx): сверху в вертикальном формате, сбоку — в горизонтальном.
 *
 * Общая геометрия для SceneMedia (рисует тайл внутри неё) и SceneFrame (сжимает
 * и сдвигает бокс сцены в оставшуюся часть той же зоны) — иначе фото и текст
 * сцены разъедутся при любом изменении чисел и снова начнут перекрываться.
 */
export interface PaperMediaZone {
  /** Реальные пиксели кадра. */
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly orientation: "top" | "side";
  /** Сколько реальных пикселей зоны контента забирает полароид у сцены. */
  readonly reserve: number;
}

/** Доля зоны контента под полароид: заметно, но не доминирует над текстом сцены. */
const BAND = 0.42;

export function paperMediaZone(format: Pick<FormatSpec, "width" | "height" | "zone"> & { name: VideoFormat }): PaperMediaZone {
  const sideRight = format.zone.sideRight ?? format.zone.side;
  const contentWidth = format.width - format.zone.side - sideRight;
  const contentHeight = format.height - format.zone.top - format.zone.bottom;

  if (format.name === "landscape") {
    const width = Math.round(contentWidth * BAND);
    return {
      top: format.zone.top,
      left: format.width - sideRight - width,
      width,
      height: contentHeight,
      orientation: "side",
      reserve: width,
    };
  }

  const height = Math.round(contentHeight * BAND);
  return {
    top: format.zone.top,
    left: format.zone.side,
    width: contentWidth,
    height,
    orientation: "top",
    reserve: height,
  };
}
