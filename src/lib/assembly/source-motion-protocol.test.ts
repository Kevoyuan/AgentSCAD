import { expect, test } from "bun:test";
import fixture from "../../../scripts/eval/assembly-fixtures/axial-hinge.spec.json";
import { AssemblySpecSchema } from "./assembly-spec";
import { buildHingeSourceProtocol } from "./source-motion-protocol";
import { transformPoint } from "../geometry/mesh-collision";

function boundSpec() {
  const spec = AssemblySpecSchema.parse(fixture);
  spec.motions[0].sourceInput = { parameter: "angle", poseSelectors: { "fixed-instance": "fixed", "moving-instance": "moving" } };
  return spec;
}

test("source bindings are optional, instance-complete and safe control names", () => {
  const old = AssemblySpecSchema.parse(fixture);
  expect(old.motions[0]).not.toHaveProperty("sourceInput");
  expect(buildHingeSourceProtocol(old).status).toBe("NOT_RUN");
  expect(AssemblySpecSchema.safeParse(boundSpec()).success).toBe(true);
  const invalidSelectors: Array<Record<string, string>> = [{}, { "fixed-instance": "fixed" },
    { "fixed-instance": "all", "moving-instance": "moving" },
    { "fixed-instance": "fixed", "moving-instance": "fixed" },
    { "fixed-instance": "fixed", "moving-instance": "moving", unknown: "other" }];
  for (const selectors of invalidSelectors) {
    const spec = boundSpec();
    spec.motions[0].sourceInput!.poseSelectors = selectors;
    expect(AssemblySpecSchema.safeParse(spec).success).toBe(false);
  }
  for (const parameter of ["agentscad_part", "agentscad_pose", "bad();"]) {
    const spec = boundSpec();
    spec.motions[0].sourceInput!.parameter = parameter;
    expect(AssemblySpecSchema.safeParse(spec).success).toBe(false);
  }
});

test("automatic source protocol freezes quartiles, zero pose and the measured-frame prerequisite", () => {
  const spec = boundSpec();
  const result = buildHingeSourceProtocol(spec);
  expect(result.status).toBe("READY");
  if (result.status !== "READY") throw new Error("Expected protocol");
  expect(result.protocol.cases.map(item => item.parameters.angle)).toEqual([-45,-22.5,0,22.5,45]);
  expect(result.protocol.manufacturingParameters).toEqual({ agentscad_pose: false, angle: 0 });
  expect(result.protocol.surfaceComparison).toBe("bounded-cover");
  spec.motions[0].sourceInput!.poseSelectors["fixed-instance"] = "changed";
  expect(result.protocol.poseSelectors["fixed-instance"]).toBe("fixed");
  const mismatch = boundSpec();
  mismatch.motions[0].range.max = 90;
  expect(buildHingeSourceProtocol(mismatch).status).toBe("NOT_RUN");
  const ungrounded = boundSpec();
  ungrounded.groundedInstanceId = null;
  expect(buildHingeSourceProtocol(ungrounded).status).toBe("NOT_RUN");
});

test("world expectations respect a rotated non-origin ground and offset local axis", () => {
  const spec = boundSpec();
  const placement: typeof spec.instances[number]["transform"] = [0,-1,0,10,1,0,0,20,0,0,1,5,0,0,0,1];
  spec.instances.forEach(instance => { instance.transform = [...placement]; });
  spec.connections[0].frameA!.origin = [2,0,0];
  const result = buildHingeSourceProtocol(spec);
  if (result.status !== "READY") throw new Error("Expected protocol");
  const pose = result.protocol.cases.at(-1)!.transforms["moving-instance"];
  const point = transformPoint(pose, [3,0,0]);
  expect(point[0]).toBeCloseTo(10 - Math.SQRT1_2, 10);
  expect(point[1]).toBeCloseTo(22 + Math.SQRT1_2, 10);
  expect(point[2]).toBe(5);
  expect(result.protocol.cases.at(-1)!.transforms["fixed-instance"]).toEqual(placement);
});

test("seeded interior probes are frozen, distinct from quartiles and repeatable", () => {
  const spec = boundSpec();
  const seed = "0123456789abcdef0123456789abcdef";
  const first = buildHingeSourceProtocol(spec, seed), second = buildHingeSourceProtocol(spec, seed);
  if (first.status !== "READY" || second.status !== "READY") throw new Error("Expected protocol");
  expect(first.protocol).toEqual(second.protocol);
  expect(first.sampling.challengeSeed).toBe(seed);
  expect(first.protocol.cases).toHaveLength(6);
  const fixed = new Set([-45,-22.5,0,22.5,45]);
  const challenge = first.protocol.cases.map(item => Number(item.parameters.angle)).find(angle => !fixed.has(angle))!;
  expect(first.protocol.cases.filter(item => item.challenge)).toHaveLength(1);
  expect(first.protocol.cases.find(item => item.challenge)!.parameters.angle).toBe(challenge);
  const fraction = ((challenge + 45) / 22.5) % 1;
  expect(fraction).toBeGreaterThan(0.2);
  expect(fraction).toBeLessThan(0.8);
  expect(Math.abs(Math.sin(8 * challenge * Math.PI / 180))).toBeGreaterThan(0.58);
  expect(() => buildHingeSourceProtocol(spec, "unfrozen")).toThrow();
});
