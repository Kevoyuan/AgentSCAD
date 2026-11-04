import { expect, test } from "bun:test";
import { measureCircularSections } from "../circular-section";
import { tubeStl, boxStl } from "./solids";

test("finds the bore centre from translated mesh contours without an expected position", () => {
  const stl = tubeStl({ outerRadius: 5, innerRadius: 2, height: 4, segments: 64 });
  for (let t = 0; t < stl.readUInt32LE(80); t++) for (let v = 0; v < 3; v++) {
    const at = 84 + 50 * t + 12 + v * 12;
    const x = stl.readFloatLE(at), y = stl.readFloatLE(at + 4), angle = 0.137;
    stl.writeFloatLE(x * Math.cos(angle) - y * Math.sin(angle) + 17, at);
    stl.writeFloatLE(x * Math.sin(angle) + y * Math.cos(angle) - 9, at + 4);
  }
  const result = measureCircularSections({ stl, origin: [0, 0, 1.3], normal: [0, 0, 1], radiusMm: { min: 1.98, max: 2.02 } });
  expect(result.contourCount).toBe(2);
  expect(result.circles).toHaveLength(1);
  expect(result.circles[0].center[0]).toBeCloseTo(17, 4);
  expect(result.circles[0].center[1]).toBeCloseTo(-9, 4);
});

test("rejects damaged input and does not confuse a box with the specified pin", () => {
  const setup = { origin: [0, 0, 1] as [number, number, number], normal: [0, 0, 1] as [number, number, number], radiusMm: { min: 1.98, max: 2.02 } };
  expect(() => measureCircularSections({ ...setup, stl: Buffer.alloc(0) })).toThrow();
  expect(measureCircularSections({ ...setup, stl: boxStl([-2, -2, 0], [2, 2, 3]) }).circles).toHaveLength(0);
});
