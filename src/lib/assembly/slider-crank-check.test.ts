import { describe, expect, test } from "bun:test";
import { checkSliderCrank, type SliderCrankSample } from "./slider-crank-check";

const contract = { crankRadiusMm: 2, rodLengthMm: 5, toleranceMm: 0.001, requiredAngles: [0, 90, 180, 270, 360] };
// Frozen reference coordinates for a centered mechanism, in millimetres.
const positions = (): SliderCrankSample[] => [
  { angleDegrees: 0, crankPin: [0, 2], pistonPin: [0, 7] },
  { angleDegrees: 90, crankPin: [2, 0], pistonPin: [0, Math.sqrt(21)] },
  { angleDegrees: 180, crankPin: [0, -2], pistonPin: [0, 3] },
  { angleDegrees: 270, crankPin: [-2, 0], pistonPin: [0, Math.sqrt(21)] },
  { angleDegrees: 360, crankPin: [0, 2], pistonPin: [0, 7] },
];

describe("planar slider crank sampled position comparison", () => {
  test("checks each supplied sample against independently specified geometry", () => {
    expect(checkSliderCrank({ ...contract, samples: positions() }).map(x => x.status)).toEqual(["PASS", "PASS", "PASS", "PASS", "PASS"]);
  });
  test("detects a false static animation and a piston off its guide", () => {
    const p = positions();
    p[1].crankPin = [0, 2];
    p[3].pistonPin[0] = 0.2;
    const result = checkSliderCrank({ ...contract, samples: p });
    expect(result[1].status).toBe("FAIL");
    expect(result[3].status).toBe("FAIL");
  });
  test("preserves missing endpoint as NOT_RUN and rejects invalid input", () => {
    expect(checkSliderCrank({ ...contract, samples: positions().slice(0, 4) })[4].status).toBe("NOT_RUN");
    expect(() => checkSliderCrank({ ...contract, samples: [positions()[0], positions()[0]] })).toThrow();
    expect(() => checkSliderCrank({ ...contract, rodLengthMm: 1, samples: [] })).toThrow();
  });
});
