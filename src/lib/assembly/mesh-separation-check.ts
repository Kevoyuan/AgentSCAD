import { createHash } from "crypto";
import { validateAssemblySpec } from "./assembly-spec";

type Bounds = { min: number[]; max: number[] };
function worldBounds(mesh: Buffer, m: number[]): Bounds {
  if (!Buffer.isBuffer(mesh) || mesh.length < 84) throw new Error("Invalid binary STL header");
  const faces = mesh.readUInt32LE(80);
  if (!faces || faces > 2_000_000 || 84 + 50 * faces !== mesh.length) throw new Error("Invalid or oversized binary STL triangle table");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < faces; i++) {
    const start = 84 + 50 * i + 12;
    for (let v = 0; v < 3; v++) {
      const x = mesh.readFloatLE(start + v * 12), y = mesh.readFloatLE(start + v * 12 + 4), z = mesh.readFloatLE(start + v * 12 + 8);
      if (![x, y, z].every(Number.isFinite)) throw new Error("Non-finite STL vertex");
      const p = [m[0]*x+m[1]*y+m[2]*z+m[3], m[4]*x+m[5]*y+m[6]*z+m[7], m[8]*x+m[9]*y+m[10]*z+m[11]];
      if (!p.every(Number.isFinite)) throw new Error("Non-finite transformed vertex");
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
  }
  return { min, max };
}

/** Conservative broad-phase check over actual binary STL vertices at one pose.
 * PASS means only that disjoint AABBs prove at least the requested gap; it does
 * not prove that meshes are complete, watertight, correctly identified, free
 * of collision at other poses, or suitable for manufacture. Overlapping boxes
 * are inconclusive, never a collision or clearance pass.
 */
export function checkMeshSeparation(input: {
  spec: unknown; instanceA: string; instanceB: string;
  meshes: Record<string, Buffer>; minimumGapMm: number; numericalMarginMm: number;
}) {
  if (!Number.isFinite(input.minimumGapMm) || input.minimumGapMm < 0 || !Number.isFinite(input.numericalMarginMm) || input.numericalMarginMm < 0) throw new Error("Gap and numerical margin must be finite and non-negative");
  const parsed = validateAssemblySpec(input.spec);
  if (!parsed.success) throw new Error("Invalid assembly specification");
  const a = parsed.data.instances.find((i) => i.id === input.instanceA);
  const b = parsed.data.instances.find((i) => i.id === input.instanceB);
  if (!a || !b || a.id === b.id) throw new Error("Two distinct known instances are required");
  const meshA = input.meshes[a.partId], meshB = input.meshes[b.partId];
  if (!meshA || !meshB) return { status: "NOT_RUN" as const, reason: "A part mesh is missing.", instanceA: a.id, instanceB: b.id };
  let boundsA: Bounds, boundsB: Bounds;
  try { boundsA = worldBounds(meshA, a.transform); boundsB = worldBounds(meshB, b.transform); }
  catch (error) { return { status: "ERROR" as const, reason: error instanceof Error ? error.message : "Invalid mesh", instanceA: a.id, instanceB: b.id }; }
  const gap = Math.hypot(...[0, 1, 2].map((k) => Math.max(0, boundsA.min[k] - boundsB.max[k], boundsB.min[k] - boundsA.max[k])));
  const proved = gap > input.numericalMarginMm && gap >= input.minimumGapMm + input.numericalMarginMm;
  return {
    status: proved ? "PASS" as const : "NOT_RUN" as const,
    reason: proved ? "Separate bounding boxes prove the stated gap for these meshes in this pose only." : "Bounding boxes do not prove the requested gap; a narrow-phase check is required.",
    instanceA: a.id, instanceB: b.id, boundsA, boundsB, lowerBoundMm: gap,
    meshAHash: createHash("sha256").update(meshA).digest("hex"), meshBHash: createHash("sha256").update(meshB).digest("hex"),
    minimumGapMm: input.minimumGapMm, numericalMarginMm: input.numericalMarginMm,
  };
}
