#!/usr/bin/env bun
/**
 * Offline evidence for the two original gear fixtures (A10 first increment).
 *
 * It renders the actual sources with the local OpenSCAD backend, measures tooth
 * counts, tip/root/pitch radii, marker orientations and bore centres from the
 * produced STL triangles, and checks the external-pair and epicyclic ratios.
 * No model call, no product route and no physical claim is involved.
 *
 * Exit codes: 0 both checks PASS, 1 a measured mismatch, 2 incomplete evidence.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  checkGearCoupling,
  checkPlanetaryCoupling,
  measureGearMarkerAngle,
  measureGearProfile,
  type GearCouplingPose,
  type GearProfileMeasurement,
  type PlanetaryPose,
} from "../../src/lib/assembly/gear-marker";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";

const wrap180 = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const round = (value: number | null | undefined) => value === null || value === undefined ? null : Number(value.toFixed(6));

const gearPairPath = "benchmarks/assembly/gear_pair.scad";
const planetaryPath = "benchmarks/assembly/planetary_gear.scad";

function profileSummary(profile: GearProfileMeasurement) {
  return {
    status: profile.status,
    artifactSha256: profile.artifactSha256,
    axisSource: profile.axisSource,
    centerMm: profile.centerMm ? [round(profile.centerMm[0]), round(profile.centerMm[1])] : null,
    toothCount: profile.toothCount,
    angularPitchDeg: round(profile.angularPitchDeg),
    tipRadiusMm: round(profile.tipRadiusMm),
    rootRadiusMm: round(profile.rootRadiusMm),
    pitchRadiusMm: round(profile.pitchRadiusMm),
    phaseResidualDeg: round(profile.phaseResidualDeg),
    markerAngleDeg: round(profile.marker?.angleDeg),
    markerVertexCount: profile.marker?.vertexCount ?? 0,
    reason: profile.reason,
  };
}

async function externalPair() {
  const source = await readFile(gearPairPath, "utf8");
  const poses: GearCouplingPose[] = [];
  const artifacts: string[] = [];
  let pinion: GearProfileMeasurement | null = null;
  let wheel: GearProfileMeasurement | null = null;
  let pinionReference: GearProfileMeasurement | null = null;
  let wheelReference: GearProfileMeasurement | null = null;
  for (const inputDeg of [0, 60, 120, 180, 240, 300]) {
    const parts = await renderAssemblyParts({
      scadSource: source,
      parameters: { input_deg: inputDeg },
      parts: [{ partId: "pinion", selector: "pinion_pose" }, { partId: "wheel", selector: "wheel_pose" }],
    });
    const pinionStl = parts.find(part => part.partId === "pinion")!.stl;
    const wheelStl = parts.find(part => part.partId === "wheel")!.stl;
    pinion = measureGearProfile({ stl: pinionStl, mode: "external", center: [0, 0] });
    wheel = measureGearProfile({ stl: wheelStl, mode: "external", center: [36, 0] });
    if (pinion.artifactSha256) artifacts.push(pinion.artifactSha256);
    if (wheel.artifactSha256) artifacts.push(wheel.artifactSha256);
    if (pinion.status !== "MEASURED" || wheel.status !== "MEASURED" || !pinion.marker || !wheel.marker) {
      return { sourceSha256: sha256(source), status: "NOT_RUN" as const,
        reason: `pose ${inputDeg}: ${pinion.reason} / ${wheel.reason}`, profiles: null, poses: [] };
    }
    if (inputDeg === 0) { pinionReference = pinion; wheelReference = wheel; }
    poses.push({ inputDeg, pinionAngleDeg: pinion.marker.angleDeg, wheelAngleDeg: wheel.marker.angleDeg });
  }
  if (!pinionReference || !wheelReference) throw new Error("the zero-input pose must come first");
  const result = checkGearCoupling({ poses, pinion: pinionReference, wheel: wheelReference, expectedRatio: -0.5,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.2 });
  return {
    sourcePath: gearPairPath,
    sourceSha256: sha256(source),
    generatedArtifactSha256: [...new Set(artifacts)],
    profiles: { pinion: profileSummary(pinionReference), wheel: profileSummary(wheelReference) },
    poses,
    result,
  };
}

async function planetaryStage() {
  const source = await readFile(planetaryPath, "utf8");
  const ringParts = await renderAssemblyParts({
    scadSource: source,
    parts: [{ partId: "ring", selector: "ring" }],
  });
  const ring = measureGearProfile({ stl: ringParts[0].stl, mode: "internal", center: [0, 0], measureAxis: false });
  if (ring.status !== "MEASURED") {
    return { sourceSha256: sha256(source), status: "NOT_RUN" as const, reason: `ring: ${ring.reason}`, profiles: null, poses: [] };
  }
  let carrierPhase: number | null = null;
  let sun: GearProfileMeasurement | null = null;
  let planet: GearProfileMeasurement | null = null;
  let sunReference: GearProfileMeasurement | null = null;
  let planetReference: GearProfileMeasurement | null = null;
  const poses: PlanetaryPose[] = [];
  const artifacts: string[] = [];
  for (const inputDeg of [0, 120, 240, -120, -240]) {
    const parts = await renderAssemblyParts({
      scadSource: source,
      parameters: { input_deg: inputDeg },
      parts: [
        { partId: "sun", selector: "sun_pose" },
        { partId: "planet", selector: "planet_pose" },
        { partId: "carrier", selector: "carrier_pose" },
      ],
    });
    const stl = (partId: string) => parts.find(part => part.partId === partId)!.stl;
    const carrierMarker = measureGearMarkerAngle({ stl: stl("carrier"), center: [0, 0], minRadiusMm: 9.5, maxRadiusMm: 12.6 });
    if (carrierMarker.status !== "MEASURED" || carrierMarker.angleDeg === null) {
      return { sourceSha256: sha256(source), status: "NOT_RUN" as const, reason: `carrier ${inputDeg}: ${carrierMarker.reason}`, profiles: null, poses: [] };
    }
    if (inputDeg === 0) carrierPhase = carrierMarker.angleDeg;
    if (carrierPhase === null) throw new Error("the zero-input pose must come first");
    const carrierAngleDeg = wrap180(carrierMarker.angleDeg - carrierPhase);
    const seed: [number, number] = [
      24 * Math.cos(carrierAngleDeg * Math.PI / 180),
      24 * Math.sin(carrierAngleDeg * Math.PI / 180),
    ];
    sun = measureGearProfile({ stl: stl("sun"), mode: "external", center: [0, 0] });
    planet = measureGearProfile({ stl: stl("planet"), mode: "external", center: seed });
    for (const profile of [sun, planet]) if (profile.artifactSha256) artifacts.push(profile.artifactSha256);
    if (sun.status !== "MEASURED" || planet.status !== "MEASURED" || !sun.marker || !planet.marker) {
      return { sourceSha256: sha256(source), status: "NOT_RUN" as const,
        reason: `pose ${inputDeg}: ${sun.reason} / ${planet.reason}`, profiles: null, poses: [] };
    }
    if (inputDeg === 0) { sunReference = sun; planetReference = planet; }
    poses.push({ inputDeg, sunAngleDeg: sun.marker.angleDeg, carrierAngleDeg,
      planetAngleDeg: planet.marker.angleDeg, planetCenterMm: planet.centerMm! });
  }
  if (!sunReference || !planetReference) throw new Error("the zero-input pose must come first");
  const result = checkPlanetaryCoupling({ poses, sun: sunReference, planet: planetReference, ring,
    angleToleranceDeg: 0.5, ratioTolerance: 0.005, centerDistanceToleranceMm: 0.25 });
  return {
    sourcePath: planetaryPath,
    sourceSha256: sha256(source),
    generatedArtifactSha256: [...new Set(artifacts)],
    profiles: { sun: profileSummary(sunReference), planet: profileSummary(planetReference), ring: profileSummary(ring) },
    poses,
    result,
  };
}

const [external, planetary] = await Promise.all([externalPair(), planetaryStage()]);
const report = {
  schemaVersion: "assembly-gear-stage.v1",
  generatedAt: new Date().toISOString(),
  backend: process.env.AGENTSCAD_OPENSCAD_BACKEND ?? "native",
  boundary: [
    "Measured on the rendered STL triangles of the listed hand-written fixtures; no product route, model call or hidden task is involved.",
    "Pitch radius is a standard full-depth estimate from measured tip/root radii, not a metrology-grade pitch-circle measurement.",
    "External sun/planet axes are refined from through-bores; the internal ring axis is declared because it has no bore.",
    "Straight-sided teeth, not involute: tooth contact, backlash, load capacity, efficiency, wear and physical manufacture are NOT_RUN.",
    "Marker tabs and central bores are measurement features; they are not evidence of the intended feature identity in an arbitrary generated part.",
  ],
  externalPair: external,
  planetary,
};
console.log(JSON.stringify(report, null, 2));
const statuses = [external.result?.status, planetary.result?.status];
if (statuses.every(status => status === "PASS")) process.exit(0);
if (statuses.some(status => status === "FAIL")) process.exit(1);
process.exit(2);
