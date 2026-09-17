import type { WordTiming } from "@shorts/contracts";

/**
 * Перенос таймингов провайдера на ОРИГИНАЛЬНЫЙ текст озвучки.
 *
 * Fish возвращает слова очищенными: "can't" → "cant", "2026," → "2026", "A.I." → "AI".
 * Показывать в субтитрах нужно оригинал с пунктуацией, а тайминги есть только для
 * очищенной формы, поэтому формы сопоставляются по нормализованному виду.
 *
 * Расхождение по количеству слов возможно (провайдер может склеить или пропустить),
 * поэтому сопоставление устойчивое: идём по оригиналу и подбираем следующее совпадение,
 * а не полагаемся на равенство длин.
 */

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

export interface WordMappingResult {
  words: WordTiming[];
  /** Сколько слов оригинала не получили тайминг провайдера (интерполированы). */
  unmatched: number;
}

export function mapTimingsToOriginalText(
  originalText: string,
  providerWords: readonly WordTiming[],
): WordMappingResult {
  const originals = originalText.split(/\s+/).filter(Boolean);
  const words: WordTiming[] = [];
  let cursor = 0;
  let unmatched = 0;

  for (const original of originals) {
    const key = normalize(original);
    if (!key) continue;

    // Ищем следующее совпадение, допуская, что провайдер мог пропустить слово.
    let found = -1;
    for (let i = cursor; i < providerWords.length && i < cursor + 4; i++) {
      if (normalize(providerWords[i]!.text) === key) {
        found = i;
        break;
      }
    }

    if (found === -1) {
      // Нет совпадения — ставим заглушку, интерполируем ниже.
      words.push({ text: original, start: Number.NaN, end: Number.NaN });
      unmatched++;
      continue;
    }

    const match = providerWords[found]!;
    words.push({ text: original, start: match.start, end: match.end });
    cursor = found + 1;
  }

  interpolateGaps(words);
  return { words, unmatched };
}

/** Заполняет пропуски линейно между известными соседями, чтобы субтитры не дёргались. */
function interpolateGaps(words: WordTiming[]): void {
  for (let i = 0; i < words.length; i++) {
    if (!Number.isNaN(words[i]!.start)) continue;
    const prevEnd = i > 0 ? words[i - 1]!.end : 0;
    let next = i + 1;
    while (next < words.length && Number.isNaN(words[next]!.start)) next++;
    const nextStart = next < words.length ? words[next]!.start : prevEnd;
    const gapCount = next - i;
    const step = gapCount > 0 ? (nextStart - prevEnd) / gapCount : 0;
    words[i] = { text: words[i]!.text, start: prevEnd, end: prevEnd + Math.max(step, 0) };
  }
}

/**
 * Fallback, когда провайдер таймингов не дал вообще: распределение по длине слов,
 * калиброванное под РЕАЛЬНУЮ длительность аудио. Всегда помечается как "estimated"
 * и показывается пользователю как приблизительное — молча за точное не выдаётся.
 */
export function estimateTimings(originalText: string, audioDurationSec: number): WordTiming[] {
  const originals = originalText.split(/\s+/).filter(Boolean);
  if (originals.length === 0) return [];
  // Речь занимает не весь файл: у TTS почти всегда есть хвост тишины.
  const speechDuration = audioDurationSec * 0.97;
  const weights = originals.map((w) => Math.max(normalize(w).length, 1) + 1);
  const total = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  return originals.map((text, i) => {
    const span = (weights[i]! / total) * speechDuration;
    const word = { text, start: cursor, end: cursor + span };
    cursor += span;
    return word;
  });
}
