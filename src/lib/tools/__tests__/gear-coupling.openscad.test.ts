import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderAssemblyParts } from "../assembly-part-renderer";
import {
  checkGearCoupling,
  measureGearProfile,
  type GearCouplingPose,
  type GearProfileMeasurement,
} from "../../assembly/gear-marker";

const fixturePath = "benchmarks/assembly/gear_pair.scad";

async function observePair(scadSource: string, inputs: number[], requireMarker = true) {
  const poses: GearCouplingPose[] = [];
  let pinion: GearProfileMeasurement | null = null;
  let wheel: GearProfileMeasurement | null = null;
  let pinionReference: GearProfileMeasurement | null = null;
  let wheelReference: GearProfileMeasurement | null = null;
  for (const inputDeg of inputs) {
    const parts = await renderAssemblyParts({
      scadSource,
      parts: [{ partId: "pinion", selector: "pinion_pose" }, { partId: "wheel", selector: "wheel_pose" }],
      parameters: { input_deg: inputDeg },
    });
    const pinionStl = parts.find(part => part.partId === "pinion")!.stl;
    const wheelStl = parts.find(part => part.partId === "wheel")!.stl;
    pinion = measureGearProfile({ stl: pinionStl, mode: "external", center: [0, 0] });
    wheel = measureGearProfile({ stl: wheelStl, mode: "external", center: [36, 0] });
    if (pinion.status !== "MEASURED" || wheel.status !== "MEASURED"
        || (requireMarker && (!pinion.marker || !wheel.marker))) {
      throw new Error(`profile ${inputDeg}: ${pinion.reason} / ${wheel.reason}`);
    }
    if (inputDeg === 0) { pinionReference = pinion; wheelReference = wheel; }
    poses.push({ inputDeg,
      pinionAngleDeg: pinion.marker?.angleDeg ?? 0,
      wheelAngleDeg: wheel.marker?.angleDeg ?? 0 });
  }
  if (!pinionReference || !wheelReference) throw new Error("the zero-input pose must come first");
  return { poses, pinion: pinionReference, wheel: wheelReference };
}

test("measured teeth and markers show the external pair rotates opposite at the tooth ratio", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const { poses, pinion, wheel } = await observePair(scadSource, [0, 60, 120, 180, 240, 300]);
  expect(pinion.toothCount).toBe(12);
  expect(wheel.toothCount).toBe(24);
  expect(pinion.pitchRadiusMm!).toBeCloseTo(12, 1);
  expect(wheel.pitchRadiusMm!).toBeCloseTo(24, 1);
  expect(pinion.axisSource).toBe("bore");
  expect(wheel.axisSource).toBe("bore");
  expect(pinion.phaseResidualDeg!).toBeLessThan(1);
  expect(wheel.phaseResidualDeg!).toBeLessThan(1);
  const result = checkGearCoupling({ poses, pinion, wheel,
    expectedRatio: -0.5, angleToleranceDeg: 0.5, ratioTolerance: 0.005 });
  expect(result.status, JSON.stringify(result)).toBe("PASS");
  expect(result.measuredRatio!).toBeCloseTo(-0.5, 3);
  expect(result.toothRatio!).toBeCloseTo(-0.5, 6);
  expect(result.centerDistanceMm!).toBeCloseTo(36, 2);
  expect(result.direction).toBe("opposite");
}, 300000);

test("a same-direction source is rejected", async () => {
  const tampered = (await readFile(fixturePath, "utf8")).replace("ratio_sign = -1;", "ratio_sign = 1;");
  const { poses, pinion, wheel } = await observePair(tampered, [0, 60, 120, 180]);
  const result = checkGearCoupling({ poses, pinion, wheel,
    expectedRatio: -0.5, angleToleranceDeg: 0.5, ratioTolerance: 0.005 });
  expect(result.status).toBe("FAIL");
  expect(result.direction).toBe("same");
}, 300000);

test("a declared ratio that disagrees with the measured tooth counts is rejected", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const { poses, pinion, wheel } = await observePair(scadSource, [0, 60, 120, 180]);
  const result = checkGearCoupling({ poses, pinion, wheel,
    expectedRatio: -0.4, angleToleranceDeg: 0.5, ratioTolerance: 0.005 });
  expect(result.status).toBe("FAIL");
  expect(result.reason).toContain("tooth ratio");
  expect(result.toothRatio!).toBeCloseTo(-0.5, 6);
}, 300000);

test("a source that ignores its own pose parameter is not a coupling witness", async () => {
  const tampered = (await readFile(fixturePath, "utf8"))
    .replace("rotate([0, 0, input_deg]) pinion_local();", "pinion_local();");
  const { poses, pinion, wheel } = await observePair(tampered, [0, 60, 120, 180]);
  const result = checkGearCoupling({ poses, pinion, wheel,
    expectedRatio: -0.5, angleToleranceDeg: 0.5, ratioTolerance: 0.005 });
  expect(result.status).toBe("FAIL");
  expect(result.reason).toContain("pinion marker");
}, 300000);

test("a gear without an index marker is NOT_RUN, not a fabricated coupling pass", async () => {
  const source = await readFile(fixturePath, "utf8");
  const tampered = source
    .replace(/      rotate\(\[0, 0, marker_angle\]\)[\s\S]*?cube\(\[marker_outer_r - marker_inner_r, 3, thickness\], center = true\);/, "");
  expect(tampered).not.toBe(source);
  const { poses, pinion, wheel } = await observePair(tampered, [0, 60, 120, 180], false);
  const result = checkGearCoupling({ poses, pinion, wheel,
    expectedRatio: -0.5, angleToleranceDeg: 0.5, ratioTolerance: 0.005 });
  expect(result.status).toBe("NOT_RUN");
}, 300000);
