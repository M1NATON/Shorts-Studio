import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { postProcessNarration } from "./audio-post.js";
import { probeDurationSec } from "./ffprobe.js";

const execFileAsync = promisify(execFile);

let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

describe("postProcessNarration (ffmpeg инъекция, без реального ffmpeg)", () => {
  it("режет тишину по краям по silencedetect и сдвигает leadTrimSec", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "post-"));
    const file = path.join(dir, "x.wav");
    writeFileSync(file, "orig");

    let probeCalls = 0;
    const result = await postProcessNarration(file, {
      tempo: 1.1,
      probe: async () => (probeCalls++ === 0 ? 2.5 : 2.0),
      execFfmpeg: async (args) => {
        if (args.includes("-f")) {
          // Читающий проход silencedetect: тишина 0..0.5, речь 0.5..2.2, тишина 2.2..конца (не закрыта).
          return {
            stdout: "",
            stderr: [
              "[silencedetect] silence_start: 0",
              "[silencedetect] silence_end: 0.5 | silence_duration: 0.5",
              "[silencedetect] silence_start: 2.2",
            ].join("\n"),
          };
        }
        // Трансформирующий проход — как реальный ffmpeg, пишет tmp-файл под rename.
        const tmpPath = args[args.length - 1]!;
        writeFileSync(tmpPath, "processed");
        return { stdout: "", stderr: "" };
      },
    });

    expect(result.tempo).toBe(1.1);
    expect(result.leadTrimSec).toBeCloseTo(0.45, 5); // 0.5 (silence_end) - 0.05 (KEEP_MARGIN_SEC)
    expect(result.durationSec).toBe(2.0);
    expect(readFileSync(file, "utf8")).toBe("processed");
  });

  it("ffmpeg упал — озвучка не теряется: файл как есть, tempo=1, leadTrimSec=0", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "post-"));
    const file = path.join(dir, "x.wav");
    writeFileSync(file, "orig");

    const result = await postProcessNarration(file, {
      probe: async () => 1.5,
      execFfmpeg: async () => {
        throw new Error("ffmpeg not found");
      },
    });

    expect(result).toEqual({ durationSec: 1.5, leadTrimSec: 0, tempo: 1 });
    expect(readFileSync(file, "utf8")).toBe("orig");
  });
});

describe.skipIf(!hasFfmpeg)("postProcessNarration (реальный ffmpeg)", () => {
  it("обрезает тишину по краям и ускоряет сгенерированный тестовый WAV", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "post-real-"));
    const file = path.join(dir, "x.wav");
    // 0.5с тишины + 1с тона 440Гц + 0.5с тишины — как WAV с "мёртвым воздухом" по краям.
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-af", "adelay=500:all=1,apad=pad_dur=0.5",
      file,
    ]);
    const before = await probeDurationSec(file);

    const result = await postProcessNarration(file, { tempo: 1.1 });

    expect(result.leadTrimSec).toBeGreaterThan(0.3);
    expect(result.leadTrimSec).toBeLessThan(0.6);
    expect(result.durationSec).toBeLessThan(before);
    expect(result.tempo).toBe(1.1);
  }, 20000);

  it("тихая и громкая фраза выходят одной громкости, 44.1 кГц", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "post-loud-"));
    const meanVolume = async (file: string) => {
      const { stderr } = await execFileAsync("ffmpeg", ["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
      return Number(/mean_volume:\s*(-?[\d.]+)/.exec(stderr)![1]);
    };
    const levels: number[] = [];
    for (const [name, volume] of [["quiet", 0.05], ["loud", 0.8]] as const) {
      const file = path.join(dir, `${name}.wav`);
      // 3 с «речи» (тон с модуляцией) — как фраза сцены.
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-af", `volume=${volume},tremolo=f=4:d=0.6`, file]);
      await postProcessNarration(file, { tempo: 1 });
      levels.push(await meanVolume(file));
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", file]);
      expect(stdout.trim()).toBe("44100");
    }
    expect(Math.abs(levels[0]! - levels[1]!)).toBeLessThan(1);
  }, 30000);
});
