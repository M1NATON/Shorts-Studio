import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, VISUAL_BLOCKS, visualSpecSchemaFor } from "@shorts/contracts";
import { KIND_DEFAULTS, NEW_BLOCK } from "./visual-defaults";

describe("заготовки редактора кадра", () => {
  it("каждый тип кадра из заготовки проходит схему", () => {
    for (const [kind, spec] of Object.entries(KIND_DEFAULTS)) {
      const result = visualSpecSchemaFor("shorts").safeParse(spec);
      expect(result.success, `${kind}: ${result.error?.issues.map((i) => i.message).join("; ")}`).toBe(true);
    }
  });

  it("каждый новый блок рядом с заголовком даёт валидный кадр", () => {
    for (const type of BLOCK_TYPES) {
      const blocks = [{ block: "heading", text: "Title", at: 0 }, { ...NEW_BLOCK[type], at: 0.2 }];
      // Кадру нужен визуальный блок, а разделителю — сосед снизу.
      if (!VISUAL_BLOCKS.has(type)) blocks.push({ block: "icon", icon: "zap", at: 0.3 } as never);
      const result = visualSpecSchemaFor("landscape").safeParse({ kind: "composed", blocks });
      expect(result.success, `${type}: ${result.error?.issues.map((i) => i.message).join("; ")}`).toBe(true);
    }
  });
});
