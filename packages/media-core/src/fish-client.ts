/**
 * Озвучка через Fish и всё, что нужно сцене после неё: WAV на диске, реальная
 * длительность по ffprobe и тайминги слов на оригинальном тексте.
 *
 * Одна функция для CLI и сервера: раньше синтез жил внутри make-video.mjs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordTiming } from "@shorts/contracts";
import { postProcessNarration } from "./audio-post.js";
import { probeDurationSec } from "./ffprobe.js";
import { assembleFishStream, parseSseEvents, type FishStreamResult } from "./fish-stream.js";
import { speakNumbers } from "./spoken-numbers.js";
import { estimateTimings, mapTimingsToOriginalText } from "./word-mapping.js";

export interface FishOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly referenceId: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Синтез одной фразы. Ошибка HTTP — с кодом и началом тела ответа (в нём нет ключа). */
export async function synthesizeFish(text: string, options: FishOptions): Promise<FishStreamResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${options.baseUrl ?? "https://api.fish.audio"}/v1/tts/stream/with-timestamp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      model: options.model,
    },
    body: JSON.stringify({ text, reference_id: options.referenceId, format: "wav" }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 180000),
  });
  if (!res.ok) throw new Error(`Fish HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return assembleFishStream(parseSseEvents(await res.text()));
}

export interface VoicedNarration {
  readonly durationSec: number;
  readonly words: WordTiming[];
  readonly timingSource: "native" | "estimated";
  /** Слова без тайминга провайдера — интерполированы. */
  readonly unmatched: number;
}

/**
 * Озвучить фразу в файл `absPath`. Без таймингов от провайдера — оценка по длине
 * слов, помеченная "estimated": UI показывает её как приблизительную.
 */
export async function voiceNarration(
  narration: string,
  absPath: string,
  options: FishOptions & {
    synthesize?: typeof synthesizeFish;
    probe?: typeof probeDurationSec;
    postProcess?: typeof postProcessNarration;
  },
): Promise<VoicedNarration> {
  // В TTS — числа словами (Fish путает "1900" и "2,000"); тайминги и субтитры — на оригинале с цифрами.
  const { audio, words } = await (options.synthesize ?? synthesizeFish)(speakNumbers(narration), options);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, audio);
  // Обрезка тишины по краям + ускорение + громкость — здесь же, одним проходом по файлу.
  const post = await (options.postProcess ?? postProcessNarration)(absPath, options);
  const durationSec = post.durationSec;
  if (words.length === 0) {
    // estimateTimings уже считает по финальной (пост-обработанной) длительности — сдвиг не нужен.
    return { durationSec, words: estimateTimings(narration, durationSec), timingSource: "estimated", unmatched: 0 };
  }
  const mapped = mapTimingsToOriginalText(narration, words);
  return {
    durationSec,
    words: shiftTimings(mapped.words, post.leadTrimSec, post.tempo),
    timingSource: "native",
    unmatched: mapped.unmatched,
  };
}

/** Тайминги провайдера — в координатах исходного (не обрезанного, не ускоренного) файла. */
function shiftTimings(words: readonly WordTiming[], leadTrimSec: number, tempo: number): WordTiming[] {
  if (leadTrimSec === 0 && tempo === 1) return [...words];
  return words.map((w) => ({
    text: w.text,
    start: Math.max(0, (w.start - leadTrimSec) / tempo),
    end: Math.max(0, (w.end - leadTrimSec) / tempo),
  }));
}
