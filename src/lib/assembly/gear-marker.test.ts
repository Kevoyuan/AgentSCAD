import { describe, expect, test } from "bun:test";
import { checkGearCoupling } from "./gear-marker";

const pose = (inputDeg: number, pinionAngleDeg: number, wheelAngleDeg: number) => ({ inputDeg, pinionAngleDeg, wheelAngleDeg });

describe("gear coupling witness", () => {
  test("accepts a rigid opposite-direction half ratio", () => {
    const result = checkGearCoupling({ expectedRatio: -0.5, angleToleranceDeg: 0.2, ratioTolerance: 0.01,
      poses: [pose(0, 10, 70), pose(90, 100, 25), pose(180, 190, -20), pose(270, 280, -65)] });
    expect(result.status).toBe("PASS");
    expect(result.measuredRatio!).toBeCloseTo(-0.5, 6);
    expect(result.direction).toBe("opposite");
  });

  test("rejects the same direction, a wrong pinion track and too few poses", () => {
    expect(checkGearCoupling({ expectedRatio: -0.5, angleToleranceDeg: 0.2, ratioTolerance: 0.01,
      poses: [pose(0, 10, 70), pose(90, 100, 115), pose(180, 190, 160)] }).status).toBe("FAIL");
    expect(checkGearCoupling({ expectedRatio: -0.5, angleToleranceDeg: 0.2, ratioTolerance: 0.01,
      poses: [pose(0, 10, 70), pose(90, 130, 25), pose(180, 190, -20)] }).status).toBe("FAIL");
    expect(() => checkGearCoupling({ expectedRatio: -0.5, angleToleranceDeg: 0.2, ratioTolerance: 0.01,
      poses: [pose(0, 10, 70)] })).toThrow("three");
  });
});
