import { describe, expect, test } from "bun:test";
import { isRepairableScadCompileError,annotateScadCompileError } from "@/lib/tools/scad-compile-error";

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

test("compile feedback locates protocol debris while preserving raw source and operational errors",()=>{
  const token="</｜｜DSML｜｜ calls>";
  const source=`// ${token}\necho("${token}");\n/* ${token} */\ncube(1);\n${token}`;
  const original=new Error("ERROR: Parser error: syntax error, line 5");
  const annotated=annotateScadCompileError(original,source) as Error;
  expect(annotated.message).toContain("1 protocol tags");
  expect(annotated.message).toContain(`line 5: ${token}`);
  expect((annotated as Error & {cause:unknown}).cause).toBe(original);
  expect(annotateScadCompileError(annotated,source)).toBe(annotated);
  expect(annotateScadCompileError(original,`/* unfinished comment ${token}`)).toBe(original);
  for(const message of ["OpenSCAD timed out", "spawn openscad ENOENT", "renderer is busy", "integrity check failed"]){
    const error=new Error(message);
    expect(annotateScadCompileError(error,source)).toBe(error);
  }
  const many=annotateScadCompileError(original,Array(20).fill(token).join("\n")) as Error;
  expect(many.message).toContain("20 protocol tags");
  expect(many.message).not.toContain("line 9:");
});
