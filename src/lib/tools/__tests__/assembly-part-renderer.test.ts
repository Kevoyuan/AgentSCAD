import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import { renderAssemblyParts, renderAssemblySpecParts } from "../assembly-part-renderer";

const stl = Buffer.alloc(134);
stl.writeUInt32LE(1, 80);
stl.writeFloatLE(1, 108);
stl.writeFloatLE(1, 124);

describe("isolated assembly part rendering", () => {
  test("selects each unique part without publishing to the job artifact directory", async () => {
    const selectors: unknown[] = [];
    let sourcePath = "";
    const parts = await renderAssemblyParts({
      scadSource: 'agentscad_part=""; cube(1);', parts: [{ partId: "base", selector: "base_selector" }, { partId: "arm", selector: "arm_selector" }],
      parameters: { motion_angle: 90, agentscad_part: "ignored_override" },
      render: async (source, output, definitions) => {
        sourcePath = source;
        selectors.push(definitions?.agentscad_part);
        expect(definitions?.motion_angle).toBe(90);
        await fs.writeFile(output, stl);
        return "";
      },
    });
    expect(selectors).toEqual(["base_selector", "arm_selector"]);
    expect(parts.map(part => part.partId)).toEqual(["base", "arm"]);
    expect(parts[0].triangleCount).toBe(1);
    expect(await fs.stat(sourcePath).then(() => true, () => false)).toBe(false);
  });

  test("rejects invalid identifiers and incomplete renders", async () => {
    await expect(renderAssemblyParts({ scadSource: "cube(1);", parts: [{ partId: "../escape", selector: "a" }] })).rejects.toThrow();
    await expect(renderAssemblyParts({ scadSource: "cube(1);", parts: [{ partId: "a", selector: "a" }, { partId: "a", selector: "b" }] })).rejects.toThrow();
    await expect(renderAssemblyParts({ scadSource: "cube(1);", parts: [{ partId: "a", selector: "a" }], render: async (_source, output) => {
      await fs.writeFile(output, "");
      return "";
    } })).rejects.toThrow("empty or invalid STL");
    await expect(renderAssemblyParts({ scadSource: "cube(1);", parts: [{ partId: "a", selector: "a" }], render: async (_source, output) => {
      await fs.writeFile(output, "solid x\n facet normal 0 0 1\n endfacet\nendsolid x\n");
      return "";
    } })).rejects.toThrow("empty or invalid STL");
  });

  test("rejects malformed contracts before running OpenSCAD", async () => {
    await expect(renderAssemblySpecParts("cube(1);", { parts: [] })).rejects.toThrow("Invalid assembly specification");
  });
  test("rejects explicit degraded compile diagnostics without blocking unrelated warnings", async () => {
    const render = (diagnostics: string) => async (_source: string, output: string) => {
      await fs.writeFile(output, stl);
      return diagnostics;
    };
    const input = { scadSource: "cube(1);", parts: [{ partId: "a", selector: "a" }] };
    for (const diagnostic of ["WARNING: Can't open include file 'missing.scad'.", "WARNING: Ignoring unknown module 'missing'", "ERROR: Parser error"]) {
      await expect(renderAssemblyParts({ ...input, render: render(diagnostic) })).rejects.toThrow("incomplete OpenSCAD render");
    }
    expect(await renderAssemblyParts({ ...input, render: render("WARNING: benign diagnostic") })).toHaveLength(1);
  });
});
