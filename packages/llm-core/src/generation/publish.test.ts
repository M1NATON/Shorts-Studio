import { describe, expect, it } from "vitest";
import { generatePublishMeta } from "./publish.js";
import { fakeLlm } from "./test-helpers.js";

const input = {
  topic: "Battery prices",
  title: "Why batteries got cheap",
  format: "shorts" as const,
  narration: ["Batteries got ninety percent cheaper in a decade.", "Packs cost 115 dollars per kWh in 2024."],
};

const validAnswer = {
  title: "Why battery prices collapsed in a decade",
  description:
    "Batteries got dramatically cheaper. This video covers the forces behind it: bigger factories, better chemistry and fierce competition between makers.",
  hashtags: ["#Batteries", "#EnergyStorage", "#Tech"],
};

describe("generatePublishMeta", () => {
  it("промпт содержит narration и не содержит источников", async () => {
    const llm = fakeLlm(() => validAnswer);
    await generatePublishMeta(llm, input);
    const user = llm.calls[0]!.user;
    expect(user).toContain("Batteries got ninety percent cheaper in a decade.");
    expect(user).toContain("Packs cost 115 dollars per kWh in 2024.");
    expect(user).not.toMatch(/https?:\/\//);
    expect(llm.calls[0]!.system).toMatch(/No links, no URLs, no list of sources/);
  });

  it("ссылки и блок источников вырезаются из описания", async () => {
    const description = [
      "Batteries got dramatically cheaper over a single decade.",
      "Bigger factories, better chemistry and fierce competition did it.",
      "",
      "Sources:",
      "- Battery price report: https://x.test/report",
      "",
      "Which part surprised you most?",
    ].join("\n");
    const llm = fakeLlm(() => ({ ...validAnswer, description }));
    const meta = await generatePublishMeta(llm, input);
    expect(llm.calls).toHaveLength(1);
    expect(meta.description).not.toMatch(/Sources:|x\.test/);
    expect(meta.description).toMatch(/Which part surprised you most\?$/);
  });

  it("shorts без #Shorts в ответе — добавляется первым и список обрезается до 8", async () => {
    const llm = fakeLlm(() => ({ ...validAnswer, hashtags: Array.from({ length: 8 }, (_, i) => `#Tag${i}`) }));
    const result = await generatePublishMeta(llm, input);
    expect(result.hashtags[0]).toBe("#Shorts");
    expect(result.hashtags).toHaveLength(8);
  });

  it("landscape не получает #Shorts", async () => {
    const llm = fakeLlm(() => validAnswer);
    const result = await generatePublishMeta(llm, { ...input, format: "landscape" });
    expect(result.hashtags).not.toContain("#Shorts");
  });

  it("shorts: промпт просит 2-4 хэштега (без #Shorts — его добавляет код)", async () => {
    const llm = fakeLlm(() => validAnswer);
    await generatePublishMeta(llm, input);
    expect(llm.calls[0]!.system).toMatch(/2 to 4 relevant hashtags/);
    expect(llm.calls[0]!.system).toMatch(/do not add #Shorts yourself/i);
  });

  it("landscape: промпт просит 3-5 хэштегов целиком от модели", async () => {
    const llm = fakeLlm(() => validAnswer);
    await generatePublishMeta(llm, { ...input, format: "landscape" });
    expect(llm.calls[0]!.system).toMatch(/3 to 5 relevant hashtags/);
  });

  it("короткий промпт обложки отбрасывается, название и описание остаются", async () => {
    const llm = fakeLlm(() => ({ ...validAnswer, thumbnailPrompt: "gears" }));
    const meta = await generatePublishMeta(llm, input);
    expect(llm.calls).toHaveLength(1);
    expect(meta.thumbnailPrompt).toBeUndefined();
    expect(meta.title).toBe(validAnswer.title);
  });

  it("промпт обложки: вертикальный для shorts, горизонтальный для landscape", async () => {
    const shorts = fakeLlm(() => validAnswer);
    await generatePublishMeta(shorts, input);
    expect(shorts.calls[0]!.system).toMatch(/thumbnailPrompt: .*vertical 9:16/s);
    const landscape = fakeLlm(() => validAnswer);
    await generatePublishMeta(landscape, { ...input, format: "landscape" });
    expect(landscape.calls[0]!.system).toMatch(/horizontal 16:9/);
  });

  it("промпт обложки требует живое фото и запрещает приметы ИИ-картинки", async () => {
    const llm = fakeLlm(() => validAnswer);
    await generatePublishMeta(llm, input);
    const system = llm.calls[0]!.system;
    expect(system).toMatch(/real photograph/);
    expect(system).toMatch(/digital art, illustration, 3D render/);
    expect(system).toMatch(/imperfections/);
  });

  it("промпт требует ключевое слово темы в начале title и вопрос в конце description", async () => {
    const llm = fakeLlm(() => validAnswer);
    await generatePublishMeta(llm, input);
    const system = llm.calls[0]!.system;
    expect(system).toMatch(/first 3-4 words/);
    expect(system).toMatch(/last line is always one specific question/);
  });

  it("невалидный ответ уходит на повтор с замечаниями, затем принимается", async () => {
    const llm = fakeLlm((_req, call) => (call === 1 ? { title: "short" } : validAnswer));
    const result = await generatePublishMeta(llm, input);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.user).toMatch(/rejected/);
    expect(result.title).toBe(validAnswer.title);
  });

  it("три невалидных ответа подряд — бросает ошибку", async () => {
    const llm = fakeLlm(() => ({ title: "x" }));
    await expect(generatePublishMeta(llm, input)).rejects.toThrow(/publish meta failed/);
    expect(llm.calls).toHaveLength(3);
  });
});
