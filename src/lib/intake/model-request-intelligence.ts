import {
  normalizeCadRequest,
  type RequestIntelligenceV1,
  type RequestInterpretation,
} from "./request-intelligence";

const MAX_OPTIONS = 4;
const MAX_LIST_ITEMS = 12;
const MAX_TEXT_CHARS = 300;

function boundedText(value: unknown, maxChars = MAX_TEXT_CHARS): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars)
    : "";
}

function boundedStringList(value: unknown, maxItems = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => boundedText(item)).filter(Boolean))].slice(0, maxItems);
}

function normalizedProbability(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.round(Math.max(0, Math.min(1, number)) * 1_000) / 1_000;
}

function optionId(value: unknown): string {
  const id = boundedText(value, 64).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]*$/.test(id) ? id : "";
}

function normalizeInterpretations(
  rawRequest: string,
  value: unknown,
): RequestInterpretation[] {
  if (!Array.isArray(value)) return [];
  const normalizedRequest = normalizeCadRequest(rawRequest);
  const seen = new Set<string>();
  const interpretations: RequestInterpretation[] = [];
  for (const raw of value.slice(0, MAX_OPTIONS)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    const id = optionId(candidate.id);
    const label = boundedText(candidate.label, 160);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const evidence = boundedStringList(candidate.evidence, 8).filter((item) =>
      normalizedRequest.includes(normalizeCadRequest(item)),
    );
    interpretations.push({
      id,
      label,
      domain: boundedText(candidate.domain, 100) || "unknown",
      objectKind: boundedText(candidate.objectKind ?? candidate.object_kind, 100) || "unknown",
      probability: normalizedProbability(candidate.probability),
      score: 0,
      evidence,
      conflicts: boundedStringList(candidate.conflicts, 8),
    });
  }

  const suppliedTotal = interpretations.reduce((total, item) => total + item.probability, 0);
  if (suppliedTotal > 0) {
    return interpretations.map((item) => ({
      ...item,
      probability: Math.round((item.probability / suppliedTotal) * 1_000) / 1_000,
      score: Math.round(item.probability * 100),
    }));
  }
  return interpretations.map((item) => ({
    ...item,
    probability: Math.round((1 / interpretations.length) * 1_000) / 1_000,
    score: 0,
  }));
}

function unknownIntelligence(rawRequest: string): RequestIntelligenceV1 {
  const normalizedRequest = normalizeCadRequest(rawRequest);
  const hasCjk = /[\u3400-\u9fff]/u.test(normalizedRequest);
  const hasLatin = /[a-z]/i.test(normalizedRequest);
  return {
    version: 1,
    rawRequest,
    normalizedRequest,
    language: hasCjk && hasLatin ? "mixed" : hasCjk ? "zh" : hasLatin ? "en" : "unknown",
    status: "UNKNOWN",
    concepts: [],
    interpretations: [],
    clarificationQuestion: null,
    requiresClarification: false,
    confidence: 0,
    assumptions: [],
    suggestedMode: "unknown",
    matchedGroupId: null,
  };
}

/**
 * Treat model output as untrusted data. Invalid or incomplete output degrades to
 * UNKNOWN and never invents a passing/approved interpretation.
 */
export function normalizeModelRequestIntelligence(
  rawRequest: string,
  value: unknown,
): RequestIntelligenceV1 {
  if (!value || typeof value !== "object") return unknownIntelligence(rawRequest);
  const raw = value as Record<string, unknown>;
  const requestedStatus = boundedText(raw.status, 32).toUpperCase();
  const interpretations = normalizeInterpretations(rawRequest, raw.interpretations);
  const clarificationQuestion = boundedText(raw.clarificationQuestion ?? raw.clarification_question, 400);
  const status = requestedStatus === "AMBIGUOUS" && interpretations.length >= 2 && clarificationQuestion
    ? "AMBIGUOUS"
    : requestedStatus === "MATCHED" && interpretations.length >= 1
      ? "MATCHED"
      : "UNKNOWN";
  if (status === "UNKNOWN") return unknownIntelligence(rawRequest);

  const base = unknownIntelligence(rawRequest);
  const rawConcepts = Array.isArray(raw.concepts) ? raw.concepts : [];
  const concepts = rawConcepts.slice(0, 8).flatMap((conceptValue, index) => {
    if (!conceptValue || typeof conceptValue !== "object") return [];
    const concept = conceptValue as Record<string, unknown>;
    const label = boundedText(concept.label, 120);
    if (!label) return [];
    return [{
      id: optionId(concept.id) || `concept_${index + 1}`,
      label,
      evidence: boundedStringList(concept.evidence, 6).filter((item) =>
        base.normalizedRequest.includes(normalizeCadRequest(item)),
      ),
      source: "llm" as const,
    }];
  });
  const rawBrief = raw.brief && typeof raw.brief === "object"
    ? raw.brief as Record<string, unknown>
    : {};

  return {
    ...base,
    status,
    concepts,
    interpretations,
    clarificationQuestion: status === "AMBIGUOUS" ? clarificationQuestion : null,
    requiresClarification: status === "AMBIGUOUS",
    confidence: Math.min(status === "AMBIGUOUS" ? 0.79 : 0.95, normalizedProbability(raw.confidence)),
    assumptions: boundedStringList(raw.assumptions, 8),
    brief: {
      summary: boundedText(rawBrief.summary, 300),
      intendedUse: boundedText(rawBrief.intendedUse ?? rawBrief.intended_use, 300),
      requiredFeatures: boundedStringList(rawBrief.requiredFeatures ?? rawBrief.required_features),
      explicitConstraints: boundedStringList(rawBrief.explicitConstraints ?? rawBrief.explicit_constraints),
      acceptanceCriteria: boundedStringList(rawBrief.acceptanceCriteria ?? rawBrief.acceptance_criteria),
    },
  };
}
