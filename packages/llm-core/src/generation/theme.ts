import {
  DEFAULT_VIDEO_THEME,
  FONT_FAMILIES,
  MUSIC_MOODS,
  VIDEO_STYLES,
  VideoThemeSchema,
  type VideoTheme,
} from "@shorts/contracts";
import { issuesOf, log, unwrapContent, withFeedback, type GenerationContext } from "./context.js";

export const THEME_SYSTEM = [
  "You design the visual identity of one short video. Return JSON only.",
  "",
  "Fields:",
  '{ "mood": short phrase, "canvas": "#rrggbb" (background), "surface": "#rrggbb" (cards),',
  '  "surfaceStrong": "#rrggbb", "border": "#rrggbb", "text": "#rrggbb" (main copy),',
  '  "muted": "#rrggbb" (secondary copy), "accent": "#rrggbb", "accentSoft": "#rrggbb",',
  `  "fontFamily": one of ${FONT_FAMILIES.join(" | ")},`,
  '  "headingWeight": 600 | 700 | 800, "letterSpacing": -0.06..0.04 (em),',
  '  "cornerRadius": 0..36, "backdropOpacity": 0.04..0.4,',
  '  "motion": { "easing": [x1,y1,x2,y2] cubic-bezier, "enterFrames": 5..24,',
  '    "staggerFrames": 1..10, "travelPx": 8..160 },',
  `  "musicMood": one of ${MUSIC_MOODS.join(" | ")} (background music under the voice),`,
  `  "style": one of ${VIDEO_STYLES.join(" | ")} (frame device — see below) }`,
  "",
  "Rules:",
  "- The palette must carry the topic: cold and metallic for industry, warm for human stories,",
  "  clinical for medicine, high-contrast neon only when the topic is loud.",
  "- Contrast on canvas is checked and enforced: text at least 7:1, accent at least 3.5:1,",
  "  muted at least 3:1. A beautiful but unreadable palette is rejected.",
  "- Light backgrounds are allowed and welcome when they fit the topic.",
  "- Motion must match the tone: calm topics get long enterFrames and small travelPx,",
  "  urgent topics get short enterFrames and snappy easing.",
  "- musicMood follows the same tone: calm for reflective topics, tech for science and gadgets,",
  "  dramatic for conflict and disasters, serious for news and money, upbeat or playful for light ones.",
  "",
  "style picks the frame device, not just the palette:",
  "- tech — dark, glowing UI look; ONLY for AI, software, cybersecurity, space tech.",
  "- editorial — light paper, serif headings (PlayfairDisplay or Lora), thin rules instead of",
  "  cards; history, society, economics, business.",
  "- poster — huge bold type filling the frame, flat saturated colors, no cards (Anton,",
  "  BebasNeue, Oswald); facts, top-N lists, bold claims.",
  "- kinetic — typography only, big words, minimal decoration; quotes, motivation, psychology.",
  "- notebook — light grid paper, handwritten look (Caveat); explainers and \"how it works\".",
  "- documentary — dark cinematic, for science, nature, places, people.",
  "- Prefer non-tech styles unless the topic is genuinely about technology; tech is overused.",
  "- The canvas must match the style: editorial and notebook need a light canvas, tech and",
  "  documentary need a dark canvas (this is checked and enforced, same as contrast).",
  "- Pick fontFamily to match the style: PlayfairDisplay or Lora for editorial, Anton/BebasNeue/",
  "  Oswald for poster, Caveat for notebook, JetBrainsMono for tech.",
  `Example: ${JSON.stringify(DEFAULT_VIDEO_THEME)}`,
].join("\n");

/**
 * Дизайн-система под тему ролика.
 *
 * Модель задаёт палитру, шрифт и кривые движения числами, а не кодом: такой ответ
 * проверяется. Контраст считается по WCAG прямо в схеме, и нечитаемая тема уходит
 * на повтор вместе с конкретными цифрами контраста. Три неудачи — дефолтная тема.
 */
export async function generateTheme(ctx: GenerationContext, topic: string): Promise<VideoTheme> {
  const feedback: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await ctx.llm.askJson({
        system: THEME_SYSTEM,
        user: withFeedback(`Video topic: ${topic}`, feedback),
        maxTokens: 900,
        timeoutMs: 150000,
      });
      const parsed = VideoThemeSchema.safeParse(unwrapContent(raw, "theme"));
      if (parsed.success) {
        log(ctx, `тема: ${parsed.data.mood} · ${parsed.data.fontFamily} · ${parsed.data.canvas}`);
        return parsed.data;
      }
      feedback.splice(0, feedback.length, ...issuesOf(parsed.error));
      log(ctx, `тема attempt ${attempt}: ${feedback.join("; ")}`);
    } catch (error) {
      log(ctx, `тема attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  log(ctx, "тема: откат на дефолтную");
  return DEFAULT_VIDEO_THEME;
}
