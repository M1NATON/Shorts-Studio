import { describe, expect, it } from "vitest";
import { HOOK_TARGET_CHARS, outline, outlineSystem } from "./outline.js";
import { narrationTells, skill } from "./skills.js";
import { fakeLlm, testContext } from "./test-helpers.js";

describe("skills", () => {
  it("loads skill bodies without frontmatter", () => {
    expect(skill("narration")).toMatch(/^# Writing the voiceover/);
    expect(skill("on-screen")).toMatch(/^# Designing the frame/);
  });

  it("narration skill: хук короткий и явно разрешает открытый вопрос, если он закрыт позже", () => {
    expect(skill("narration")).toMatch(/8-10 words max/);
    expect(skill("narration")).toMatch(/Open loop/);
    expect(skill("narration")).toMatch(/never answers is a bug/);
  });

  it("flags AI tells and passes plain sentences", () => {
    expect(narrationTells("It's not just a battery, it's a revolution.")).toHaveLength(1);
    expect(narrationTells("This is not a battery story. It's a chemistry story.")).toHaveLength(1);
    expect(narrationTells("Prices fell — fast.")).toHaveLength(1);
    expect(narrationTells("Let's dive into a pivotal shift.").length).toBe(2);
    expect(narrationTells("Experts say it matters.")).toHaveLength(1);
    expect(narrationTells("In 2023, pack prices fell to $139 per kWh, down 14 percent in a year.")).toEqual([]);
    expect(narrationTells("China built 216 GW of solar, not the EU.")).toEqual([]);
  });

  it("outline system: хук короче остальных тезисов и требует петлю в конце", () => {
    const system = outlineSystem("2026-09-19", 8);
    expect(system).toContain(`${HOOK_TARGET_CHARS.min}-${HOOK_TARGET_CHARS.max} characters`);
    expect(system).toMatch(/8-10 words/);
    expect(system).toMatch(/Ending:/);
    expect(system).toMatch(/never a dangling fragment/);
    expect(system).toMatch(/No spoken call to action/);
  });

  it("outline retries once with tells as feedback, then accepts", async () => {
    const beats = Array.from({ length: 6 }, (_, i) => ({ narration: `It's not just cheap, it's a revolution number ${i}.`, intent: "fact" }));
    const llm = fakeLlm(() => ({ title: "Batteries", beats }));
    const result = await outline(testContext(llm), "batteries", "", 6);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]!.system).toContain("# Writing the voiceover");
    expect(llm.calls[1]!.user).toMatch(/beat 1: .*state Y directly/);
    expect(result.beats).toHaveLength(6);
  });
});
