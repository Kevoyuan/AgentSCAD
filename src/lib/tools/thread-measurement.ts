import { checkThreadExit } from "../assembly/thread-exit";
import { createHash } from "crypto";
import { canonicalJson } from "../canonical-json";
import { requiredMeasurementStatus } from "../assembly/measurement-status";
import {
  measureThreadGeometry,
  type ThreadGeometryContract,
  type ThreadGeometryResult,
} from "../assembly/thread-geometry";
import {
  measureThreadAdvance,
  type ThreadMotionContract,
  type ThreadMotionResult,
} from "../assembly/thread-motion";
import { renderAssemblyParts } from "./assembly-part-renderer";
import type { ScadExecutionOptions } from "./scad-renderer";
import { buildBvh, placeBvh, bvhIntersects } from "../geometry/mesh-collision";
import { readBinaryStl } from "../geometry/stl-mesh";

/**
 * Renders the actual source twice: once with every pose parameter off, so the
 * thread is measured in the part's own frame, and once per commanded turn angle,
 * so the advance is measured from meshes the source produced at that angle.
 */
export async function sampleThreadedFastener(input: {
  scadSource: string;
  selectors: { bolt: string; nut: string };
  geometry: { external: ThreadGeometryContract; internal: ThreadGeometryContract };
  motion: ThreadMotionContract;
  /** Optional frozen requirement for full axial removal. */
  exit?: { minTurns: number; maxStepDeg: number; clearanceMm: number; minExitTurns?: number; maxExitTurns?: number; startAngleDeg?: number };
  /** Commanded nut turn angles; must cover at least `motion.minTurns`. */
  turns: number[];
  /** E.g. the explicit switch from manufacturing coordinates to assembly pose. */
  poseParameters?: Record<string, number | string | boolean>;
  /** Fixed parameters applied to every render, e.g. a deliberate defect. */
  parameters?: Record<string, number | string | boolean>;
  options?: ScadExecutionOptions;
  /** Test or local adapter; no renderer is invoked before contract preflight. */
  render?: typeof renderAssemblyParts;
  onArtifacts?: (label: string, parts: Awaited<ReturnType<typeof renderAssemblyParts>>) => Promise<void>;
}) {
  const { selectors } = input;
  if (!selectors || Object.keys(selectors).sort().join(",") !== "bolt,nut" ||
      Object.values(selectors).some((s) => typeof s !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s)) ||
      new Set(Object.values(selectors)).size !== 2) {
    throw new Error("Two distinct selectors for the bolt and the nut are required");
  }
  if (!Array.isArray(input.turns) || input.turns.length < 3 || input.turns.length > 64 ||
      input.turns.some((turn) => !Number.isFinite(turn)) || new Set(input.turns).size !== input.turns.length) {
    throw new Error("Expected 3 to 64 unique finite turn angles");
  }
  // Reject invalid evaluation contracts and angle sequences before any expensive render.
  // This validation is intentionally independent of generated mesh data.
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const hand = (h: unknown) => h === "right" || h === "left";
  const diameterRange = (r: { min: number; max: number } | undefined) =>
    !!r && nonnegative(r.min) && positive(r.max) && r.min <= r.max;
  for (const g of [input.geometry?.external, input.geometry?.internal]) {
    if (!g || !positive(g.pitchMm) || !positive(g.toleranceMm) || !positive(g.searchRadiusMm) || !hand(g.hand) ||
        !diameterRange(g.majorDiameterMm) || !diameterRange(g.minorDiameterMm) || !g.threadRangeMm ||
        !Number.isFinite(g.threadRangeMm.min) || !Number.isFinite(g.threadRangeMm.max) || g.threadRangeMm.max <= g.threadRangeMm.min) {
      throw new Error("Invalid thread geometry contract");
    }
  }
  const motionContract = input.motion;
  if (!motionContract || !positive(motionContract.pitchMm) || !positive(motionContract.toleranceMm) || !positive(motionContract.orientationToleranceDeg) ||
      !positive(motionContract.minTurns) || !positive(motionContract.cornerRadiusMm) || !hand(motionContract.hand)) {
    throw new Error("Invalid thread motion contract");
  }
  const intervals = input.turns.slice(1).map((angle, i) => angle - input.turns[i]);
  if (intervals.some(step => step <= 0)) throw new Error("Turn angles must strictly increase");
  if (input.exit) {
    const e = input.exit;
    if (!positive(e.minTurns) || !positive(e.maxStepDeg) || !nonnegative(e.clearanceMm) ||
        (e.startAngleDeg !== undefined && !Number.isFinite(e.startAngleDeg)) ||
        (e.minExitTurns !== undefined && !nonnegative(e.minExitTurns)) ||
        (e.maxExitTurns !== undefined && !nonnegative(e.maxExitTurns)) ||
        (e.minExitTurns !== undefined && e.maxExitTurns !== undefined && e.minExitTurns > e.maxExitTurns)) {
      throw new Error("Invalid thread exit contract");
    }
    if (e.startAngleDeg !== undefined && Math.abs(input.turns[0] - e.startAngleDeg) > 1e-9) {
      throw new Error("First turn angle does not match the exit contract start angle");
    }
    if (intervals.some(step => step > e.maxStepDeg + 1e-9)) throw new Error("Turn angle gap exceeds the exit contract");
  }
  const fixed = input.parameters ?? {};
  const setup = structuredClone({
    selectors, geometry: input.geometry, motion: input.motion, turns: input.turns,
    poseParameters: input.poseParameters ?? {}, parameters: fixed, ...(input.exit ? { exit: input.exit } : {}),
  });
  const scadSource = input.scadSource;
  const partsFor = (parameters: Record<string, number | string | boolean>) => (input.render ?? renderAssemblyParts)({
    scadSource,
    parts: [{ partId: "bolt", selector: setup.selectors.bolt }, { partId: "nut", selector: setup.selectors.nut }],
    parameters: { ...setup.parameters, ...parameters },
    options: input.options,
  });

  const staticParts = await partsFor({});
  await input.onArtifacts?.("static", staticParts);
  const staticMesh = Object.fromEntries(staticParts.map((part) => [part.partId, part.stl])) as { bolt: Buffer; nut: Buffer };
  const external = measureThreadGeometry({ stl: staticMesh.bolt, role: "external", contract: setup.geometry.external });
  const internal = measureThreadGeometry({ stl: staticMesh.nut, role: "internal", contract: setup.geometry.internal });

  const poses: Array<{ turnDeg: number; bolt: Buffer; nut: Buffer }> = [];
  const engagement: Array<{ turnDeg: number; status: string; testedPairs: number; reason: string }> = [];
  for (const turnDeg of setup.turns) {
    input.options?.signal?.throwIfAborted();
    const rendered = await partsFor({ ...setup.poseParameters, turn_deg: turnDeg });
    await input.onArtifacts?.(`turn-${turnDeg}`, rendered);
    const mesh = Object.fromEntries(rendered.map((part) => [part.partId, part.stl])) as { bolt: Buffer; nut: Buffer };
    poses.push({ turnDeg, bolt: mesh.bolt, nut: mesh.nut });
    // Meshing is not the same as advancing: two parts can move together while
    // their threads cut into each other. Every pose therefore has to be free of
    // interference, and running out of budget is never reported as clearance.
    try {
      const result = bvhIntersects(
        placeBvh(buildBvh(readBinaryStl(mesh.bolt))),
        placeBvh(buildBvh(readBinaryStl(mesh.nut))),
        { maxPairTests: 4_000_000 },
      );
      engagement.push({ turnDeg, status: result.status, testedPairs: result.testedPairs, reason: result.reason });
    } catch (error) {
      engagement.push({
        turnDeg, status: "ERROR", testedPairs: 0,
        reason: error instanceof Error ? error.message : "The engagement test failed",
      });
    }
  }
  const engagementStatus = requiredMeasurementStatus(
    engagement.map((pose) => (pose.status === "SEPARATED" ? "PASS" : pose.status === "UNKNOWN" ? "NOT_RUN" : pose.status === "ERROR" ? "ERROR" : "FAIL")),
  );
  const motion = measureThreadAdvance({ contract: setup.motion, poses });
  const exit = setup.exit
    ? checkThreadExit({ ...setup.exit, poses: poses.map((pose, i) => ({ ...pose, collision: engagement[i].status as "SEPARATED" | "INTERSECT" | "CONTAINED" | "UNKNOWN" | "ERROR" })) })
    : { status: "NOT_RUN" as const, reason: "No full-removal contract was supplied." };

  const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
  const threadStatus = requiredMeasurementStatus([external.status, internal.status]);
  // Bounding-box overlap and a clear sampled pose do not measure the two thread axes.
  // Keep the holistic verdict incomplete until an independent coaxiality check exists.
  const coaxiality = { status: "NOT_RUN" as const, reason: "Thread axis alignment and coaxiality were not independently measured." };
  return {
    schemaVersion: 1,
    method: "rendered-thread-geometry-and-advance/v1",
    sourceSha256: sha256(scadSource),
    setupSha256: sha256(canonicalJson(setup)),
    setup,
    status: requiredMeasurementStatus([threadStatus, engagementStatus, motion.status, coaxiality.status, ...(setup.exit ? [exit.status] : [])]),
    exit,
    coaxiality,
    threadStatus,
    external: external as ThreadGeometryResult,
    internal: internal as ThreadGeometryResult,
    engagement: {
      status: engagementStatus,
      poses: engagement,
      coverage:
        "Triangle-level interference between the two full part meshes at the listed commanded angles only. " +
        "Separation is reported as measured; no clearance value, flank contact pressure or elastic deformation is measured.",
    },
    motion: motion as ThreadMotionResult,
    coverage:
      "Thread geometry: radii and crest phase of the listed meshes only. Advance: nut height and orientation at the listed " +
      "commanded angles only. Engagement: triangle intersections between the two meshes at those angles. No flank contact " +
      "pressure, torque, preload, strength, wear, cross-threading, continuous sweep or physical verification.",
    physical: { status: "NOT_RUN" as const, reason: "No manufactured specimen was tested." },
  };
}
