import { PublishMetaSchema, type PublishMeta, type VideoFormat } from "@shorts/contracts";
import { issuesOf, unwrapContent, withFeedback } from "./context.js";
import type { LlmClient } from "./llm-client.js";

/**
 * shorts получают #Shorts кодом (withShortsTag), поэтому просим модель на один
 * хэштег меньше — итог всё равно 3-5. landscape пишет весь список сама.
 */
function publishSystem(format: VideoFormat): string {
  const hashtagsRule =
    format === "shorts"
      ? "2 to 4 relevant hashtags, each starting with #. Do not add #Shorts yourself — the app adds it."
      : "3 to 5 relevant hashtags, each starting with #.";
  return [
    "You write the YouTube publish metadata for one finished video. Return JSON only.",
    "",
    'Fields: { "title": string, "description": string, "hashtags": string[], "thumbnailPrompt": string }',
    "",
    "Rules:",
    "- title: a strong hook, ideally under 60 characters (hard limit 100), specific to what is",
    "  actually in the video, never a lie or clickbait, not ALL CAPS, at most one emoji or none.",
    "  Put the topic's key word or name in the first 3-4 words — the viewer decides before reading the rest.",
    "- description: first line is a hook (shown in the preview), then 2-4 short sentences about",
    "  what the video covers — use only facts that appear in the narration, never invent facts.",
    '  If SOURCES are given, add a line "Sources:" followed by up to 5 lines "- title: url" (skip this block',
    "  entirely if no sources are given). The description's last line is always one specific question about",
    '  the topic that invites viewers to comment — not a generic "what do you think?". Do not repeat the',
    "  hashtags inside the description.",
    `- hashtags: ${hashtagsRule}`,
    `- thumbnailPrompt: one English prompt (60-160 words) for an AI image generator that makes the video's`,
    `  ${format === "shorts" ? "vertical 9:16" : "horizontal 16:9"} thumbnail. Describe: one clear focal subject taken from the most striking`,
    "  moment of the narration, what makes it intriguing, composition (subject large, close-up, simple",
    "  uncluttered background, strong depth), dramatic lighting, high contrast, saturated colors, photorealistic",
    "  or cinematic style, emotion. Include a short bold overlay text of 2-4 words in quotes that teases the hook",
    "  without repeating the title, and where it sits (large, top or side, clear space for it). Accurate to the",
    "  facts — no invented events; no logos, brand names or watermarks; no likeness of a real living person.",
  ].join("\n");
}

export interface PublishMetaInput {
  readonly topic: string;
  readonly title: string;
  readonly format: VideoFormat;
  readonly narration: readonly string[];
  readonly sources: readonly { title: string; url: string }[];
}

function userPrompt(input: PublishMetaInput): string {
  const lines = [
    `Video topic: ${input.topic}`,
    `Video title: ${input.title}`,
    "Narration, scene by scene:",
    ...input.narration.map((n, i) => `${i + 1}. ${n}`),
  ];
  if (input.sources.length > 0) {
    lines.push("", "SOURCES:", ...input.sources.slice(0, 5).map((s) => `- ${s.title}: ${s.url}`));
  }
  return lines.join("\n");
}

/** Негодный промпт обложки не должен валить название и описание: он необязателен — просто отбрасываем. */
function dropBadThumbnailPrompt(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const { thumbnailPrompt, ...rest } = content as { thumbnailPrompt?: unknown };
  return PublishMetaSchema.shape.thumbnailPrompt.safeParse(thumbnailPrompt).success ? content : rest;
}

/** Shorts всегда должны нести #Shorts первым тегом — это решает код, а не повторный запрос. */
function withShortsTag(meta: PublishMeta, format: VideoFormat): PublishMeta {
  if (format !== "shorts" || meta.hashtags[0] === "#Shorts") return meta;
  return { ...meta, hashtags: ["#Shorts", ...meta.hashtags.filter((h) => h !== "#Shorts")].slice(0, 8) };
}

/**
 * Название, описание и хэштеги для YouTube — из уже готового сценария (озвучка и
 * источники), чтобы пользователь не заполнял их отдельно.
 */
export async function generatePublishMeta(llm: LlmClient, input: PublishMetaInput): Promise<PublishMeta> {
  const user = userPrompt(input);
  const feedback: string[] = [];
  let lastError = "no attempts";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await llm.askJson({
        system: publishSystem(input.format),
        user: withFeedback(user, feedback),
        maxTokens: 1400,
        timeoutMs: 150000,
      });
      const parsed = PublishMetaSchema.safeParse(dropBadThumbnailPrompt(unwrapContent(raw, "publish")));
      if (parsed.success) return withShortsTag(parsed.data, input.format);
      feedback.splice(0, feedback.length, ...issuesOf(parsed.error));
      lastError = feedback.join("; ");
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`publish meta failed: ${lastError}`);
}
