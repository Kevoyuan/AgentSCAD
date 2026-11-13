import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { validateAssemblySpec } from "./assembly-spec";
import { verifyAssemblyBundle } from "./verify-assembly-bundle";
import { checkReconstructedMesh } from "./reconstructed-mesh-check";
import { meshBounds, readBinaryStl, type Vec3 } from "../geometry/stl-mesh";
import { transformPoint } from "../geometry/mesh-collision";

/** The output is an assembly *layout*, not the boolean union of its solids. */
const MAX_ASSEMBLY_TRIANGLES = 1_000_000;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class AssemblyReconstructionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AssemblyReconstructionError";
  }
}

export type ReferenceComparison = {
  status: "PASS" | "FAIL" | "NOT_RUN" | "ERROR";
  reason: string;
  artifactSha256: string | null;
  method: string | null;
  bboxErrorMm?: number;
  maxVertexErrorMm?: number;
  matchedTriangles?: number;
};

export type ReconstructedAssemblyReport = {
  reconstruction: "COMPLETE" | "PARTIAL";
  archiveIntegrity: "PASS";
  archiveSha256: string;
  specificationSha256: string;
  sourceSha256: string;
  assembledStlSha256: string;
  units: "mm";
  /** Each instance is positioned independently; duplicates remain distinct. */
  instances: Array<{ id: string; partId: string; triangleCount: number; artifactSha256: string }>;
  missingPurchasedInstances: string[];
  triangleCount: number;
  boundsMm: { min: Vec3; max: Vec3 };
  reference: ReferenceComparison;
  limitations: string[];
};

export function reconstructAssemblyBundle(input: {
  zip: Uint8Array;
  /** Independently rendered assembled-pose STL; never generated from this ZIP. */
  referenceStl?: Buffer;
  /** Purchased parts have no STL; by default refuse an incomplete assembly. */
  allowPartial?: boolean;
  /** Protect local memory/CPU even if the ZIP's part files are individually valid. */
  maxTriangles?: number;
  toleranceMm?: number;
}): { stl: Buffer; report: ReconstructedAssemblyReport } {
  const verified = verifyAssemblyBundle(input.zip);
  const files = unzipSync(input.zip);
  const declaration = validateAssemblySpec(JSON.parse(strFromU8(files["specification.json"])));
  // The verifier already checked this exact canonical file; retain a guard
  // so no downstream code can inadvertently consume an unvalidated spec.
  if (!declaration.success) throw new AssemblyReconstructionError("INVALID_SPECIFICATION", "Assembly specification is invalid");
  const spec = declaration.data;
  const missingPurchasedInstances = spec.instances
    .filter(instance => spec.parts.some(part => part.id === instance.partId && part.source === "purchased"))
    .map(instance => instance.id);
  if (missingPurchasedInstances.length && !input.allowPartial) {
    throw new AssemblyReconstructionError("PURCHASED_PARTS_UNAVAILABLE",
      "Assembly contains purchased instances with no geometry: " + missingPurchasedInstances.join(", ") +
      ". Use allowPartial only when an incomplete layout is acceptable.");
  }

  const maxTriangles = input.maxTriangles ?? MAX_ASSEMBLY_TRIANGLES;
  if (!Number.isSafeInteger(maxTriangles) || maxTriangles < 1 || maxTriangles > MAX_ASSEMBLY_TRIANGLES) {
    throw new AssemblyReconstructionError("INVALID_BUDGET", "maxTriangles must be an integer from 1 to 1000000");
  }
  const byPart = new Map<string, ReturnType<typeof readBinaryStl>>();
  for (const part of spec.parts) {
    if (part.source !== "generated") continue;
    byPart.set(part.id, readBinaryStl(Buffer.from(files[part.id + ".stl"])));
  }
  const included = spec.instances.filter(instance => byPart.has(instance.partId));
  const triangleCount = included.reduce((sum, instance) => sum + byPart.get(instance.partId)!.triangleCount, 0);
  if (!triangleCount) throw new AssemblyReconstructionError("NO_GEOMETRY", "No generated assembly instances to reconstruct");
  if (triangleCount > maxTriangles) {
    throw new AssemblyReconstructionError("TRIANGLE_BUDGET", "Reconstructed layout exceeds the triangle budget");
  }

  const stl = Buffer.alloc(84 + 50 * triangleCount);
  stl.write("AgentSCAD reconstructed assembly layout - NOT functional validation", 0, "ascii");
  stl.writeUInt32LE(triangleCount, 80);
  const instances: ReconstructedAssemblyReport["instances"] = [];
  let written = 0;
  for (const instance of included) {
    const mesh = byPart.get(instance.partId)!;
    const partBytes = files[instance.partId + ".stl"];
    for (let t = 0; t < mesh.triangleCount; t++) {
      const vertices: Vec3[] = [];
      for (let v = 0; v < 3; v++) {
        const offset = t * 9 + v * 3;
        const point: Vec3 = [
          mesh.coordinates[offset],
          mesh.coordinates[offset + 1],
          mesh.coordinates[offset + 2],
        ];
        const placed = transformPoint(instance.transform, point);
        if (placed.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
          throw new AssemblyReconstructionError("COORDINATE_OVERFLOW",
            "Placed coordinate does not fit binary STL float32: " + instance.id);
        }
        vertices.push(placed);
      }
      const a = vertices[0], b = vertices[1], c = vertices[2];
      const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const norm = Math.hypot(...cross);
      const normal = norm > 0 && Number.isFinite(norm) ? cross.map(n => n / norm) : [0, 0, 0];
      const dst = 84 + 50 * written;
      for (let k = 0; k < 3; k++) stl.writeFloatLE(normal[k], dst + k * 4);
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) stl.writeFloatLE(vertices[j][k], dst + 12 + j * 12 + k * 4);
      }
      written++;
    }
    instances.push({
      id: instance.id, partId: instance.partId,
      triangleCount: mesh.triangleCount,
      artifactSha256: sha256(partBytes),
    });
  }
  const placedMesh = readBinaryStl(stl);
  const reference: ReferenceComparison = {
    status: "NOT_RUN",
    reason: "No independently rendered assembled-pose STL was supplied.",
    artifactSha256: input.referenceStl ? sha256(input.referenceStl) : null,
    method: null,
  };
  if (input.referenceStl && missingPurchasedInstances.length) {
    reference.reason = "Purchased instances are missing from the reconstructed layout; full-assembly comparison is not possible.";
  } else if (input.referenceStl) {
    try {
      const result = checkReconstructedMesh({
        local: stl, posed: input.referenceStl,
        transform: IDENTITY, toleranceMm: input.toleranceMm,
      });
      reference.status = result.status;
      reference.reason = result.reason;
      reference.method = result.method;
      if ("bboxErrorMm" in result) reference.bboxErrorMm = result.bboxErrorMm;
      if ("maxVertexErrorMm" in result) reference.maxVertexErrorMm = result.maxVertexErrorMm;
      if ("matchedTriangles" in result) reference.matchedTriangles = result.matchedTriangles;
    } catch (error) {
      reference.status = "ERROR";
      reference.reason = error instanceof Error ? error.message : "Reference comparison failed";
    }
  }
  return {
    stl,
    report: {
      reconstruction: missingPurchasedInstances.length ? "PARTIAL" : "COMPLETE",
      archiveIntegrity: verified.status,
      archiveSha256: verified.archiveSha256,
      specificationSha256: verified.specificationSha256,
      sourceSha256: verified.sourceSha256,
      assembledStlSha256: sha256(stl),
      units: "mm",
      instances,
      missingPurchasedInstances,
      triangleCount,
      boundsMm: meshBounds(placedMesh),
      reference,
      limitations: [
        "The assembled STL is a triangle concatenation of placed part instances, not a Boolean union or collision-safe solid.",
        "Transforms come from the assembly declaration; comparison to independently rendered geometry is NOT_RUN unless referenceStl is supplied.",
        "A reference PASS covers matched tessellated surfaces at a single pose only; a different tessellation may yield NOT_RUN.",
        "No fit, clearance, full motion, tool access, manufacturing, structural or physical function is established.",
      ],
    },
  };
}
