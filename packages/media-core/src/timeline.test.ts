import { describe, expect, it } from "vitest";
import { recomputeTimeline, wordFrame } from "./timeline.js";

const scenes = (...durations: number[]) =>
  durations.map((audioDurationSec, i) => ({ sceneId: `s${i + 1}`, audioDurationSec }));

describe("recomputeTimeline", () => {
  it("укладывает сцены встык без дыр", () => {
    const { slots, totalDurationInFrames } = recomputeTimeline(scenes(2, 3), 30);
    expect(slots).toEqual([
      { sceneId: "s1", startFrame: 0, durationInFrames: 60 },
      { sceneId: "s2", startFrame: 60, durationInFrames: 90 },
    ]);
    expect(totalDurationInFrames).toBe(150);
  });

  it("округляет длительность вверх, чтобы не обрезать хвост озвучки", () => {
    const [slot] = recomputeTimeline(scenes(2.01), 30).slots;
    expect(slot?.durationInFrames).toBe(61);
  });

  it("не копит ошибку округления по длинному ролику", () => {
    const { slots } = recomputeTimeline(scenes(...Array.from({ length: 9 }, () => 3.333)), 30);
    // каждая сцена ceil(99.99)=100 кадров; 9-я обязана начаться ровно на 800
    expect(slots.at(-1)).toEqual({ sceneId: "s9", startFrame: 800, durationInFrames: 100 });
  });

  it("даёт сцене минимум один кадр даже при нулевом аудио", () => {
    expect(recomputeTimeline(scenes(0), 30).slots[0]?.durationInFrames).toBe(1);
  });

  it("вставляет паузу между сценами, но не после последней", () => {
    const { slots, totalDurationInFrames } = recomputeTimeline(scenes(1, 1), 30, { gapFrames: 5 });
    expect(slots[1]?.startFrame).toBe(35);
    expect(totalDurationInFrames).toBe(65);
  });

  it("сдвигает только сцены ПОСЛЕ изменённой (контракт точечной перегенерации)", () => {
    const before = recomputeTimeline(scenes(2, 2, 2), 30).slots;
    const after = recomputeTimeline(scenes(2, 4, 2), 30).slots;
    expect(after[0]).toEqual(before[0]);
    expect(after[2]?.startFrame).toBe(before[2]!.startFrame + 60);
  });

  it("работает на 24 и 25 fps", () => {
    expect(recomputeTimeline(scenes(2), 24).slots[0]?.durationInFrames).toBe(48);
    expect(recomputeTimeline(scenes(2), 25).slots[0]?.durationInFrames).toBe(50);
  });

  it("отвергает мусорную длительность, а не создаёт NaN-кадры", () => {
    expect(() => recomputeTimeline([{ sceneId: "x", audioDurationSec: Number.NaN }], 30)).toThrow();
    expect(() => recomputeTimeline([{ sceneId: "x", audioDurationSec: -1 }], 30)).toThrow();
  });

  it("отвергает нецелый gapFrames", () => {
    expect(() => recomputeTimeline(scenes(1), 30, { gapFrames: 1.5 })).toThrow();
  });

  it("пустой список не ломает рендер", () => {
    expect(recomputeTimeline([], 30)).toEqual({ slots: [], totalDurationInFrames: 1 });
  });
});

describe("wordFrame", () => {
  it("переводит секунды слова в глобальный кадр", () => {
    expect(wordFrame(60, 1.5, 30)).toBe(105);
    expect(wordFrame(0, 0, 30)).toBe(0);
  });
});
