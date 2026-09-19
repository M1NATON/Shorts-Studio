import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { synthesizeFish, voiceNarration } from "./fish-client.js";

const options = { apiKey: "k", model: "m", referenceId: "r" };

describe("voiceNarration", () => {
  it("пишет WAV, берёт длительность у ffprobe и переносит тайминги на оригинал", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "voice-"));
    const file = path.join(dir, "a", "x.wav");
    const result = await voiceNarration("It cost $8.7 billion.", file, {
      ...options,
      synthesize: async () => ({
        audio: Buffer.from("RIFF"),
        words: [
          { text: "It", start: 0, end: 0.2 },
          { text: "cost", start: 0.2, end: 0.5 },
          { text: "8", start: 0.5, end: 0.8 },
          { text: "7", start: 0.8, end: 1.1 },
          { text: "billion", start: 1.1, end: 1.6 },
        ],
        reportedDurationSec: 1.7,
      }),
      probe: async () => 1.8,
      postProcess: async () => ({ durationSec: 1.8, leadTrimSec: 0, tempo: 1 }),
    });
    expect(readFileSync(file, "utf8")).toBe("RIFF");
    expect(result).toMatchObject({ durationSec: 1.8, timingSource: "native", unmatched: 0 });
    expect(result.words.map((w) => w.text)).toEqual(["It", "cost", "$8.7", "billion."]);
  });

  it("сдвигает и масштабирует тайминги по leadTrimSec и tempo от постобработки", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "voice-"));
    const result = await voiceNarration("It cost", path.join(dir, "x.wav"), {
      ...options,
      synthesize: async () => ({
        audio: Buffer.from("RIFF"),
        words: [
          { text: "It", start: 0.2, end: 0.4 },
          { text: "cost", start: 0.4, end: 0.8 },
        ],
        reportedDurationSec: 0.8,
      }),
      probe: async () => 0.8,
      postProcess: async () => ({ durationSec: 0.5, leadTrimSec: 0.2, tempo: 1.1 }),
    });
    // (0.2 - 0.2) / 1.1 = 0, (0.4 - 0.2) / 1.1 ≈ 0.1818
    expect(result.words[0]).toMatchObject({ start: 0 });
    expect(result.words[0]!.end).toBeCloseTo(0.1818, 3);
    expect(result.words[1]!.start).toBeCloseTo(0.1818, 3);
    expect(result.words[1]!.end).toBeCloseTo((0.8 - 0.2) / 1.1, 3);
  });

  it("без таймингов от провайдера — оценка с пометкой estimated", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "voice-"));
    const result = await voiceNarration("Two words", path.join(dir, "x.wav"), {
      ...options,
      synthesize: async () => ({ audio: Buffer.from(""), words: [], reportedDurationSec: 0 }),
      probe: async () => 1,
      postProcess: async () => ({ durationSec: 1, leadTrimSec: 0, tempo: 1 }),
    });
    expect(result.timingSource).toBe("estimated");
    expect(result.words).toHaveLength(2);
  });
});

describe("synthesizeFish", () => {
  it("HTTP-ошибка с кодом", async () => {
    const fetchImpl = (async () => new Response("quota", { status: 402 })) as unknown as typeof fetch;
    await expect(synthesizeFish("x", { ...options, fetchImpl })).rejects.toThrow("Fish HTTP 402: quota");
  });
});
