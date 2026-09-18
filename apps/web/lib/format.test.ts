import { describe, expect, it } from "vitest";
import { formatDuration, timeAgo } from "./format";

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(92)).toBe("1:32");
    expect(formatDuration(5)).toBe("0:05");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-09-18T12:00:00Z").getTime();

  it("шаг в минутах и часах", () => {
    expect(timeAgo(new Date(now - 30_000).toISOString(), now)).toBe("только что");
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 мин назад");
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3 ч назад");
  });

  it("больше суток — короткая дата", () => {
    expect(timeAgo(new Date(now - 2 * 24 * 3600_000).toISOString(), now)).toBe("16 сент");
  });
});
