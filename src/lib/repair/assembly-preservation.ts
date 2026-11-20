import { extractEmbeddedAssemblySpec } from "@/lib/assembly/embedded-spec";
import { assertRepairPreservesAssembly } from "@/lib/assembly/repair-findings";
import { deriveRequirementContract } from "@/lib/requirements/extract-requirements";
import { ModelRequestError, type ModelErrorEvidence } from "@/lib/model-runtime";

/** Guard model rewrites before callers render or persist their candidate. */
export function assertAssemblySourcePreserved(input: {
  originalSource: string;
  proposedSource: string;
  originalRequest: string;
  evidence?: ModelErrorEvidence;
}): void {
  const originalAssembly = extractEmbeddedAssemblySpec(input.originalSource);
  if (originalAssembly.status === "valid") {
    const proposedAssembly = extractEmbeddedAssemblySpec(input.proposedSource);
    const preservation = proposedAssembly.status === "valid"
      ? assertRepairPreservesAssembly({ before: originalAssembly.spec, after: proposedAssembly.spec,
          contract: deriveRequirementContract({ request: input.originalRequest }) }) : null;
    if (!preservation?.ok) {
      const reason = preservation ? preservation.violations.map(item=>item.message).join(" ")
        : "The repair removed or invalidated the existing embedded assembly declaration.";
      throw new ModelRequestError("LLM_FORMAT_INVALID", `Assembly repair rejected: ${reason} The existing source must be retained; no geometry or function has been reverified.`, false, { evidence: input.evidence });
    }
  }
}
