import { describe, expect, test } from "bun:test";
import { ModelRequestError } from "@/lib/model-runtime";
import {
  getModelTransportRetryCode,
  retryModelTransport,
} from "@/lib/tools/model-transport-retry";

function transportError(code = "ECONNRESET"): ModelRequestError {
  return new ModelRequestError("LLM_UNAVAILABLE", `connection interrupted (${code})`, true, {
    evidence: { transportCode: code },
  });
}

describe("model transport retry", () => {
  test("retries once after a transport reset and returns the successful attempt", async () => {
    let calls = 0;
    const retries: string[] = [];

    const result = await retryModelTransport(
      async () => {
        calls += 1;
        if (calls === 1) throw transportError("ECONNRESET");
        return "generated";
      },
      { attempts: 2, baseDelayMs: 1, onRetry: ({ code }) => retries.push(code) },
    );

    expect(result).toBe("generated");
    expect(calls).toBe(2);
    expect(retries).toEqual(["ECONNRESET"]);
  });

  test("does not retry schema, auth, or empty-response failures", async () => {
    let calls = 0;
    await expect(
      retryModelTransport(
        async () => {
          calls += 1;
          throw new ModelRequestError("LLM_FORMAT_INVALID", "bad schema", true);
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(ModelRequestError);
    expect(calls).toBe(1);
  });

  test("finds the transport code even when fetch wraps it in a cause chain", () => {
    const wrapped = new ModelRequestError("LLM_UNAVAILABLE", "terminated", true, {
      cause: Object.assign(new TypeError("terminated"), { code: "ECONNRESET" }),
    });
    expect(getModelTransportRetryCode(wrapped)).toBe("ECONNRESET");
  });

  test("infers a retry code from undici socket-close text without a structured code", () => {
    const wrapped = new ModelRequestError(
      "LLM_UNAVAILABLE",
      "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
      true,
    );
    expect(getModelTransportRetryCode(wrapped)).toBe("UND_ERR_SOCKET");
  });

  test("stops retrying when the job is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;

    const promise = retryModelTransport(
      async () => {
        calls += 1;
        controller.abort();
        throw transportError("ECONNRESET");
      },
      { attempts: 3, baseDelayMs: 5, signal: controller.signal },
    );

    await expect(promise).rejects.toBeInstanceOf(ModelRequestError);
    expect(calls).toBe(1);
  });

  test("caps attempts and rethrows the last transport error", async () => {
    let calls = 0;
    await expect(
      retryModelTransport(
        async () => {
          calls += 1;
          throw transportError("UND_ERR_SOCKET");
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(ModelRequestError);
    expect(calls).toBe(2);
  });
});
