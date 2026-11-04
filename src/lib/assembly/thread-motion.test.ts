import { describe, expect, test } from "bun:test";
import { measureThreadAdvance, type ThreadMotionContract } from "./thread-motion";

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

/** A hexagonal prism with its own datum, used as the orientation reference. */
function hexPrism(circumRadiusMm: number, z0: number, heightMm: number, rotationDeg = 0, distinctive = true): Buffer {
  const corners = Array.from({ length: 6 }, (_, i) => {
    const angle = ((rotationDeg + 60 * i) * Math.PI) / 180;
    const r = circumRadiusMm + (distinctive && i === 0 ? 0.7 : 0);
    return [r * Math.cos(angle), r * Math.sin(angle)] as [number, number];
  });
  const bottom = corners.map(([x, y]) => [x, y, z0] as [number, number, number]);
  const top = corners.map(([x, y]) => [x, y, z0 + heightMm] as [number, number, number]);
  const triangles: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    triangles.push([bottom[i], bottom[j], top[j]]);
    triangles.push([bottom[i], top[j], top[i]]);
    triangles.push([[0, 0, z0], bottom[j], bottom[i]]);
    triangles.push([[0, 0, z0 + heightMm], top[i], top[j]]);
  }
  return stl(triangles);
}

function contract(overrides: Partial<ThreadMotionContract> = {}): ThreadMotionContract {
  return {
    pitchMm: 1.5,
    hand: "right",
    toleranceMm: 0.005,
    orientationToleranceDeg: 0.5,
    minTurns: 2,
    cornerRadiusMm: 9.2,
    ...overrides,
  };
}

const turns = [0, 90, 180, 270, 360, 450, 540, 630, 720];

function poses(options: {
  advanceMmPerTurn?: number; rotate?: boolean; boltDriftMm?: number; baseZmm?: number; aliasRotation?: boolean;
} = {}) {
  const advance = options.advanceMmPerTurn ?? 1.5;
  const rotate = options.rotate ?? true;
  return turns.map((turnDeg, index) => ({
    turnDeg,
    bolt: hexPrism(9.2376, -6 + (options.boltDriftMm ?? 0) * index, 6),
    nut: hexPrism(9.815, (options.baseZmm ?? 0.6) + (advance * turnDeg) / 360, 6, rotate ? (options.aliasRotation && turnDeg === 90 ? 30 : turnDeg) : 0),
  }));
}

describe("thread advance", () => {
  test("a nut that turns and advances by one pitch per turn passes", () => {
    const result = measureThreadAdvance({ contract: contract(), poses: poses() });
    expect(result.status).toBe("PASS");
    expect(result.leadPerTurnMm!).toBeCloseTo(1.5, 6);
    expect(result.hand).toBe("right");
    expect(result.advanceResidualMm!).toBeLessThan(1e-6);
    expect(result.orientationSpreadDeg!).toBeLessThan(1e-6);
    expect(result.boltDriftMm!).toBeLessThan(1e-6);
    expect(result.turnsCovered).toBe(2);
  });

  test("a nut that only spins is rejected: rotating is not advancing", () => {
    const result = measureThreadAdvance({ contract: contract(), poses: poses({ advanceMmPerTurn: 0 }) });
    expect(result.status).toBe("FAIL");
    expect(result.leadPerTurnMm!).toBeCloseTo(0, 6);
    expect(result.failures.join(" ")).toContain("advances");
  });

  test("a nut that only slides is rejected: advancing is not rotating", () => {
    const result = measureThreadAdvance({ contract: contract(), poses: poses({ rotate: false }) });
    expect(result.status).toBe("FAIL");
    expect(result.leadPerTurnMm!).toBeCloseTo(1.5, 6);
    expect(result.orientationSpreadDeg!).toBeGreaterThan(1);
    expect(result.failures.join(" ")).toContain("orientation");
  });

  test("a 90 degree command with only 30 degrees of actual rotation is rejected", () => {
    const result = measureThreadAdvance({ contract: contract(), poses: poses({ aliasRotation: true }) });
    expect(result.status).toBe("FAIL");
    expect(result.failures.join(" ")).toContain("feature orientation");
  });

  test("a bolt drifting 4 mm laterally per pose is not fixed", () => {
    const shifted = poses().map((p, index) => {
      const bolt = Buffer.from(p.bolt);
      const count = bolt.readUInt32LE(80);
      for (let i=0;i<count;i++) for (let v=0;v<3;v++) {
        const offset=84+i*50+12+v*12;
        bolt.writeFloatLE(bolt.readFloatLE(offset)+4*index,offset);
      }
      return { ...p, bolt };
    });
    const result = measureThreadAdvance({ contract: contract(), poses: shifted });
    expect(result.status).toBe("FAIL");
    expect(result.failures.join(" ")).toContain("all axes");
  });

  test("a symmetric section cannot certify rotation beyond hexagonal ambiguity", () => {
    const symmetric = poses().map(p => ({ ...p, nut: hexPrism(9.815, 0.6 + 1.5*p.turnDeg/360, 6, p.turnDeg, false) }));
    const result = measureThreadAdvance({ contract: contract(), poses: symmetric });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("first-harmonic");
  });

  test("a double lead is caught even though the thread still turns", () => {
    const result = measureThreadAdvance({ contract: contract(), poses: poses({ advanceMmPerTurn: 3 }) });
    expect(result.status).toBe("FAIL");
    expect(result.leadPerTurnMm!).toBeCloseTo(3, 6);
  });

  test("a left-hand helix is reported as left-hand", () => {
    const result = measureThreadAdvance({ contract: contract({ hand: "left" }), poses: poses({ advanceMmPerTurn: -1.5 }) });
    expect(result.status).toBe("PASS");
    expect(result.hand).toBe("left");
    expect(result.leadPerTurnMm!).toBeCloseTo(-1.5, 6);
  });

  test("a moving bolt fails the stillness control", () => {
    const result = measureThreadAdvance({ contract: contract(), poses: poses({ boltDriftMm: 0.2 }) });
    expect(result.status).toBe("FAIL");
    expect(result.boltDriftMm!).toBeGreaterThan(0.1);
    expect(result.failures.join(" ")).toContain("bolt moves");
  });

  test("too few turns fails the declared coverage", () => {
    const result = measureThreadAdvance({ contract: contract({ minTurns: 3 }), poses: poses() });
    expect(result.status).toBe("FAIL");
    expect(result.failures.join(" ")).toContain("turns");
  });

  test("fewer than three poses is refused rather than fitted", () => {
    expect(() => measureThreadAdvance({ contract: contract(), poses: poses().slice(0, 2) })).toThrow("3 to 64 poses");
  });

  test("a mesh without a hexagonal outline is not run, not passed", () => {
    const broken = poses().map((pose) => ({ ...pose, nut: hexPrism(4, 0.6, 6) }));
    const result = measureThreadAdvance({ contract: contract(), poses: broken });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("hexagonal outline");
  });
});
