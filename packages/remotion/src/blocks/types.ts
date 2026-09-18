import type { BlockOf, BlockType } from "@shorts/contracts";

/**
 * Что получает каждый блок от ComposedScene.
 *
 * Вход блока в кадр (прозрачность, смещение) делает обёртка, а блок отвечает только
 * за собственную внутреннюю анимацию: счёт числа, заполнение кольца, рост столбцов.
 * Поэтому все блоки одинаково слушаются `motion` из спеки.
 */
export interface BlockProps<T extends BlockType> {
  readonly block: BlockOf<T>;
  /** Кадр относительно момента появления блока; до появления отрицательный. */
  readonly localFrame: number;
  /** Сколько кадров сцены осталось после появления блока. */
  readonly remainingFrames: number;
  readonly align: "left" | "center";
}

/** Сравнение слова с emphasisWords без учёта регистра и пунктуации. */
export const normalizeWord = (value: string): string =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
