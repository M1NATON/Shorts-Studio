import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_THEME, PAPER } from "@shorts/contracts";
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
});
