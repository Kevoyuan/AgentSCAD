import { describe, expect, test } from "bun:test";
import { getOpenScadTimeoutMs, isOpenScadExecTimeoutKill, OpenScadTimeoutError, toOpenScadExecError } from "../scad-timeout";

describe("OpenSCAD budgets", () => {
  test("defaults and bounds native configuration", () => {
    expect(getOpenScadTimeoutMs({})).toBe(300000);
    for (const value of ["bad", "0", "-1", "Infinity"]) expect(getOpenScadTimeoutMs({ AGENTSCAD_OPENSCAD_TIMEOUT_MS: value })).toBe(300000);
    expect(getOpenScadTimeoutMs({ AGENTSCAD_OPENSCAD_TIMEOUT_MS: "1" })).toBe(5000);
    expect(getOpenScadTimeoutMs({ AGENTSCAD_OPENSCAD_TIMEOUT_MS: "3000000" })).toBe(3000000);
    expect(getOpenScadTimeoutMs({ AGENTSCAD_OPENSCAD_TIMEOUT_MS: "99999999" })).toBe(3000000);
  });
  test("classifies the observed SIGTERM and preserves diagnostics", () => {
    const error = toOpenScadExecError({ error: Object.assign(new Error("Command failed"), {
      killed: true, signal: "SIGTERM", code: null, stderr: "WARNING: diagnostic", stdout: "progress",
    }), stage: "validation", timeoutMs: 120000, elapsedMs: 120041, prefix: "Validation" });
    expect(error).toBeInstanceOf(OpenScadTimeoutError);
    expect(error.message).toContain("120s");
    expect(error.message).toContain("WARNING: diagnostic");
    expect(error.message).toContain("progress");
    expect(error.message).toContain("Simplify");
  });
  test("does not misclassify maxBuffer or external signals as budget exhaustion", () => {
    expect(isOpenScadExecTimeoutKill({ killed: true, signal: "SIGTERM", code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })).toBe(false);
    expect(isOpenScadExecTimeoutKill({ signal: "SIGTERM", code: null })).toBe(false);
    expect(isOpenScadExecTimeoutKill({ code: "ETIMEDOUT" })).toBe(true);
  });
  test("WASM advice does not suggest a native-only configuration", () => {
    const error = new OpenScadTimeoutError({ stage: "render", timeoutMs: 120000, elapsedMs: 120100, backend: "wasm" });
    expect(error.message).toContain("fixed at 120s");
    expect(error.message).not.toContain("AGENTSCAD_OPENSCAD_TIMEOUT_MS");
  });
});
