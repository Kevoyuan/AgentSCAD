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
