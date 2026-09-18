import { parseJsonObject } from "@/lib/harness/structured-output";
import { loadSkill } from "@/lib/skill-resolver";
import { createChatCompletionWithFallback } from "@/lib/tools/model-router";

import { normalizeModelRequestIntelligence } from "./model-request-intelligence";
import type { RequestIntelligenceV1 } from "./request-intelligence";

export async function runModelCadIntake(
  rawRequest: string,
  requestedModel?: string | null,
  researchEvidence?: string,
): Promise<RequestIntelligenceV1> {
  const skill = await loadSkill("scad-intake");
  if (!skill) throw new Error("scad-intake skill is missing");

  const evidenceBlock = researchEvidence?.trim()
    ? [
        "",
        "External research evidence (from web sources, may resolve ambiguity):",
        researchEvidence.trim(),
        "Prefer the interpretation the evidence supports. Only report AMBIGUOUS when the evidence does not settle it.",
      ].join("\n")
    : "";

  const rawContent = await createChatCompletionWithFallback({
    messages: [
      { role: "system", content: skill },
      {
        role: "user",
        content: `Analyze this CAD request. Return only the required JSON object.\n\n<user_request>\n${rawRequest}\n</user_request>${evidenceBlock}`,
      },
    ],
    model: requestedModel?.trim() || undefined,
    stream: false,
  });
  const parsed = parseJsonObject<unknown>(rawContent);
  return normalizeModelRequestIntelligence(rawRequest, parsed);
}
