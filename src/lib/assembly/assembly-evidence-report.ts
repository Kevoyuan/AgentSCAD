import type { buildAssemblyBundle } from "./assembly-bundle";

type Bundle = Awaited<ReturnType<typeof buildAssemblyBundle>>;

const LAYERS = ["identity", "geometry", "assembly", "disassembly", "motion", "physical"] as const;

/**
 * Small, inspectable, one-shot report for product UI.
 * Constructed from measured outputs of the exact bundle build — never from the
 * declaration alone. Avoid returning raw pose matrices or large BVHs to a
 * browser; the ZIP remains the source of complete versioned evidence.
 *
 * A status is *already* contract-gated by prepareAssembly. Measured statuses
 * remain separate from user-confirmed evidentiary standing.
 */
export function summarizeAssemblyEvidence(bundle: Bundle) {
  const manifest = bundle.manifest;
  const declared = manifest.declaredDisassembly;
  const evidence = Object.fromEntries(LAYERS.map(layer => {
    const item = manifest.evidence[layer];
    return [layer, { status: item.status, reason: item.reason }];
  })) as Record<typeof LAYERS[number], { status: string; reason: string }>;
  const operations = declared.results.slice(0, 64).map(operation => {
    const path = operation.path;
    const blockedAt = path && "blockedAt" in path ? path.blockedAt : null;
    return {
      operationId: operation.operationId,
      instanceId: operation.instanceId,
      measuredStatus: operation.status,
      reason: operation.reason,
      path: path ? {
        method: path.method,
        posesEvaluated: path.posesEvaluated,
        declaredPoseCount: path.poses.length,
        translationStepMm: path.translationStepMm,
        rotationStepDeg: path.rotationStepDeg,
        coverage: path.coverage,
        blockedAt: blockedAt ?? null,
      } : null,
    };
  });
  return {
    reportSchemaVersion: 1 as const,
    archiveSha256: bundle.sha256,
    sourceSha256: manifest.sourceSha256,
    specificationSha256: manifest.specificationSha256,
    contract: {
      evidenceCurrent: manifest.contract.evidenceCurrent,
      reason: manifest.contract.reason,
      binding: manifest.contract.binding,
    },
    evidence,
    disassembly: {
      status: declared.status,
      reason: declared.reason,
      measuredStatus: declared.measuredStatus,
      measuredReason: declared.measuredReason,
      method: declared.method,
      coverage: declared.coverage,
      budgetMs: "budgetMs" in declared ? declared.budgetMs : null,
      totalOperations: declared.results.length,
      omittedOperations: Math.max(0, declared.results.length - operations.length),
      operations,
    },
    fitBinding: manifest.fitBinding,
    fits: manifest.fits.slice(0, 32).map(fit => ({
      connectionId: fit.connectionId,
      status: fit.status,
      measuredStatus: fit.measuredStatus,
      reason: fit.reason,
      diametralClearanceMm: fit.diametralClearanceMm,
      boreDiameterMm: fit.boreDiameterMm,
      shaftDiameterMm: fit.shaftDiameterMm,
      axisOffsetMm: fit.axisOffsetMm,
      axisAngleDeg: fit.axisAngleDeg,
      unknowns: fit.unknowns,
    })),
    omittedFits: Math.max(0, manifest.fits.length - 32),
    limitations: [
      "Result applies to these source/specification/archive hashes only; no persistent job verdict was written.",
      "Contract-uncertain measured PASS is not an approved PASS. Only manifest.evidence carries the gated standing.",
      "Declared removal checks sampled geometry; no continuous clearance, thread engagement, tool access or physical function.",
      "Missing fit/motion measurements are NOT_RUN and must not be promoted to PASS.",
      "A declared bore/shaft role is not independently identified; auto-bound clearance checks remain candidate observations, not validated fit PASS.",
    ],
  };
}

export type AssemblyEvidenceReport = ReturnType<typeof summarizeAssemblyEvidence>;
