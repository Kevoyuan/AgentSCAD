import { describe, expect, test } from "bun:test";
import { checkDeclaredJointFrames } from "./joint-frame-check";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const spec = () => ({
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: ["base", "arm"].map((id) => ({ id, name: id, selector: id, source: "generated", material: null })),
  instances: ["base", "arm"].map((id) => ({ id, partId: id, subassemblyId: null, transform: [...identity] })),
  subassemblies: [], groundedInstanceId: "base", motions: [], operations: [], manufacturing: null,
  assumptions: [], unknowns: [],
  connections: [{ id: "hinge", type: "revolute", a: "base", b: "arm", frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] }, range: null, pitchMm: null, ratio: null, allowedContact: [] }],
});
const check = (value: unknown) => checkDeclaredJointFrames({ spec: value, maxAxisOffsetMm: 0.05, maxAngleDegrees: 0.1 });

describe("declared joint frames", () => {
  test("maps local axes through instance transforms and permits movement along the axis", () => {
    const value = spec();
    value.instances[1].transform[11] = 8;
    value.connections[0].frameB.direction = [0, 0, -1];
    expect(check(value)[0]).toMatchObject({ status: "PASS", axisOffsetMm: 0, angleDegrees: 0 });
  });
  test("detects offset and tilted axes", () => {
    const value = spec();
    value.instances[1].transform[3] = 0.2;
    expect(check(value)[0]).toMatchObject({ status: "FAIL", axisOffsetMm: 0.2 });
    value.instances[1].transform[3] = 0;
    value.connections[0].frameB.direction = [1, 0, 0];
    expect(check(value)[0]).toMatchObject({ status: "FAIL", angleDegrees: 90 });
  });
  test("does not report unsupported types or missing frames as passed", () => {
    const value = spec();
    value.connections[0].type = "gear";
    expect(check(value)[0].status).toBe("NOT_RUN");
    value.connections[0].type = "revolute";
    (value.connections[0] as {frameA: null | {origin: number[]; direction: number[]}}).frameA = null;
    expect(check(value)[0].status).toBe("NOT_RUN");
  });
  test("rejects malformed specifications and invalid tolerances", () => {
    expect(() => check({})).toThrow("Invalid assembly specification");
    expect(() => checkDeclaredJointFrames({ spec: spec(), maxAxisOffsetMm: NaN, maxAngleDegrees: 0 })).toThrow();
  });
});
