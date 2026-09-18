import { describe, expect, test } from "bun:test";

import {
  createControlledSnippet,
  createModelRequestSignal,
  getModelRequestTimeoutMs,
  ModelRequestError,
  normalizeModelRequestError,
} from "@/lib/model-runtime";

describe("model runtime", () => {
  test("has no application timeout by default and supports explicit overrides", () => {
    expect(getModelRequestTimeoutMs({})).toBeNull();
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "" })).toBeNull();
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "0" })).toBeNull();
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "60000" })).toBe(60_000);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "100" })).toBe(5_000);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "999999" })).toBe(999_999);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "invalid" })).toBeNull();
  });

  test("does not create a timeout signal unless one is explicitly requested", () => {
    expect(createModelRequestSignal(undefined, null)).toBeUndefined();
    const caller = new AbortController();
    expect(createModelRequestSignal(caller.signal, null)).toBe(caller.signal);
    expect(createModelRequestSignal(undefined, 60_000)).toBeInstanceOf(AbortSignal);
  });

  test("classifies timeout, authentication, rate-limit, and provider failures", () => {
    expect(normalizeModelRequestError(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      90_000,
    )).toMatchObject({ code: "LLM_TIMEOUT", retryable: true });

    expect(normalizeModelRequestError(new Error("Provider request failed (401)"))).toMatchObject({
      code: "LLM_AUTH_ERROR",
      retryable: false,
    });

    expect(normalizeModelRequestError(new Error("Provider request failed (429)"))).toMatchObject({
      code: "LLM_RATE_LIMITED",
      retryable: true,
    });

    expect(normalizeModelRequestError(new Error("socket closed"))).toMatchObject({
      code: "LLM_UNAVAILABLE",
      retryable: true,
    });
  });

  test("creates controlled snippet without unbounded string explosion", () => {
    expect(createControlledSnippet("")).toBe("");
    expect(createControlledSnippet(null)).toBe("");
    const shortText = "```scad\ncube([10, 10, 10]);\n```";
    expect(createControlledSnippet(shortText, 100)).toBe(shortText);

    const longText = "A".repeat(500) + "MIDDLE" + "B".repeat(500);
    const snippet = createControlledSnippet(longText, 200);
    expect(snippet.length).toBeLessThan(longText.length);
    expect(snippet).toContain("[truncated");
    expect(snippet.startsWith("AAAA")).toBe(true);
    expect(snippet.endsWith("BBBB")).toBe(true);

    const errorWithEvidence = new ModelRequestError(
      "LLM_OUTPUT_TRUNCATED",
      "Output truncated",
      true,
      {
        evidence: {
          model: "deepseek-flash",
          finishReason: "length",
          responseLength: 1006,
          rawSnippet: snippet,
        },
      },
    );
    expect(errorWithEvidence.code).toBe("LLM_OUTPUT_TRUNCATED");
    expect(errorWithEvidence.evidence?.finishReason).toBe("length");
    expect(errorWithEvidence.evidence?.model).toBe("deepseek-flash");
  });
});

