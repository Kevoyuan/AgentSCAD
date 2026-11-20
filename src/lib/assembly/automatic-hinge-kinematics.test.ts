import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateAssemblySpec } from "./assembly-spec";
import { automaticHingeKinematics } from "./automatic-hinge-kinematics";

test("automatic sampling only moves the ungrounded side of a simple supported hinge", async () => {
  const parsed = validateAssemblySpec(JSON.parse(await readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json", "utf8")));
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const spec = parsed.data;
  expect(automaticHingeKinematics(spec)).toEqual({ connectionId: "hinge", movingInstanceIds: ["moving-instance"] });
  expect(automaticHingeKinematics({ ...spec, groundedInstanceId: null })).toBeUndefined();
  expect(automaticHingeKinematics({ ...spec, groundedInstanceId: "moving-instance" })).toBeUndefined();
  expect(automaticHingeKinematics({ ...spec, instances: [...spec.instances, { ...spec.instances[1], id: "extra" }] })).toBeUndefined();
});
