import { describe, expect, test } from "bun:test";
import { unpackProviderChatCompletionResponse } from "@/lib/tools/model-router";
import { ModelRequestError } from "@/lib/model-runtime";

describe("model-router response unpacking & diagnostics", () => {
  test("extracts text content from standard OpenAI-compatible choices", () => {
    const response = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "{\n  \"part_type\": \"bracket\"\n}\n```scad\ncube([10, 10, 10]);\n```",
          },
        },
      ],
    };
    const content = unpackProviderChatCompletionResponse(response, "TestProvider");
    expect(content).toContain("cube([10, 10, 10]);");
  });

  test("extracts text content when message.content is an array of text parts", () => {
    const response = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "{\n  \"part_type\": \"stand\"\n}" },
              { type: "text", text: "```scad\ncube([20, 20, 5]);\n```" },
            ],
          },
        },
      ],
    };
    const content = unpackProviderChatCompletionResponse(response, "TestProvider");
    expect(content).toContain("cube([20, 20, 5]);");
  });

  test("throws ModelRequestError with finish_reason length when output is truncated and empty", () => {
    const response = {
      choices: [
        {
          finish_reason: "length",
          message: { role: "assistant", content: null },
        },
      ],
    };
    expect(() => unpackProviderChatCompletionResponse(response, "TestProvider")).toThrow(
      ModelRequestError
    );
    try {
      unpackProviderChatCompletionResponse(response, "DeepSeek");
    } catch (err) {
      const modelErr = err as ModelRequestError;
      expect(["LLM_OUTPUT_TRUNCATED", "LLM_UNAVAILABLE"]).toContain(modelErr.code);
      expect(modelErr.message).toContain("finish_reason: length");
      expect(modelErr.evidence?.finishReason).toBe("length");
    }
  });

  test("throws ModelRequestError when API response contains error object", () => {
    const errorResponse = {
      error: {
        message: "API key rate limit exceeded",
        code: "rate_limit_exceeded",
      },
    };
    try {
      unpackProviderChatCompletionResponse(errorResponse, "DeepSeek");
    } catch (err) {
      const modelErr = err as ModelRequestError;
      expect(modelErr.code).toBe("LLM_RATE_LIMITED");
      expect(modelErr.message).toContain("API key rate limit exceeded");
    }
  });

  test("throws ModelRequestError when choices array is empty", () => {
    const response = { choices: [] };
    expect(() => unpackProviderChatCompletionResponse(response, "MiMo")).toThrow(
      "MiMo returned no output content or choices."
    );
  });
});
