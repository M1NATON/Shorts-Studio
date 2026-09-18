import { describe, expect, it } from "vitest";
import type { Project, Scene } from "./api";
import { exportJson, exportMarkdown } from "./export";

const project: Project = {
  id: "p1",
  topic: "Полёт на Марс",
  title: "Марс за 60 секунд",
  format: "shorts",
  captionStyle: "karaoke",
  status: "ready",
  freshnessRequested: "current",
  freshness: "current",
  researchedAt: "2026-09-01",
  minutes: null,
  theme: null,
  music: null,
  publish: { title: "Марс за 60 секунд: вода найдена!", description: "Короткий ролик о самых свежих находках на Марсе и о том, что это значит для будущих миссий.", hashtags: ["#марс", "#космос", "#наука"] },
  sources: [
    { url: "https://nasa.gov/mars", title: "NASA Mars Facts", kind: "web", publishedAt: "2026-08-20" },
    { url: "https://example.com/news", title: "Mars news", kind: "news" },
  ],
  chapters: [],
  thumbnailPath: null,
  durationSec: null,
  error: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const scenes: Scene[] = [
  {
    id: "s1",
    position: 0,
    version: {
      id: "v1",
      sceneId: "s1",
      narration: "Марс — четвёртая планета от Солнца.",
      intent: null,
      visual: { kind: "hook-statement", variant: "statement", text: "Красная планета", emphasisWords: [], layout: "center", motion: "rise", backdrop: "plain", accentShift: 0 },
      audio: null,
      unverifiedNumbers: ["четвёртая"],
      origin: "ai",
      note: null,
      batchId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    media: { kind: "photo", query: "mars planet surface", src: "projects/p1/media/1.jpg", width: 1080, height: 1920, pexelsId: 1, credit: { name: "Photographer", url: "https://pexels.com/1" } },
  },
  {
    id: "s2",
    position: 1,
    version: {
      id: "v2",
      sceneId: "s2",
      narration: "На Марсе нашли воду.",
      intent: null,
      visual: {
        kind: "composed",
        layout: "center",
        motion: "rise",
        backdrop: "plain",
        accentShift: 0,
        blocks: [
          { block: "heading", text: "Вода на Марсе", emphasisWords: [], size: "l", at: 0, motion: "rise" },
          { block: "icon", icon: "sparkles", caption: "Лёд под поверхностью", at: 0.2 },
        ],
      },
      audio: null,
      unverifiedNumbers: [],
      origin: "ai",
      note: null,
      batchId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    media: null,
  },
];

describe("exportMarkdown", () => {
  it("содержит тексты кадра, не содержит служебных enum-полей", () => {
    const md = exportMarkdown(project, scenes);
    expect(md).toContain("Красная планета");
    expect(md).toContain("Вода на Марсе");
    expect(md).toContain("Лёд под поверхностью");
    expect(md).not.toMatch(/\bcenter\b/);
    expect(md).not.toMatch(/\bplain\b/);
    expect(md).not.toMatch(/\bsparkles\b/);
    expect(md).not.toMatch(/\bcomposed\b/);
  });

  it("выводит числа без источника", () => {
    expect(exportMarkdown(project, scenes)).toContain("Числа без источника: четвёртая");
  });

  it("источники — нумерованный список в конце, после сцен", () => {
    const md = exportMarkdown(project, scenes);
    const sourcesIndex = md.indexOf("## Источники");
    const lastSceneIndex = md.indexOf("## Сцена 2");
    expect(sourcesIndex).toBeGreaterThan(lastSceneIndex);
    expect(md).toContain("1. NASA Mars Facts — https://nasa.gov/mars");
    expect(md).toContain("2. Mars news — https://example.com/news");
  });

  it("начинается с инструкции для проверяющей нейросети", () => {
    expect(exportMarkdown(project, scenes).startsWith("Проверь фактическую точность")).toBe(true);
  });

  it("выводит раздел «Для публикации», если publish задан", () => {
    const md = exportMarkdown(project, scenes);
    expect(md).toContain("## Для публикации");
    expect(md).toContain("Название: Марс за 60 секунд: вода найдена!");
    expect(md).toContain("Хэштеги: #марс #космос #наука");
  });

  it("не выводит раздел «Для публикации», если publish не задан", () => {
    expect(exportMarkdown({ ...project, publish: null }, scenes)).not.toContain("Для публикации");
  });
});

describe("exportJson", () => {
  it("собирает сцены без внутренних id и темы оформления", () => {
    const data = JSON.parse(exportJson(project, scenes)) as {
      title: string;
      scenes: { index: number; narration: string; onScreen: string[]; unverifiedNumbers: string[]; mediaQuery: string | null }[];
    };
    expect(data.title).toBe("Марс за 60 секунд");
    expect(data.scenes).toHaveLength(2);
    expect(data.scenes[0]!.onScreen).toContain("Красная планета");
    expect(data.scenes[0]!.unverifiedNumbers).toEqual(["четвёртая"]);
    expect(data.scenes[0]!.mediaQuery).toBe("mars planet surface");
    expect(data.scenes[1]!.mediaQuery).toBeNull();
    expect(JSON.stringify(data)).not.toContain("\"id\"");
  });

  it("включает publish", () => {
    const data = JSON.parse(exportJson(project, scenes)) as { publish: { title: string; hashtags: string[] } | null };
    expect(data.publish?.title).toBe("Марс за 60 секунд: вода найдена!");
    expect(data.publish?.hashtags).toEqual(["#марс", "#космос", "#наука"]);
  });
});
