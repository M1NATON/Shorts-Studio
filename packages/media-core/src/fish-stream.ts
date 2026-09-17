import type { WordTiming } from "@shorts/contracts";
import { finalizeWavHeader } from "./wav.js";

/**
 * Разбор SSE-потока Fish `/v1/tts/stream/with-timestamp`.
 *
 * Три особенности реального протокола, каждая ловится тестом на фикстуре:
 *
 * 1. `alignment` — КУМУЛЯТИВНЫЙ снапшот внутри чанка, а не дельта: события одного
 *    chunk_seq приходят с 1, 2, 5, 9, 10 сегментами. Наивная конкатенация даёт дубли,
 *    поэтому от каждого чанка берётся ПОСЛЕДНЕЕ событие.
 * 2. Длинный текст Fish чанкует сам и присылает `chunk_audio_offset_sec` — собственный
 *    чанкинг по maxCharsPerRequest не нужен, тайминги сшиваются этим смещением.
 * 3. Финальное событие чанка приходит с пустым `audio_base64` — только ради alignment.
 */

export interface FishStreamEvent {
  audio_base64?: string;
  content?: string;
  alignment?: { segments?: Array<{ text: string; start: number; end: number }>; audio_duration?: number };
  chunk_seq?: number;
  chunk_audio_offset_sec?: number;
}

export interface FishStreamResult {
  /** Готовый WAV с корректным заголовком. */
  audio: Buffer;
  /** Слова в секундах от начала сцены, уже сшитые через chunk_audio_offset_sec. */
  words: WordTiming[];
  /** Длительность по данным провайдера. Для таймлайна используется ffprobe, не это. */
  reportedDurationSec: number;
}

/** Разбирает текст SSE-ответа в события. Толерантен к keep-alive и комментариям. */
export function parseSseEvents(raw: string): FishStreamEvent[] {
  const events: FishStreamEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload) as FishStreamEvent);
    } catch {
      // Обрывок кадра в потоке не должен ронять всю озвучку сцены.
    }
  }
  return events;
}

export function assembleFishStream(events: readonly FishStreamEvent[]): FishStreamResult {
  if (events.length === 0) throw new Error("Fish: empty response stream");

  const audioParts: Buffer[] = [];
  /** chunk_seq → последнее событие этого чанка (alignment кумулятивный). */
  const lastByChunk = new Map<number, FishStreamEvent>();

  for (const event of events) {
    if (event.audio_base64) audioParts.push(Buffer.from(event.audio_base64, "base64"));
    const seq = event.chunk_seq ?? 0;
    if (event.alignment?.segments) lastByChunk.set(seq, event);
  }

  const words: WordTiming[] = [];
  let reportedDurationSec = 0;
  for (const seq of [...lastByChunk.keys()].sort((a, b) => a - b)) {
    const event = lastByChunk.get(seq)!;
    const offset = event.chunk_audio_offset_sec ?? 0;
    for (const seg of event.alignment?.segments ?? []) {
      words.push({ text: seg.text, start: seg.start + offset, end: seg.end + offset });
    }
    reportedDurationSec = Math.max(reportedDurationSec, offset + (event.alignment?.audio_duration ?? 0));
  }

  const audio = Buffer.concat(audioParts);
  if (audio.length === 0) throw new Error("Fish: response contained no audio");

  return { audio: finalizeWavHeader(audio), words, reportedDurationSec };
}
