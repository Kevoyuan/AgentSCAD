import { describe, expect, test } from "bun:test";
import { measureThreadGeometry, type ThreadGeometryContract } from "./thread-geometry";

/** Minimal binary STL writer: the measurement only reads vertices. */
function stl(triangles: Array<Array<[number, number, number]>>): Buffer {
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    const base = 84 + index * 50 + 12;
    triangle.forEach((vertex, v) => {
      vertex.forEach((value, k) => buffer.writeFloatLE(value, base + v * 12 + k * 4));
    });
  });
  return buffer;
}

function cylinder(radiusMm: number, z0: number, z1: number, segments = 64) {
  const triangles: Array<Array<[number, number, number]>> = [];
  const ring = (z: number) => Array.from({ length: segments }, (_, i) => {
    const angle = (2 * Math.PI * i) / segments;
    return [radiusMm * Math.cos(angle), radiusMm * Math.sin(angle), z] as [number, number, number];
  });
  const bottom = ring(z0), top = ring(z1);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    triangles.push([bottom[i], bottom[j], top[j]]);
    triangles.push([bottom[i], top[j], top[i]]);
    triangles.push([[0, 0, z0], bottom[j], bottom[i]]);
    triangles.push([[0, 0, z1], top[i], top[j]]);
  }
  return triangles;
}

/**
 * A crest ribbon with the topology a twisted extrusion produces: at every slice
 * the crest is a constant-height arc of `arcDeg` degrees, and the arc's start
 * angle advances by one pitch per revolution.
 */
function ribbon(options: {
  radiusMm: number; z0: number; lengthMm: number; pitchMm: number;
  hand: "right" | "left"; arcDeg?: number; slicesPerPitch?: number;
}) {
  const { radiusMm, z0, lengthMm, pitchMm, hand } = options;
  const arcDeg = options.arcDeg ?? 180;
  const perPitch = options.slicesPerPitch ?? 18;
  const dz = pitchMm / perPitch;
  const slices = Math.round(lengthMm / dz);
  const arcSteps = 8;
  const sign = hand === "right" ? 1 : -1;
  const point = (s: number, a: number): [number, number, number] => {
    const z = z0 + s * dz;
    const start = ((sign * 2 * Math.PI * (z - z0)) / pitchMm);
    const angle = start + (arcDeg * Math.PI / 180) * (a / arcSteps);
    return [radiusMm * Math.cos(angle), radiusMm * Math.sin(angle), z];
  };
  const triangles: Array<Array<[number, number, number]>> = [];
  for (let s = 0; s < slices; s++) {
    for (let a = 0; a < arcSteps; a++) {
      triangles.push([point(s, a), point(s, a + 1), point(s + 1, a + 1)]);
      triangles.push([point(s, a), point(s + 1, a + 1), point(s + 1, a)]);
    }
  }
  return triangles;
}

function contract(overrides: Partial<ThreadGeometryContract> = {}): ThreadGeometryContract {
  return {
    pitchMm: 1.5,
    hand: "right",
    majorDiameterMm: { min: 9.9, max: 10.1 },
    minorDiameterMm: { min: 8.1, max: 8.3 },
    toleranceMm: 0.01,
    searchRadiusMm: 6,
    threadRangeMm: { min: 0.05, max: 11.95 },
    ...overrides,
  };
}

function externalThread(hand: "right" | "left" = "right") {
  return stl([
    ...cylinder(4.1, 0, 12),
    ...ribbon({ radiusMm: 5, z0: 0, lengthMm: 12, pitchMm: 1.5, hand }),
  ]);
}

describe("thread geometry", () => {
  test("measures the pitch, hand and both diameters of a right-hand thread", () => {
    const result = measureThreadGeometry({ stl: externalThread(), role: "external", contract: contract() });
    expect(result.status).toBe("PASS");
    expect(result.hand).toBe("right");
    expect(result.pitchMm!).toBeCloseTo(1.5, 4);
    expect(result.majorDiameterMm!).toBeCloseTo(10, 2);
    expect(result.minorDiameterMm!).toBeCloseTo(8.2, 2);
    expect(result.phaseBins).toBeGreaterThan(20);
  });

  test("a left-hand helix is reported as left-hand, not as a pitch error", () => {
    const result = measureThreadGeometry({ stl: externalThread("left"), role: "external", contract: contract({ hand: "left" }) });
    expect(result.status).toBe("PASS");
    expect(result.hand).toBe("left");
    expect(result.pitchMm!).toBeCloseTo(1.5, 4);
  });

  test("declaring the wrong hand fails even when the pitch is right", () => {
    const result = measureThreadGeometry({ stl: externalThread("left"), role: "external", contract: contract() });
    expect(result.status).toBe("FAIL");
    expect(result.failures.join(" ")).toContain("left-hand");
  });

  test("a plain cylinder has one radius population and is not called a thread", () => {
    const result = measureThreadGeometry({ stl: stl(cylinder(5, 0, 12)), role: "external", contract: contract() });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("distinct radius population");
    expect(result.pitchMm).toBeNull();
  });

  test("a thread of the wrong pitch fails against the contract", () => {
    const source = stl([
      ...cylinder(4.1, 0, 12),
      ...ribbon({ radiusMm: 5, z0: 0, lengthMm: 10.5, pitchMm: 1.75, hand: "right" }),
    ]);
    const result = measureThreadGeometry({ stl: source, role: "external", contract: contract() });
    expect(result.status).toBe("FAIL");
    expect(result.pitchMm!).toBeCloseTo(1.75, 3);
    expect(result.failures.join(" ")).toContain("pitch");
  });

  test("an internal thread reads the rib as its crest", () => {
    const nut = stl([
      ...cylinder(9.8, 0, 6),
      ...cylinder(5.15, 0, 6),
      ...ribbon({ radiusMm: 4.25, z0: 0, lengthMm: 6, pitchMm: 1.5, hand: "right", arcDeg: 108 }),
    ]);
    const result = measureThreadGeometry({
      stl: nut, role: "internal",
      contract: contract({
        majorDiameterMm: { min: 10.2, max: 10.4 }, minorDiameterMm: { min: 8.4, max: 8.6 },
        threadRangeMm: { min: 0.05, max: 5.95 },
      }),
    });
    expect(result.status).toBe("PASS");
    expect(result.hand).toBe("right");
    expect(result.pitchMm!).toBeCloseTo(1.5, 4);
    expect(result.majorDiameterMm!).toBeCloseTo(10.3, 2);
    expect(result.minorDiameterMm!).toBeCloseTo(8.5, 2);
  });

  test("an empty or truncated mesh is an error, never a pass", () => {
    const result = measureThreadGeometry({ stl: Buffer.alloc(40), role: "external", contract: contract() });
    expect(result.status).toBe("ERROR");
    expect(result.pitchMm).toBeNull();
  });

  test("an invalid contract is rejected instead of guessed", () => {
    expect(() => measureThreadGeometry({ stl: externalThread(), role: "external", contract: contract({ toleranceMm: 0 }) }))
      .toThrow("Invalid thread geometry contract");
    expect(() => measureThreadGeometry({ stl: externalThread(), role: "external", contract: contract({ searchRadiusMm: 0 }) }))
      .toThrow("Invalid thread geometry contract");
  });
});
