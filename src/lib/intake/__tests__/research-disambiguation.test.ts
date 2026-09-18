import { describe, expect, test } from "bun:test";
import {
  applyResearchDisambiguation,
  resolveAmbiguityFromResearch,
} from "@/lib/intake/research-disambiguation";
import type { RequestIntelligenceV1 } from "@/lib/intake/request-intelligence";
import type { ResearchResultV1 } from "@/lib/research/request-research";

function intelligence(status: RequestIntelligenceV1["status"]): RequestIntelligenceV1 {
  return {
    version: 1,
    rawRequest: "Create a parametric CAD model of Apple iPhone 18 Duo 2026",
    normalizedRequest: "create a parametric cad model of apple iphone 18 duo 2026",
    language: "en",
    status,
    concepts: [],
    interpretations: [
      {
        id: "foldable_dual_screen_phone",
        label: "Dual-screen foldable phone exterior",
        domain: "consumer_electronics",
        objectKind: "assembly",
        probability: 0.4,
        score: 1,
        evidence: [],
        conflicts: [],
      },
      {
        id: "dual_camera_branding_phone",
        label: "Standard smartphone exterior with Duo as camera branding",
        domain: "consumer_electronics",
        objectKind: "enclosure",
        probability: 0.35,
        score: 1,
        evidence: [],
        conflicts: [],
      },
      {
        id: "internal_assembly_view",
        label: "Internal component assembly view",
        domain: "consumer_electronics",
        objectKind: "assembly",
        probability: 0.25,
        score: 1,
        evidence: [],
        conflicts: [],
      },
    ],
    clarificationQuestion: "Which meaning of Duo should the model use?",
    requiresClarification: true,
    confidence: 0.6,
    assumptions: [],
    suggestedMode: "unknown",
    matchedGroupId: null,
  };
}

function research(overrides: Partial<ResearchResultV1> = {}): ResearchResultV1 {
  return {
    version: 1,
    status: "OK",
    backend: "keyless",
    queries: ["Apple iPhone 18 Duo 2026 dimensions specifications"],
    sources: ["IPhone Duo — https://en.wikipedia.org/wiki/IPhone_Duo"],
    evidence: [
      "The iPhone Duo is a foldable smartphone developed and marketed by Apple. It is the first iPhone to feature a foldable design.",
    ],
    highlights: [
      "IPhone Duo: The iPhone Duo is a foldable smartphone developed and marketed by Apple.",
    ],
    dimensions: [],
    unknowns: [],
    notes: "Extracted 6 dimension(s) from 3 result(s).",
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("research disambiguation", () => {
  test("picks the interpretation the web evidence names", () => {
    const resolved = resolveAmbiguityFromResearch(intelligence("AMBIGUOUS"), research());

    expect(resolved?.interpretation.id).toBe("foldable_dual_screen_phone");
    expect(resolved?.matchedTokens).toContain("foldable");
    expect(resolved?.decisiveTokens).toContain("foldable");
    expect(resolved?.evidenceQuote).toContain("foldable smartphone");
  });

  test("resolves the earlier dual-screen vs dual-camera ambiguity", () => {
    const ambiguous = intelligence("AMBIGUOUS");
    ambiguous.interpretations = [
      {
        id: "dual_screen_foldable_phone",
        label: "Dual-screen / foldable phone exterior",
        domain: "consumer_electronics",
        objectKind: "assembly",
        probability: 0.34,
        score: 1,
        evidence: [],
        conflicts: [],
      },
      {
        id: "dual_camera_branding_phone",
        label: "Standard smartphone exterior with Duo as dual-camera branding",
        domain: "consumer_electronics",
        objectKind: "enclosure",
        probability: 0.33,
        score: 1,
        evidence: [],
        conflicts: [],
      },
      {
        id: "internal_component_assembly",
        label: "Internal component assembly view",
        domain: "consumer_electronics",
        objectKind: "assembly",
        probability: 0.33,
        score: 1,
        evidence: [],
        conflicts: [],
      },
    ];

    const resolved = resolveAmbiguityFromResearch(ambiguous, research());
    expect(resolved?.interpretation.id).toBe("dual_screen_foldable_phone");
    expect(resolved?.decisiveTokens).toContain("foldable");
  });

  test("does nothing without usable evidence", () => {
    expect(resolveAmbiguityFromResearch(intelligence("AMBIGUOUS"), null)).toBeNull();
    expect(resolveAmbiguityFromResearch(intelligence("AMBIGUOUS"), research({
      status: "DISABLED",
      evidence: [],
      highlights: [],
      sources: [],
      notes: "",
    }))).toBeNull();
  });

  test("does nothing when the request is not ambiguous", () => {
    expect(resolveAmbiguityFromResearch(intelligence("MATCHED"), research())).toBeNull();
    expect(resolveAmbiguityFromResearch(intelligence("UNKNOWN"), research())).toBeNull();
  });

  test("stays quiet when evidence matches several options equally", () => {
    const tied = intelligence("AMBIGUOUS");
    tied.interpretations = tied.interpretations.map((interpretation) => ({
      ...interpretation,
      label: "phone",
      id: "phone",
      domain: "consumer_electronics",
      objectKind: "phone",
    }));
    expect(resolveAmbiguityFromResearch(tied, research())).toBeNull();
  });

  test("applies the resolution with the chosen option first", () => {
    const resolved = resolveAmbiguityFromResearch(intelligence("AMBIGUOUS"), research());
    const applied = applyResearchDisambiguation(intelligence("AMBIGUOUS"), resolved!);

    expect(applied.status).toBe("MATCHED");
    expect(applied.requiresClarification).toBe(false);
    expect(applied.clarificationQuestion).toBeNull();
    expect(applied.interpretations[0].id).toBe("foldable_dual_screen_phone");
    expect(applied.assumptions.at(-1)).toContain("resolved from web research");
    expect(applied.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
