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
    "  No links, no URLs, no list of sources, no timestamps.",
    "  The description's last line is always one specific question about the topic that invites viewers",
    '  to comment — not a generic "what do you think?". Do not repeat the hashtags inside the description.',
    `- hashtags: ${hashtagsRule}`,
    `- thumbnailPrompt: one English prompt (70-170 words) for an AI image generator that makes the video's`,
    `  ${format === "shorts" ? "vertical 9:16" : "horizontal 16:9"} thumbnail. It must read as a real photograph someone took, not as AI art.`,
    "  Describe: one clear focal subject taken from the most striking moment of the narration, large in the",
    "  frame; the camera and lens in plain words (for example 35mm at f/2, eye level, handheld); one",
    "  believable light source with a visible direction and soft real shadows; true-to-life muted colors;",
    "  real surface texture and small imperfections — dust, wear, uneven edges, a little motion blur,",
    "  slightly off-centre framing; shallow depth of field; a plain uncluttered background; and empty space",
    `  in the ${format === "shorts" ? "top third" : "left third"} of the frame for text added later.`,
    "  The prompt must also forbid, in its own words: digital art, illustration, 3D render, CGI, 8k,",
    "  hyperrealistic, ultra-detailed, trending on artstation, neon rim light, glowing edges, lens flare,",
    "  fake HDR, oversaturated colors, plastic glossy skin, perfect symmetry; any text, letters, numbers,",
    "  logos or watermarks inside the image; and the likeness of a real living person.",
    "  Accurate to the facts — no invented events. Finish with one separate final line, exactly in this shape:",
    '  Overlay text (add in an editor, not in the generated image): "2-4 words" — a tease of the hook that',
    "  does not repeat the title.",
  ].join("\n");
}

export interface PublishMetaInput {
  readonly topic: string;
  readonly title: string;
  readonly format: VideoFormat;
  readonly narration: readonly string[];
}

function userPrompt(input: PublishMetaInput): string {
  return [
    `Video topic: ${input.topic}`,
    `Video title: ${input.title}`,
    "Narration, scene by scene:",
    ...input.narration.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");
}

/** Негодный промпт обложки не должен валить название и описание: он необязателен — просто отбрасываем. */
function dropBadThumbnailPrompt(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const { thumbnailPrompt, ...rest } = content as { thumbnailPrompt?: unknown };
  return PublishMetaSchema.shape.thumbnailPrompt.safeParse(thumbnailPrompt).success ? content : rest;
}

/**
 * Ссылки и блок источников в описании не нужны — режем строками, а не надеждой на
 * то, что модель соблюдёт правило. Убираем до разбора схемой: если после чистки
 * описание стало коротким, модель получит замечание и перепишет его.
 */
function stripSources(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const { description } = content as { description?: unknown };
  if (typeof description !== "string") return content;
  const cleaned = description
    .split("\n")
    .filter((line) => !/^\s*(sources|источники|links|ссылки)\s*:/i.test(line) && !/https?:\/\/|www\./i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...content, description: cleaned };
}

/** Shorts всегда должны нести #Shorts первым тегом — это решает код, а не повторный запрос. */
function withShortsTag(meta: PublishMeta, format: VideoFormat): PublishMeta {
  if (format !== "shorts" || meta.hashtags[0] === "#Shorts") return meta;
  return { ...meta, hashtags: ["#Shorts", ...meta.hashtags.filter((h) => h !== "#Shorts")].slice(0, 8) };
}

/**
 * Название, описание и хэштеги для YouTube — из уже готовой озвучки сцен, чтобы
 * пользователь не заполнял их отдельно.
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
      const parsed = PublishMetaSchema.safeParse(stripSources(dropBadThumbnailPrompt(unwrapContent(raw, "publish"))));
      if (parsed.success) return withShortsTag(parsed.data, input.format);
      feedback.splice(0, feedback.length, ...issuesOf(parsed.error));
      lastError = feedback.join("; ");
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`publish meta failed: ${lastError}`);
}
