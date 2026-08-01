import { describe, expect, test } from "bun:test";

import { normalizeModelRequestIntelligence } from "./model-request-intelligence";

describe("model request intelligence normalization", () => {
  test("accepts a bounded generic ambiguity brief", () => {
    const result = normalizeModelRequestIntelligence("做一个火星基地接口", {
      status: "AMBIGUOUS",
      confidence: 0.7,
      interpretations: [
        { id: "display_model", label: "科幻展示模型", domain: "concept", objectKind: "diorama", probability: 0.5, evidence: ["火星基地"] },
        { id: "mechanical_interface", label: "机械连接接口", domain: "mechanical", objectKind: "adapter", probability: 0.5, evidence: ["接口"] },
      ],
      clarificationQuestion: "你要科幻展示模型，还是带尺寸约束的机械连接接口？",
      concepts: [{ id: "mars_base", label: "火星基地", evidence: ["火星基地"] }],
      assumptions: [],
      brief: { summary: "Ambiguous interface request", requiredFeatures: ["interface"] },
    });

    expect(result.status).toBe("AMBIGUOUS");
    expect(result.interpretations).toHaveLength(2);
    expect(result.concepts[0]?.source).toBe("llm");
    expect(result.requiresClarification).toBe(true);
  });

  test("degrades malformed or unsupported output to UNKNOWN", () => {
    expect(normalizeModelRequestIntelligence("做个零件", { status: "AMBIGUOUS", interpretations: [] }))
      .toMatchObject({ status: "UNKNOWN", interpretations: [], requiresClarification: false });
    expect(normalizeModelRequestIntelligence("做个零件", "not-json").status).toBe("UNKNOWN");
  });

  test("drops evidence that is not a substring of the user request", () => {
    const result = normalizeModelRequestIntelligence("做一个机械接口", {
      status: "MATCHED",
      confidence: 0.9,
      interpretations: [{
        id: "adapter",
        label: "机械适配器",
        domain: "mechanical",
        objectKind: "adapter",
        probability: 1,
        evidence: ["机械接口", "用户从未说过的事实"],
      }],
    });
    expect(result.interpretations[0]?.evidence).toEqual(["机械接口"]);
  });
});
