import { describe, expect, it } from "vitest";
import { buildCaptionPages, findActivePageIndex } from "./caption-pages.js";
import type { WordTiming } from "./manifest.js";

const w = (text: string, start: number, end: number): WordTiming => ({ text, start, end });

/** Реальная сцена из storage/manifest.json — на ней и воспроизводилось дёргание. */
const REAL_SCENE: WordTiming[] = [
  w("Will", 0, 0.16),
  w("AI", 0.24, 0.56),
  w("rebel", 0.56, 1.12),
  w("in", 1.12, 1.2),
  w("2026?", 1.2, 2.32),
  w("A", 2.96, 2.96),
  w("deliberate", 3.04, 3.52),
  w("machine", 3.52, 3.92),
  w("uprising", 4, 4.56),
  w("remains", 4.56, 4.88),
  w("science", 4.88, 5.28),
  w("fiction,", 5.28, 5.84),
  w("not", 6.16, 6.32),
  w("a", 6.32, 6.4),
  w("credible", 6.4, 6.8),
  w("forecast.", 6.8, 7.52),
];

describe("buildCaptionPages", () => {
  it("возвращает пустой список без слов", () => {
    expect(buildCaptionPages([])).toEqual([]);
  });

  it("держит лимит слов на странице", () => {
    const pages = buildCaptionPages([w("a", 0, 0.1), w("b", 0.1, 0.2), w("c", 0.2, 0.3), w("d", 0.3, 0.4)], {
      maxWordsPerPage: 2,
      pageBreakGapSec: 10,
    });
    expect(pages.map((p) => p.words.map((x) => x.text))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("держит лимит символов", () => {
    const pages = buildCaptionPages([w("internationalization", 0, 1), w("considerations", 1, 2)], {
      maxCharsPerPage: 24,
      pageBreakGapSec: 10,
    });
    expect(pages).toHaveLength(2);
  });

  it("не теряет слово, которое само длиннее лимита символов", () => {
    const pages = buildCaptionPages([w("incomprehensibilities", 0, 1)], { maxCharsPerPage: 5 });
    expect(pages[0]!.words.map((x) => x.text)).toEqual(["incomprehensibilities"]);
  });

  it("рвёт страницу по паузе в речи", () => {
    const pages = buildCaptionPages([w("a", 0, 0.2), w("b", 1.6, 1.8)], {
      maxWordsPerPage: 5,
      pageBreakGapSec: 0.35,
    });
    expect(pages).toHaveLength(2);
  });

  it("стыкует страницы без зазоров, чтобы субтитры не мигали в паузах", () => {
    const pages = buildCaptionPages(REAL_SCENE);
    for (let i = 0; i < pages.length - 1; i += 1) {
      expect(pages[i]!.endSec).toBe(pages[i + 1]!.startSec);
    }
    expect(pages[0]!.startSec).toBe(0);
    expect(pages[pages.length - 1]!.endSec).toBeCloseTo(7.92, 5);
  });

  it("сохраняет все слова и корректный firstWordIndex", () => {
    const pages = buildCaptionPages(REAL_SCENE);
    expect(pages.flatMap((p) => p.words.map((x) => x.text))).toEqual(REAL_SCENE.map((x) => x.text));
    for (const page of pages) {
      expect(REAL_SCENE[page.firstWordIndex]).toEqual(page.words[0]);
    }
  });

  it("на реальной сцене строка перестраивается только по числу страниц, а не на каждом слове", () => {
    const pages = buildCaptionPages(REAL_SCENE);
    const fps = 30;
    let layoutChanges = 0;
    let previous: string | null = null;
    for (let frame = 0; frame < Math.ceil(7.66 * fps); frame += 1) {
      const index = findActivePageIndex(pages, frame / fps);
      const layout = index === -1 ? "" : pages[index]!.words.map((x) => x.text).join(" ");
      if (layout !== previous) {
        layoutChanges += 1;
        previous = layout;
      }
    }
    // Старое скользящее окно давало 13 перерисовок на 16 словах.
    expect(layoutChanges).toBe(pages.length);
    expect(pages.length).toBeLessThanOrEqual(8);
  });

  it("падает на нечисловом тайминге вместо тихой порчи кадра", () => {
    expect(() => buildCaptionPages([w("a", 0, Number.NaN)])).toThrow(/non-finite/);
  });

  it("проверяет опции", () => {
    expect(() => buildCaptionPages([w("a", 0, 1)], { maxWordsPerPage: 0 })).toThrow(/maxWordsPerPage/);
    expect(() => buildCaptionPages([w("a", 0, 1)], { maxCharsPerPage: 0 })).toThrow(/maxCharsPerPage/);
  });
});

describe("findActivePageIndex", () => {
  const pages = buildCaptionPages(REAL_SCENE);

  it("нет страниц — нет активной", () => {
    expect(findActivePageIndex([], 1)).toBe(-1);
  });

  it("находит страницу по времени внутри неё", () => {
    for (const [index, page] of pages.entries()) {
      const middle = (page.startSec + page.endSec) / 2;
      expect(findActivePageIndex(pages, middle)).toBe(index);
    }
  });

  it("на границе отдаёт следующую страницу", () => {
    expect(findActivePageIndex(pages, pages[1]!.startSec)).toBe(1);
  });

  it("скрывает субтитры после конца последней страницы", () => {
    expect(findActivePageIndex(pages, pages[pages.length - 1]!.endSec + 0.01)).toBe(-1);
  });
});
