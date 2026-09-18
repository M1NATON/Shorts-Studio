import { describe, expect, it } from "vitest";
import {
  CONTRAST_MIN,
  DEFAULT_VIDEO_THEME,
  VideoThemeSchema,
  contrastRatio,
  relativeLuminance,
  themeStyle,
} from "./video-theme.js";

describe("contrastRatio", () => {
  it("даёт 21 для чёрного на белом и 1 для одинаковых цветов", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#DCA268", "#DCA268")).toBeCloseTo(1, 5);
  });

  it("не зависит от порядка аргументов", () => {
    expect(contrastRatio("#171817", "#EEECE6")).toBeCloseTo(contrastRatio("#EEECE6", "#171817"), 10);
  });

  it("считает яркость по WCAG, а не по среднему каналу", () => {
    // Зелёный ярче синего при одинаковом значении канала.
    expect(relativeLuminance("#00ff00")).toBeGreaterThan(relativeLuminance("#0000ff"));
  });
});

describe("VideoThemeSchema", () => {
  it("принимает тему по умолчанию", () => {
    expect(VideoThemeSchema.parse(DEFAULT_VIDEO_THEME)).toEqual(DEFAULT_VIDEO_THEME);
  });

  it("отклоняет нечитаемый текст на фоне", () => {
    const result = VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, text: "#2A2C29" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/contrast with canvas/);
    expect(result.error!.issues[0]!.path).toEqual(["text"]);
  });

  it("отклоняет акцент, который сливается с фоном", () => {
    const result = VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, accent: "#1E201E" });
    expect(result.success).toBe(false);
  });

  it("сообщает обо всех нечитаемых цветах сразу, чтобы повтор чинил их за один раз", () => {
    const result = VideoThemeSchema.safeParse({
      ...DEFAULT_VIDEO_THEME,
      text: "#232523",
      accent: "#1E201E",
      muted: "#1C1E1C",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path[0])).toEqual(["text", "accent", "muted"]);
  });

  it("порог для основного текста строже, чем для акцента", () => {
    expect(CONTRAST_MIN.text).toBeGreaterThan(CONTRAST_MIN.accent);
  });

  it("проверяет формат цвета", () => {
    expect(VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, canvas: "black" }).success).toBe(false);
    expect(VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, canvas: "#fff" }).success).toBe(false);
  });

  it("не принимает шрифт вне списка загружаемых", () => {
    expect(
      VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, fontFamily: "Comic Sans" }).success,
    ).toBe(false);
  });

  it("держит параметры движения в пределах, где сцена не ломается", () => {
    expect(
      VideoThemeSchema.safeParse({
        ...DEFAULT_VIDEO_THEME,
        motion: { ...DEFAULT_VIDEO_THEME.motion, enterFrames: 90 },
      }).success,
    ).toBe(false);
    expect(
      VideoThemeSchema.safeParse({
        ...DEFAULT_VIDEO_THEME,
        motion: { ...DEFAULT_VIDEO_THEME.motion, travelPx: 900 },
      }).success,
    ).toBe(false);
  });

  it("принимает светлую тему, а не только тёмную", () => {
    const light = {
      ...DEFAULT_VIDEO_THEME,
      mood: "clean light report",
      canvas: "#F5F3EE",
      surface: "#FFFFFF",
      surfaceStrong: "#E6E3DC",
      border: "#D2CEC5",
      text: "#1B1C1A",
      muted: "#5A5C55",
      accent: "#8A4B1F",
      accentSoft: "#EAD9C8",
      // без style: тема без него не проверяется на яркость фона (см. themeStyle ниже).
      style: undefined,
    };
    expect(VideoThemeSchema.safeParse(light).success).toBe(true);
  });

  it("editorial с тёмным canvas отклоняется с issue по path canvas", () => {
    const result = VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, style: "editorial" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["canvas"]);
    expect(result.error!.issues[0]!.message).toMatch(/needs a light canvas/);
  });

  it("editorial со светлым canvas проходит", () => {
    const editorial = {
      ...DEFAULT_VIDEO_THEME,
      style: "editorial",
      mood: "clean light report",
      canvas: "#F5F3EE",
      surface: "#FFFFFF",
      surfaceStrong: "#E6E3DC",
      border: "#D2CEC5",
      text: "#1B1C1A",
      muted: "#5A5C55",
      accent: "#8A4B1F",
      accentSoft: "#EAD9C8",
    };
    expect(VideoThemeSchema.safeParse(editorial).success).toBe(true);
  });

  it("тема без style проходит, themeStyle по умолчанию — tech", () => {
    expect(VideoThemeSchema.safeParse({ ...DEFAULT_VIDEO_THEME, style: undefined }).success).toBe(true);
    expect(themeStyle({ style: undefined })).toBe("tech");
    expect(themeStyle({ style: "editorial" })).toBe("editorial");
  });
});
