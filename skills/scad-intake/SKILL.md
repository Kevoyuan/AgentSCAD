---
name: scad-intake
description: Interpret a natural-language CAD request before geometry generation, identify materially different meanings, and return a bounded evidence-grounded brief or one high-information clarification question. Use before OpenSCAD generation when deterministic intake cannot confidently classify the request.
---

# SCAD Intake

Return exactly one JSON object. Do not write OpenSCAD and do not add Markdown.

## Rules

1. Preserve the user's language and explicit words.
2. Distinguish materially different object types, uses, or modeling modes before generation.
3. Use `AMBIGUOUS` only when choosing the wrong interpretation would produce a substantially different CAD artifact. Return 2–4 mutually exclusive options and one question that resolves the highest-impact uncertainty.
4. Use `MATCHED` when one interpretation is sufficiently supported. Missing numeric dimensions alone are not ambiguity when they can remain editable parameters.
5. Use `UNKNOWN` when the request cannot support a useful interpretation.
6. Never silently choose functional vs concept/display mode, internal cutaway vs exterior shell, printability, assembly motion, or component count.
7. Evidence strings must be exact substrings of the user request. Do not cite world knowledge as user evidence.
8. Keep `assumptions` empty unless an assumption is explicitly harmless, reversible, and exposed as an editable parameter. Do not turn assumptions into user facts.
9. Acceptance criteria must describe observable geometry or explicit user constraints; do not claim that OpenSCAD, mesh, or visual validation has run.
10. IDs must match `[a-z0-9][a-z0-9_-]*` and remain stable descriptions, not random values.

## Output

```json
{
  "status": "MATCHED|AMBIGUOUS|UNKNOWN",
  "confidence": 0.0,
  "concepts": [
    { "id": "concept_id", "label": "concept label", "evidence": ["exact request substring"] }
  ],
  "interpretations": [
    {
      "id": "stable_interpretation_id",
      "label": "user-facing interpretation",
      "domain": "mechanical|architectural|product|concept|other",
      "objectKind": "specific CAD object kind",
      "probability": 0.0,
      "evidence": ["exact request substring"],
      "conflicts": []
    }
  ],
  "clarificationQuestion": "one question or null",
  "assumptions": [],
  "brief": {
    "summary": "literal request summary",
    "intendedUse": "explicit use or unknown",
    "requiredFeatures": [],
    "explicitConstraints": [],
    "acceptanceCriteria": []
  }
}
```

For `AMBIGUOUS`, probabilities should sum to approximately 1 and `clarificationQuestion` must be non-empty. For `MATCHED`, put the most supported interpretation first and set `clarificationQuestion` to `null`. For `UNKNOWN`, return empty concepts/interpretations/assumptions and a brief containing only explicit facts.
