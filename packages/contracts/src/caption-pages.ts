import type { WordTiming } from "./manifest.js";

/**
 * Страница субтитров: неизменяемая группа слов с фиксированным временем показа.
 *
 * Зачем страницы, а не «окно вокруг активного слова»: окно пересобирается на каждом
 * слове, из-за чего строка целиком переверстывается (на реальной сцене 7.66 с это
 * 13 перерисовок — визуально субтитры дёргаются и прыгают по вертикали, когда число
 * строк меняется). Страница живёт от первого своего слова до начала следующей
 * страницы, поэтому внутри неё верстка заморожена: меняется только подсветка.
 */
export interface CaptionPage {
  /** Слова страницы в исходном порядке. */
  readonly words: readonly WordTiming[];
  /** Индекс первого слова страницы в исходном массиве — нужен для подсветки. */
  readonly firstWordIndex: number;
  /** Секунды относительно аудио сцены. */
  readonly startSec: number;
  readonly endSec: number;
}

export interface CaptionPageOptions {
  /** Максимум слов на странице. */
  readonly maxWordsPerPage?: number;
  /** Максимум символов (со пробелами) — держит страницу в одну строку на 1080px. */
  readonly maxCharsPerPage?: number;
  /** Пауза в речи, по которой страница рвётся принудительно. */
  readonly pageBreakGapSec?: number;
  /** Сколько последняя страница висит после конца последнего слова. */
  readonly holdLastPageSec?: number;
}

const DEFAULTS = {
  maxWordsPerPage: 3,
  maxCharsPerPage: 24,
  pageBreakGapSec: 0.35,
  holdLastPageSec: 0.4,
} as const;

/**
 * Группирует словные тайминги в страницы.
 *
 * Правила разрыва: лимит слов, лимит символов, пауза в речи. Паузу режем в первую
 * очередь — так границы страниц совпадают с дыханием диктора, а не с арифметикой.
 *
 * Страницы стыкуются без зазоров (endSec страницы = startSec следующей): иначе в
 * паузах между словами субтитры гасли бы и мигали.
 */
export function buildCaptionPages(
  words: readonly WordTiming[],
  options: CaptionPageOptions = {},
): CaptionPage[] {
  const maxWords = options.maxWordsPerPage ?? DEFAULTS.maxWordsPerPage;
  const maxChars = options.maxCharsPerPage ?? DEFAULTS.maxCharsPerPage;
  const breakGap = options.pageBreakGapSec ?? DEFAULTS.pageBreakGapSec;
  const holdLast = options.holdLastPageSec ?? DEFAULTS.holdLastPageSec;

  if (maxWords < 1) throw new Error("buildCaptionPages: maxWordsPerPage must be >= 1");
  if (maxChars < 1) throw new Error("buildCaptionPages: maxCharsPerPage must be >= 1");
  if (words.length === 0) return [];

  interface Draft {
    words: WordTiming[];
    firstWordIndex: number;
  }

  const drafts: Draft[] = [];
  let current: Draft | undefined;

  words.forEach((word, index) => {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) {
      throw new Error(`buildCaptionPages: word #${index} has non-finite timing`);
    }

    if (current) {
      const previous = current.words[current.words.length - 1]!;
      const chars = current.words.reduce((sum, w) => sum + w.text.length + 1, 0) + word.text.length;
      const gap = word.start - previous.end;
      const overflow = current.words.length >= maxWords || chars > maxChars;
      if (overflow || gap >= breakGap) current = undefined;
    }

    if (!current) {
      current = { words: [], firstWordIndex: index };
      drafts.push(current);
    }
    current.words.push(word);
  });

  return drafts.map((draft, index) => {
    const next = drafts[index + 1];
    const lastWord = draft.words[draft.words.length - 1]!;
    return {
      words: draft.words,
      firstWordIndex: draft.firstWordIndex,
      // Первую страницу тянем к нулю, чтобы кадр не начинался с пустоты.
      startSec: index === 0 ? 0 : draft.words[0]!.start,
      endSec: next ? next.words[0]!.start : lastWord.end + holdLast,
    };
  });
}

/** Индекс активной страницы, или -1 если на этом времени субтитров нет. */
export function findActivePageIndex(pages: readonly CaptionPage[], timeSec: number): number {
  if (pages.length === 0) return -1;

  let low = 0;
  let high = pages.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (pages[mid]!.startSec <= timeSec) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (result === -1) return -1;
  return timeSec < pages[result]!.endSec ? result : -1;
}
