import { createHash } from "node:crypto";
import type { SourcePoseArtifact } from "../tools/source-pose-verification";

type Identity = Pick<SourcePoseArtifact, "phase" | "caseId" | "partId">;
const identityKey = (item: Identity) => JSON.stringify([item.phase, item.caseId, item.partId]);

/** Bounded all-or-none mesh retention. Archive completeness is separate from
 * the numerical verdict. Numeric filenames never incorporate untrusted IDs.
 */
export function createSourcePoseArchive(maxBytes = 32 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Invalid source-pose archive budget");
  }
  const retained: SourcePoseArtifact[] = [];
  let bytes = 0;
  let overBudget = false;
  return {
    collect(artifact: SourcePoseArtifact) {
      if (overBudget) return;
      if (!Buffer.isBuffer(artifact.stl) || artifact.stl.length === 0) {
        throw new Error("Empty source-pose artifact");
      }
      if (createHash("sha256").update(artifact.stl).digest("hex") !== artifact.sha256) {
        throw new Error("Source-pose artifact hash mismatch");
      }
      if (bytes + artifact.stl.length > maxBytes) {
        overBudget = true;
        retained.length = 0;
        bytes = 0;
        return;
      }
      retained.push({
        ...artifact,
        parameters: structuredClone(artifact.parameters),
        stl: Buffer.from(artifact.stl),
      });
      bytes += artifact.stl.length;
    },
    finish(expected: Identity[]) {
      const observed = new Set(retained.map(identityKey));
      const complete = !overBudget && expected.length > 0 && retained.length === expected.length
        && observed.size === expected.length && expected.every(item => observed.has(identityKey(item)));
      const status = overBudget || !retained.length ? "NOT_RUN" : complete ? "COMPLETE" : "PARTIAL";
      const files = retained.map(({ stl, ...metadata }, index) => ({
        ...metadata,
        path: `evidence/source-poses/${String(index).padStart(4, "0")}.stl`,
        byteLength: stl.length,
      }));
      const reason = overBudget ? "Mesh retention budget exceeded. All captured meshes were discarded."
        : complete ? "Every planned source-pose mesh is retained. Numerical verdicts remain separate."
        : expected.length === 0 ? "No source-pose execution was planned."
        : "Source-pose execution did not produce every planned mesh.";
      return {
        metadata: { status, byteLength: bytes, maxBytes, expectedFiles: expected.length, files, reason },
        meshes: retained.map(item => item.stl),
      };
    },
  };
}
