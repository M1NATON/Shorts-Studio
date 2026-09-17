import { describe, expect, it } from "vitest";
import { IconNameSchema } from "@shorts/contracts";
import { resolveIcon } from "./Icon.js";

describe("реестр иконок", () => {
  it("каждое имя из IconNameSchema существует в lucide-react", () => {
    const missing = IconNameSchema.options.filter((name) => !resolveIcon(name));
    expect(missing).toEqual([]);
  });

  it("в схеме нет дублей", () => {
    const names = IconNameSchema.options;
    expect(new Set(names).size).toBe(names.length);
  });
});
