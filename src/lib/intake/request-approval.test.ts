import { describe, expect, test } from "bun:test";

import {
  approveCadRequestInterpretation,
  approvePersistedCadRequestInterpretation,
  buildApprovedGenerationRequest,
  restoreApprovedRequestIntelligence,
  restorePersistedRequestIntelligence,
} from "./request-approval";
import { normalizeModelRequestIntelligence } from "./model-request-intelligence";

describe("request intent approval", () => {
  test("turns a valid ambiguous option into auditable user-approved intent", () => {
    const approved = approveCadRequestInterpretation(
      "行星发动机模型",
      "planetary_gear_motor",
      "2026-08-01T00:00:00.000Z",
    );

    expect(approved).toMatchObject({
      status: "MATCHED",
      requiresClarification: false,
      confidence: 1,
      approval: {
        source: "user",
        selectedInterpretationId: "planetary_gear_motor",
      },
    });
    expect(approved.interpretations[0]?.id).toBe("planetary_gear_motor");
    expect(approved.assumptions).toEqual([]);
  });

  test("restores approval only while it still belongs to the same request", () => {
    const approved = approveCadRequestInterpretation(
      "行星发动机模型",
      "planetary_propulsion_megastructure",
    );

    expect(restoreApprovedRequestIntelligence("行星发动机模型", JSON.stringify(approved)))
      .toMatchObject({ approval: { selectedInterpretationId: "planetary_propulsion_megastructure" } });
    expect(restoreApprovedRequestIntelligence("完全不同的请求", JSON.stringify(approved))).toBeNull();
    expect(restoreApprovedRequestIntelligence("行星发动机模型", "not-json")).toBeNull();
  });

  test("adds the approved meaning to generation context without changing the original text", () => {
    const approved = approveCadRequestInterpretation(
      "行星发动机模型",
      "planetary_gear_motor",
    );
    const generationRequest = buildApprovedGenerationRequest("行星发动机模型", approved);

    expect(generationRequest.startsWith("行星发动机模型\n")).toBe(true);
    expect(generationRequest).toContain("User-approved interpretation");
    expect(generationRequest).toContain("planetary_gear_motor");
    expect(generationRequest).toContain("行星齿轮电机/减速机构");
  });

  test("rejects unknown or already-unambiguous selections", () => {
    expect(() => approveCadRequestInterpretation("行星发动机模型", "missing"))
      .toThrow("not a valid option");
    expect(() => approveCadRequestInterpretation("带太阳轮的行星齿轮电机", "planetary_gear_motor"))
      .toThrow("not a valid option");
  });

  test("approves a validated model-derived ambiguity without another model call", () => {
    const persisted = JSON.stringify({
      version: 1,
      rawRequest: "做一个火星基地接口",
      normalizedRequest: "做一个火星基地接口",
      language: "zh",
      status: "AMBIGUOUS",
      concepts: [{ id: "mars_base", label: "火星基地", evidence: ["火星基地"], source: "llm" }],
      interpretations: [
        { id: "display_model", label: "科幻展示模型", domain: "concept", objectKind: "diorama", probability: 0.5, evidence: ["火星基地"], conflicts: [] },
        { id: "mechanical_interface", label: "机械连接接口", domain: "mechanical", objectKind: "adapter", probability: 0.5, evidence: ["接口"], conflicts: [] },
      ],
      clarificationQuestion: "你要科幻展示模型，还是带尺寸约束的机械连接接口？",
      requiresClarification: true,
      confidence: 0.7,
      assumptions: [],
      suggestedMode: "unknown",
      matchedGroupId: null,
      brief: { summary: "火星基地接口", intendedUse: "unknown", requiredFeatures: [], explicitConstraints: [], acceptanceCriteria: [] },
    });

    const approved = approvePersistedCadRequestInterpretation(
      "做一个火星基地接口",
      persisted,
      "mechanical_interface",
    );
    expect(approved.interpretations[0]?.id).toBe("mechanical_interface");
    expect(approved.approval.source).toBe("user");
    expect(restoreApprovedRequestIntelligence("做一个火星基地接口", JSON.stringify(approved)))
      .toMatchObject({ status: "MATCHED", approval: { selectedInterpretationId: "mechanical_interface" } });
  });

  test("restores a validated model-derived match only for the same request", () => {
    const persisted = JSON.stringify(normalizeModelRequestIntelligence("custom flange", {
      status: "MATCHED",
      confidence: 0.9,
      interpretations: [{
        id: "custom_flange",
        label: "Custom flange",
        domain: "mechanical",
        object_kind: "flange",
        probability: 1,
        evidence: ["flange"],
      }],
      brief: { summary: "A custom flange" },
    }));

    expect(restorePersistedRequestIntelligence("custom flange", persisted)?.status).toBe("MATCHED");
    expect(restorePersistedRequestIntelligence("different request", persisted)).toBeNull();
  });
});
