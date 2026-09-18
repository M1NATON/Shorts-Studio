import { describe, expect, it } from "vitest";
import type { SceneVersion } from "./api";
import { pendingVariants } from "./variants";

const v = (id: string, createdAt: string, origin: SceneVersion["origin"], batchId: string | null = null) =>
  ({ id, createdAt, origin, batchId }) as SceneVersion;

describe("pendingVariants", () => {
  const history = [v("ai", "t1", "ai"), v("a1", "t2", "variant", "A"), v("a2", "t2", "variant", "A")];

  it("shows the newest batch until one of it is chosen", () => {
    expect(pendingVariants(history, "ai").map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(pendingVariants(history, "a1")).toEqual([]);
    expect(pendingVariants(history, "a2")).toEqual([]);
  });

  it("a new batch after a choice is pending again; a later manual edit closes it", () => {
    const more = [...history, v("b1", "t3", "variant", "B"), v("b2", "t3", "variant", "B")];
    expect(pendingVariants(more, "a1").map((x) => x.id)).toEqual(["b1", "b2"]);
    expect(pendingVariants([...more, v("m", "t4", "manual")], "m")).toEqual([]);
  });
});
