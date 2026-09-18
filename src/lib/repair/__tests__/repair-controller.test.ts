import { describe, expect, test } from "bun:test";
import { assertRepairCompletionUsable } from "@/lib/repair/repair-controller";
import type { ModelCompletionResponse } from "@/lib/tools/model-router";

function completion(overrides: Partial<ModelCompletionResponse> = {}): ModelCompletionResponse {
  return {
    content: "// repaired\nbody_length = 158;\ngenerated_part();\n",
    model: "deepseek-flash",
    provider: "DeepSeek",
    finishReason: "stop",
    responseLength: 0,
    rawSnippet: "",
    ...overrides,
  };
}

describe("repair completion guard", () => {
  test("accepts a complete repair reply", () => {
    expect(() => assertRepairCompletionUsable(completion())).not.toThrow();
  });

  test("rejects a repair reply cut off mid-file by the output budget", () => {
    // Regression: a truncated reply (source ending mid-assignment) used to be
    // persisted as valid SCAD and only failed later inside the OpenSCAD renderer.
    expect(() =>
      assertRepairCompletionUsable(
        completion({
          content: "// iPhone 18 Duo\nbody_length = 158;\nbutton_chamfer",
          finishReason: "length",
          responseLength: 1325,
        })
      )
    ).toThrow("cut off before it finished");
  });

  test("rejects an empty reply and reports the truncation code", () => {
    try {
      assertRepairCompletionUsable(
        completion({ content: "", finishReason: "length", responseLength: 0 })
      );
      throw new Error("expected the guard to throw");
    } catch (error) {
      const failure = error as { code?: string; evidence?: { responseLength?: number } };
      expect(failure.code).toBe("LLM_OUTPUT_TRUNCATED");
      expect(failure.evidence?.responseLength).toBe(0);
    }
  });

  test("rejects an empty reply without a length finish reason", () => {
    expect(() =>
      assertRepairCompletionUsable(completion({ content: "   ", finishReason: "stop" }))
    ).toThrow("returned no content");
  });
});
