import { createHash } from "crypto";
import { buildBvh, placeBvh, bvhIntersects } from "../geometry/mesh-collision";
import { readBinaryStl } from "../geometry/stl-mesh";
import { translationMatrix } from "./path-and-motion";

/** Probe a rigid translation against explicitly named obstacles. A retention
 * assertion needs a clear start and a later collision; an initially intersecting
 * assembly must not pass merely because the requested motion is blocked.
 */
export function checkTranslationProbe(input: {
  moving: Buffer;
  /** Parts rigidly carried with the moving body, not stationary obstacles. */
  companions?: Record<string, Buffer>;
  obstacles: Record<string, Buffer>;
  translationMm: [number, number, number]; samples: number;
  expected: "clear" | "blocked";
}) {
  if (!Array.isArray(input.translationMm) || input.translationMm.length !== 3 || input.translationMm.some(v => !Number.isFinite(v)) ||
      Math.hypot(...input.translationMm) === 0 || !Number.isInteger(input.samples) || input.samples < 2 || input.samples > 4096 ||
      !["clear", "blocked"].includes(input.expected)) throw new Error("Invalid translation probe");
  const entries = Object.entries(input.obstacles);
  const companions = Object.entries(input.companions ?? {});
  if (!entries.length || entries.length > 32 || companions.length > 16 || entries.length * (companions.length + 1) * input.samples > 100_000) throw new Error("Obstacle/sample budget invalid");
  if ([input.moving, ...entries.map(([, b]) => b), ...companions.map(([, b]) => b)].some(b => b.length > 64 * 1024 * 1024)) throw new Error("Probe mesh byte budget exceeded");
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const base = { method: "rigid-translation-probe/v1", translationMm: [...input.translationMm], samples: input.samples,
    expected: input.expected, stepMm: Math.hypot(...input.translationMm) / (input.samples - 1),
    movingSha256: sha(input.moving), companions: Object.fromEntries(companions.map(([id,b]) => [id,sha(b)])), obstacles: Object.fromEntries(entries.map(([id,b]) => [id,sha(b)])),
    coverage: "Listed sampled rigid translations against named obstacles only; not rotational constraint, continuous collision, load or physical guidance proof." };
  const moving = [{id:"moving",bvh:buildBvh(readBinaryStl(input.moving))}, ...companions.map(([id,b])=>({id,bvh:buildBvh(readBinaryStl(b))}))];
  const obstacles = entries.map(([id,b]) => ({ id, placed: placeBvh(buildBvh(readBinaryStl(b))) }));
  for (let i = 0; i < input.samples; i++) {
    const fraction = i / (input.samples - 1);
    const transform = translationMatrix(input.translationMm.map(v => v * fraction) as [number,number,number]);
    for (const body of moving) {
    const placed = placeBvh(body.bvh, transform);
    for (const other of obstacles) {
      const collision = bvhIntersects(placed,other.placed);
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
