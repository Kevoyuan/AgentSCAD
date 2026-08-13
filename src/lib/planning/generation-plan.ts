import { createHash } from "crypto";

import type { RequestIntelligenceV1 } from "@/lib/intake/request-intelligence";
import type {
  CadConstraints,
  CadFeature,
  CadGenerationPlan,
  CadValidationTargets,
  ParameterDef,
  PartFamily,
} from "@/lib/harness/types";

export interface PersistedGenerationPlan {
  schema_version: 1;
  fingerprint: string;
  plan: CadGenerationPlan;
}

function fingerprintPayload(
  request: string,
  family: PartFamily,
  parameterValues: Record<string, unknown>,
  intelligence: RequestIntelligenceV1,
): string {
  return JSON.stringify({
    request,
    family,
    parameterValues: Object.fromEntries(
      Object.entries(parameterValues).sort(([left], [right]) => left.localeCompare(right)),
    ),
    approvedInterpretation: intelligence.interpretations[0]?.id ?? null,
    brief: intelligence.brief ?? null,
  });
}

export function generationPlanFingerprint(
  request: string,
  family: PartFamily,
  parameterValues: Record<string, unknown>,
  intelligence: RequestIntelligenceV1,
): string {
  return createHash("sha256")
    .update(fingerprintPayload(request, family, parameterValues, intelligence))
    .digest("hex");
}

function numericDimensions(parameters: ParameterDef[]): Record<string, number> {
  return Object.fromEntries(
    parameters
      .filter((parameter) => Number.isFinite(parameter.value))
      .map((parameter) => [parameter.key, parameter.value]),
  );
}

function plannedFeatures(intelligence: RequestIntelligenceV1): CadFeature[] {
  const required = intelligence.brief?.requiredFeatures ?? [];
  const fallback = intelligence.interpretations[0]?.label
    ?? intelligence.concepts[0]?.label
    ?? "requested CAD body";
  return (required.length > 0 ? required : [fallback]).map((description, index) => ({
    name: description,
    type: index === 0 ? "base" : "feature",
    required: true,
    parameters: {},
    description,
  }));
}

export function buildGenerationPlan(args: {
  request: string;
  family: PartFamily;
  parameterValues: Record<string, unknown>;
  parameterSchema: ParameterDef[];
  intelligence: RequestIntelligenceV1;
}): PersistedGenerationPlan {
  const { request, family, parameterValues, parameterSchema, intelligence } = args;
  const features = plannedFeatures(intelligence);
  const dimensions = numericDimensions(parameterSchema);
  const constraints: CadConstraints = {
    dimensions,
    assumptions: [...intelligence.assumptions],
    manufacturing: {
      min_wall_thickness: dimensions.wall_thickness ?? 1.2,
      printable: true,
    },
    geometry: {
      must_be_manifold: true,
      centered: true,
      no_floating_parts: true,
    },
    code: {
      use_parameters: true,
      use_library_modules: true,
      avoid_magic_numbers: true,
      top_level_module: "generated_part",
    },
  };
  const validationTargets: CadValidationTargets = {
    expected_bbox: [],
    required_feature_checks: [
      "single connected body",
      ...features.map((feature) => feature.description),
      ...(intelligence.brief?.acceptanceCriteria ?? []),
    ],
    forbidden_failure_modes: [
      "missing required features",
      "floating parts",
      "non-manifold mesh",
      "sub-minimum printable features",
    ],
  };

  return {
    schema_version: 1,
    fingerprint: generationPlanFingerprint(request, family, parameterValues, intelligence),
    plan: {
      part_type: family === "unknown"
        ? intelligence.interpretations[0]?.objectKind ?? "freeform_part"
        : family,
      summary: intelligence.brief?.summary || request,
      units: "mm",
      features,
      constraints,
      modeling_plan: [
        "Create the primary printable body from editable top-level dimensions.",
        ...features.map((feature) => `Model required feature: ${feature.description}.`),
        "Apply cutouts and clearances as subtractive geometry with explicit overlap tolerances.",
        "Assemble one manifold body in generated_part() and expose it once at the top level.",
      ],
      design_rationale: [
        "Use a compact, persisted geometry contract so retries can resume at code generation.",
        "Keep OpenSCAD as the artifact source of truth for editable parameters.",
      ],
      validation_targets: validationTargets,
    },
  };
}

export function restoreGenerationPlan(
  cadIntentJson: string | null | undefined,
  expectedFingerprint: string,
): PersistedGenerationPlan | null {
  if (!cadIntentJson) return null;
  try {
    const parsed = JSON.parse(cadIntentJson) as { generation_plan?: PersistedGenerationPlan };
    const persisted = parsed.generation_plan;
    if (
      persisted?.schema_version !== 1
      || persisted.fingerprint !== expectedFingerprint
      || !persisted.plan
      || !Array.isArray(persisted.plan.modeling_plan)
    ) return null;
    return persisted;
  } catch {
    return null;
  }
}
