import intentIndexJson from "../../../cad_knowledge/intent-index.json";

export type RequestIntentStatus = "MATCHED" | "AMBIGUOUS" | "UNKNOWN";

interface IntentCandidateDefinition {
  id: string;
  label: string;
  domain: string;
  object_kind: string;
  shared_aliases: string[];
  strong_aliases: string[];
  supporting_aliases: string[];
  conflicting_aliases: string[];
}

interface AmbiguityGroupDefinition {
  id: string;
  shared_concept: { id: string; label: string };
  clarification_question: string;
  candidates: IntentCandidateDefinition[];
}

interface IntentIndexV1 {
  schema_version: 1;
  ambiguity_groups: AmbiguityGroupDefinition[];
}

export interface RequestInterpretation {
  id: string;
  label: string;
  domain: string;
  objectKind: string;
  probability: number;
  score: number;
  evidence: string[];
  conflicts: string[];
}

export interface RequestIntelligenceV1 {
  version: 1;
  rawRequest: string;
  normalizedRequest: string;
  language: "en" | "zh" | "mixed" | "unknown";
  status: RequestIntentStatus;
  concepts: Array<{
    id: string;
    label: string;
    evidence: string[];
    source: "index" | "llm";
  }>;
  interpretations: RequestInterpretation[];
  clarificationQuestion: string | null;
  requiresClarification: boolean;
  confidence: number;
  assumptions: string[];
  suggestedMode: "unknown";
  matchedGroupId: string | null;
  brief?: {
    summary: string;
    intendedUse: string;
    requiredFeatures: string[];
    explicitConstraints: string[];
    acceptanceCriteria: string[];
  };
}

type MatchBucket = {
  shared: string[];
  strong: string[];
  supporting: string[];
  conflicts: string[];
};

const intentIndex = validateIntentIndex(intentIndexJson);

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function validateIntentIndex(value: unknown): IntentIndexV1 {
  if (!value || typeof value !== "object") throw new Error("intent index must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== 1) throw new Error("intent index schema_version must be 1");
  if (!Array.isArray(raw.ambiguity_groups)) throw new Error("intent index ambiguity_groups must be an array");
  const groupIds = new Set<string>();
  const candidateIds = new Set<string>();
  const groups = raw.ambiguity_groups.map((groupValue, groupIndex) => {
    if (!groupValue || typeof groupValue !== "object") throw new Error(`ambiguity_groups[${groupIndex}] must be an object`);
    const group = groupValue as Record<string, unknown>;
    if (typeof group.id !== "string" || !group.id) throw new Error(`ambiguity_groups[${groupIndex}].id is required`);
    if (groupIds.has(group.id)) throw new Error(`duplicate ambiguity group id: ${group.id}`);
    groupIds.add(group.id);
    if (typeof group.clarification_question !== "string" || !group.clarification_question) {
      throw new Error(`ambiguity_groups[${groupIndex}].clarification_question is required`);
    }
    if (!group.shared_concept || typeof group.shared_concept !== "object") {
      throw new Error(`ambiguity_groups[${groupIndex}].shared_concept is required`);
    }
    const concept = group.shared_concept as Record<string, unknown>;
    if (typeof concept.id !== "string" || typeof concept.label !== "string") {
      throw new Error(`ambiguity_groups[${groupIndex}].shared_concept needs id and label`);
    }
    if (!Array.isArray(group.candidates) || group.candidates.length < 2) {
      throw new Error(`ambiguity_groups[${groupIndex}] needs at least two candidates`);
    }
    const candidates = group.candidates.map((candidateValue, candidateIndex) => {
      if (!candidateValue || typeof candidateValue !== "object") {
        throw new Error(`ambiguity_groups[${groupIndex}].candidates[${candidateIndex}] must be an object`);
      }
      const candidate = candidateValue as Record<string, unknown>;
      for (const field of ["id", "label", "domain", "object_kind"] as const) {
        if (typeof candidate[field] !== "string" || !candidate[field]) {
          throw new Error(`candidate ${candidateIndex}.${field} is required`);
        }
      }
      if (candidateIds.has(candidate.id as string)) throw new Error(`duplicate intent candidate id: ${candidate.id}`);
      candidateIds.add(candidate.id as string);
      return {
        id: candidate.id as string,
        label: candidate.label as string,
        domain: candidate.domain as string,
        object_kind: candidate.object_kind as string,
        shared_aliases: validateStringArray(candidate.shared_aliases, `${candidate.id}.shared_aliases`),
        strong_aliases: validateStringArray(candidate.strong_aliases, `${candidate.id}.strong_aliases`),
        supporting_aliases: validateStringArray(candidate.supporting_aliases, `${candidate.id}.supporting_aliases`),
        conflicting_aliases: validateStringArray(candidate.conflicting_aliases, `${candidate.id}.conflicting_aliases`),
      };
    });
    return {
      id: group.id,
      shared_concept: { id: concept.id, label: concept.label } as { id: string; label: string },
      clarification_question: group.clarification_question,
      candidates,
    };
  });
  return { schema_version: 1, ambiguity_groups: groups };
}

export function normalizeCadRequest(request: string): string {
  return request
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(value: string): RequestIntelligenceV1["language"] {
  const hasCjk = /[\u3400-\u9fff]/u.test(value);
  const hasLatin = /[a-z]/i.test(value);
  if (hasCjk && hasLatin) return "mixed";
  if (hasCjk) return "zh";
  if (hasLatin) return "en";
  return "unknown";
}

function matchedAliases(normalizedRequest: string, aliases: string[]): string[] {
  return aliases
    .map(normalizeCadRequest)
    .filter((alias, index, all) => alias && all.indexOf(alias) === index && normalizedRequest.includes(alias));
}

function candidateMatches(normalizedRequest: string, candidate: IntentCandidateDefinition): MatchBucket {
  return {
    shared: matchedAliases(normalizedRequest, candidate.shared_aliases),
    strong: matchedAliases(normalizedRequest, candidate.strong_aliases),
    supporting: matchedAliases(normalizedRequest, candidate.supporting_aliases),
    conflicts: matchedAliases(normalizedRequest, candidate.conflicting_aliases),
  };
}

function scoreMatches(matches: MatchBucket): number {
  const positive = matches.shared.length * 5 + matches.strong.length * 9 + matches.supporting.length * 3;
  return Math.max(0, positive - matches.conflicts.length * 4);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function analyzeCadRequest(rawRequest: string): RequestIntelligenceV1 {
  const normalizedRequest = normalizeCadRequest(rawRequest);
  const language = detectLanguage(normalizedRequest);

  const groupResults = intentIndex.ambiguity_groups.map((group) => {
    const candidates = group.candidates.map((candidate, stableIndex) => {
      const matches = candidateMatches(normalizedRequest, candidate);
      return { candidate, stableIndex, matches, score: scoreMatches(matches) };
    });
    return {
      group,
      candidates,
      score: candidates.reduce((total, item) => total + item.score, 0),
    };
  }).filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.group.id.localeCompare(b.group.id));

  const selected = groupResults[0];
  if (!selected) {
    return {
      version: 1,
      rawRequest,
      normalizedRequest,
      language,
      status: "UNKNOWN",
      concepts: [],
      interpretations: [],
      clarificationQuestion: null,
      requiresClarification: true,
      confidence: 0,
      assumptions: [],
      suggestedMode: "unknown",
      matchedGroupId: null,
    };
  }

  const ranked = selected.candidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.stableIndex - b.stableIndex);
  const smoothedTotal = ranked.reduce((total, item) => total + item.score + 1, 0);
  const interpretations: RequestInterpretation[] = ranked.map(({ candidate, matches, score }) => ({
    id: candidate.id,
    label: candidate.label,
    domain: candidate.domain,
    objectKind: candidate.object_kind,
    probability: round((score + 1) / smoothedTotal),
    score,
    evidence: [...new Set([...matches.shared, ...matches.strong, ...matches.supporting])],
    conflicts: matches.conflicts,
  }));

  const top = ranked[0];
  const second = ranked[1];
  const topProbability = interpretations[0]?.probability ?? 0;
  const secondProbability = interpretations[1]?.probability ?? 0;
  const margin = topProbability - secondProbability;
  const sharedOnly = Boolean(top) && top.matches.shared.length > 0 && top.matches.strong.length === 0 && top.matches.supporting.length === 0;
  const ambiguous = Boolean(second) && (margin < 0.2 || sharedOnly);
  const positiveAliasCount = top
    ? top.matches.shared.length + top.matches.strong.length + top.matches.supporting.length
    : 0;
  const confidence = ambiguous
    ? round(Math.min(0.69, 0.35 + positiveAliasCount * 0.08 + Math.max(0, margin)))
    : round(Math.min(0.95, 0.6 + positiveAliasCount * 0.08 + Math.max(0, margin) * 0.2));

  return {
    version: 1,
    rawRequest,
    normalizedRequest,
    language,
    status: ambiguous ? "AMBIGUOUS" : "MATCHED",
    concepts: [{
      id: selected.group.shared_concept.id,
      label: selected.group.shared_concept.label,
      evidence: [...new Set(ranked.flatMap((item) => item.matches.shared))],
      source: "index",
    }],
    interpretations,
    clarificationQuestion: ambiguous ? selected.group.clarification_question : null,
    requiresClarification: ambiguous,
    confidence,
    assumptions: [],
    suggestedMode: "unknown",
    matchedGroupId: selected.group.id,
  };
}
