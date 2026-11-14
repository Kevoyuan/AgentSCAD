import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";
import { bindSourcePoseJobRequest } from "./source-pose-job-request";
import { translationMatrix } from "./path-and-motion";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const body = {
  sourceSha256: hash, specSha256: otherHash,
  connectionId: "hinge", sourceParameter: "hinge_angle",
  rotationDeg: 45, confirmedBinding: true as const,
};

async function fixture(): Promise<{ spec: AssemblySpec; scadSource: string }> {
  const spec = validateAssemblySpec(JSON.parse(await readFile("scripts/eval/assembly-fixtures/axial-hinge.spec.json", "utf8")));
  if (!spec.success) throw new Error("Fixture invalid");
  return { spec: spec.data, scadSource: await readFile("benchmarks/assembly/axial_hinge.scad", "utf8") };
}

describe("A06.3 explicit grounded joint parameter binding", () => {
  test("derives three server-owned poses from real declared hinge, never trusts arbitrary matrices", async () => {
    const f = await fixture();
    const { binding } = bindSourcePoseJobRequest({ ...f, raw: body });
    expect(binding.samples.map(s => s.parameters.hinge_angle)).toEqual([-45, 0, 45]);
    expect(binding.samples.map(s => s.id)).toEqual(["negative", "zero", "positive"]);
    expect(binding.movingInstanceId).toBe("moving-instance");
    expect(binding.groundedInstanceId).toBe("fixed-instance");
    expect(binding.axis).toEqual({ origin: [0,0,0], direction: [0,0,1] });
    expect(binding.samples[1].transforms["moving-instance"]).toEqual(translationMatrix([0,0,0]));
    const before = binding.samples[0].transforms["moving-instance"];
    const after = binding.samples[2].transforms["moving-instance"];
    expect(before[1]).toBeCloseTo(Math.SQRT1_2, 7);
    expect(after[1]).toBeCloseTo(-Math.SQRT1_2, 7);
    expect(binding.sourceBindingConfirmedByUser).toBe(true);
  });

  test("derives the correct non-origin world-axis, without trusting a precomputed client transform", async () => {
    const f = await fixture();
    const spec = structuredClone(f.spec);
    for (const instance of spec.instances) instance.transform = translationMatrix([11, -7, 3]) as typeof instance.transform;
    const { binding } = bindSourcePoseJobRequest({ ...f, spec, raw: { ...body, rotationDeg: 15 } });
    expect(binding.axis.origin).toEqual([11,-7,3]);
    expect(binding.samples[1].transforms["moving-instance"]).toEqual(translationMatrix([11,-7,3]));
    expect(binding.samples[0].transforms["moving-instance"][3]).toBeCloseTo(11, 7);
    expect(binding.samples[2].transforms["moving-instance"][7]).toBeCloseTo(-7, 7);
  });

  test("rejects missing confirmation, undeclared source parameters and untrusted matrices", async () => {
    const f = await fixture();
    for (const raw of [
      { ...body, confirmedBinding: false },
      { ...body, sourceParameter: "unknown_angle" },
      { ...body, sourceParameter: "agentscad_part" },
      { ...body, sourceParameter: "hinge_angle; include</tmp>" },
      { ...body, movingWorldFromLocal: Array(16).fill(0) },
      { ...body, referenceSelector: "moving" },
      { ...body, rotationDeg: Number.NaN },
    ]) {
      expect(() => bindSourcePoseJobRequest({ ...f, raw })).toThrow();
    }
  });

  test("rejects out-of-range angles, misaligned frames and non-grounded source joints", async () => {
    const f = await fixture();
    for (const deg of [-1, 0, 46, 1000]) {
      expect(() => bindSourcePoseJobRequest({ ...f, raw: { ...body, rotationDeg: deg } })).toThrow();
    }
    const misaligned = structuredClone(f.spec);
    misaligned.connections[0].frameB!.origin = [1,0,0];
    expect(() => bindSourcePoseJobRequest({ scadSource: f.scadSource, spec: misaligned, raw: body })).toThrow("axes are not coherent");
    const reversed = structuredClone(f.spec);
    reversed.groundedInstanceId = "moving-instance";
    expect(() => bindSourcePoseJobRequest({ scadSource: f.scadSource, spec: reversed, raw: body })).toThrow("grounded revolute");
  });

  test("does not silently freeze other articulated moving joints or assume purchased part meshes", async () => {
    const f = await fixture();
    const withExtra = structuredClone(f.spec);
    withExtra.connections.push({ ...withExtra.connections[0], id: "other-hinge" });
    expect(() => bindSourcePoseJobRequest({ ...f, spec: withExtra, raw: body })).toThrow("other articulated joints");
    const purchased = structuredClone(f.spec);
    purchased.parts[1].source = "purchased";
    expect(() => bindSourcePoseJobRequest({ ...f, spec: purchased, raw: body })).toThrow("complete generated");
  });

  test("does not create proof when source is oversized or motion declares a narrower range", async () => {
    const f = await fixture();
    expect(() => bindSourcePoseJobRequest({ ...f, scadSource: f.scadSource + "\n" + " ".repeat(260_000), raw: body })).toThrow("exceeds");
    const motion = structuredClone(f.spec);
    motion.motions[0].range.min = -10;
    expect(() => bindSourcePoseJobRequest({ ...f, spec: motion, raw: body })).toThrow("motion range");
  });
});
