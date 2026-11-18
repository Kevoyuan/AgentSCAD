import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderAssemblyParts } from "../assembly-part-renderer";
import {
  checkPlanetaryCoupling,
  measureGearMarkerAngle,
  measureGearProfile,
  type GearProfileMeasurement,
  type PlanetaryPose,
} from "../../assembly/gear-marker";

const fixturePath = "benchmarks/assembly/planetary_gear.scad";
const carrierRadiusMm = 24;
const wrap180 = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;

async function observePlanetary(scadSource: string, inputs: number[], requireMarker = true) {
  const ringParts = await renderAssemblyParts({
    scadSource,
    parts: [{ partId: "ring", selector: "ring" }],
  });
  const ring = measureGearProfile({ stl: ringParts[0].stl, mode: "internal", center: [0, 0], measureAxis: false });
  if (ring.status !== "MEASURED") throw new Error(`ring profile: ${ring.reason}`);
  let carrierPhase: number | null = null;
  let sun: GearProfileMeasurement | null = null;
  let planet: GearProfileMeasurement | null = null;
  let sunReference: GearProfileMeasurement | null = null;
  let planetReference: GearProfileMeasurement | null = null;
  const poses: PlanetaryPose[] = [];
  for (const inputDeg of inputs) {
    const parts = await renderAssemblyParts({
      scadSource,
      parameters: { input_deg: inputDeg },
      parts: [
        { partId: "sun", selector: "sun_pose" },
        { partId: "planet", selector: "planet_pose" },
        { partId: "carrier", selector: "carrier_pose" },
      ],
    });
    const stl = (partId: string) => parts.find(part => part.partId === partId)!.stl;
    const carrierMarker = measureGearMarkerAngle({
      stl: stl("carrier"), center: [0, 0], minRadiusMm: 9.5, maxRadiusMm: 12.6,
    });
    if (carrierMarker.status !== "MEASURED" || carrierMarker.angleDeg === null) {
      throw new Error(`carrier marker ${inputDeg}: ${carrierMarker.reason}`);
    }
    if (inputDeg === 0) carrierPhase = carrierMarker.angleDeg;
    if (carrierPhase === null) throw new Error("the zero-input pose must come first");
    const carrierAngleDeg = wrap180(carrierMarker.angleDeg - carrierPhase);
    const seed: [number, number] = [
      carrierRadiusMm * Math.cos(carrierAngleDeg * Math.PI / 180),
      carrierRadiusMm * Math.sin(carrierAngleDeg * Math.PI / 180),
    ];
    sun = measureGearProfile({ stl: stl("sun"), mode: "external", center: [0, 0] });
    planet = measureGearProfile({ stl: stl("planet"), mode: "external", center: seed });
    if (sun.status !== "MEASURED" || planet.status !== "MEASURED"
        || (requireMarker && (!sun.marker || !planet.marker))) {
      throw new Error(`profile ${inputDeg}: ${sun.reason} / ${planet.reason}`);
    }
    if (inputDeg === 0) { sunReference = sun; planetReference = planet; }
    poses.push({
      inputDeg,
      sunAngleDeg: sun.marker?.angleDeg ?? 0,
      carrierAngleDeg,
      planetAngleDeg: planet.marker?.angleDeg ?? 0,
      planetCenterMm: planet.centerMm ?? [0, 0],
    });
  }
  if (!sunReference || !planetReference) throw new Error("the zero-input pose must come first");
  return { poses, sun: sunReference, planet: planetReference, ring };
}

test("measured teeth and marker slopes match the epicyclic ratios in both directions", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const { poses, sun, planet, ring } = await observePlanetary(scadSource, [0, 120, 240, -120, -240]);
  expect(sun.toothCount).toBe(12);
  expect(planet.toothCount).toBe(12);
  expect(ring.toothCount).toBe(36);
  expect(sun.axisSource).toBe("bore");
  expect(planet.axisSource).toBe("bore");
  expect(ring.axisSource).toBe("declared");
  expect(sun.pitchRadiusMm!).toBeCloseTo(12, 1);
  expect(planet.pitchRadiusMm!).toBeCloseTo(12, 1);
  expect(ring.pitchRadiusMm!).toBeCloseTo(36, 1);
  expect(poses[0].sunAngleDeg).toBeCloseTo(15, 2);
  expect(poses[0].planetAngleDeg).toBeCloseTo(15, 2);
  const result = checkPlanetaryCoupling({ poses, sun, planet, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  expect(result.status, JSON.stringify(result)).toBe("PASS");
  expect(result.carrierRatio).toBeCloseTo(0.25, 6);
  expect(result.planetAbsoluteRatio).toBeCloseTo(-0.5, 6);
  expect(result.sunRatio!).toBeCloseTo(1, 4);
  expect(result.carrierRatioMeasured!).toBeCloseTo(0.25, 4);
  expect(result.planetRatioMeasured!).toBeCloseTo(-0.5, 4);
  expect(result.reversalSamples).toBe(2);
  expect(result.centerDistanceResidualMaxMm!).toBeLessThan(0.05);
  expect(poses.map(pose => pose.planetCenterMm[0].toFixed(3))).toEqual(["24.000", "20.785", "12.000", "20.785", "12.000"]);
}, 300000);

test("a reverse planet rotation is rejected even though the tooth counts are unchanged", async () => {
  const tampered = (await readFile(fixturePath, "utf8")).replace(
    "planet_angle = carrier_angle * (1 + sun_teeth / planet_teeth)\n  - input_deg * sun_teeth / planet_teeth;",
    "planet_angle = carrier_angle;",
  );
  const { poses, sun, planet, ring } = await observePlanetary(tampered, [0, 120, 240, -120, -240]);
  const result = checkPlanetaryCoupling({ poses, sun, planet, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  expect(result.status).toBe("FAIL");
  expect(result.planetRatioMeasured!).toBeCloseTo(0.25, 4);
}, 300000);

test("a carrier that does not follow the measured tooth ratio is rejected", async () => {
  const tampered = (await readFile(fixturePath, "utf8")).replace(
    "carrier_angle = input_deg * sun_teeth / (sun_teeth + ring_teeth);",
    "carrier_angle = input_deg * 0.3;",
  );
  const { poses, sun, planet, ring } = await observePlanetary(tampered, [0, 120, 240, -120, -240]);
  const result = checkPlanetaryCoupling({ poses, sun, planet, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  expect(result.status).toBe("FAIL");
  expect(result.carrierRatioMeasured!).toBeCloseTo(0.3, 4);
}, 300000);

test("a ring whose measured teeth do not close the planetary relation fails", async () => {
  const tampered = (await readFile(fixturePath, "utf8")).replace("ring_teeth = 36;", "ring_teeth = 35;");
  const { poses, sun, planet, ring } = await observePlanetary(tampered, [0, 120, 240, -120, -240]);
  expect(ring.toothCount).toBe(35);
  const result = checkPlanetaryCoupling({ poses, sun, planet, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  expect(result.status).toBe("FAIL");
  expect(result.reason).toContain("ring = sun + 2");
}, 300000);

test("one input sign is NOT_RUN for a reversal claim", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const { poses, sun, planet, ring } = await observePlanetary(scadSource, [0, 60, 120, 180]);
  const result = checkPlanetaryCoupling({ poses, sun, planet, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  expect(result.status).toBe("NOT_RUN");
  expect(result.reason).toContain("Both");
}, 300000);

test("removing the index markers makes the epicyclic ratio NOT_RUN", async () => {
  const source = await readFile(fixturePath, "utf8");
  const tampered = source.replace(/      \/\/ A radial wedge[\s\S]*?\n          \)\);/, "");
  expect(tampered).not.toBe(source);
  const { poses, sun, planet, ring } = await observePlanetary(tampered, [0, 120, 240, -120, -240], false);
  const result = checkPlanetaryCoupling({ poses, sun, planet, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  expect(result.status).toBe("NOT_RUN");
}, 300000);
