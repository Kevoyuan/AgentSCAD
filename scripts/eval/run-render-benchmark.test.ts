import { describe, expect, test } from "bun:test";

import { bboxMatches, inspectBinaryStlBounds } from "./run-render-benchmark";

function singleTriangleStl(): Buffer {
  const buffer = Buffer.alloc(84 + 50);
  buffer.writeUInt32LE(1, 80);
  const points = [[-1, -2, -3], [4, -2, -3], [-1, 5, 6]];
  points.forEach((point, index) => {
    point.forEach((value, axis) => buffer.writeFloatLE(value, 84 + 12 + index * 12 + axis * 4));
  });
  return buffer;
}

describe("deterministic render benchmark", () => {
  test("measures finite binary STL bounds", () => {
    expect(inspectBinaryStlBounds(singleTriangleStl())).toEqual({
      triangleCount: 1,
      bbox: { x: 5, y: 7, z: 9 },
    });
  });

  test("uses an explicit per-axis bbox tolerance", () => {
    expect(bboxMatches({ x: 20.1, y: 19.9, z: 2.2 }, [20, 20, 2], 0.25)).toBe(true);
    expect(bboxMatches({ x: 20.3, y: 20, z: 2 }, [20, 20, 2], 0.25)).toBe(false);
  });
});
