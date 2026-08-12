import { describe, expect, test } from "bun:test";

import {
  createModelRequestSignal,
  getModelRequestTimeoutMs,
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
});
