import { createHash } from "crypto";
import { requiredMeasurementStatus } from "../assembly/measurement-status";
import { canonicalJson } from "../canonical-json";
import { measureSliderCrankGeometry, type SliderCrankGeometryContract } from "../assembly/slider-crank-geometry";
import { measureSliderCrankMotion, type SliderCrankPoseInput } from "../assembly/slider-crank-motion";
import { checkSliderCrank } from "../assembly/slider-crank-check";
import { renderAssemblyParts } from "./assembly-part-renderer";
import type { ScadExecutionOptions } from "./scad-renderer";
import { buildBvh, placeBvh, bvhIntersects } from "../geometry/mesh-collision";
import { readBinaryStl } from "../geometry/stl-mesh";

/** Execute the actual source for every angle; never substitute rigid transforms
 * of a single pose for evidence that the source's motion parameter works.
 */
export async function sampleSliderCrankSource(input: {
  scadSource: string;
  contract: SliderCrankGeometryContract;
  angles: number[];
  motionParameter: string;
  selectors: { crank: string; rod: string; slider: string; frame: string };
  /** Additional named parts included in every collision pose, e.g. retainers. */
  attachments?: Record<string, string>;
  /** E.g. an explicit switch from local manufacturing coordinates to assembly pose. */
  poseParameters?: Record<string, number | string | boolean>;
  options?: ScadExecutionOptions;
  /** Preserve the raw meshes outside the temporary renderer workspace when requested. */
  onArtifacts?: (angle: number, parts: Awaited<ReturnType<typeof renderAssemblyParts>>) => Promise<void>;
}) {
  if (!input.angles.length || input.angles.length > 64 || input.angles.some(a => !Number.isFinite(a)) || new Set(input.angles).size !== input.angles.length) throw new Error("Expected 1 to 64 unique finite input angles");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.motionParameter) || input.motionParameter === "agentscad_part") throw new Error("Invalid motion parameter");
  if (!input.selectors || Object.keys(input.selectors).sort().join(",") !== "crank,frame,rod,slider" ||
      Object.values(input.selectors).some(s => typeof s !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s)) || new Set(Object.values(input.selectors)).size !== 4) {
    throw new Error("Four distinct selectors for crank, frame, rod and slider are required");
  }
  const attachments = input.attachments ?? {};
  if (typeof attachments !== "object" || Array.isArray(attachments) || Object.keys(attachments).length > 12 ||
      Object.entries(attachments).some(([id, selector]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || Object.hasOwn(input.selectors, id) ||
        typeof selector !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(selector)) ||
      new Set([...Object.values(input.selectors), ...Object.values(attachments)]).size !== 4 + Object.keys(attachments).length) {
    throw new Error("Attachment ids and selectors must be distinct from all mechanism roles, with at most 12 attachments");
  }
  const setup = structuredClone({ contract: input.contract, angles: input.angles, motionParameter: input.motionParameter, selectors: input.selectors, attachments, poseParameters: input.poseParameters ?? {} });
  checkSliderCrank({ ...setup.contract, requiredAngles: setup.angles, samples: [] });
  if (!Number.isFinite(setup.contract.sectionYmm) || setup.contract.toleranceMm < 1e-4 ||
      [setup.contract.pinRadiusMm, setup.contract.rodBoreRadiusMm].some(r => !r || !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min <= 0 || r.max < r.min)) {
    throw new Error("Invalid section/radius setup or requested tolerance below the measurement resolution");
  }
  const scadSource = input.scadSource;
  const samples: Array<ReturnType<typeof measureSliderCrankGeometry> | { angleDegrees: number; status: "ERROR"; reason: string }> = [];
  const poses: SliderCrankPoseInput[] = [];
  const collisionSamples: Array<{ angleDegrees: number; status: "PASS" | "FAIL" | "NOT_RUN" | "ERROR"; reason?: string; pairs?: Array<{ a: string; b: string; result: ReturnType<typeof bvhIntersects> }> }> = [];
  for (const angleDegrees of setup.angles) {
    input.options?.signal?.throwIfAborted();
    try {
      const parts = await renderAssemblyParts({
        scadSource, parts: Object.entries({ ...setup.selectors, ...setup.attachments }).map(([partId, selector]) => ({ partId, selector })),
        parameters: { ...setup.poseParameters, [setup.motionParameter]: angleDegrees }, options: input.options,
      });
      await input.onArtifacts?.(angleDegrees, parts);
      const meshes = Object.fromEntries(parts.map(p => [p.partId, p.stl])) as { crank: Buffer; rod: Buffer; slider: Buffer };
      poses.push({ angleDegrees, meshes });
      samples.push(measureSliderCrankGeometry({ angleDegrees, contract: setup.contract, meshes }));
      const placed = parts.map(p => ({ id: p.partId, bvh: placeBvh(buildBvh(readBinaryStl(p.stl))) }));
      const pairs: Array<{ a: string; b: string; result: ReturnType<typeof bvhIntersects> }> = [];
      for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
        pairs.push({ a: placed[a].id, b: placed[b].id, result: bvhIntersects(placed[a].bvh, placed[b].bvh) });
      }
      const status = pairs.some(p => p.result.status === "INTERSECT" || p.result.status === "CONTAINED") ? "FAIL"
        : pairs.some(p => p.result.status === "UNKNOWN") ? "NOT_RUN" : "PASS";
      collisionSamples.push({ angleDegrees, status, pairs });
    } catch (error) {
      input.options?.signal?.throwIfAborted();
      const reason = error instanceof Error ? error.message : "Rendering failed";
      if (!samples.some(s => s.angleDegrees === angleDegrees)) samples.push({ angleDegrees, status: "ERROR" as const, reason });
      collisionSamples.push({ angleDegrees, status: "ERROR", reason });
    }
  }
  // Cross-pose evidence: the crank radius and axis are fitted to the trace the
  // pin actually leaves, the rod has to keep one length, and the pins have to
  // stay parallel to +Y between two slices. None of this is read from the source.
  const motion = poses.length === 0 ? null : (() => {
    try {
      return measureSliderCrankMotion({ contract: setup.contract, poses });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Cross-pose measurement failed";
      return {
        status: "ERROR" as const, reason, poses: [], crank: null, rodLengthMm: null,
        axisDriftMm: null,
        axisCheck: { performed: false, reason: "The cross-pose measurement did not run." },
        coverage: { poses: 0, anglesDegrees: [], stepDeg: null, slicesPerPose: 0, partsPerPose: 0 },
        observations: [], failures: [reason],
      };
    }
  })();
  const motionStatus = motion?.status ?? "NOT_RUN";
  const landmarkStatus = requiredMeasurementStatus(samples.map(s => s.status));
  const collisionStatus = requiredMeasurementStatus(collisionSamples.map(s => s.status));
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
  return {
    schemaVersion: 1, method: "rendered-circular-sections-slider-crank/v1",
    sourceSha256: sha256(scadSource), setupSha256: sha256(canonicalJson(setup)), setup,
    status: requiredMeasurementStatus([landmarkStatus, motionStatus, collisionStatus]),
    landmarkStatus,
    samples,
    motion,
    coverage: "Landmarks: listed input angles and one axial slice only. Cross-pose: crank circle fit, rod length constancy and pin-axis parallelism at the listed angles. Collision: full selected meshes at those angles; no allowed-contact exemptions. No continuous motion, disassembly, load or physical verification.",
    collision: {
      status: collisionStatus,
      samples: collisionSamples,
    },
    physical: { status: "NOT_RUN", reason: "No manufactured specimen was tested." },
  };
}
