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
const LOUDNESS = "I=-14:TP=-1.5:LRA=11";
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
 * Обрезает тишину по краям, ускоряет речь, выравнивает громкость (замер + линейный
 * loudnorm) и сглаживает края фразы — трансформирующим ffmpeg-проходом во временный
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
    // Громкость в два прохода: однопроходный loudnorm на фразе в 2–5 с работает в
    // динамическом режиме и даёт разный уровень от сцены к сцене. Сначала меряем,
    // потом выставляем линейно (одним усилением на всю фразу) по замеру.
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
      "-af", `${shape},${loudnormApply(measured)},${fades}`,
      // loudnorm пересэмплирует в 192 кГц — возвращаем обычную частоту.
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

/** loudnorm с замером первого прохода (linear); без замера — обычный однопроходный. */
function loudnormApply(stderr: string): string {
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)?.[0];
  if (!json) return `loudnorm=${LOUDNESS}`;
  const m = JSON.parse(json) as Record<string, string>;
  const num = (key: string) => Number.isFinite(Number(m[key])) ? Number(m[key]) : undefined;
  const [i, tp, lra, thresh, offset] = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"].map(num);
  // Тишина или слишком короткий кусок: замер -inf — линейный режим невозможен.
  if ([i, tp, lra, thresh, offset].some((v) => v === undefined)) return `loudnorm=${LOUDNESS}`;
  return `loudnorm=${LOUDNESS}:measured_I=${i}:measured_TP=${tp}:measured_LRA=${lra}:measured_thresh=${thresh}:offset=${offset}:linear=true`;
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
