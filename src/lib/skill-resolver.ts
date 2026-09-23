import fs from "fs/promises";
import path from "path";
import { buildScadLibraryPrompt } from "@/lib/tools/scad-library-resolver";
import { retrieveContext, formatRetrievalContext } from "@/lib/retrieval/example-retriever";

// ---------------------------------------------------------------------------
// Types (mirrors the ParameterDef in process/route.ts)
// ---------------------------------------------------------------------------

export interface ParameterDef {
  key: string;
  label: string;
  kind: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  source: string;
  editable: boolean;
  description: string;
  group: string;
}

interface FamilySchemaFile {
  family: string;
  parameters: ParameterDef[];
}

// ---------------------------------------------------------------------------
// In-memory cache -- skills are static at runtime
// ---------------------------------------------------------------------------

const skillCache = new Map<string, string>();
const familyCache = new Map<string, FamilySchemaFile>();
let stdLibDocCache: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skillsRoot(): string {
  return path.join(process.cwd(), "skills");
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function skillInstructions(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "").trim();
}

export function isExperimentalMemoryPromptEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.AGENTSCAD_MEMORY_PROMPT_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the AgentSCAD standard library reference doc (openscad_lib/README.md).
 * Cached in memory — the library doesn't change at runtime.
 */
async function loadStdLibDoc(): Promise<string> {
  if (stdLibDocCache !== null) return stdLibDocCache;
  const content = await readTextFile(
    path.join(process.cwd(), "openscad_lib", "README.md")
  );
  stdLibDocCache = content ?? "";
  return stdLibDocCache;
}

/**
 * Load a skill markdown file from skills/{skillName}/SKILL.md.
 * Returns the file content, or null if it doesn't exist.
 */
export async function loadSkill(skillName: string): Promise<string | null> {
  const cached = skillCache.get(skillName);
  if (cached !== undefined) return cached;

  const filePath = path.join(skillsRoot(), skillName, "SKILL.md");
  const content = await readTextFile(filePath);

  // Cache even null so we don't retry failed reads
  skillCache.set(skillName, content ?? "");
  return content;
}

/**
 * Load a parameter-family schema from
 * skills/scad-generation/families/{family}.json
 * Returns the parsed schema, or null if it doesn't exist.
 */
export async function loadFamilySchema(
  family: string
): Promise<FamilySchemaFile | null> {
  const cached = familyCache.get(family);
  if (cached !== undefined) return cached;

  const filePath = path.join(
    skillsRoot(),
    "scad-generation",
    "families",
    `${family}.json`
  );
  const schema = await readJsonFile<FamilySchemaFile>(filePath);

  if (schema) {
    familyCache.set(family, schema);
  }
  return schema;
}

/**
 * Build the system + user prompt pair for SCAD generation.
 *
 * 1. Loads the scad-generation SKILL.md
 * 2. Loads the per-family parameter schema
 * 3. Fills in template variables
 *
 * Falls back to hardcoded defaults (null return) if skill files are missing.
 */
export async function buildScadPrompt(
  inputRequest: string,
  partFamily: string,
  parameterValues: Record<string, unknown>,
  researchEvidence?: string,
): Promise<{ systemPrompt: string; userPrompt: string } | null> {
  const [skillContent, planningSkill, familySchema, libraryPromptRaw, retrievalCtx, stdLibDocRaw] = await Promise.all([
    loadSkill("scad-generation"),
    loadSkill("scad-planning"),
    loadFamilySchema(partFamily),
    buildScadLibraryPrompt(),
    retrieveContext(inputRequest),
    loadStdLibDoc(),
  ]);
  if (!skillContent || !planningSkill) return null;

  // Prompt sections are no longer silently cut off. Truncating the skill, the
  // standard library reference or the library guidance mid-sentence produced
  // prompts that asked for APIs the model could no longer see.
  const boundedSkill = skillInstructions(skillContent);
  const planningInstructions = skillInstructions(planningSkill);
  const libraryPrompt = libraryPromptRaw;
  const retrievalText = formatRetrievalContext(retrievalCtx);
  const stdLibDoc = stdLibDocRaw;

  // Apply parameter overrides to the schema defaults
  const params = (familySchema?.parameters ?? []).map((p) => {
    const override = parameterValues[p.key];
    return override !== undefined ? { ...p, value: override as number } : p;
  });

  // Build parameter summary string
  const paramSummary =
    params.length > 0
      ? params
          .map(
            (p) =>
              `- ${p.key} = ${p.value} (${p.kind}, ${p.unit || "unitless"}, range ${p.min}–${p.max})  // ${p.description}`
          )
          .join("\n")
      : "- (no parameters defined)";

  // Split the skill file into system prompt (everything before the
  // "## User Request" section) and user prompt (the section itself).
  const marker = "## User Request";
  const markerIdx = boundedSkill.indexOf(marker);

  let systemPrompt: string;
  let userPromptTemplate: string;

  if (markerIdx >= 0) {
    systemPrompt = [
      boundedSkill.slice(0, markerIdx).trim(),
      planningInstructions,
      stdLibDoc,
      libraryPrompt,
      retrievalText,
    ].filter(Boolean).join("\n\n");
    userPromptTemplate = boundedSkill.slice(markerIdx + marker.length).trim();
  } else {
    // Fallback: entire file is the system prompt, build a simple user prompt
    systemPrompt = [
      boundedSkill.trim(),
      planningInstructions,
      stdLibDoc,
      libraryPrompt,
      retrievalText,
    ].filter(Boolean).join("\n\n");
    userPromptTemplate = `Generate OpenSCAD code for the following request:\n\n"{inputRequest}"\n\nDetected part family: {partFamily}\n\nSuggested parameters:\n{paramSummary}\n\nCurrent parameter values:\n{parameterValues}\n\nReturn the JSON object with summary, parameters, and scad_source.`;
  }

  // Fill in template variables in the user prompt
  let userPrompt = userPromptTemplate
    .replace(/\{inputRequest\}/g, inputRequest)
    .replace(/\{partFamily\}/g, partFamily)
    .replace(/\{paramSummary\}/g, paramSummary)
    .replace(
      /\{parameterValues\}/g,
      JSON.stringify(parameterValues, null, 2)
    );

  // Optional web-research evidence. It is advisory: the generator may use it to
  // constrain dimensions, but it must not present the model as an official product.
  if (researchEvidence && researchEvidence.trim()) {
    userPrompt = `${userPrompt.trimEnd()}\n\n${researchEvidence.trim()}`;
  }

  // Experimental learned observations are off by default and cannot run in
  // production. They do not yet have artifact-linked acceptance provenance.
  if (
    isExperimentalMemoryPromptEnabled() &&
    partFamily &&
    partFamily !== "unknown"
  ) {
    try {
      const { getLearnedPatternsForFamily } = await import("@/lib/improvement-analyzer");
      const learnedContext = await getLearnedPatternsForFamily(partFamily);
      if (learnedContext) {
        // Insert learned patterns before the final "Return the JSON..." instruction
        const returnMarker = "Return the JSON object";
        const markerIdx = userPrompt.lastIndexOf(returnMarker);
        if (markerIdx >= 0) {
          const beforeMarker = userPrompt.slice(0, markerIdx).trimEnd();
          const afterMarker = userPrompt.slice(markerIdx);
          userPrompt =
            beforeMarker +
            "\n\n## Learned patterns from user edits (optional context)\n" +
            "The following patterns have been observed from how users edit generated code for this part family. " +
            "Use these insights to improve your generation, but treat them as guidance, not strict requirements.\n\n" +
            learnedContext +
            "\n\n" +
            afterMarker;
        }
      }
    } catch {
      // Learned patterns are non-critical — silently skip if unavailable
    }
  }

  return { systemPrompt, userPrompt };
}

/** Build the smaller code-agent prompt used after a generation plan exists. */
export async function buildScadCodingPrompt(
  inputRequest: string,
  partFamily: string,
  parameterValues: Record<string, unknown>,
  generationPlan: unknown,
  researchEvidence?: string,
): Promise<{ systemPrompt: string; userPrompt: string } | null> {
  const [skillContent, planningSkill, familySchema, libraryPromptRaw, retrievalCtx, stdLibDocRaw] = await Promise.all([
    loadSkill("scad-coding"),
    loadSkill("scad-planning"),
    loadFamilySchema(partFamily),
    buildScadLibraryPrompt(),
    retrieveContext(inputRequest),
    loadStdLibDoc(),
  ]);
  if (!skillContent || !planningSkill) return null;

  const params = (familySchema?.parameters ?? []).map((parameter) => ({
    ...parameter,
    value: parameterValues[parameter.key] ?? parameter.value,
  }));
  return {
    systemPrompt: [
      skillInstructions(skillContent),
      skillInstructions(planningSkill),
      stdLibDocRaw,
      libraryPromptRaw,
      formatRetrievalContext(retrievalCtx),
    ].filter(Boolean).join("\n\n"),
    userPrompt: [
      "Use this persisted request-evidence contract to plan and implement complete OpenSCAD.",
      `<user_request>\n${inputRequest}\n</user_request>`,
      `<generation_plan>\n${JSON.stringify(generationPlan, null, 2)}\n</generation_plan>`,
      `<editable_parameters>\n${JSON.stringify(params, null, 2)}\n</editable_parameters>`,
      `<current_values>\n${JSON.stringify(parameterValues, null, 2)}\n</current_values>`,
      ...(researchEvidence && researchEvidence.trim()
        ? [`<external_research>\n${researchEvidence.trim()}\n</external_research>`]
        : []),
      "Return only one ```scad fenced block. Do not repeat the plan or add commentary.",
    ].join("\n\n"),
  };
}

/**
 * Apply per-family parameter value overrides to a loaded schema.
 * Returns a new ParameterDef[] with user-provided values merged in.
 */
export function applyParameterOverrides(
  schema: ParameterDef[],
  overrides: Record<string, unknown>
): ParameterDef[] {
  return schema.map((p) => {
    const v = overrides[p.key];
    return v !== undefined ? { ...p, value: v as number } : p;
  });
}
