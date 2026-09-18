import { PublishMetaSchema, type PublishMeta, type VideoFormat } from "@shorts/contracts";
import { issuesOf, unwrapContent, withFeedback } from "./context.js";
import type { LlmClient } from "./llm-client.js";

export const PUBLISH_SYSTEM = [
  "You write the YouTube publish metadata for one finished video. Return JSON only.",
  "",
  'Fields: { "title": string, "description": string, "hashtags": string[] }',
  "",
  "Rules:",
  "- title: a strong hook, ideally under 60 characters (hard limit 100), specific to what is",
  "  actually in the video, never a lie or clickbait, not ALL CAPS, at most one emoji or none.",
  "- description: first line is a hook (shown in the preview), then 2-4 short sentences about",
  "  what the video covers — use only facts that appear in the narration, never invent facts.",
  '  If SOURCES are given, end with a line "Sources:" followed by up to 5 lines "- title: url".',
  "  No sources given — skip that block entirely. Do not repeat the hashtags inside the description.",
  "- hashtags: 3 to 8 relevant hashtags, each starting with #.",
].join("\n");

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
        system: PUBLISH_SYSTEM,
        user: withFeedback(user, feedback),
        maxTokens: 900,
        timeoutMs: 150000,
      });
      const parsed = PublishMetaSchema.safeParse(unwrapContent(raw, "publish"));
      if (parsed.success) return withShortsTag(parsed.data, input.format);
      feedback.splice(0, feedback.length, ...issuesOf(parsed.error));
      lastError = feedback.join("; ");
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`publish meta failed: ${lastError}`);
}
