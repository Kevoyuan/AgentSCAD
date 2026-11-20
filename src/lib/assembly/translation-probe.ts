import { createHash } from "crypto";
import { buildBvh, placeBvh, bvhIntersects } from "../geometry/mesh-collision";
import { readBinaryStl } from "../geometry/stl-mesh";
import { multiplyMatrices, translationMatrix } from "./path-and-motion";
import { validateRigidTransform } from "./assembly-spec";

/** Probe a rigid translation against explicitly named obstacles. A retention
 * assertion needs a clear start and a later collision; an initially intersecting
 * assembly must not pass merely because the requested motion is blocked.
 */
export function checkTranslationProbe(input: {
  moving: Buffer;
  /** Parts rigidly carried with the moving body, not stationary obstacles. */
  companions?: Record<string, Buffer>;
  obstacles: Record<string, Buffer>;
  /** Common local-to-world starting placement for moving and companion meshes. */
  movingTransform?: number[];
  obstacleTransforms?: Record<string, number[]>;
  /** Displacement in world coordinates, applied after the starting placement. */
  translationMm: [number, number, number]; samples: number;
  expected: "clear" | "blocked";
  /** Synchronous queries cannot be interrupted; late results become NOT_RUN. */
  budgetMs?: number;
}) {
  const started = performance.now();
  const budgetMs = input.budgetMs ?? 5000;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 60000) throw new Error("Invalid probe deadline");
  if (!Array.isArray(input.translationMm) || input.translationMm.length !== 3 || input.translationMm.some(v => !Number.isFinite(v)) ||
      Math.hypot(...input.translationMm) === 0 || !Number.isInteger(input.samples) || input.samples < 2 || input.samples > 4096 ||
      !["clear", "blocked"].includes(input.expected)) throw new Error("Invalid translation probe");
  const entries = Object.entries(input.obstacles);
  const companions = Object.entries(input.companions ?? {});
  const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const checkedMoving = validateRigidTransform(input.movingTransform ?? identity);
  if (!checkedMoving.success) throw new Error("Moving transform must be rigid");
  const supplied = input.obstacleTransforms ?? {};
  if (Object.keys(supplied).some(id => !Object.hasOwn(input.obstacles, id))) throw new Error("Transform refers to an unknown obstacle");
  const obstacleTransforms = Object.fromEntries(entries.map(([id]) => {
    const checked = validateRigidTransform(supplied[id] ?? identity);
    if (!checked.success) throw new Error("Obstacle transform must be rigid");
    return [id, checked.data];
  }));
  if (!entries.length || entries.length > 32 || companions.length > 16 || entries.length * (companions.length + 1) * input.samples > 100_000) throw new Error("Obstacle/sample budget invalid");
  if ([input.moving, ...entries.map(([, b]) => b), ...companions.map(([, b]) => b)].some(b => b.length > 64 * 1024 * 1024)) throw new Error("Probe mesh byte budget exceeded");
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const base = { method: "rigid-translation-probe/v2", translationMm: [...input.translationMm], samples: input.samples,
    expected: input.expected, stepMm: Math.hypot(...input.translationMm) / (input.samples - 1),
    movingTransform: checkedMoving.data, obstacleTransforms, budgetMs,
    movingSha256: sha(input.moving), companions: Object.fromEntries(companions.map(([id,b]) => [id,sha(b)])), obstacles: Object.fromEntries(entries.map(([id,b]) => [id,sha(b)])),
    coverage: "Listed sampled rigid translations against named obstacles only; not rotational constraint, continuous collision, load or physical guidance proof." };
  const moving = [{id:"moving",bvh:buildBvh(readBinaryStl(input.moving))}, ...companions.map(([id,b])=>({id,bvh:buildBvh(readBinaryStl(b))}))];
  const obstacles = entries.map(([id,b]) => ({ id, placed: placeBvh(buildBvh(readBinaryStl(b)), obstacleTransforms[id]) }));
  const late = (samplesEvaluated: number) => ({ ...base, status: "NOT_RUN", reason: `Probe exceeded its ${budgetMs} ms evaluation budget`, samplesEvaluated });
  for (let i = 0; i < input.samples; i++) {
    if (performance.now() - started > budgetMs) return late(i);
    const fraction = i / (input.samples - 1);
    const transform = multiplyMatrices(translationMatrix(input.translationMm.map(v => v * fraction) as [number,number,number]), checkedMoving.data);
    for (const body of moving) {
    const placed = placeBvh(body.bvh, transform);
    for (const other of obstacles) {
      const collision = bvhIntersects(placed,other.placed);
      if (performance.now() - started > budgetMs) return late(i+1);
      if (collision.status === "UNKNOWN") return { ...base,status: "NOT_RUN",reason: collision.reason,samplesEvaluated:i+1 };
      if (collision.blocked) return { ...base,status: i > 0 && input.expected === "blocked" ? "PASS" : "FAIL",
        reason: i === 0 ? "The starting pose already intersects; no valid retention evidence" : "A sampled translation is blocked",
        samplesEvaluated:i+1,blockedAt:{ fraction, displacementMm: input.translationMm.map(v => v*fraction), movingId:body.id,obstacleId:other.id,collision:collision.status } };
    }
    }
  }
  return { ...base,status:input.expected === "clear" ? "PASS" : "FAIL",samplesEvaluated:input.samples,
    reason:"No blocking collision was observed at the sampled positions" };
}
