import { describe, expect, test } from "bun:test";
import {
  buildOpenScadDefineArgs,
  collectOpenScadWarnings,
  countStlTriangles,
} from "@/lib/tools/scad-renderer";
import { usesOpenScadWasm } from "@/lib/tools/openscad-backend";

describe("scad-renderer", () => {
  test("counts ASCII and binary STL triangles", () => {
    // OpenSCAD writes ASCII STL by default; the binary-only reader reported 0
    // triangles for every native render and failed C001 on healthy geometry.
    const asciiStl = Buffer.from(
      [
        "solid model",
        " facet normal 0 0 1",
        "  outer loop",
        "   vertex 0 0 0",
        "   vertex 1 0 0",
        "   vertex 0 1 0",
        "  endloop",
        " endfacet",
        " facet normal 0 1 0",
        " endfacet",
        "endsolid model",
      ].join("\n"),
      "utf8"
    );
    expect(countStlTriangles(asciiStl)).toBe(2);

    const binaryStl = Buffer.alloc(84 + 3 * 50);
    binaryStl.writeUInt32LE(3, 80);
    expect(countStlTriangles(binaryStl)).toBe(3);

    expect(countStlTriangles(Buffer.alloc(0))).toBe(0);
  });

  test("keeps OpenSCAD diagnostics that explain a degraded render", () => {
    const output = [
      "WARNING: Can't open include file 'agentscad_std.scad'.",
      "WARNING: Ignoring unknown module 'mounting_plate' in file model.scad , line 4",
      "Geometries in cache: 1",
      "WARNING: Can't open include file 'agentscad_std.scad'.",
    ].join("\n");

    const warnings = collectOpenScadWarnings(output, undefined);
    expect(warnings).toEqual([
      "WARNING: Can't open include file 'agentscad_std.scad'.",
      "WARNING: Ignoring unknown module 'mounting_plate' in file model.scad , line 4",
    ]);
  });

  test("builds shell-safe OpenSCAD define args for primitive parameter values", () => {
    const args = buildOpenScadDefineArgs({
      width: 42,
      centered: true,
      label: 'left "bracket" $HOME',
      bad_key: 10,
      "bad-key": 20,
      ignored: { nested: true },
      alsoIgnored: Number.NaN,
    });

    expect(args).toContain('-D "width=42"');
    expect(args).toContain('-D "centered=true"');
    expect(args).toContain('-D "label=\\"left \\\\\\"bracket\\\\\\" \\$HOME\\""');
    expect(args).toContain('-D "bad_key=10"');
    expect(args).not.toContain("bad-key");
    expect(args).not.toContain("ignored=");
    expect(args).not.toContain("alsoIgnored=");
  });

  test("selects native and WASM backends deterministically", () => {
    const previous = {
      backend: process.env.AGENTSCAD_OPENSCAD_BACKEND,
      vercel: process.env.VERCEL,
      lambda: process.env.AWS_LAMBDA_FUNCTION_NAME,
    };
    try {
      process.env.VERCEL = "1";
      process.env.AGENTSCAD_OPENSCAD_BACKEND = "native";
      expect(usesOpenScadWasm()).toBe(false);

      process.env.AGENTSCAD_OPENSCAD_BACKEND = "wasm";
      delete process.env.VERCEL;
      expect(usesOpenScadWasm()).toBe(true);

      delete process.env.AGENTSCAD_OPENSCAD_BACKEND;
      process.env.AWS_LAMBDA_FUNCTION_NAME = "agentscad";
      expect(usesOpenScadWasm()).toBe(true);

      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      expect(usesOpenScadWasm()).toBe(false);
    } finally {
      if (previous.backend === undefined) {
        delete process.env.AGENTSCAD_OPENSCAD_BACKEND;
      } else {
        process.env.AGENTSCAD_OPENSCAD_BACKEND = previous.backend;
      }
      if (previous.vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous.vercel;
      if (previous.lambda === undefined) {
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      } else {
        process.env.AWS_LAMBDA_FUNCTION_NAME = previous.lambda;
      }
    }
  });
});
