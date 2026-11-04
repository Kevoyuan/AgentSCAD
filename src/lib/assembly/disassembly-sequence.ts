import { validateAssemblySpec } from "./assembly-spec";
import { createHash } from "crypto";
import { canonicalJson } from "../canonical-json";
import { buildBvh, placeBvh, bvhIntersects } from "../geometry/mesh-collision";
import { readBinaryStl } from "../geometry/stl-mesh";
import { translationMatrix } from "./path-and-motion";
import type { MeasurementStatus } from "./measurement-status";

export interface RemovalStep {
  instanceId: string;
  /** World-space displacement from the supplied assembled mesh, millimetres. */
  translationMm: [number, number, number];
  samples: number;
}
export interface DisassemblySequence {
  groundedInstanceId: string;
  steps: RemovalStep[];
}

/** Checks a supplied straight-line removal order; does not search for one.
 * Meshes must already be in a common assembly frame. Removed parts are taken
 * to external storage, not silently retained at a possibly obstructing pose.
 * No permitted-contact exemption: any observed penetration rejects the route.
 */
export function checkDisassemblySequence(input: {
  meshes: Record<string, Buffer>;
  plan: DisassemblySequence;
}) {
  const plan = structuredClone(input.plan);
  const ids = Object.keys(input.meshes).sort();
  if (!plan || !ids.length || ids.length > 64 || ids.some(id => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) || !ids.includes(plan.groundedInstanceId) || !Array.isArray(plan.steps)) {
    throw new Error("A known grounded instance and 1–64 posed meshes are required");
  }
  const expected = ids.filter(id => id !== plan.groundedInstanceId);
  const removed = plan.steps.map(s => s.instanceId);
  if (!expected.length || new Set(removed).size !== removed.length || expected.join("|") !== [...removed].sort().join("|")) {
    throw new Error("The sequence must remove every non-grounded instance exactly once");
  }
  let sampleBudget = 0;
  for (const step of plan.steps) {
    if (!Array.isArray(step.translationMm) || step.translationMm.length !== 3 ||
        step.translationMm.some(n => !Number.isFinite(n)) || Math.hypot(...step.translationMm) <= 0 ||
        !Number.isInteger(step.samples) || step.samples < 2 || step.samples > 4096) {
      throw new Error("Each removal requires a finite nonzero translation and 2–4096 samples");
    }
    sampleBudget += step.samples;
  }
  if (sampleBudget * ids.length > 100_000) throw new Error("Sequence exceeds the collision sampling budget");
  const meshes = new Map(ids.map(id => {
    const buffer = input.meshes[id];
    if (buffer.length > 64 * 1024 * 1024) throw new Error(`Mesh ${id} exceeds the byte budget`);
    return [id, buildBvh(readBinaryStl(buffer))] as const;
  }));
  const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
  const artifactSha256 = Object.fromEntries(ids.map(id => [id, sha256(input.meshes[id])]));
  const remaining = new Set(ids);
  const results: Array<{
    instanceId: string; status: MeasurementStatus; reason: string;
    samplesEvaluated: number; stepMm: number; against: string[];
    blockedAt: { fraction: number; otherInstanceId: string; collision: string } | null;
  }> = [];
  let status: MeasurementStatus = "PASS";
  for (const step of plan.steps) {
    const against = [...remaining].filter(id => id !== step.instanceId);
    const result: typeof results[number] = {
      instanceId: step.instanceId, status: "PASS", reason: "All sampled poses are clear; terminal pose is outside the remaining assembly envelope.",
      samplesEvaluated: 0, stepMm: Math.hypot(...step.translationMm) / (step.samples - 1), against, blockedAt: null,
    };
    if (status !== "PASS") {
      results.push({ ...result, status: "NOT_RUN", reason: "A preceding removal did not pass; the remaining scene cannot be assumed." });
      continue;
    }
    const stationary = against.map(id => ({ id, placed: placeBvh(meshes.get(id)!) }));
    const envelope = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const item of stationary) for (let axis = 0; axis < 3; axis++) {
      envelope[axis] = Math.min(envelope[axis], item.placed.worldBounds[axis]);
      envelope[axis + 3] = Math.max(envelope[axis + 3], item.placed.worldBounds[axis + 3]);
    }
    for (let i = 0; i < step.samples; i++) {
      const fraction = i / (step.samples - 1);
      const placed = placeBvh(meshes.get(step.instanceId)!, translationMatrix(step.translationMm.map(v => v * fraction) as [number, number, number]));
      result.samplesEvaluated++;
      for (const other of stationary) {
        const collision = bvhIntersects(placed, other.placed);
        if (collision.status === "INTERSECT" || collision.status === "CONTAINED" || collision.status === "UNKNOWN") {
          result.status = collision.status === "UNKNOWN" ? "NOT_RUN" : "FAIL";
          result.reason = collision.reason;
          result.blockedAt = { fraction, otherInstanceId: other.id, collision: collision.status };
          break;
        }
      }
      if (result.status !== "PASS") break;
      if (i === step.samples - 1) {
        const b = placed.worldBounds;
        const outside = [0, 1, 2].some(axis => b[axis + 3] < envelope[axis] - 1e-6 || b[axis] > envelope[axis + 3] + 1e-6);
        if (!outside) {
          result.status = "FAIL";
          result.reason = "Terminal pose is not outside the remaining assembly envelope; complete removal is not established.";
        }
      }
    }
    results.push(result);
    status = result.status;
    if (status === "PASS") remaining.delete(step.instanceId);
  }
  return {
    schemaVersion: 1, method: "ordered-straight-removal-sampling/v1", status,
    plan, planSha256: sha256(canonicalJson(plan)), artifactSha256, results,
    remainingInstanceIds: [...remaining],
    coverage: "Only listed straight translations and sampled poses; inter-sample collisions, tools, grasping, compliance, retention and load are not verified. A clear reverse sequence covers the same sampled geometric poses only.",
    assumptions: ["Meshes are assembled world-space geometry in millimetres.", "After each successful removal the part is carried to external storage; that transport and support of remaining parts are not modelled."],
    physical: { status: "NOT_RUN", reason: "No manufactured assembly was tested." },
  };
}

/** Translate the supported subset of declared operations into a sampled plan.
 * Rotation, intermediate waypoints and missing operations are refused rather
 * than silently replaced with a simpler route.
 */
export function removalSequenceFromSpec(input: unknown, maxStepMm = 0.25): DisassemblySequence {
  const parsed = validateAssemblySpec(input);
  if (!parsed.success) throw new Error("Invalid assembly specification");
  const spec = parsed.data;
  if (!Number.isFinite(maxStepMm) || maxStepMm <= 0 || !spec.groundedInstanceId) throw new Error("Grounded assembly and a positive sampling step are required");
  const operations = spec.operations.filter(o => o.action === "disassemble");
  const expected = spec.instances.filter(i => i.id !== spec.groundedInstanceId).map(i => i.id).sort();
  const actual = operations.map(o => o.instanceId).sort();
  if (!expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Operations must remove every non-grounded instance exactly once");
  const steps = operations.map(operation => {
    const instance = spec.instances.find(i => i.id === operation.instanceId)!;
    if (operation.waypoints.length !== 2) throw new Error("Only two-waypoint straight removal operations are supported");
    const [start, end] = operation.waypoints;
    if (start.some((v, i) => Math.abs(v - instance.transform[i]) > 1e-6)) throw new Error("Removal must start at the declared assembly pose");
    if (start.some((v, i) => ![3, 7, 11].includes(i) && Math.abs(v - end[i]) > 1e-6)) throw new Error("Rotating removal operations require a different path checker");
    const translationMm = [3, 7, 11].map(i => end[i] - start[i]) as [number, number, number];
    const length = Math.hypot(...translationMm);
    if (!(length > 0) || !Number.isFinite(length)) throw new Error("Removal requires nonzero finite travel");
    const samples = Math.ceil(length / maxStepMm) + 1;
    if (samples > 4096) throw new Error("Declared path exceeds the sampling budget");
    return { instanceId: operation.instanceId, translationMm, samples };
  });
  return { groundedInstanceId: spec.groundedInstanceId, steps };
}
