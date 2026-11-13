import { describe, expect, test } from "bun:test";
import { prismStl } from "../geometry/__tests__/prism";
import { tubeStl, mergeStl } from "../geometry/__tests__/solids";
import { assessFit, measureRevoluteFit } from "./fit-measurement";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const axisFrame = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };

function spec(options: { shaftTransform?: number[]; frameB?: typeof axisFrame | null } = {}) {
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "bore", name: "Bore part", selector: "bore", source: "generated", material: null },
      { id: "shaft", name: "Shaft part", selector: "shaft", source: "generated", material: null },
    ],
    instances: [
      { id: "bore-instance", partId: "bore", subassemblyId: null, transform: identity },
      { id: "shaft-instance", partId: "shaft", subassemblyId: null, transform: options.shaftTransform ?? identity },
    ],
    subassemblies: [], groundedInstanceId: "bore-instance",
    connections: [{
      id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance",
      frameA: axisFrame, frameB: options.frameB === undefined ? axisFrame : options.frameB,
      range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
}

const meshes = {
  bore: prismStl({ radius: 3.2, height: 10, segments: 64 }),
  shaft: prismStl({ radius: 3, height: 12, segments: 64, z0: -1 }),
};

const inradius = (radius: number, segments: number) => radius * Math.cos(Math.PI / segments);

describe("revolute fit measurement", () => {
  test("reports the diametral clearance interval implied by the tessellation", () => {
    const result = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(result.status).toBe("MEASURED");
    expect(result.bore!.measurement.segmentCount).toBe(64);
    expect(result.shaft!.measurement.segmentCount).toBe(64);
    // Bore circumradius 3.2, shaft circumradius 3.0.
    expect(result.clearanceMm!.min).toBeCloseTo(2 * inradius(3.2, 64) - 6, 4);
    expect(result.clearanceMm!.max).toBeCloseTo(6.4 - 2 * inradius(3, 64), 4);
    expect(result.axis!.offsetMm).toBeLessThan(1e-3);
    expect(result.axis!.angleDeg).toBeLessThan(1e-3);
    expect(result.bore!.seedOffsetMm).toBeLessThan(1e-3);
  });

  test("independent section structure reveals that a declared bore was actually solid", () => {
    const checked = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(checked.status).toBe("MEASURED");
    expect(checked.bore?.roleCheck?.status).toBe("OBSERVED");
    expect(checked.bore?.roleCheck?.observedRole).toBe("shaft");
    expect(checked.shaft?.roleCheck?.observedRole).toBe("shaft");
    // Numeric clearance alone must never be described as proof of a bore.
    expect(checked.clearanceMm?.min).toBeGreaterThan(0);
  });

  test("sampled closed annular bore and solid pin are observed from STL, not declared names", () => {
    const actual = {
      bore: tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
      shaft: prismStl({ radius: 3, height: 12, z0: -1, segments: 64 }),
    };
    const checked = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes: actual, boreInstanceId: "bore-instance" });
    expect(checked.status).toBe("MEASURED");
    expect(checked.bore?.roleCheck?.status).toBe("OBSERVED");
    expect(checked.bore?.roleCheck?.observedRole).toBe("bore");
    expect(checked.shaft?.roleCheck?.status).toBe("OBSERVED");
    expect(checked.shaft?.roleCheck?.observedRole).toBe("shaft");
    expect(checked.clearanceMm?.min).toBeCloseTo(2 * inradius(3.2, 64) - 6, 4);
  });

  test("nested-shell decoy never obtains an observed bore role", () => {
    const actual = {
      bore: mergeStl(
        tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
        prismStl({ radius: 1, height: 10, segments: 64 }),
      ),
      shaft: meshes.shaft,
    };
    const checked = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes: actual, boreInstanceId: "bore-instance" });
    // A regular-looking inner surface alone is not enough to trust a bore.
    expect(checked.bore?.roleCheck?.status === "OBSERVED" && checked.bore?.roleCheck?.observedRole === "bore").toBe(false);
  });

  test("a frozen band that the geometry does not meet fails, and a wider documented band passes", () => {
    const result = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    const strict = assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.1, max: 0.3 } });
    expect(strict.status).toBe("FAIL");
    expect(strict.reason).toContain("outside the frozen");
    const documented = assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } });
    expect(documented.status).toBe("PASS");
  });

  test("declaring the shaft as the bore produces a negative clearance instead of a pass", () => {
    const result = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes, boreInstanceId: "shaft-instance" });
    expect(result.status).toBe("MEASURED");
    expect(result.clearanceMm!.max).toBeLessThan(0);
    expect(assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } }).status).toBe("FAIL");
  });

  test("a translated instance is measured in the assembly frame", () => {
    const offset = [1, 0, 0, 0.12, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const result = measureRevoluteFit({ spec: spec({ shaftTransform: offset }), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(result.status).toBe("MEASURED");
    // The shaft axis moved 0.12 mm in x; the clearance is unchanged by translation.
    expect(result.axis!.offsetMm).toBeCloseTo(0.12, 3);
    expect(result.radialEnclosure?.maximumCenterOffsetMm).toBeCloseTo(0.12, 3);
    expect(result.clearanceMm!.min).toBeCloseTo(2 * inradius(3.2, 64) - 6, 4);
  });

  test("measured eccentricity can invalidate an otherwise matching diameter band", () => {
    const shifted = [1, 0, 0, 0.25, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const result = measureRevoluteFit({
      spec: spec({ shaftTransform: shifted }), connectionId: "joint", meshes,
      boreInstanceId: "bore-instance",
    });
    expect(result.status).toBe("MEASURED");
    expect(result.clearanceMm!.min).toBeGreaterThan(0.35);
    expect(result.radialEnclosure?.status).toBe("OBSERVED");
    expect(result.radialEnclosure?.maximumCenterOffsetMm).toBeCloseTo(0.25, 3);
    expect(result.radialEnclosure?.minimumMarginMm).toBeLessThan(0);
    const assessed = assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } });
    expect(assessed.status).toBe("NOT_RUN");
    expect(assessed.reason).toContain("radial enclosure");
    // Negative conservative radius margin is not itself proof of triangle collision.
    expect(assessed.reason).toContain("neither collision");
  });

  test("an angularly tilted shaft loses radial clearance along the sampled overlap", () => {
    const deg = 3 * Math.PI / 180;
    const c = Math.cos(deg), si = Math.sin(deg);
    const tilted = [c, 0, si, 0, 0, 1, 0, 0, -si, 0, c, 0, 0, 0, 0, 1];
    const result = measureRevoluteFit({
      spec: spec({ shaftTransform: tilted }), connectionId: "joint", meshes,
      boreInstanceId: "bore-instance",
    });
    expect(result.status).toBe("MEASURED");
    expect(result.axis!.angleDeg).toBeCloseTo(3, 1);
    expect(result.radialEnclosure?.stations).toHaveLength(3);
    expect(result.radialEnclosure?.maximumCenterOffsetMm).toBeGreaterThan(0.30);
    expect(result.radialEnclosure?.minimumMarginMm).toBeLessThan(0);
    expect(assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } }).status).toBe("NOT_RUN");
  });

  test("an ordinary small eccentricity retains positive measured radial margin", () => {
    const shifted = [1, 0, 0, 0.12, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const result = measureRevoluteFit({
      spec: spec({ shaftTransform: shifted }), connectionId: "joint", meshes,
      boreInstanceId: "bore-instance",
    });
    const enclosure = result.radialEnclosure!;
    expect(enclosure.minimumMarginMm).toBeGreaterThan(0.07);
    expect(enclosure.minimumMarginMm).toBeLessThan(0.09);
    expect(enclosure.stations.every(x => x.conservativeMarginMm > enclosure.safetyReserveMm)).toBe(true);
    expect(assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } }).status).toBe("PASS");
    expect(enclosure.coverage).toContain("Corresponding sampled axial stations only");
  });

  test("one sampled station cannot establish the relative radial enclosure", () => {
    const result = measureRevoluteFit({
      spec: spec(), connectionId: "joint", meshes, boreInstanceId: "bore-instance",
      stationsMm: [5],
    });
    expect(result.status).toBe("MEASURED");
    expect(result.radialEnclosure?.status).toBe("NOT_RUN");
    expect(assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } }).status).toBe("NOT_RUN");
  });

  test("a frame origin elsewhere on the same axis does not change the measured fit", () => {
    // The line is identical; only its parameterisation moved, so the result
    // must be the same. Comparing raw local offsets would break here.
    const shifted = { origin: [0, 0, 20] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
    const result = measureRevoluteFit({ spec: spec({ frameB: shifted }), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(result.status).toBe("MEASURED");
    expect(result.clearanceMm!.min).toBeCloseTo(2 * inradius(3.2, 64) - 6, 4);
    expect(result.clearanceMm!.max).toBeCloseTo(6.4 - 2 * inradius(3, 64), 4);
  });

  test("frames that do not describe one axis are refused", () => {
    const perpendicular = { origin: [0, 0, 0] as [number, number, number], direction: [1, 0, 0] as [number, number, number] };
    const result = measureRevoluteFit({ spec: spec({ frameB: perpendicular }), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("one axis");
  });

  test("a connection without frames cannot be measured", () => {
    const result = measureRevoluteFit({ spec: spec({ frameB: null }), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("frame on both instances");
    expect(assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0, max: 1 } }).status).toBe("ERROR");
  });

  test("a missing mesh is NOT_RUN, never a pass", () => {
    const result = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes: { bore: meshes.bore }, boreInstanceId: "bore-instance" });
    expect(result.status).toBe("NOT_RUN");
    expect(assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0, max: 1 } }).status).toBe("NOT_RUN");
  });

  test("a requirement for a different connection is refused", () => {
    const result = measureRevoluteFit({ spec: spec(), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    expect(assessFit(result, { connectionId: "other", diametralClearanceMm: { min: 0, max: 1 } }).status).toBe("ERROR");
  });

  test("axis limits are only asserted when they are supplied", () => {
    const offset = [1, 0, 0, 0.12, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const result = measureRevoluteFit({ spec: spec({ shaftTransform: offset }), connectionId: "joint", meshes, boreInstanceId: "bore-instance" });
    const loose = assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 } });
    expect(loose.status).toBe("PASS");
    const tight = assessFit(result, { connectionId: "joint", diametralClearanceMm: { min: 0.35, max: 0.45 }, maxAxisOffsetMm: 0.05 });
    expect(tight.status).toBe("FAIL");
    expect(tight.reason).toContain("axis offset");
  });
});
