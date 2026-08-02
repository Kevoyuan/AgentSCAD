import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
  getModelRequestTimeoutMs,
  normalizeModelRequestError,
} from "@/lib/model-runtime";

describe("model runtime", () => {
  test("uses a complex-generation-friendly timeout with bounded overrides", () => {
    expect(getModelRequestTimeoutMs({})).toBe(DEFAULT_MODEL_REQUEST_TIMEOUT_MS);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "60000" })).toBe(60_000);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "100" })).toBe(5_000);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "999999" })).toBe(240_000);
    expect(getModelRequestTimeoutMs({ AGENTSCAD_LLM_TIMEOUT_MS: "invalid" })).toBe(
      DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
    );
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
});
