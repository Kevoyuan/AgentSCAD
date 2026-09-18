import fs from "fs/promises";
import path from "path";
import {
  EXAMPLE_ENTRIES,
  PATTERN_ENTRIES,
  RETRIEVAL_BUDGET,
  normalizeRetrievalText,
  rankIndexEntries,
} from "./retrieval-index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievedExample {
  name: string;
  scad_code: string;
  /** Score normalized to 0–1 against the best hit in this result set. */
  relevance: number;
  /** Raw weighted alias score, kept for retrieval evidence and debugging. */
  score: number;
  matchedAliases: string[];
}

export interface RetrievedPattern {
  name: string;
  content: string;
  relevance: number;
  score: number;
  matchedAliases: string[];
}

export interface RetrievedFailure {
  name: string;
  content: string;
}

export interface RetrievalContext {
  examples: RetrievedExample[];
  patterns: RetrievedPattern[];
  failures: RetrievedFailure[];
  /** Alias strings that matched, sorted for stable evidence between runs. */
  matchedKeywords: string[];
}

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

const FAILURE_ALWAYS_INCLUDE = ["missing_holes", "non_manifold_boolean", "floating_parts"];

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
 * Score every index entry against the request, keep the ones whose document actually
 * exists on disk, and cut to the retrieval budget.
 *
 * Availability is checked before the budget is applied so an entry with a missing file
 * cannot consume a slot a real document should have had.
 */
function selectWithinBudget(
  entries: typeof EXAMPLE_ENTRIES,
  normalizedRequest: string,
  availableNames: string[],
  limit: number,
) {
  if (!normalizedRequest) return [];
  return rankIndexEntries(entries, normalizedRequest)
    .filter((candidate) => availableNames.includes(candidate.entry.id))
    .slice(0, limit);
}

function normalizeRelevance(score: number, topScore: number): number {
  if (!(topScore > 0)) return 0;
  return Math.round((score / topScore) * 100) / 100;
}

/**
 * Retrieve relevant examples, patterns, and failure docs for an input request.
 *
 * - Examples and patterns come from the alias index, ranked by weighted alias match.
 * - Failures: the high-value failure docs are always included (small, and they prevent
 *   errors that cost a render and a repair round).
 *
 * Unknown input returns no examples or design patterns. Injecting files chosen by
 * directory order creates false context and is worse than honest emptiness.
 */
export async function retrieveContext(input: string): Promise<RetrievalContext> {
  const normalizedRequest = normalizeRetrievalText(input);
  const [availableExamples, availablePatterns, availableFailures] = await Promise.all([
    listScadFiles(examplesDir()),
    listMdFiles(patternsDir()),
    listMdFiles(failuresDir()),
  ]);

  const exampleHits = selectWithinBudget(
    EXAMPLE_ENTRIES,
    normalizedRequest,
    availableExamples,
    RETRIEVAL_BUDGET.maxExamples,
  );
  const patternHits = selectWithinBudget(
    PATTERN_ENTRIES,
    normalizedRequest,
    availablePatterns,
    RETRIEVAL_BUDGET.maxPatterns,
  );

  // Failure-mode guidance is curated as always-relevant, so it stays unconditional.
  const resolvedFailures = availableFailures.filter((name) =>
    FAILURE_ALWAYS_INCLUDE.includes(name)
  );

  const topExampleScore = exampleHits[0]?.score ?? 0;
  const topPatternScore = patternHits[0]?.score ?? 0;

  const [examples, patterns, failures] = await Promise.all([
    Promise.all(
      exampleHits.map(async ({ entry, score, matchedAliases }) => {
        const scad_code = await readFileIfExists(path.join(examplesDir(), `${entry.id}.scad`));
        return {
          name: entry.id,
          scad_code: scad_code ?? "",
          relevance: normalizeRelevance(score, topExampleScore),
          score,
          matchedAliases,
        };
      })
    ),
    Promise.all(
      patternHits.map(async ({ entry, score, matchedAliases }) => {
        const content = await readFileIfExists(path.join(patternsDir(), `${entry.id}.md`));
        return {
          name: entry.id,
          content: content ?? "",
          relevance: normalizeRelevance(score, topPatternScore),
          score,
          matchedAliases,
        };
      })
    ),
    Promise.all(
      resolvedFailures.map(async (name) => {
        const content = await readFileIfExists(path.join(failuresDir(), `${name}.md`));
        return { name, content: content ?? "" };
      })
    ),
  ]);

  const matchedKeywords = [
    ...new Set([
      ...exampleHits.flatMap((hit) => hit.matchedAliases),
      ...patternHits.flatMap((hit) => hit.matchedAliases),
    ]),
  ].sort();

  return {
    examples: examples.filter((e) => e.scad_code.length > 0),
    patterns: patterns.filter((p) => p.content.length > 0),
    failures: failures.filter((f) => f.content.length > 0),
    matchedKeywords,
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
