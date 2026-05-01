import fs from "fs/promises";
import path from "path";
import { buildScadLibraryPrompt } from "@/lib/tools/scad-library-resolver";
import { getLearnedPatternsForFamily } from "@/lib/improvement-analyzer";
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
  parameterValues: Record<string, unknown>
): Promise<{ systemPrompt: string; userPrompt: string } | null> {
  const skillContent = await loadSkill("scad-generation");
  if (!skillContent) return null;

  const familySchema = await loadFamilySchema(partFamily);
  const libraryPrompt = await buildScadLibraryPrompt();
  const retrievalCtx = await retrieveContext(inputRequest);
  const retrievalText = formatRetrievalContext(retrievalCtx);
  const stdLibDoc = await loadStdLibDoc();

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
  const markerIdx = skillContent.indexOf(marker);

  let systemPrompt: string;
  let userPromptTemplate: string;

  if (markerIdx >= 0) {
    systemPrompt = [
      skillContent.slice(0, markerIdx).trim(),
      stdLibDoc,
      libraryPrompt,
      retrievalText,
    ].filter(Boolean).join("\n\n");
    userPromptTemplate = skillContent.slice(markerIdx + marker.length).trim();
  } else {
    // Fallback: entire file is the system prompt, build a simple user prompt
    systemPrompt = [
      skillContent.trim(),
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

  // Inject manufacturing constraints that the validator enforces.
  // These are NOT the design wall_thickness parameter — they are
  // printability thresholds the mesh validator checks against.
  {
    const returnMarker = "Return the JSON object";
    const idx = userPrompt.lastIndexOf(returnMarker);
    if (idx >= 0) {
      const constraints = [
        "FDM minimum wall thickness: 1.2 mm (R001 validation will fail below this)",
        "Every printable local feature must be at least 1.2 mm thick/wide, including decorative ribs, relief lines, scrollwork, rims, lips, bridges around holes, nose ridges, tabs, bosses, and connectors.",
        "Prefer 1.6 mm or thicker for decorative details and 2.0 mm or thicker for structural/support features unless the user explicitly asks for a non-printable display-only model.",
        "Do not create knife-edge, hairline, zero-thickness, or sub-1.2 mm features. If a requested visual detail would be too thin, simplify, merge, emboss, or thicken it while preserving the design intent.",
        "Avoid tangential/coplanar boolean contacts and degenerate sliver triangles; overlap joined solids by an explicit merge tolerance such as 0.2 mm.",
        "All dimensions in millimeters",
      ].join("\n");
      userPrompt =
        userPrompt.slice(0, idx).trimEnd() +
        `\n\n## Manufacturing constraints (validated)\n${constraints}\n\n` +
        userPrompt.slice(idx);
    }
  }

  // Inject learned patterns from user edit history (self-learning loop).
  // These are optional context — they enhance generation quality but are
  // never treated as hard constraints.
  if (partFamily && partFamily !== "unknown") {
    try {
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
