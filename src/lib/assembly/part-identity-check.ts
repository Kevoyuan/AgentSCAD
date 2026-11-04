/**
 * Evidence about whether the source honoured the part selector.
 *
 * A successful render only proves that OpenSCAD produced triangles for the
 * requested selector value. If the source ignores that value, every selector
 * returns the same geometry and the "parts" are one body copied N times. These
 * checks can prove that failure from the meshes alone; they cannot prove that
 * the triangles are the part the user meant. Nothing here measures fit, motion,
 * manufacture or physical function.
 */
export type IdentityStatus = "PASS" | "FAIL" | "NOT_RUN";

export interface SelectedPartMesh {
  partId: string;
  selector: string;
  stl: Buffer;
  sha256: string;
  triangleCount: number;
}

export interface MeshFacts {
  triangleCount: number;
  min: [number, number, number];
  max: [number, number, number];
  /** Order-insensitive summary of quantized triangles; equal facts mean equal geometry, not equal identity. */
  fingerprint: string;
}

const DEFAULT_TOLERANCE_MM = 1e-3;
/** 0.1 µm is far below any printable feature, so quantization cannot merge distinct parts. */
const QUANTUM_PER_MM = 10_000;
const MAX_TRIANGLES = 2_000_000;

function readFacts(stl: Buffer): MeshFacts {
  if (!Buffer.isBuffer(stl) || stl.length < 84) throw new Error("Invalid binary STL header");
  const triangleCount = stl.readUInt32LE(80);
  if (!triangleCount || triangleCount > MAX_TRIANGLES || 84 + 50 * triangleCount !== stl.length) {
    throw new Error("Invalid or oversized binary STL triangle table");
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  // Triangle order and vertex winding must not change the summary, so each
  // triangle contributes through commutative accumulators (xor and sum).
  let xor = 0;
  let sum = 0;
  const corners: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < triangleCount; i++) {
    const start = 84 + 50 * i + 12;
    let t1 = 0x811c9dc5 >>> 0;
    let t2 = 0x9e3779b9 >>> 0;
    for (let v = 0; v < 3; v++) {
      const corner = corners[v];
      for (let k = 0; k < 3; k++) {
        const value = stl.readFloatLE(start + v * 12 + k * 4);
        if (!Number.isFinite(value)) throw new Error("Non-finite STL vertex");
        if (value < min[k]) min[k] = value;
        if (value > max[k]) max[k] = value;
        // Normalize -0 to 0 so two identical meshes cannot hash differently.
        corner[k] = Math.round(value * QUANTUM_PER_MM) + 0;
      }
    }
    corners.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (let v = 0; v < 3; v++) {
      for (let k = 0; k < 3; k++) {
        const value = (corners[v][k] % 4294967296 + 4294967296) % 4294967296;
        t1 = Math.imul(t1 ^ value, 16777619) >>> 0;
        t2 = Math.imul(t2 + value, 2246822519) >>> 0;
      }
    }
    xor = (xor ^ t1) >>> 0;
    sum = (sum + t2) >>> 0;
  }
  return { triangleCount, min, max, fingerprint: xor.toString(16).padStart(8, "0") + sum.toString(16).padStart(8, "0") };
}

const within = (innerMin: number[], innerMax: number[], outerMin: number[], outerMax: number[], tolerance: number) =>
  innerMin.every((value, k) => value >= outerMin[k] - tolerance) && innerMax.every((value, k) => value <= outerMax[k] + tolerance);

export interface PartIdentityEvidence {
  status: IdentityStatus;
  reason: string;
  distinctness: { status: IdentityStatus; reason: string; groups: string[][] };
  containment: { status: IdentityStatus; reason: string; offenders: string[] };
  parts: Array<{ partId: string; selector: string; sha256: string; triangleCount: number; facts: MeshFacts }>;
  assembly: { sha256: string; triangleCount: number; facts: MeshFacts } | null;
}

/**
 * `parts` must contain one mesh per generated part. `assemblyMesh` is the
 * complete assembly at the same pose; without it, a part that returned the whole
 * assembly cannot be distinguished from a part that returned itself.
 */
export function checkPartIdentity(input: {
  parts: SelectedPartMesh[];
  assemblyMesh?: { stl: Buffer; sha256?: string } | null;
  toleranceMm?: number;
}): PartIdentityEvidence {
  const tolerance = input.toleranceMm ?? DEFAULT_TOLERANCE_MM;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Tolerance must be finite and non-negative");
  const ids = new Set(input.parts.map((part) => part.partId));
  if (ids.size !== input.parts.length) throw new Error("Part IDs must be unique");
  for (const part of input.parts) {
    if (typeof part.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error(`Part ${part.partId} has no content hash`);
  }

  const parts = input.parts.map((part) => ({ partId: part.partId, selector: part.selector, sha256: part.sha256, triangleCount: part.triangleCount, facts: readFacts(part.stl) }));

  // Byte equality and geometry equality are reported separately: different bytes
  // can still be the same triangles in a different order.
  const groups: string[][] = [];
  const byBytes = new Map<string, string[]>();
  const byGeometry = new Map<string, string[]>();
  for (const part of parts) {
    const geometryKey = `${part.facts.fingerprint}:${part.facts.triangleCount}:${part.facts.min.join(",")}:${part.facts.max.join(",")}`;
    byBytes.set(part.sha256, [...(byBytes.get(part.sha256) ?? []), part.partId]);
    byGeometry.set(geometryKey, [...(byGeometry.get(geometryKey) ?? []), part.partId]);
  }
  for (const group of [...byBytes.values(), ...byGeometry.values()]) {
    if (group.length < 2) continue;
    const signature = [...group].sort().join("|");
    if (!groups.some((existing) => existing.join("|") === signature)) groups.push(group);
  }
  const distinctness: PartIdentityEvidence["distinctness"] = groups.length > 0
    ? { status: "FAIL", reason: "Different selectors produced the same geometry, so at least one part is not independently selectable.", groups }
    : parts.length < 2
      ? { status: "NOT_RUN", reason: "A single generated part cannot demonstrate selector distinctness.", groups: [] }
      : { status: "PASS", reason: "The selected renders are pairwise distinct. This proves the selectors differ, not that each mesh is the intended part.", groups: [] };

  const offenders: string[] = [];
  let assembly: PartIdentityEvidence["assembly"] = null;
  let containment: PartIdentityEvidence["containment"];
  if (!input.assemblyMesh) {
    containment = { status: "NOT_RUN", reason: "No complete-assembly mesh was supplied, so a part returning the whole assembly cannot be ruled out.", offenders };
  } else {
    const facts = readFacts(input.assemblyMesh.stl);
    assembly = { sha256: input.assemblyMesh.sha256 ?? "", triangleCount: facts.triangleCount, facts };
    for (const part of parts) {
      // Triangle counts are deliberately not compared: a CGAL union can remove
      // internal faces, so one part may legitimately carry more triangles than
      // the assembled result. Only equality and envelope violations are proofs.
      if (part.sha256 === assembly.sha256 || (part.facts.fingerprint === facts.fingerprint && part.facts.triangleCount === facts.triangleCount)) offenders.push(part.partId);
      else if (!within(part.facts.min, part.facts.max, facts.min, facts.max, tolerance)) offenders.push(part.partId);
    }
    containment = offenders.length > 0
      ? { status: "FAIL", reason: "A selected part equals or exceeds the complete assembly, so its selector did not isolate that part.", offenders }
      : { status: "PASS", reason: "Every selected mesh is smaller than the complete assembly and inside its envelope at this pose.", offenders: [] };
  }

  const status: IdentityStatus = distinctness.status === "FAIL" || containment.status === "FAIL"
    ? "FAIL"
    : distinctness.status === "PASS" && containment.status === "PASS" ? "PASS" : "NOT_RUN";
  const reason = status === "FAIL"
    ? [distinctness.status === "FAIL" ? distinctness.reason : "", containment.status === "FAIL" ? containment.reason : ""].filter(Boolean).join(" ")
    : status === "PASS"
      ? "Selectors produced distinct, contained meshes. Identity, fit and function were not measured."
      : "Selector identity is not established: " + [distinctness.status !== "PASS" ? distinctness.reason : "", containment.status !== "PASS" ? containment.reason : ""].filter(Boolean).join(" ");

  return { status, reason, distinctness, containment, parts, assembly };
}
