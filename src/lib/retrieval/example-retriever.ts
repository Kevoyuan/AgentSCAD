import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievedExample {
  name: string;
  scad_code: string;
  relevance: number; // 0–1
}

export interface RetrievedPattern {
  name: string;
  content: string;
}

export interface RetrievedFailure {
  name: string;
  content: string;
}

export interface RetrievalContext {
  examples: RetrievedExample[];
  patterns: RetrievedPattern[];
  failures: RetrievedFailure[];
}

// ---------------------------------------------------------------------------
// Keyword-to-example mapping
// ---------------------------------------------------------------------------

const KEYWORD_EXAMPLE_MAP: Record<string, string[]> = {
  plate: ["mounting_plate_four_holes"],
  "mounting plate": ["mounting_plate_four_holes"],
  "base plate": ["mounting_plate_four_holes"],
  bracket: ["l_bracket_ribs", "ribbed_mount"],
  "l bracket": ["l_bracket_ribs"],
  "wall bracket": ["l_bracket_ribs"],
  "shelf bracket": ["l_bracket_ribs"],
  clamp: ["pipe_clamp"],
  "pipe clamp": ["pipe_clamp"],
  "tube clamp": ["pipe_clamp"],
  "hose clamp": ["pipe_clamp"],
  enclosure: ["electronics_enclosure"],
  "project box": ["electronics_enclosure"],
  "junction box": ["electronics_enclosure"],
  "electronics box": ["electronics_enclosure"],
  washer: ["washer"],
  spacer: ["spacer"],
  standoff: ["spacer"],
  shim: ["washer"],
  hinge: ["hinge_bracket"],
  "hinge bracket": ["hinge_bracket"],
  "pivot bracket": ["hinge_bracket"],
  rib: ["l_bracket_ribs", "ribbed_mount"],
  ribbed: ["ribbed_mount"],
  "heavy duty": ["ribbed_mount"],
  "reinforced": ["ribbed_mount"],
  knob: ["gear_like_knob"],
  "thumb wheel": ["gear_like_knob"],
  dial: ["gear_like_knob"],
  gear: ["gear_like_knob"],
};

const KEYWORD_PATTERN_MAP: Record<string, string[]> = {
  hole: ["hole_patterns"],
  holes: ["hole_patterns"],
  "hole pattern": ["hole_patterns"],
  mounting: ["hole_patterns"],
  "bolt pattern": ["hole_patterns"],
  bracket: ["bracket_patterns"],
  mount: ["bracket_patterns"],
  enclosure: ["enclosure_patterns", "printable_rules"],
  box: ["enclosure_patterns"],
  case: ["enclosure_patterns"],
  printable: ["printable_rules"],
  "3d print": ["printable_rules"],
  print: ["printable_rules"],
  wall: ["printable_rules"],
  thickness: ["printable_rules"],
  overhang: ["printable_rules"],
  bridge: ["printable_rules"],
  manifold: ["printable_rules"],
};

const FAILURE_ALWAYS_INCLUDE = ["missing_holes", "non_manifold_boolean", "floating_parts"];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function knowledgeRoot(): string {
  return path.join(process.cwd(), "cad_knowledge");
}

function examplesDir(): string {
  return path.join(knowledgeRoot(), "examples");
}

function patternsDir(): string {
  return path.join(knowledgeRoot(), "patterns");
}

function failuresDir(): string {
  return path.join(knowledgeRoot(), "failures");
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function listScadFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".scad")).map((e) => e.replace(".scad", ""));
  } catch {
    return [];
  }
}

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(".md", ""));
  } catch {
    return [];
  }
}

/**
 * Match keywords from the input request against known example/pattern mappings.
 * Returns deduplicated example and pattern names.
 */
function matchKeywords(input: string): { exampleNames: Set<string>; patternNames: Set<string> } {
  const lower = input.toLowerCase();
  const exampleNames = new Set<string>();
  const patternNames = new Set<string>();

  for (const [keyword, examples] of Object.entries(KEYWORD_EXAMPLE_MAP)) {
    if (lower.includes(keyword)) {
      for (const e of examples) exampleNames.add(e);
    }
  }

  for (const [keyword, patterns] of Object.entries(KEYWORD_PATTERN_MAP)) {
    if (lower.includes(keyword)) {
      for (const p of patterns) patternNames.add(p);
    }
  }

  return { exampleNames, patternNames };
}

/**
 * Retrieve relevant examples, patterns, and failure docs for an input request.
 *
 * - Examples: keyword-matched from cad_knowledge/examples/. Full SCAD source returned.
 * - Patterns: keyword-matched from cad_knowledge/patterns/. Markdown content returned.
 * - Failures: all failure docs always included (small, high-value for avoiding errors).
 *
 * Falls back to a small set of default examples when nothing matches.
 */
export async function retrieveContext(input: string): Promise<RetrievalContext> {
  const { exampleNames, patternNames } = matchKeywords(input);
  const availableExamples = await listScadFiles(examplesDir());
  const availablePatterns = await listMdFiles(patternsDir());
  const availableFailures = await listMdFiles(failuresDir());

  // Resolve example names to actual files (fall back to first 2 if no match)
  let resolvedExamples = [...exampleNames].filter((n) => availableExamples.includes(n));
  if (resolvedExamples.length === 0) {
    resolvedExamples = availableExamples.slice(0, 2); // default: first 2 examples
  }

  // Resolve pattern names
  const resolvedPatterns = [...patternNames].filter((n) => availablePatterns.includes(n));
  // If no pattern matched, include printable_rules as a sensible default
  if (resolvedPatterns.length === 0 && availablePatterns.includes("printable_rules")) {
    resolvedPatterns.push("printable_rules");
  }

  // Always include all failure docs
  const resolvedFailures = availableFailures.filter((n) =>
    FAILURE_ALWAYS_INCLUDE.includes(n)
  );

  // Read files in parallel
  const [examples, patterns, failures] = await Promise.all([
    Promise.all(
      resolvedExamples.map(async (name) => {
        const scad_code = await readFileIfExists(path.join(examplesDir(), `${name}.scad`));
        return { name, scad_code: scad_code ?? "", relevance: 1.0 };
      })
    ),
    Promise.all(
      resolvedPatterns.map(async (name) => {
        const content = await readFileIfExists(path.join(patternsDir(), `${name}.md`));
        return { name, content: content ?? "" };
      })
    ),
    Promise.all(
      resolvedFailures.map(async (name) => {
        const content = await readFileIfExists(path.join(failuresDir(), `${name}.md`));
        return { name, content: content ?? "" };
      })
    ),
  ]);

  return {
    examples: examples.filter((e) => e.scad_code.length > 0),
    patterns: patterns.filter((p) => p.content.length > 0),
    failures: failures.filter((f) => f.content.length > 0),
  };
}

/**
 * Format retrieval context as a string for injection into the LLM prompt.
 */
export function formatRetrievalContext(ctx: RetrievalContext): string {
  const parts: string[] = [];

  if (ctx.examples.length > 0) {
    parts.push("## Reference Examples\n");
    for (const ex of ctx.examples) {
      parts.push(`### ${ex.name}\n\`\`\`scad\n${ex.scad_code}\n\`\`\`\n`);
    }
  }

  if (ctx.patterns.length > 0) {
    parts.push("## Design Patterns\n");
    for (const p of ctx.patterns) {
      parts.push(`### ${p.name}\n${p.content}\n`);
    }
  }

  if (ctx.failures.length > 0) {
    parts.push("## Common Failure Modes to Avoid\n");
    for (const f of ctx.failures) {
      parts.push(`### ${f.name}\n${f.content}\n`);
    }
  }

  return parts.join("\n");
}
