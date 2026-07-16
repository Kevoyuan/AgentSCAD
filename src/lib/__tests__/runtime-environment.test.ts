import { describe, expect, test } from "bun:test";
import { isEphemeralRuntime } from "@/lib/runtime-environment";

describe("runtime environment", () => {
  test("detects Vercel and Lambda without depending on storage modules", () => {
    expect(
      isEphemeralRuntime({
        NODE_ENV: "test",
        VERCEL: "1",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isEphemeralRuntime({
        NODE_ENV: "test",
        AWS_LAMBDA_FUNCTION_NAME: "agentscad",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isEphemeralRuntime({ NODE_ENV: "test" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});
