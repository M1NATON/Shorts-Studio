import { execFile } from "node:child_process";
import { rename } from "node:fs/promises";
import { promisify } from "node:util";
import { probeDurationSec } from "./ffprobe.js";

const execFileAsync = promisify(execFile);

/** Порог, ниже которого сигнал считается тишиной. */
const SILENCE_THRESHOLD_DB = -45;
/** Запас перед первым/после последнего звука — резать впритык нельзя, слово "спотыкается". */
const KEEP_MARGIN_SEC = 0.05;
/** Целевая громкость речи (LUFS) и потолок пиков: одинаковая у всех сцен. */
// -16 LUFS — стандарт для речи; громче лимитер начал бы заметно давить пики у резких фраз.
const TARGET_LUFS = -16;
const PEAK_DB = -1.5;
/** Только для замера (print_format=json): input_i — интегральная громкость фразы. */
const LOUDNESS = `I=${TARGET_LUFS}:TP=${PEAK_DB}:LRA=11`;
/** Плавный вход и выход фразы: без них стык сцен щёлкает и «режет слух». */
const FADE_IN_SEC = 0.02;
const FADE_OUT_SEC = 0.08;
/** Ускорение речи. `TTS_TEMPO` в env переопределяет для подбора без деплоя; 1 = выключено. */
export const DEFAULT_TEMPO = Number(process.env.TTS_TEMPO) || 1.1;

export type ExecFfmpeg = (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

async function defaultExecFfmpeg(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("ffmpeg", args as string[]);
}

export interface PostProcessOptions {
  readonly tempo?: number;
  readonly execFfmpeg?: ExecFfmpeg;
  readonly probe?: typeof probeDurationSec;
}

export interface PostProcessResult {
  readonly durationSec: number;
  /** Сколько секунд отрезано от начала, в координатах ИСХОДНОГО файла — сдвинуть тайминги слов. */
  readonly leadTrimSec: number;
  /** Применённый tempo — тайминги слов после сдвига ещё и поделить на него. 1, если обработка не удалась. */
  readonly tempo: number;
}

/**
 * Обрезает тишину по краям, ускоряет речь, выравнивает громкость (замер + ровное
 * усиление с лимитером) и сглаживает края фразы — трансформирующим ffmpeg-проходом во временный
 * файл с последующим rename поверх оригинала.
 *
 * Величину обрезки начала (нужна, чтобы сдвинуть тайминги слов) узнаём НАДЁЖНО заранее —
 * отдельным читающим проходом ffmpeg с фильтром silencedetect, без записи файла: сам
 * трансформирующий фильтр (atrim) не сообщает, сколько именно вырезал. silencedetect пишет
 * в stderr пары `silence_start`/`silence_end`. Если первая пара начинается у нуля — файл
 * открывается тишиной, и её конец — момент, где начинается речь (это и есть leadTrimSec).
 * Если последний `silence_start` не закрыт `silence_end` — стрим закончился тишиной, это
 * хвост под обрезку. К обеим границам добавлен KEEP_MARGIN_SEC, чтобы не резать впритык.
 *
 * Если ffmpeg упал на любом из проходов — озвучку не теряем: файл остаётся как есть,
 * возвращается tempo=1 и leadTrimSec=0 (вызывающий код тайминги не трогает).
 */
export async function postProcessNarration(filePath: string, options: PostProcessOptions = {}): Promise<PostProcessResult> {
  const tempo = options.tempo ?? DEFAULT_TEMPO;
  const execFfmpeg = options.execFfmpeg ?? defaultExecFfmpeg;
  const probe = options.probe ?? probeDurationSec;

  try {
    const originalDurationSec = await probe(filePath);
    const { stderr } = await execFfmpeg([
      "-i", filePath,
      "-af", `silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=0.05`,
      "-f", "null", "-",
    ]);
    const { leadTrimSec, tailEndSec } = parseSilence(stderr, originalDurationSec);

    const shape = `atrim=start=${leadTrimSec}:end=${tailEndSec},asetpts=PTS-STARTPTS,atempo=${tempo}`;
    // Громкость в два прохода: сначала замер, потом одно ровное усиление на фразу (gainToTarget).
    const { stderr: measured } = await execFfmpeg([
      "-i", filePath,
      "-af", `${shape},loudnorm=${LOUDNESS}:print_format=json`,
      "-f", "null", "-",
    ]);
    const outSec = (tailEndSec - leadTrimSec) / tempo;
    const fades = `afade=t=in:d=${FADE_IN_SEC},afade=t=out:st=${Math.max(0, outSec - FADE_OUT_SEC).toFixed(3)}:d=${FADE_OUT_SEC}`;
    const tmpPath = `${filePath}.tmp.wav`;
    await execFfmpeg([
      "-y", "-i", filePath,
      "-af", `${shape},${gainToTarget(measured)},${fades}`,
      // Частота — стандартная для озвучки, независимо от того, что отдал TTS.
      "-ar", "44100",
      tmpPath,
    ]);
    await rename(tmpPath, filePath);
    const durationSec = await probe(filePath);
    return { durationSec, leadTrimSec, tempo };
  } catch (err) {
    console.warn(`postProcessNarration: ffmpeg failed, keeping original audio for ${filePath}:`, err);
    const durationSec = await probe(filePath).catch(() => 0);
    return { durationSec, leadTrimSec: 0, tempo: 1 };
  }
}

/**
 * Выровнять громкость и сгладить края УЖЕ озвученной фразы — без обрезки и ускорения,
 * поэтому тайминги слов остаются верными. Для озвучки, сделанной до postProcessNarration.
 * Файл уже на целевой громкости (±0.5 LU) пропускается: повторный запуск ничего не портит.
 */
export async function normalizeNarration(
  filePath: string,
  options: Pick<PostProcessOptions, "execFfmpeg" | "probe"> = {},
): Promise<"normalized" | "skipped"> {
  const execFfmpeg = options.execFfmpeg ?? defaultExecFfmpeg;
  const probe = options.probe ?? probeDurationSec;
  const { stderr: measured } = await execFfmpeg(["-i", filePath, "-af", `loudnorm=${LOUDNESS}:print_format=json`, "-f", "null", "-"]);
  const inputI = Number(/"input_i"\s*:\s*"(-?[\d.]+)"/.exec(measured)?.[1]);
  if (Number.isFinite(inputI) && Math.abs(inputI - TARGET_LUFS) <= 0.5) return "skipped";
  const durationSec = await probe(filePath);
  const fades = `afade=t=in:d=${FADE_IN_SEC},afade=t=out:st=${Math.max(0, durationSec - FADE_OUT_SEC).toFixed(3)}:d=${FADE_OUT_SEC}`;
  const tmpPath = `${filePath}.tmp.wav`;
  await execFfmpeg(["-y", "-i", filePath, "-af", `${gainToTarget(measured)},${fades}`, "-ar", "44100", tmpPath]);
  await rename(tmpPath, filePath);
  return "normalized";
}

/**
 * Громкость по замеру первого прохода: ровное усиление до TARGET_LUFS + лимитер пиков.
 * Не loudnorm-apply: на фразах в 2–5 с он уходит в динамический режим и даёт разброс в
 * несколько дБ между сценами. Здесь результат предсказуем: одна цифра усиления на фразу.
 * Нет замера (тишина, слишком короткий кусок) — усиление 0.
 */
function gainToTarget(stderr: string): string {
  const inputI = Number(/"input_i"\s*:\s*"(-?[\d.]+)"/.exec(stderr)?.[1]);
  const gainDb = Number.isFinite(inputI) ? Math.max(-30, Math.min(30, TARGET_LUFS - inputI)) : 0;
  // limit в линейной шкале: -1.5 dBFS; level=0 — без автоподъёма, latency=1 — без сдвига звука.
  return `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${(10 ** (PEAK_DB / 20)).toFixed(4)}:level=0:latency=1`;
}

function parseSilence(stderr: string, originalDurationSec: number): { leadTrimSec: number; tailEndSec: number } {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  const leadTrimSec = starts.length > 0 && starts[0]! <= 0.02 && ends.length > 0
    ? Math.max(0, ends[0]! - KEEP_MARGIN_SEC)
    : 0;

  const hasUnclosedTail = ends.length < starts.length;
  const tailEndSec = hasUnclosedTail
    ? Math.min(originalDurationSec, starts[starts.length - 1]! + KEEP_MARGIN_SEC)
    : originalDurationSec;

  // Защита от вырожденного случая (почти весь файл — тишина): не режем в ноль.
  if (tailEndSec - leadTrimSec < 0.1) {
    return { leadTrimSec: 0, tailEndSec: originalDurationSec };
  }
  return { leadTrimSec, tailEndSec };
}
