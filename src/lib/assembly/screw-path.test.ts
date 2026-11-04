import { expect, test } from "bun:test";
import { sampleScrewPath, type ScrewPathInput } from "./screw-path";
import { multiplyMatrices } from "./path-and-motion";
import { transformPoint } from "../geometry/mesh-collision";

const base: ScrewPathInput = {
  units: "mm", axis: { origin: [10, 0, 0], direction: [0, 0, 5] },
  hand: "right", leadMm: 1.5, startAngleDeg: 0, endAngleDeg: 90, maxStepDeg: 5,
};

function expectPoint(actual: number[], expected: number[]) {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
}

test("twelve turns at five degrees create all 865 cumulative poses", () => {
  const path = sampleScrewPath({ ...base, endAngleDeg: 4320 });
  expect(path.poses).toHaveLength(865);
  expect(path.anglesDegrees).toHaveLength(865);
  expect(path.anglesDegrees[0]).toBe(0);
  expect(path.anglesDegrees.at(-1)).toBe(4320);
  expect(path.actualStepDeg).toBeCloseTo(5, 9);
  expect(path.axialTravelMm).toBe(18);
  expect(path.collision.status).toBe("NOT_RUN");
  expect(path.physical.status).toBe("NOT_RUN");
});

test("rotation about an offset world axis is combined with axial lead", () => {
  const path = sampleScrewPath(base);
  expectPoint(transformPoint(path.poses[0], [11, 0, 0]), [11, 0, 0]);
  expectPoint(transformPoint(path.poses.at(-1)!, [11, 0, 0]), [10, 1, 0.375]);
  expectPoint(transformPoint(path.poses.at(-1)!, [10, 0, 3]), [10, 0, 3.375]);
});

test("hand and turn direction independently control axial advance", () => {
  const right = sampleScrewPath({ ...base, endAngleDeg: 360 });
  const left = sampleScrewPath({ ...base, hand: "left", endAngleDeg: 360 });
  const reverseRight = sampleScrewPath({ ...base, endAngleDeg: -360 });
  const reverseLeft = sampleScrewPath({ ...base, hand: "left", endAngleDeg: -360 });
  expect([right.axialTravelMm, left.axialTravelMm, reverseRight.axialTravelMm, reverseLeft.axialTravelMm]).toEqual([1.5, -1.5, -1.5, 1.5]);
  expect(reverseRight.anglesDegrees.every((n, i, list) => i === 0 || n < list[i - 1])).toBe(true);
});

test("nonzero starting angle is already represented by the supplied start geometry", () => {
  const path = sampleScrewPath({ ...base, startAngleDeg: 60, endAngleDeg: 150 });
  expect(path.anglesDegrees[0]).toBe(60);
  expectPoint(transformPoint(path.poses[0], [11, 0, 0]), [11, 0, 0]);
  expectPoint(transformPoint(path.poses.at(-1)!, [11, 0, 0]), [10, 1, 0.375]);
});

test("an arbitrary axis is normalised and its own points stay on that axis", () => {
  const path = sampleScrewPath({ ...base, axis: { origin: [1, 2, 3], direction: [0, 3, 4] }, endAngleDeg: 360 });
  expectPoint(path.axis.direction, [0, 0.6, 0.8]);
  expectPoint(transformPoint(path.poses.at(-1)!, [1, 2, 3]), [1, 2.9, 4.2]);
});

test("invalid inputs, insufficient numeric precision and excess work are refused", () => {
  const invalid: Array<Record<string, unknown>> = [
    { units: "inch" }, { hand: "clockwise" }, { leadMm: 0 }, { leadMm: Infinity },
    { startAngleDeg: NaN }, { endAngleDeg: 0 }, { maxStepDeg: 0 }, { maxStepDeg: 181 },
    { axis: { origin: [0, 0, 0], direction: [0, 0, 0] } },
    { axis: { origin: [0, Infinity, 0], direction: [0, 0, 1] } },
    { maxPoses: 1 }, { maxPoses: 4097 }, { maxPoses: 2.5 },
    { endAngleDeg: 4320, maxStepDeg: 5, maxPoses: 864 },
    { startAngleDeg: 1e20, endAngleDeg: 1e20 + 1 },
    { startAngleDeg: 1e15, endAngleDeg: 1e15 + 1, maxStepDeg: 0.2 },
  ];
  for (const overrides of invalid) expect(() => sampleScrewPath({ ...base, ...overrides } as ScrewPathInput)).toThrow();
});

test("reversing the same path returns a transformed point to its starting pose", () => {
  const forward = sampleScrewPath({ ...base, startAngleDeg: 10, endAngleDeg: 730 });
  const reverse = sampleScrewPath({ ...base, startAngleDeg: 730, endAngleDeg: 10 });
  const roundTrip = multiplyMatrices(reverse.poses.at(-1)!, forward.poses.at(-1)!);
  expectPoint(transformPoint(roundTrip, [13, -2, 7]), [13, -2, 7]);
});
