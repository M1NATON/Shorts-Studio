import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_THEME, PAPER, VIDEO_STYLES, VideoThemeSchema } from "@shorts/contracts";
import { generateTheme, THEME_SYSTEM } from "./theme.js";
import { fakeLlm } from "./test-helpers.js";

describe("generateTheme", () => {
  it("style paper получает фиксированную бумажную палитру, настроение и музыка — от модели", async () => {
    // Модель выбрала paper, но цвета и шрифт свои: в ролик должны уйти токены PAPER.
    const answer = { ...DEFAULT_VIDEO_THEME, canvas: "#FFFFFF", text: "#000000", fontFamily: "Inter", style: "paper", musicMood: "playful" };
    const theme = await generateTheme({ llm: fakeLlm(() => answer), today: "2026-09-23" }, "Why ships float");
    expect(theme).toMatchObject({ style: "paper", canvas: PAPER.paper, text: PAPER.ink, fontFamily: "PatrickHand", musicMood: "playful" });
  });

  it("промпт описывает стиль paper", () => {
    expect(THEME_SYSTEM).toMatch(/- paper —/);
  });

  it("форсированный стиль перебивает выбор модели и попадает в промпт", async () => {
    let seenUser = "";
    const answer = { ...DEFAULT_VIDEO_THEME, style: "tech" };
    const theme = await generateTheme(
      { llm: fakeLlm((req) => { seenUser = req.user; return answer; }), today: "2026-09-23" },
      "Why ships float",
      "poster",
    );
    expect(theme.style).toBe("poster");
    expect(seenUser).toMatch(/Required style: poster \(mandatory\)/);
  });

  it("если модель не попала в стиль, запасная тема сохраняет выбранный стиль и проходит проверку", async () => {
    // Тёмный canvas для editorial отклоняется все три попытки.
    const llm = fakeLlm(() => ({ ...DEFAULT_VIDEO_THEME, style: "editorial" }));
    for (const style of VIDEO_STYLES) {
      const theme = await generateTheme({ llm, today: "2026-09-23" }, "Why ships float", style);
      expect(theme.style).toBe(style);
      expect(VideoThemeSchema.safeParse(theme).success).toBe(true);
    }
  });
});
