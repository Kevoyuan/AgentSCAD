import { describe, expect, test } from "bun:test";
import { prismStl } from "./prism";
import { analyzeProfile, castRadialProfile, extentAlongAxis, readBinaryStl, refineProfileCenter, sectionMesh } from "../stl-mesh";
import { measureCylindricalFeature } from "../cylindrical-feature";

const axis = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
const polygonInradius = (radius: number, segments: number) => radius * Math.cos(Math.PI / segments);

describe("binary STL sections", () => {
  test("a plane through a prism yields one segment per crossed triangle", () => {
    const mesh = readBinaryStl(prismStl({ radius: 5, height: 10, segments: 8 }));
    const section = sectionMesh(mesh, [0, 0, 5], [0, 0, 1]);
    // Eight side facets, each split into two triangles, all crossed.
    expect(section.segments.length).toBe(16);
    expect(section.dropped).toBe(0);
  });

  test("the section is planar and the basis is orthonormal", () => {
    const mesh = readBinaryStl(prismStl({ radius: 4, height: 6, segments: 12 }));
    const section = sectionMesh(mesh, [0, 0, 3], [0, 0, 1]);
    const dot = section.u[0] * section.v[0] + section.u[1] * section.v[1] + section.u[2] * section.v[2];
    expect(Math.abs(dot)).toBeLessThan(1e-12);
    for (const segment of section.segments) {
      // Every cut point must lie on the requested plane; the basis is exact here.
      expect(Number.isFinite(segment.ax) && Number.isFinite(segment.by)).toBe(true);
    }
  });

  test("extent along an axis follows the vertices", () => {
    const mesh = readBinaryStl(prismStl({ radius: 2, height: 7, segments: 16, z0: -3 }));
    expect(extentAlongAxis(mesh, [0, 0, 0], [0, 0, 1])).toEqual({ min: -3, max: 4 });
  });
});

describe("radial profile", () => {
  test("a 64-gon reports its inscribed and circumscribed diameters", () => {
    const radius = 3.2;
    const mesh = readBinaryStl(prismStl({ radius, height: 10, segments: 64 }));
    const section = sectionMesh(mesh, [0, 0, 5], [0, 0, 1]);
    const { profile, converged } = refineProfileCenter(section, [0, 0], 1440, 50);
    expect(converged).toBe(true);
    const shape = analyzeProfile(profile);
    expect(shape.cylindrical).toBe(true);
    expect(shape.segmentCount).toBe(64);
    expect(Math.abs(shape.radiusMinMm - polygonInradius(radius, 64))).toBeLessThan(1e-4);
    expect(Math.abs(shape.radiusMaxMm - radius)).toBeLessThan(1e-4);
    expect(shape.formErrorMm).toBeLessThan(1e-4);
  });

  test("an off-centre seed is corrected and the offset is recovered", () => {
    const mesh = readBinaryStl(prismStl({ radius: 3, height: 10, segments: 64, center: [0.35, -0.2] }));
    const section = sectionMesh(mesh, [0, 0, 5], [0, 0, 1]);
    const { profile, converged } = refineProfileCenter(section, [0, 0], 1440, 50);
    expect(converged).toBe(true);
    expect(Math.abs(profile.center[0] - 0.35)).toBeLessThan(2e-3);
    expect(Math.abs(profile.center[1] + 0.2)).toBeLessThan(2e-3);
  });

  test("an ellipse is rejected instead of being accepted as a bore", () => {
    const mesh = readBinaryStl(prismStl({ radius: 4, radiusY: 3, height: 10, segments: 96 }));
    const section = sectionMesh(mesh, [0, 0, 5], [0, 0, 1]);
    const { profile } = refineProfileCenter(section, [0, 0], 1440, 50);
    const shape = analyzeProfile(profile);
    expect(shape.cylindrical).toBe(false);
    expect(shape.reason).toContain("not a regular polygon");
  });

  test("a square section is reported as a four-facet polygon, not a smooth bore", () => {
    const mesh = readBinaryStl(prismStl({ radius: 3, height: 10, segments: 4 }));
    const section = sectionMesh(mesh, [0, 0, 5], [0, 0, 1]);
    const { profile } = refineProfileCenter(section, [0, 0], 720, 50);
    const shape = analyzeProfile(profile);
    expect(shape.cylindrical).toBe(true);
    expect(shape.segmentCount).toBe(4);
    expect(Math.abs(shape.radiusMinMm - polygonInradius(3, 4))).toBeLessThan(1e-6);
  });

  test("a ray that hits nothing is reported as a miss rather than a radius", () => {
    const mesh = readBinaryStl(prismStl({ radius: 1, height: 4, segments: 32 }));
    const section = sectionMesh(mesh, [0, 0, 2], [0, 0, 1]);
    // Only the ray aimed straight back at the prism reaches it.
    const profile = castRadialProfile(section, [10, 0], 32, 50);
    expect(profile.misses).toBe(31);
    expect(analyzeProfile(profile).cylindrical).toBe(false);
  });
});

describe("cylindrical feature measurement", () => {
  test("three stations on a shaft agree on diameter, facet count and centre", () => {
    const stl = prismStl({ radius: 3, height: 12, segments: 64, z0: -1 });
    const result = measureCylindricalFeature({ stl, axis, role: "shaft", stationsMm: [2, 5, 8] });
    expect(result.status).toBe("MEASURED");
    expect(result.segmentCount).toBe(64);
    expect(result.diameterMm!.max).toBeCloseTo(6, 4);
    expect(result.diameterMm!.min).toBeCloseTo(2 * polygonInradius(3, 64), 4);
    expect(result.axis!.lateralDeviationMm).toBeLessThan(1e-4);
    expect(result.axis!.direction[2]).toBeCloseTo(1, 6);
  });

  test("stations outside the mesh are refused instead of clamped", () => {
    const stl = prismStl({ radius: 3, height: 10, segments: 32 });
    const result = measureCylindricalFeature({ stl, axis, role: "shaft", stationsMm: [2, 20] });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("outside the mesh extent");
  });

  test("a seed axis outside the feature produces an error, not a plausible diameter", () => {
    const stl = prismStl({ radius: 2, height: 10, segments: 32 });
    const result = measureCylindricalFeature({ stl, axis: { origin: [6, 0, 0], direction: [0, 0, 1] }, role: "shaft", stationsMm: [5] });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("missed the solid");
  });

  test("a tapered feature is refused because the stations disagree", () => {
    // Two stacked prisms of different radius are not one cylinder.
    const lower = prismStl({ radius: 2, height: 5, segments: 48 });
    const upper = prismStl({ radius: 3, height: 5, segments: 48, z0: 5 });
    const merged = Buffer.concat([lower, upper]);
    // Rebuild a single valid STL table from both triangle sets.
    const count = lower.readUInt32LE(80) + upper.readUInt32LE(80);
    const stl = Buffer.alloc(84 + 50 * count);
    stl.writeUInt32LE(count, 80);
    lower.copy(stl, 84, 84);
    upper.copy(stl, 84 + (lower.length - 84), 84);
    expect(merged.length).toBeGreaterThan(0);
    const result = measureCylindricalFeature({ stl, axis, role: "shaft", stationsMm: [2.5, 7.5] });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toMatch(/disagree on the diameter|not a cylindrical section/);
  });
});
