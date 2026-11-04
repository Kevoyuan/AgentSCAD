import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { extractEmbeddedAssemblySpec } from "./embedded-spec";
import { assemblySourceHash } from "../pipeline/assembly-spec-record";
import { sanitizeGeneratedScadSource } from "../tools/scad-sanitizer";
import { writeScadParameters } from "../tools/scad-parameter-writer";
import { renderAssemblyParts } from "../tools/assembly-part-renderer";
import { buildRepairPrompt } from "../repair/repair-controller";

const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const axis = { origin: [0, 0, 0], direction: [0, 0, 1] };
const spec = {
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: [
    { id: "fixed", name: "Fixed leaf and pin", selector: "fixed", source: "generated", material: null },
    { id: "moving", name: "Moving leaf", selector: "moving", source: "generated", material: null },
  ],
  instances: [
    { id: "fixed-instance", partId: "fixed", subassemblyId: null, transform: pose },
    { id: "moving-instance", partId: "moving", subassemblyId: null, transform: pose },
  ], subassemblies: [], groundedInstanceId: "fixed-instance",
  connections: [{ id: "hinge", type: "revolute", a: "fixed-instance", b: "moving-instance", frameA: axis, frameB: axis, range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [] }],
  motions: [{ id: "turn", inputConnectionId: "hinge", range: { min: -45, max: 45, unit: "deg" } }],
  operations: [], manufacturing: null, assumptions: [], unknowns: [],
};

async function source() {
  const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
  return `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;
}

describe("the declaration survives every rewrite the pipeline performs", () => {
  test("sanitizing reserved words keeps the comment and the selector intact", async () => {
    const sanitized = sanitizeGeneratedScadSource(await source());
    const extracted = extractEmbeddedAssemblySpec(sanitized);
    expect(extracted.status).toBe("valid");
    if (extracted.status !== "valid") throw new Error("declaration lost");
    expect(extracted.spec.parts.map((part) => part.selector)).toEqual(["fixed", "moving"]);
    expect(sanitized).toContain('agentscad_part = "all"');
    expect(sanitized).toContain('agentscad_part == "fixed"');
    expect(sanitized).toContain('agentscad_part == "moving"');
    expect(sanitized).toContain("module fixed_leaf()");
  });

  test("a reserved word inside the declaration or a string is not rewritten", () => {
    const declaration = '/* AGENTSCAD_ASSEMBLY_V1\n{"note":"module"}\nEND_AGENTSCAD_ASSEMBLY */\nlabel = "module";\nmodule bracket() { cube(1); }\n';
    const sanitized = sanitizeGeneratedScadSource(declaration);
    expect(sanitized).toContain('{"note":"module"}');
    expect(sanitized).toContain('label = "module"');
    expect(sanitized).toContain("module bracket()");
    expect(sanitizeGeneratedScadSource("module = 3;").trim()).toBe("tooth_module = 3;");
  });

  test("a parameter edit rewrites the value, changes the source hash and keeps the declaration", async () => {
    const original = await source();
    const edited = writeScadParameters(original, { hinge_angle: 30 });
    expect(edited).toContain("hinge_angle = 30;");
    expect(edited).not.toContain("hinge_angle = 0;");
    // A stored declaration is bound to the source it was written against, so an
    // edit must make it stale rather than silently apply to new geometry.
    expect(assemblySourceHash(edited)).not.toBe(assemblySourceHash(original));
    const extracted = extractEmbeddedAssemblySpec(edited);
    expect(extracted.status).toBe("valid");
    if (extracted.status !== "valid") throw new Error("declaration lost");
    expect(extracted.spec.parts).toHaveLength(2);
  });

  test("each part is rendered with its own selector in one private workspace", async () => {
    const calls: Array<{ source: string; output: string; definitions?: Record<string, unknown> }> = [];
    const stl = (() => {
      const buffer = Buffer.alloc(134);
      buffer.writeUInt32LE(1, 80);
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, 96 + v * 12 + k * 4)));
      return buffer;
    })();
    const parts = await renderAssemblyParts({
      scadSource: await source(),
      parts: [{ partId: "fixed", selector: "fixed" }, { partId: "moving", selector: "moving" }],
      render: async (sourcePath, outputPath, definitions) => {
        calls.push({ source: sourcePath, output: outputPath, definitions });
        await Bun.write(outputPath, stl);
        return "";
      },
    });
    expect(calls.map((call) => call.definitions)).toEqual([{ agentscad_part: "fixed" }, { agentscad_part: "moving" }]);
    expect(new Set(calls.map((call) => path.dirname(call.output))).size).toBe(1);
    expect(parts.map((part) => part.partId)).toEqual(["fixed", "moving"]);
    expect(existsSync(path.dirname(calls[0].output))).toBe(false);
  });

  test("the simplification prompt forbids replacing required parts", () => {
    const prompt = buildRepairPrompt({
      originalRequest: "a two-piece hinge with a working pin joint",
      partFamily: "assembly",
      currentScadCode: "cube(1);",
      validationResults: [],
      repairStrategy: "simplify",
    });
    expect(prompt).toContain("Never merge, omit, or replace any explicitly required parts");
    expect(prompt).toContain("do not claim the resulting assembly is complete");
  });
});
