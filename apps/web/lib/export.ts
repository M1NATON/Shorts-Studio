/**
 * Экспорт содержимого ролика для проверки фактов сторонней нейросетью.
 * Чистые функции — источник данных (страница ролика) собирает project/scenes,
 * а сериализация в Markdown/JSON живёт здесь и покрыта тестом.
 */
import type { SceneVisualSpec } from "@shorts/contracts";
import type { Project, Scene } from "./api";
import { formatDate } from "./format";

/** Служебные enum-поля спецификации кадра — не текст, в экспорт не идут. */
const EXCLUDED_KEYS = new Set(["kind", "block", "layout", "motion", "backdrop", "variant", "size", "icon"]);

function collectTexts(value: unknown, key: string | undefined, out: string[]): void {
  if (key !== undefined && EXCLUDED_KEYS.has(key)) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (text) out.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTexts(item, undefined, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectTexts(v, k, out);
  }
}

/** Все видимые тексты кадра: обходит visual рекурсивно, пропуская служебные enum-поля. */
export function onScreenTexts(visual: SceneVisualSpec): string[] {
  const out: string[] = [];
  collectTexts(visual, undefined, out);
  return out;
}

const FRESHNESS_LABEL: Record<string, string> = { current: "свежие факты", evergreen: "вечные факты" };

const INSTRUCTION =
  "Проверь фактическую точность этого короткого видео. Для каждой сцены отметь: верно / сомнительно / неверно, с объяснением и, где можно, источником. Отдельно проверь числа, даты, имена. Отметь утверждения, которых нет в источниках.";

export function exportMarkdown(project: Project, scenes: Scene[]): string {
  const lines: string[] = [INSTRUCTION, "", `# ${project.title ?? project.topic}`, "", `Тема: ${project.topic}`];
  if (project.researchedAt) lines.push(`Факты собраны: ${formatDate(project.researchedAt)}`);
  if (project.freshness) lines.push(`Актуальность: ${FRESHNESS_LABEL[project.freshness] ?? project.freshness}`);
  lines.push("");

  scenes.forEach((scene, i) => {
    lines.push(`## Сцена ${i + 1}`, `Озвучка: ${scene.version.narration}`);
    const texts = onScreenTexts(scene.version.visual);
    if (texts.length) lines.push(`На экране: ${texts.join(" · ")}`);
    if (scene.version.unverifiedNumbers.length) lines.push(`Числа без источника: ${scene.version.unverifiedNumbers.join(", ")}`);
    if (scene.media?.query) lines.push(`Фон: ${scene.media.query}`);
    lines.push("");
  });

  if (project.sources.length) {
    lines.push("## Источники");
    project.sources.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title} — ${s.url}${s.publishedAt ? ` (${formatDate(s.publishedAt)})` : ""}`);
    });
    lines.push("");
  }

  if (project.publish) {
    lines.push("## Для публикации", `Название: ${project.publish.title}`, `Описание: ${project.publish.description}`, `Хэштеги: ${project.publish.hashtags.join(" ")}`);
    if (project.publish.thumbnailPrompt) lines.push(`Промпт для обложки: ${project.publish.thumbnailPrompt}`);
  }

  return `${lines.join("\n").trim()}\n`;
}

export function exportJson(project: Project, scenes: Scene[]): string {
  return JSON.stringify(
    {
      title: project.title ?? project.topic,
      topic: project.topic,
      format: project.format,
      researchedAt: project.researchedAt,
      freshness: project.freshness,
      sources: project.sources,
      publish: project.publish,
      scenes: scenes.map((scene, i) => ({
        index: i + 1,
        narration: scene.version.narration,
        onScreen: onScreenTexts(scene.version.visual),
        unverifiedNumbers: scene.version.unverifiedNumbers,
        intent: scene.version.intent,
        mediaQuery: scene.media?.query ?? null,
      })),
    },
    null,
    2,
  );
}
