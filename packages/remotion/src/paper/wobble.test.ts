import { describe, expect, it } from "vitest";
import { wobble, type Point } from "./wobble.js";

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("wobble", () => {
  it("детерминирована: одинаковый вход даёт одинаковый выход", () => {
    expect(wobble(square, "seed", 3, 10)).toEqual(wobble(square, "seed", 3, 10));
  });

  it("остаётся неизменной внутри одного 4-кадрового бакета", () => {
    expect(wobble(square, "seed", 3, 0)).toEqual(wobble(square, "seed", 3, 3));
  });

  it("меняется между кадром 3 и кадром 4 — новый бакет", () => {
    expect(wobble(square, "seed", 3, 3)).not.toEqual(wobble(square, "seed", 3, 4));
  });

  it("разный seed даёт разное дрожание", () => {
    expect(wobble(square, "a", 3, 10)).not.toEqual(wobble(square, "b", 3, 10));
  });

  it("amount=0 не смещает точки", () => {
    expect(wobble(square, "seed", 0, 10)).toEqual(square);
  });
});
