import {
  analyzeCadRequest,
  normalizeCadRequest,
  type RequestIntelligenceV1,
  type RequestInterpretation,
} from "./request-intelligence";
import { normalizeModelRequestIntelligence } from "./model-request-intelligence";

export interface RequestIntentApproval {
  version: 1;
  source: "user";
  selectedInterpretationId: string;
  approvedAt: string;
}

export interface ApprovedRequestIntelligenceV1 extends RequestIntelligenceV1 {
  approval: RequestIntentApproval;
}

function parseObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getPersistedApproval(value: Record<string, unknown>): RequestIntentApproval | null {
  const approval = value.approval;
  if (!approval || typeof approval !== "object") return null;
  const candidate = approval as Record<string, unknown>;
  if (
    candidate.version !== 1
    || candidate.source !== "user"
    || typeof candidate.selectedInterpretationId !== "string"
    || typeof candidate.approvedAt !== "string"
  ) {
    return null;
  }
  return candidate as unknown as RequestIntentApproval;
}

export function approveCadRequestInterpretation(
  rawRequest: string,
  selectedInterpretationId: string,
  approvedAt = new Date().toISOString(),
): ApprovedRequestIntelligenceV1 {
  const analysis = analyzeCadRequest(rawRequest);
  return approveAnalysis(analysis, selectedInterpretationId, approvedAt, false);
}

function approveAnalysis(
  analysis: RequestIntelligenceV1,
  selectedInterpretationId: string,
  approvedAt: string,
  allowMatched: boolean,
): ApprovedRequestIntelligenceV1 {
  const selected = analysis.interpretations.find(
    (interpretation) => interpretation.id === selectedInterpretationId,
  );
  if (!selected || (analysis.status !== "AMBIGUOUS" && !(allowMatched && analysis.status === "MATCHED"))) {
    throw new Error("The selected interpretation is not a valid option for this request");
  }

  return {
    ...analysis,
    status: "MATCHED",
    interpretations: [
      selected,
      ...analysis.interpretations.filter((interpretation) => interpretation.id !== selected.id),
    ],
    clarificationQuestion: null,
    requiresClarification: false,
    confidence: 1,
    approval: {
      version: 1,
      source: "user",
      selectedInterpretationId: selected.id,
      approvedAt,
    },
  };
}

function restorePersistedAnalysis(
  rawRequest: string,
  persisted: Record<string, unknown>,
): RequestIntelligenceV1 | null {
  if (typeof persisted.rawRequest !== "string") return null;
  if (normalizeCadRequest(persisted.rawRequest) !== normalizeCadRequest(rawRequest)) return null;
  if (typeof persisted.matchedGroupId === "string" && persisted.matchedGroupId) {
    const deterministic = analyzeCadRequest(rawRequest);
    return deterministic.matchedGroupId === persisted.matchedGroupId ? deterministic : null;
  }
  const normalized = normalizeModelRequestIntelligence(rawRequest, persisted);
  return normalized.status === "UNKNOWN" ? null : normalized;
}

/** Restore validated deterministic or model-derived intake for the same request. */
export function restorePersistedRequestIntelligence(
  rawRequest: string,
  persistedIntentResult: string | null | undefined,
): RequestIntelligenceV1 | null {
  const persisted = parseObject(persistedIntentResult);
  return persisted ? restorePersistedAnalysis(rawRequest, persisted) : null;
}

export function approvePersistedCadRequestInterpretation(
  rawRequest: string,
  persistedIntentResult: string | null | undefined,
  selectedInterpretationId: string,
  approvedAt = new Date().toISOString(),
): ApprovedRequestIntelligenceV1 {
  const analysis = restorePersistedRequestIntelligence(rawRequest, persistedIntentResult);
  if (!analysis || analysis.status !== "AMBIGUOUS") {
    throw new Error("The job does not contain a valid ambiguous intent brief");
  }
  return approveAnalysis(analysis, selectedInterpretationId, approvedAt, false);
}

export function restoreApprovedRequestIntelligence(
  rawRequest: string,
  persistedIntentResult: string | null | undefined,
): ApprovedRequestIntelligenceV1 | null {
  const persisted = parseObject(persistedIntentResult);
  const approval = persisted ? getPersistedApproval(persisted) : null;
  if (!persisted || !approval) return null;
  const analysis = restorePersistedRequestIntelligence(rawRequest, persistedIntentResult);
  if (!analysis) return null;

  try {
    return approveAnalysis(
      analysis,
      approval.selectedInterpretationId,
      approval.approvedAt,
      true,
    );
  } catch {
    return null;
  }
}

export function getApprovedInterpretation(
  intelligence: RequestIntelligenceV1,
): RequestInterpretation | null {
  if (!("approval" in intelligence)) return null;
  const approval = (intelligence as ApprovedRequestIntelligenceV1).approval;
  return intelligence.interpretations.find(
    (interpretation) => interpretation.id === approval.selectedInterpretationId,
  ) ?? null;
}

export function buildApprovedGenerationRequest(
  rawRequest: string,
  intelligence: RequestIntelligenceV1,
): string {
  const approved = getApprovedInterpretation(intelligence);
  const selected = approved ?? (intelligence.status === "MATCHED" ? intelligence.interpretations[0] : null);
  if (!selected && !intelligence.brief) return rawRequest;
  const context = [
    rawRequest,
    "",
    approved
      ? "User-approved interpretation (treat this as explicit input, not an assumption):"
      : "Pre-generation request interpretation (use only the evidence and explicit facts below):",
  ];
  if (selected) {
    context.push(
      `- ${selected.label}`,
      `- intent_id: ${selected.id}`,
      `- domain: ${selected.domain}`,
      `- object_kind: ${selected.objectKind}`,
    );
  }
  if (intelligence.brief) {
    const brief = intelligence.brief;
    if (brief.summary) context.push(`- summary: ${brief.summary}`);
    if (brief.intendedUse) context.push(`- intended_use: ${brief.intendedUse}`);
    if (brief.requiredFeatures.length > 0) context.push(`- required_features: ${brief.requiredFeatures.join("; ")}`);
    if (brief.explicitConstraints.length > 0) context.push(`- explicit_constraints: ${brief.explicitConstraints.join("; ")}`);
    if (brief.acceptanceCriteria.length > 0) context.push(`- acceptance_criteria: ${brief.acceptanceCriteria.join("; ")}`);
  }
  if (intelligence.assumptions.length > 0) {
    context.push(`- provisional_editable_assumptions: ${intelligence.assumptions.join("; ")}`);
  }
  return context.join("\n");
}
