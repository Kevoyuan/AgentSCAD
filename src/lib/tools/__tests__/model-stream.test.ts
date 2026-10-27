import { describe, expect, test } from "bun:test";
import { ModelRequestError } from "@/lib/model-runtime";
import {
  readModelCompletionResponse,
  toModelCompletionResponseFromStream,
} from "@/lib/tools/model-router";
import { readOpenAiCompatibleStream } from "@/lib/tools/model-stream";

function sseResponse(chunks: string[], contentType = "text/event-stream; charset=utf-8"): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": contentType } },
  );
}

function chunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("OpenAI-compatible stream accumulation", () => {
  test("joins deltas split across network chunks and keeps model plus finish reason", async () => {
    const wire = [
      chunk({ model: "deepseek-v4-flash", choices: [{ delta: { role: "assistant", content: "module " }, finish_reason: null }] }),
      chunk({ choices: [{ delta: { content: "generated_part() {" }, finish_reason: null }] }),
      chunk({ choices: [{ delta: { content: " cube(1); }" }, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ].join("");
    const splitAt = Math.floor(wire.length / 2);

    const streamed = await readOpenAiCompatibleStream(
      sseResponse([wire.slice(0, splitAt), wire.slice(splitAt)]),
      { provider: "DeepSeek", model: "deepseek-v4-flash" },
    );

    expect(streamed.content).toBe("module generated_part() { cube(1); }");
    expect(streamed.finishReason).toBe("stop");
    expect(streamed.model).toBe("deepseek-v4-flash");
  });

  test("reads reasoning deltas, CRLF events, keepalive comments and usage", async () => {
    const wire = [
      ": keepalive\r\n\r\n",
      "data: " + JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking..." } }] }) + "\r\n\r\n",
      "data: " + JSON.stringify({
        choices: [{ delta: { content: "SCAD" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }) + "\r\n\r\n",
      "data: [DONE]\r\n\r\n",
    ].join("");

    const streamed = await readOpenAiCompatibleStream(sseResponse([wire]), {
      provider: "DeepSeek",
      model: "deepseek-v4-flash",
    });

    expect(streamed.content).toBe("SCAD");
    expect(streamed.reasoningContent).toBe("thinking...");
    expect(streamed.finishReason).toBe("stop");
    expect(streamed.usage).toMatchObject({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  });

  test("turns an in-stream provider error into a readable model error", async () => {
    const response = sseResponse([chunk({ error: { message: "context length exceeded" } })]);
    await expect(
      readOpenAiCompatibleStream(response, { provider: "DeepSeek" }),
    ).rejects.toThrow("context length exceeded");
  });

  test("rejects a malformed stream chunk instead of silently accepting partial CAD", async () => {
    const response = sseResponse(["data: {not-json}\n\n"]);
    await expect(
      readOpenAiCompatibleStream(response, { provider: "DeepSeek" }),
    ).rejects.toBeInstanceOf(ModelRequestError);
  });
});

describe("streamed completion mapping", () => {
  test("maps an SSE result to the standard completion shape", () => {
    const completion = toModelCompletionResponseFromStream(
      { content: "cube(1);", finishReason: "stop" },
      "DeepSeek",
      "deepseek-v4-flash",
    );
    expect(completion.content).toBe("cube(1);");
    expect(completion.provider).toBe("DeepSeek");
    expect(completion.model).toBe("deepseek-v4-flash");
    expect(completion.responseLength).toBe(8);
  });

  test("treats a length-limited empty stream as truncated output", () => {
    expect(() =>
      toModelCompletionResponseFromStream({ content: "  ", finishReason: "length" }, "DeepSeek", "m"),
    ).toThrow("truncated");
  });

  test("falls back to hidden reasoning content, matching the JSON path", () => {
    const completion = toModelCompletionResponseFromStream(
      { content: "  ", reasoningContent: "reasoned", finishReason: "stop" },
      "DeepSeek",
      "m",
    );
    expect(completion.content).toBe("reasoned");
  });
});

describe("provider response reader", () => {
  test("parses a JSON body when the provider ignores stream:true", async () => {
    const response = new Response(
      JSON.stringify({
        model: "deepseek-v4-flash",
        choices: [{ message: { content: "cube(2);" }, finish_reason: "stop" }],
      }),
      { headers: { "content-type": "application/json" } },
    );

    const completion = await readModelCompletionResponse(response, {
      stream: true,
      providerLabel: "DeepSeek",
      fallbackModel: "deepseek-v4-flash",
    });
    expect(completion.content).toBe("cube(2);");
  });

  test("parses an SSE body when streaming is enabled", async () => {
    const response = sseResponse([
      chunk({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]);

    const completion = await readModelCompletionResponse(response, {
      stream: true,
      providerLabel: "DeepSeek",
      fallbackModel: "deepseek-v4-flash",
    });
    expect(completion.content).toBe("ok");
  });
});
