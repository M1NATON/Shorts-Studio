import { describe, expect, it } from "vitest";
import { PublishMetaSchema } from "./publish-meta.js";

const valid = {
  title: "Why battery prices collapsed in a decade",
  description:
    "Batteries got dramatically cheaper. This video explains the three forces that drove it down: bigger factories, better chemistry and fierce competition.",
  hashtags: ["#Shorts", "#Batteries", "#EnergyStorage"],
};

describe("PublishMetaSchema", () => {
  it("принимает валидные данные", () => {
    expect(PublishMetaSchema.safeParse(valid).success).toBe(true);
  });

  it("промпт обложки необязателен, но не пустышка", () => {
    const prompt = "A close-up of an ancient bronze gear mechanism glowing under a diver's torch, bold text \"LOST TECH\"";
    expect(PublishMetaSchema.safeParse({ ...valid, thumbnailPrompt: prompt }).success).toBe(true);
    expect(PublishMetaSchema.safeParse({ ...valid, thumbnailPrompt: "gears" }).success).toBe(false);
  });

  it("отклоняет слишком короткий заголовок и описание", () => {
    expect(PublishMetaSchema.safeParse({ ...valid, title: "Short" }).success).toBe(false);
    expect(PublishMetaSchema.safeParse({ ...valid, description: "Too short." }).success).toBe(false);
  });

  it("отклоняет меньше 3 и больше 8 хэштегов", () => {
    expect(PublishMetaSchema.safeParse({ ...valid, hashtags: ["#A", "#B"] }).success).toBe(false);
    expect(
      PublishMetaSchema.safeParse({ ...valid, hashtags: Array.from({ length: 9 }, (_, i) => `#Tag${i}`) }).success,
    ).toBe(false);
  });

  it("отклоняет хэштег без # и с недопустимыми символами", () => {
    expect(PublishMetaSchema.safeParse({ ...valid, hashtags: ["Batteries", "#B", "#C"] }).success).toBe(false);
    expect(PublishMetaSchema.safeParse({ ...valid, hashtags: ["#Bat-teries", "#B", "#C"] }).success).toBe(false);
  });
});
