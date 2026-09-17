import { describe, expect, it } from "vitest";
import longFixture from "./fixtures/fish-long.json" with { type: "json" };
import shortFixture from "./fixtures/fish-short.json" with { type: "json" };
import { assembleFishStream, parseSseEvents, type FishStreamEvent } from "./fish-stream.js";

const long = longFixture as FishStreamEvent[];
const short = shortFixture as FishStreamEvent[];

describe("parseSseEvents", () => {
  it("читает кадры data: и игнорирует служебные строки", () => {
    const raw = 'event: message\ndata: {"chunk_seq":0}\n\n: keep-alive\ndata: [DONE]\n';
    expect(parseSseEvents(raw)).toEqual([{ chunk_seq: 0 }]);
  });

  it("не роняет поток из-за одного битого кадра", () => {
    expect(parseSseEvents('data: {"chunk_seq":0}\ndata: {broken\ndata: {"chunk_seq":1}')).toHaveLength(2);
  });
});

describe("assembleFishStream (фикстуры реальных ответов Fish)", () => {
  it("не дублирует слова: alignment внутри чанка кумулятивный", () => {
    // В короткой фикстуре 6 событий с 1,2,2,5,9,10 сегментами. Наивная конкатенация дала бы 29.
    const { words } = assembleFishStream(short);
    expect(words).toHaveLength(10);
    expect(words.map((w) => w.text).join(" ")).toBe("By 2026 AI systems still cannot set their own goals");
  });

  it("сшивает чанки через chunk_audio_offset_sec без разрывов и без перехлёста", () => {
    const { words } = assembleFishStream(long);
    expect(words).toHaveLength(92);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
      expect(words[i]!.start + 1e-9).toBeGreaterThanOrEqual(words[i - 1]!.end - 1e-9);
    }
    // стык второго чанка: смещение 18.25с реально применено
    expect(words.at(-1)!.end).toBeCloseTo(31.61, 1);
  });

  it("длительность по alignment сходится с реальной длительностью файла (ffprobe: 31.68с)", () => {
    expect(assembleFishStream(long).reportedDurationSec).toBeCloseTo(31.68, 1);
  });

  it("не спотыкается о финальное событие с пустым audio_base64", () => {
    expect(short.at(-1)?.audio_base64).toBe("");
    expect(() => assembleFishStream(short)).not.toThrow();
  });

  it("чинит streaming-заголовок WAV: размеры становятся реальными", () => {
    const { audio } = assembleFishStream(short);
    expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
    expect(audio.readUInt32LE(4)).toBe(audio.length - 8);
    const dataIdx = audio.indexOf("data", 12);
    expect(audio.readUInt32LE(dataIdx + 4)).toBe(audio.length - dataIdx - 8);
  });

  it("склеивает аудио без вставки лишних RIFF-заголовков на стыках чанков", () => {
    const { audio } = assembleFishStream(long);
    let count = 0;
    for (let i = audio.indexOf("RIFF"); i !== -1; i = audio.indexOf("RIFF", i + 4)) count++;
    expect(count).toBe(1);
  });

  it("падает явно на пустом или безаудийном ответе, а не отдаёт тишину", () => {
    expect(() => assembleFishStream([])).toThrow(/empty response/);
    expect(() => assembleFishStream([{ chunk_seq: 0 }])).toThrow(/no audio/);
  });
});
