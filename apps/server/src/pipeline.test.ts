import { describe, expect, it } from "vitest";
import type { PexelsCandidate } from "@shorts/media-core";
import { nextCandidate } from "./pipeline.js";

const page = (...ids: number[]) =>
  ids.map((pexelsId) => ({ pexelsId, url: "", width: 1, height: 1, credit: { name: "", url: "" } }) as PexelsCandidate);

describe("nextCandidate", () => {
  const pages: Record<number, PexelsCandidate[]> = { 1: page(1, 2), 2: page(3, 4), 3: [] };
  const search = async (n: number) => pages[n] ?? [];

  it("идёт дальше через границу страниц и по кругу", async () => {
    expect((await nextCandidate(search, 1))?.pexelsId).toBe(2);
    expect((await nextCandidate(search, 2))?.pexelsId).toBe(3);
    expect((await nextCandidate(search, 3))?.pexelsId).toBe(4);
    expect((await nextCandidate(search, 4))?.pexelsId).toBe(1);
    expect((await nextCandidate(search, 99))?.pexelsId).toBe(1);
  });

  it("единственный кандидат — нечего предложить", async () => {
    expect(await nextCandidate(async (n) => (n === 1 ? page(7) : []), 7)).toBeUndefined();
  });
});
