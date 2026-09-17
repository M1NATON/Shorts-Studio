/**
 * Работа с WAV-потоком Fish Audio.
 *
 * Fish отдаёт первым чанком WAV со streaming-заголовком: поля размера забиты
 * 0xFFFFFFFF, потому что длина на момент старта генерации неизвестна. ffprobe такой файл
 * читает, а вот браузерный аудио-декодер (то есть preview в @remotion/player) на него
 * полагаться не может. Поэтому после склейки размеры переписываются на реальные.
 *
 * Проверено на реальном ответе: последующие чанки приходят сырым PCM, без собственного
 * RIFF-заголовка, поэтому побайтовая склейка безопасна и не даёт щелчков на стыках.
 */

const RIFF_SIZE_OFFSET = 4;
const DATA_CHUNK_ID = "data";

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  /** Длительность по заголовку. Источник истины для таймлайна — всё равно ffprobe. */
  durationSec: number;
}

function findDataChunk(buf: Buffer): number {
  // Ищем строго среди id чанков, а не первое вхождение "data" в PCM-данных.
  let offset = 12; // после "RIFF"+size+"WAVE"
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === DATA_CHUNK_ID) return offset;
    if (size === 0xffffffff) break; // streaming-заголовок: дальше размеры бессмысленны
    offset += 8 + size + (size % 2);
  }
  const fallback = buf.indexOf(DATA_CHUNK_ID, 12);
  if (fallback === -1) throw new Error("WAV: data chunk not found");
  return fallback;
}

/** Переписывает RIFF/data размеры на фактические. Возвращает тот же буфер (мутирует). */
export function finalizeWavHeader(buf: Buffer): Buffer {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("WAV: not a RIFF stream");
  }
  const dataIdx = findDataChunk(buf);
  const dataBytes = buf.length - (dataIdx + 8);
  if (dataBytes < 0) throw new Error("WAV: truncated data chunk");
  buf.writeUInt32LE(buf.length - 8, RIFF_SIZE_OFFSET);
  buf.writeUInt32LE(dataBytes, dataIdx + 4);
  return buf;
}

export function readWavInfo(buf: Buffer): WavInfo {
  const dataIdx = findDataChunk(buf);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(dataIdx + 4);
  const bytesPerFrame = (bitsPerSample / 8) * channels;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSec: bytesPerFrame > 0 ? dataBytes / bytesPerFrame / sampleRate : 0,
  };
}
