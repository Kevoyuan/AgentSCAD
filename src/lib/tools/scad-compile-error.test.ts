import { describe, expect, test } from "bun:test";
import { isRepairableScadCompileError } from "@/lib/tools/scad-compile-error";

describe("OpenSCAD compile error classification", () => {
  test("repairs only source diagnostics, not runtime infrastructure failures", () => {
    expect(isRepairableScadCompileError(new Error("CGAL error in applyHull(): assertion violation"))).toBe(true);
    expect(isRepairableScadCompileError(new Error("Parser error: syntax error"))).toBe(true);
    expect(isRepairableScadCompileError(new Error("OpenSCAD WASM renderer is busy; retry this render shortly"))).toBe(false);
    expect(isRepairableScadCompileError(new Error("Bundled OpenSCAD WASM failed its integrity check"))).toBe(false);
    expect(isRepairableScadCompileError(new Error("OpenSCAD WASM render timed out after 120 seconds"))).toBe(false);
    expect(isRepairableScadCompileError(new Error("unknown renderer fault"))).toBe(false);
    expect(isRepairableScadCompileError("Current top level object is empty")).toBe(true);
  });
});
