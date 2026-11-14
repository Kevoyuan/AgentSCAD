/**
 * Explicit source-pose observations. Local parts are rendered from one CAD
 * source; the whole assembled reference is separately rendered by OpenSCAD
 * with explicit source parameters at every requested pose.
 *
 * These surface comparisons are not generic motion verification: source
 * parameters, rigid placements and the reference selector are still caller
 * bindings. Product motion and physical evidence remain NOT_RUN.
 */
import { createHash } from "node:crypto";
import { validateAssemblySpec, validateRigidTransform, type AssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { buildAssemblyBundle } from "./assembly-bundle";
import { reconstructAssemblyBundle } from "./reconstruct-assembly-bundle";
import { renderAssemblyParts, renderAssemblySpecParts, type RenderedAssemblyPart } from "../tools/assembly-part-renderer";
import type { ScadExecutionOptions } from "../tools/scad-renderer";

type Rendered = { parts: RenderedAssemblyPart[]; purchasedPartIds: string[] };
export type SourcePoseSample = {
  id: string;
  parameters: Record<string, number>;
  transforms: Record<string, number[]>;
};
type ResultStatus = "PASS" | "FAIL" | "NOT_RUN" | "ERROR";
export type SourcePoseObservation = {
  id: string;
  status: ResultStatus;
  reason: string;
  sourceSha256: string;
  posedSpecificationSha256: string;
  localPartSha256: Record<string, string>;
  referenceStlSha256: string;
  reconstructedStlSha256: string;
  archiveSha256: string;
  comparisonMethod: string | null;
  matchedTriangles?: number;
  bboxErrorMm?: number;
  maxVertexErrorMm?: number;
  limitations: string;
};
export type SourcePoseReport = {
  method: "independent-source-pose-stl-comparison/v1";
  status: ResultStatus;
  sourceSha256: string;
  originalSpecificationSha256: string;
  referenceSelector: string;
  samples: SourcePoseObservation[];
  reason: string;
  coverage: string;
};

type ReferenceRenderer = (
  scadSource: string,
  selector: string,
  parameters: Record<string, number>,
  options?: ScadExecutionOptions,
) => Promise<{ stl: Buffer; sha256: string }>;

export async function observeSourcePoses(input: {
  scadSource: string;
  spec: unknown;
  referenceSelector: string;
  samples: SourcePoseSample[];
  options?: ScadExecutionOptions;
  renderLocal?: (source: string, spec: AssemblySpec, options?: ScadExecutionOptions) => Promise<Rendered>;
  renderReference?: ReferenceRenderer;
}): Promise<SourcePoseReport> {
  const checkedSpec = validateAssemblySpec(input.spec);
  if (!checkedSpec.success) throw new Error("Invalid source-pose assembly specification");
  if (!input.scadSource.trim()) throw new Error("Source-pose observation requires nonempty CAD source");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.referenceSelector)) throw new Error("Invalid reference selector");
  if (input.samples.length < 2 || input.samples.length > 8) throw new Error("Source-pose comparison requires 2 to 8 explicit samples");
  if (new Set(input.samples.map(sample => sample.id)).size !== input.samples.length) throw new Error("Duplicate source pose sample IDs");
  const spec = checkedSpec.data;
  if (!spec.instances.length || spec.instances.length > 32 ||
    spec.parts.some(part => part.source !== "generated") ||
    spec.instances.some(instance => !spec.parts.some(part => part.id === instance.partId))) {
    throw new Error("Complete generated-part geometry is required for source pose replay");
  }
  const ids = new Set(spec.instances.map(instance => instance.id));
  const sourceSha256 = createHash("sha256").update(input.scadSource).digest("hex");
  const renderLocal = input.renderLocal ?? renderAssemblySpecParts;
  const renderReference = input.renderReference ?? (async (source, selector, parameters, options) =>
    (await renderAssemblyParts({ scadSource: source, parts: [{ partId: "reference", selector }], parameters, options }))[0]);

  for (const sample of input.samples) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(sample.id) ||
      Object.keys(sample.transforms).length === 0 ||
      Object.keys(sample.transforms).some(id => !ids.has(id)) ||
      Object.keys(sample.parameters).length === 0 ||
      Object.entries(sample.parameters).some(([name, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || !Number.isFinite(value))) {
      throw new Error("Source pose sample lacks a valid instance, pose, or finite source parameter");
    }
    if (Object.values(sample.transforms).some(transform => !validateRigidTransform(transform).success)) {
      throw new Error("Source pose transform is not right-handed rigid");
    }
  }

  const local = await renderLocal(input.scadSource, spec, input.options);
  if (local.purchasedPartIds.length || local.parts.length !== spec.parts.length ||
    new Set(local.parts.map(part => part.partId)).size !== spec.parts.length ||
    spec.parts.some(part => !local.parts.some(output => output.partId === part.id))) {
    throw new Error("Source did not render every independently selectable generated part");
  }
  const localPartSha256 = Object.fromEntries(local.parts.map(part => [part.partId, part.sha256]));
  const results: SourcePoseObservation[] = [];
  for (const sample of input.samples) {
    input.options?.signal?.throwIfAborted();
    const posedSpec = {
      ...spec,
      instances: spec.instances.map(instance => ({
        ...instance, transform: sample.transforms[instance.id] ?? instance.transform,
      })),
    };
    const checked = validateAssemblySpec(posedSpec);
    if (!checked.success) throw new Error("Sample contains an invalid positioned assembly specification");

    // Independent reference render evaluates the CAD source with its own
    // selector and parameter. It is NEVER synthesized from the matrices.
    const reference = await renderReference(input.scadSource, input.referenceSelector, sample.parameters, input.options);
    const referenceHash = createHash("sha256").update(reference.stl).digest("hex");
    if (referenceHash !== reference.sha256) throw new Error("Independent reference renderer returned incorrect STL SHA-256");
    const bundle = await buildAssemblyBundle({
      scadSource: input.scadSource, spec: checked.data, options: input.options,
      render: async () => local,
    });
    const compared = reconstructAssemblyBundle({ zip: bundle.zip, referenceStl: reference.stl });
    const observation = compared.report.reference;
    results.push({
      id: sample.id, status: observation.status,
      reason: observation.reason, sourceSha256,
      posedSpecificationSha256: compared.report.specificationSha256,
      localPartSha256, referenceStlSha256: referenceHash,
      reconstructedStlSha256: compared.report.assembledStlSha256,
      archiveSha256: bundle.sha256, comparisonMethod: observation.method,
      ...("matchedTriangles" in observation ? { matchedTriangles: observation.matchedTriangles } : {}),
      ...("bboxErrorMm" in observation ? { bboxErrorMm: observation.bboxErrorMm } : {}),
      ...("maxVertexErrorMm" in observation ? { maxVertexErrorMm: observation.maxVertexErrorMm } : {}),
      limitations: "One source-parameter pose, measured triangulated surfaces only. No continuous clearance, semantic parameter-to-motion identity, force, physical fit or full product acceptance.",
    });
  }
  const statuses = results.map(item => item.status);
  const status: ResultStatus = statuses.includes("ERROR") ? "ERROR" :
    statuses.includes("FAIL") ? "FAIL" :
    statuses.includes("NOT_RUN") ? "NOT_RUN" : "PASS";
  return {
    method: "independent-source-pose-stl-comparison/v1",
    status, sourceSha256,
    originalSpecificationSha256: assemblySpecificationHash(spec),
    referenceSelector: input.referenceSelector, samples: results,
    reason: "Independently rendered source reference versus placed parts at explicit samples, not product motion approval.",
    coverage: results.length + " explicitly enumerated pose samples; no continuous sweep, allowed contacts, tools or manufacturing.",
  };
}
