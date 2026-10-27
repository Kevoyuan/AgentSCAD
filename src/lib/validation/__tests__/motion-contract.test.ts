import { describe, expect, test } from "bun:test";
import {
  evaluateMotionContract,
  isMotionReadyIntent,
} from "@/lib/validation/motion-contract";

const motionIntent = {
  version: 1,
  status: "MATCHED",
  interpretations: [{
    id: "functional_motion_ready_v8",
    label: "Functional motion-ready V8 assembly",
    probability: 0.1,
    score: 10,
  }],
};

const staticV8Scad = [
  "include <agentscad_std.scad>;",
  "total_length = 842;",
  "v_angle = 90;",
  "module bank_solid() { cube([100, 100, 100]); }",
  "module generated_part() { bank_solid(); }",
  "generated_part();",
].join("\n");

const movableV8Scad = [
  "include <agentscad_std.scad>;",
  "crank_angle = 45; // [0:1:360]",
  "pin_angles = [0, 90, 270, 180];",
  "cutaway = true;",
  "crank_r = 10;",
  "rod_len = 30;",
  "function piston_z(angle, bank) = crank_r * cos(angle + bank) + sqrt(rod_len*rod_len - pow(crank_r * sin(angle + bank), 2));",
  "module internals() { for (a = pin_angles) translate([0, 0, piston_z(crank_angle, a)]) cylinder(h = 10, r = 5); }",
  "module generated_part() { internals(); }",
  "generated_part();",
].join("\n");

describe("motion contract", () => {
  test("ignores requests that were not approved as motion-ready", () => {
    expect(isMotionReadyIntent("a phone stand", { status: "MATCHED" })).toBe(false);
    expect(evaluateMotionContract({
      inputRequest: "a phone stand",
      intentResult: { status: "MATCHED" },
      scadSource: staticV8Scad,
    })).toBeNull();
  });

  test("blocks a motion-ready request that produced a static, closed model", () => {
    const result = evaluateMotionContract({
      inputRequest: "A complete V8 engine",
      intentResult: motionIntent,
      scadSource: staticV8Scad,
    });

    expect(result).toMatchObject({
      rule_id: "M001",
      rule_name: "Motion Contract",
      status: "FAIL",
      passed: false,
      is_critical: true,
    });
    const message = String(result?.message);
    expect(message).toContain("crank_angle");
    expect(message).toContain("kinematic function");
    expect(message).toContain("cutaway");
  });

  test("passes when the artifact exposes a motion angle, kinematics, phases and a cutaway", () => {
    const result = evaluateMotionContract({
      inputRequest: "A complete V8 engine",
      intentResult: motionIntent,
      scadSource: movableV8Scad,
    });

    expect(result).toMatchObject({
      rule_id: "M001",
      status: "PASS",
      passed: true,
      is_critical: true,
    });
    expect(String(result?.message)).toContain("crank_angle");
    expect(String(result?.message)).toContain("piston_z");
  });

  test("recognizes motion-ready wording directly in an approved request", () => {
    expect(isMotionReadyIntent("functional motion-ready gear train")).toBe(true);
    expect(isMotionReadyIntent("kinematic linkage")).toBe(true);
    expect(isMotionReadyIntent("static display model")).toBe(false);
  });
});
