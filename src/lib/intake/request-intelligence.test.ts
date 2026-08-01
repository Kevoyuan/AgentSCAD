import { describe, expect, test } from "bun:test";

import { analyzeCadRequest, normalizeCadRequest } from "./request-intelligence";

describe("request intelligence", () => {
  test("normalizes Unicode and whitespace without translating user intent", () => {
    expect(normalizeCadRequest("  PLANETARY　ENGINE\n模型  ")).toBe("planetary engine 模型");
  });

  test("keeps 行星发动机模型 ambiguous and asks the frozen question", () => {
    const result = analyzeCadRequest("行星发动机模型");
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.requiresClarification).toBe(true);
    expect(result.interpretations.map((item) => item.id)).toEqual([
      "planetary_propulsion_megastructure",
      "planetary_gear_motor",
    ]);
    expect(result.clarificationQuestion).toBe(
      "你指的是行星推进用的科幻巨型发动机，还是行星齿轮电机/减速机构？",
    );
    expect(result.suggestedMode).toBe("unknown");
    expect(result.assumptions).toEqual([]);
  });

  test("mechanical evidence ranks the planetary gear interpretation first", () => {
    const result = analyzeCadRequest("设计一个带太阳轮、齿圈和减速输出的行星齿轮电机");
    expect(result.status).toBe("MATCHED");
    expect(result.interpretations[0]?.id).toBe("planetary_gear_motor");
    expect(result.interpretations[0]?.evidence).toContain("太阳轮");
    expect(result.requiresClarification).toBe(false);
  });

  test("science-fiction evidence ranks the propulsion megastructure first", () => {
    const result = analyzeCadRequest("做一个流浪地球风格的巨型推进行星发动机");
    expect(result.status).toBe("MATCHED");
    expect(result.interpretations[0]?.id).toBe("planetary_propulsion_megastructure");
    expect(result.interpretations[0]?.evidence).toContain("流浪地球");
  });

  test("unknown requests stay unknown instead of borrowing an arbitrary meaning", () => {
    const result = analyzeCadRequest("做一个从未见过的量子花瓶结构");
    expect(result.status).toBe("UNKNOWN");
    expect(result.interpretations).toEqual([]);
    expect(result.requiresClarification).toBe(true);
    expect(result.confidence).toBe(0);
  });
});
