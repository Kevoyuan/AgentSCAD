// ---------------------------------------------------------------------------
// Resolve an ambiguous intake with web evidence
//
// "Apple iPhone 18 Duo" is ambiguous to a language model (dual-screen? dual-camera
// branding? internal assembly?), but a product page answers it outright. When the
// research stage finds evidence that names exactly one of the offered interpretations,
// pick it and record the evidence instead of asking the user.
// ---------------------------------------------------------------------------

import type { RequestInterpretation, RequestIntelligenceV1 } from "./request-intelligence";
import type { ResearchResultV1 } from "@/lib/research/request-research";

const MIN_TOKEN_LENGTH = 4;
const IGNORED_TOKENS = new Set([
  "with", "from", "that", "this", "model", "cad", "part", "phone", "smartphone", "device",
  "unknown", "other", "view", "based", "only", "standard", "conceptual",
]);

export interface ResearchDisambiguation {
  interpretation: RequestInterpretation;
  matchedTokens: string[];
  decisiveTokens: string[];
  evidenceQuote: string;
}

function tokens(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH && !IGNORED_TOKENS.has(token)),
  ));
}

function evidenceCorpus(research: ResearchResultV1): string {
  return [
    research.notes,
    ...research.evidence,
    ...(research.highlights ?? []),
    ...research.sources,
    ...research.dimensions.map((dimension) => `${dimension.feature} ${dimension.name}`),
  ].join(" \n ");
}

/**
 * Return the interpretation the web evidence supports, or null when the evidence is
 * missing, matches nothing, or matches several options equally (never guess).
 */
export function resolveAmbiguityFromResearch(
  intelligence: RequestIntelligenceV1,
  research: ResearchResultV1 | null | undefined,
): ResearchDisambiguation | null {
  if (!research || intelligence.status !== "AMBIGUOUS" || intelligence.interpretations.length < 2) {
    return null;
  }
  const corpus = evidenceCorpus(research).toLowerCase();
  if (!corpus.trim()) return null;

  const optionTokenCounts = new Map<string, number>();
  for (const interpretation of intelligence.interpretations) {
    for (const token of tokens(
      `${interpretation.label} ${interpretation.id} ${interpretation.domain} ${interpretation.objectKind}`,
    )) {
      optionTokenCounts.set(token, (optionTokenCounts.get(token) ?? 0) + 1);
    }
  }

  const scored = intelligence.interpretations
    .map((interpretation) => {
      const candidates = tokens(
        `${interpretation.label} ${interpretation.id} ${interpretation.domain} ${interpretation.objectKind}`,
      );
      const matched = candidates.filter((token) => corpus.includes(token));
      // A token shared by several options ("shell", "assembly") cannot decide between
      // them. Only tokens unique to one option are allowed to break the tie.
      const decisive = matched.filter((token) => optionTokenCounts.get(token) === 1);
      return { interpretation, matched, decisive };
    })
    .filter((entry) => entry.matched.length > 0)
    .sort((a, b) =>
      (b.decisive.length - a.decisive.length) || (b.matched.length - a.matched.length));

  if (scored.length === 0) return null;
  const [best, runnerUp] = scored;
  // Never guess: the evidence must separate the winner on decisive tokens alone.
  if (best.decisive.length === 0) return null;
  if (runnerUp && runnerUp.decisive.length === best.decisive.length) return null;

  const quote = research.evidence
    .concat(research.highlights ?? [], research.notes)
    .find((line) => best.decisive.some((token) => line.toLowerCase().includes(token)));

  return {
    interpretation: best.interpretation,
    matchedTokens: best.matched,
    decisiveTokens: best.decisive,
    evidenceQuote: (quote ?? `web research matched: ${best.decisive.join(", ")}`).slice(0, 240),
  };
}

/** Apply a resolved interpretation: chosen option first, clarification cleared. */
export function applyResearchDisambiguation(
  intelligence: RequestIntelligenceV1,
  resolved: ResearchDisambiguation,
): RequestIntelligenceV1 {
  const rest = intelligence.interpretations.filter(
    (interpretation) => interpretation.id !== resolved.interpretation.id,
  );
  return {
    ...intelligence,
    status: "MATCHED",
    requiresClarification: false,
    clarificationQuestion: null,
    interpretations: [resolved.interpretation, ...rest],
    assumptions: [
      ...intelligence.assumptions,
      `Ambiguity resolved from web research (${resolved.decisiveTokens.join(", ")}): ${resolved.evidenceQuote}`,
    ],
    confidence: Math.max(intelligence.confidence, 0.8),
  };
}
