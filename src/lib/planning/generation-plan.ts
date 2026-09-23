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
  schema_version: 2;
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

function explicitValidationMode(request: string, intelligence: RequestIntelligenceV1) {
  const stated = [request, intelligence.brief?.intendedUse ?? "", ...(intelligence.brief?.explicitConstraints ?? [])].join(" ");
  const assembly = /\b(?:assembly|separate parts|multiple parts|multi-part)\b|\b(?:[2-9]|two|three)(?:\s+\w+){0,3}\s+parts\b|装配|多个零件|两个零件|两部分|分体/i.test(stated);
  const display = /\b(?:display-only|display model|non-printable|not for printing)\b|展示模型|仅供展示|不用于打印/i.test(stated);
  const exactParts = stated.match(/\b([2-9])(?:\s+\w+){0,3}\s+parts\b|\b(two|three)(?:\s+\w+){0,3}\s+parts\b|([二两三四五六七八九])个?零件/iu);
  const chineseCounts: Record<string, number> = { 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const expectedComponentCount = exactParts
    ? exactParts[1] ? Number(exactParts[1]) : exactParts[2] ? (exactParts[2].toLowerCase() === "two" ? 2 : 3) : chineseCounts[exactParts[3]]
    : undefined;
  return { assembly, display, expectedComponentCount };
}

export function buildGenerationPlan(args: {
  request: string;
  family: PartFamily;
  parameterValues: Record<string, unknown>;
  parameterSchema: ParameterDef[];
  intelligence: RequestIntelligenceV1;
}): PersistedGenerationPlan {
  const { request, family, parameterValues, parameterSchema, intelligence } = args;
  const validationMode = explicitValidationMode(request, intelligence);
  const features = plannedFeatures(intelligence);
  const dimensions = numericDimensions(parameterSchema);
  const constraints: CadConstraints = {
    dimensions,
    assumptions: [...intelligence.assumptions],
    explicit_constraints: [...(intelligence.brief?.explicitConstraints ?? [])],
    manufacturing: {},
    geometry: {},
    code: {},
  };
  const validationTargets: CadValidationTargets = {
    expected_bbox: [],
    required_feature_checks: [...(intelligence.brief?.acceptanceCriteria ?? [])],
    forbidden_failure_modes: [],
    ...(validationMode.assembly ? { allow_multiple_components: true } : {}),
    ...(validationMode.expectedComponentCount ? { expected_component_count: validationMode.expectedComponentCount } : {}),
    ...(validationMode.display ? { manufacturing_mode: "display" as const } : {}),
  };

  return {
    schema_version: 2,
    fingerprint: generationPlanFingerprint(request, family, parameterValues, intelligence),
    plan: {
      part_type: family === "unknown"
        ? intelligence.interpretations[0]?.objectKind ?? "freeform_part"
        : family,
      summary: intelligence.brief?.summary || request,
      units: "mm",
      features,
      constraints,
      modeling_plan: [],
      design_rationale: [],
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
      persisted?.schema_version !== 2
      || persisted.fingerprint !== expectedFingerprint
      || !persisted.plan
      || !Array.isArray(persisted.plan.modeling_plan)
    ) return null;
    return persisted;
  } catch {
    return null;
  }
}
