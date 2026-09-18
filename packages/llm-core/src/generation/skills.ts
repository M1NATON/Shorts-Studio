/**
 * Скиллы модели — markdown в packages/llm-core/skills. Правятся без кода; в промпт
 * уходит тело файла без frontmatter. Путь одинаков из src/ и dist/ (оба на два уровня ниже корня пакета).
 */
import { readFileSync } from "node:fs";

export type SkillName = "narration" | "on-screen";

const cache = new Map<SkillName, string>();

export function skill(name: SkillName): string {
  let text = cache.get(name);
  if (text === undefined) {
    const raw = readFileSync(new URL(`../../skills/${name}.md`, import.meta.url), "utf8");
    text = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    cache.set(name, text);
  }
  return text;
}

/**
 * Самые надёжные признаки «нейротекста» из скилла narration, которые ловит код.
 * Список короткий сознательно: ложное срабатывание стоит лишнего запроса к модели.
 */
const TELLS: readonly [RegExp, string][] = [
  [/[—–]/, "dash (— or –): use a comma, period or colon"],
  [/\bnot (?:just|only|merely|simply)\b[^.]*\bbut\b/i, '"not just X but Y": state Y directly'],
  [/\b(?:it'?s|this is|that'?s) not\b[^.]*[.,;]\s*(?:it'?s|this is|that'?s)\b/i, '"it\'s not X, it\'s Y": state Y directly'],
  [/\b(?:let'?s dive|here'?s the thing|buckle up|picture this|imagine a world|in a world where|ever wondered|let that sink in|and that changes everything)\b/i, "staged opener or closer"],
  [/\b(?:delve|tapestry|testament|pivotal|game[- ]changer|groundbreaking|showcas\w*|underscor\w*|seamless\w*|vibrant|realm|unlock\w*|revolutioniz\w*|mind-blowing|the future looks bright)\b/i, "stock AI word"],
  [/\b(?:experts|studies|scientists|many) (?:say|show|believe|agree)\b/i, "unnamed authority: name the source or drop it"],
];

/** Замечания к тексту озвучки: по одному на найденный признак, с цитатой. */
export function narrationTells(text: string): string[] {
  return TELLS.flatMap(([re, why]) => {
    const hit = re.exec(text);
    return hit ? [`"${hit[0]}" — ${why}`] : [];
  });
}
