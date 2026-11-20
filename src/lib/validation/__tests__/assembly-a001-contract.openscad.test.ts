import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { db } from "../../db";
import { deriveRequirementContract } from "../../requirements/extract-requirements";
import { saveRequirementContract } from "../../requirements/requirement-contract-record";
import { validateAssemblyArtifact } from "../assembly-validation";

/**
 * A001 is deliberately conservative for a multi-joint source. A stored,
 * confirmed contract must not promote layers that the A001 route did not
 * measure (here: `assembly` and `jointFrames`). This locks that boundary so a
 * later change cannot turn an unmeasured layer into a PASS by accident.
 */
test("A001 keeps a confirmed multi-joint contract NOT_RUN when selected layers were not measured", async () => {
  const inputRequest =
    "Design a six-part guided retained single-cylinder slider-crank: frame, crank, rod, slider, eccentric key and removable front guide; the crank rotates, the slider is guided, and the front guide and eccentric key are removable.";
  const job = await db.job.create({ data: { inputRequest, state: "DELIVERED" } });
  try {
    const derived = deriveRequirementContract({ request: inputRequest });
    await saveRequirementContract({
      job: { id: job.id, inputRequest, state: job.state, updatedAt: job.updatedAt },
      contract: derived,
      expectedContractSha256: null,
    });
    const source = await readFile("bench/product/submissions/guided-product-8-28/reference.scad", "utf8");
    const [row] = await validateAssemblyArtifact({ inputRequest, scadSource: source, jobId: job.id });
    expect(row.status).toBe("NOT_RUN");
    expect(row.passed).toBe(false);
    const manifest = row.assemblyEvidence!.manifest;
    expect(manifest.contract.evidenceCurrent).toBe(true);
    expect(manifest.declaredAssembly.measuredStatus).toBe("PASS");
    expect(manifest.declaredDisassembly.measuredStatus).toBe("PASS");
    expect(manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(manifest.evidence.jointFrames.status).toBe("NOT_RUN");
  } finally {
    await db.job.delete({ where: { id: job.id } });
  }
}, 120000);
