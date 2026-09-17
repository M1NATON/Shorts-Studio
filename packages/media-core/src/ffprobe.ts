import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Реальная длительность аудиофайла.
 *
 * Это ЕДИНСТВЕННЫЙ источник длительности сцены для таймлайна. Значение
 * `alignment.audio_duration` из ответа TTS для этого не годится: оно описывает
 * сгенерированную речь, а не итоговый файл, и расхождение (даже 70 мс на сцену)
 * накапливается по ролику в заметный рассинхрон.
 */
export async function probeDurationSec(filePath: string, ffprobePath = "ffprobe"): Promise<number> {
  const { stdout } = await exec(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`ffprobe returned unusable duration for ${filePath}: "${stdout.trim()}"`);
  }
  return duration;
}
