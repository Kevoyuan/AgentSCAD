import retrievalIndexJson from "../../../cad_knowledge/retrieval-index.json";
import type { PartFamily } from "@/lib/harness/types";

/**
 * Deterministic retrieval contract.
 *
 * The alias table is data (`cad_knowledge/retrieval-index.json`), not route logic, so
 * coverage can grow without touching the retriever. Matching is lexical on purpose:
 * it is cheap, explainable, and works for Chinese and English alike because both the
 * request and the aliases are normalized before comparison.
 *
 * This is the "cheapest reliable route" the retrieval chapter asks for. It is not a
 * semantic retriever, and it does not pretend to be one: a request that matches
 * nothing returns nothing.
 */

interface RawIndexEntry {
  id: string;
  family?: string | null;
  strong_aliases?: string[];
  supporting_aliases?: string[];
  exclude_aliases?: string[];
}

interface RawRetrievalIndex {
  schema_version: number;
  notes?: string[];
  examples: RawIndexEntry[];
  patterns: RawIndexEntry[];
  families: RawIndexEntry[];
}

export interface NormalizedIndexEntry {
  id: string;
  family: PartFamily | null;
  strongAliases: string[];
  supportingAliases: string[];
  excludeAliases: string[];
}

export interface AliasMatch {
  score: number;
  matchedAliases: string[];
}

export const RETRIEVAL_INDEX_SCHEMA_VERSION = 1;

/** Alias weights. A strong alias names the part; a supporting alias names a feature. */
export const STRONG_ALIAS_WEIGHT = 3;
export const SUPPORTING_ALIAS_WEIGHT = 1;

/** Retrieval budget: how many whole documents may reach the generation prompt. */
export const RETRIEVAL_BUDGET = {
  maxExamples: 3,
  maxPatterns: 3,
} as const;

const rawIndex = retrievalIndexJson as RawRetrievalIndex;

const KNOWN_FAMILIES = new Set<string>([
  "spur_gear",
  "device_stand",
  "electronics_enclosure",
  "phone_case",
  "unknown",
]);

/**
 * Normalize a request or alias for comparison.
 *
 * NFKC folds full-width forms (for example `（）` and full-width digits) onto their
 * ASCII equivalents, punctuation becomes a separator, and case is dropped. CJK text
 * has no word separators, so substring matching is the correct primitive there.
 */
export function normalizeRetrievalText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAliasList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values ?? []) {
    const alias = normalizeRetrievalText(value);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    normalized.push(alias);
  }
  return normalized;
}

function normalizeEntry(entry: RawIndexEntry): NormalizedIndexEntry {
  const family = entry.family && KNOWN_FAMILIES.has(entry.family)
    ? (entry.family as PartFamily)
    : null;
  return {
    id: entry.id,
    family,
    strongAliases: normalizeAliasList(entry.strong_aliases),
    supportingAliases: normalizeAliasList(entry.supporting_aliases),
    excludeAliases: normalizeAliasList(entry.exclude_aliases),
  };
}

export const EXAMPLE_ENTRIES: NormalizedIndexEntry[] =
  rawIndex.examples.map(normalizeEntry);
export const PATTERN_ENTRIES: NormalizedIndexEntry[] =
  rawIndex.patterns.map(normalizeEntry);

/**
 * Family entries declare the family in `id` rather than in a `family` field, so they get
 * their own normalizer instead of the shared one.
 */
export const FAMILY_ENTRIES: NormalizedIndexEntry[] = rawIndex.families.map((entry) => ({
  ...normalizeEntry(entry),
  family: KNOWN_FAMILIES.has(entry.id) ? (entry.id as PartFamily) : null,
}));

/**
 * Longer aliases describe something more specific, so they outrank short generic ones
 * ("mounting plate" over "plate"). This stands in for an IDF weight without needing a
 * corpus to count document frequency against.
 */
function aliasSpecificity(alias: string): number {
  return 1 + Math.min(alias.length, 12) / 12;
}

function matchesAll(normalizedText: string, aliases: string[]): boolean {
  return aliases.some((alias) => normalizedText.includes(alias));
}

/**
 * Score one index entry against an already-normalized request.
 *
 * Hard negatives are absolute: a request containing `行星齿轮`/`planetary gearbox`
 * never matches the spur-gear entry, because a planetary reduction mechanism is not a
 * spur gear and the wrong family would hand the model the wrong parameter schema.
 */
export function scoreIndexEntry(
  entry: NormalizedIndexEntry,
  normalizedText: string,
): AliasMatch {
  if (matchesAll(normalizedText, entry.excludeAliases)) {
    return { score: 0, matchedAliases: [] };
  }

  let score = 0;
  const matchedAliases: string[] = [];

  for (const alias of entry.strongAliases) {
    if (!normalizedText.includes(alias)) continue;
    score += STRONG_ALIAS_WEIGHT * aliasSpecificity(alias);
    matchedAliases.push(alias);
  }
  for (const alias of entry.supportingAliases) {
    if (!normalizedText.includes(alias)) continue;
    score += SUPPORTING_ALIAS_WEIGHT * aliasSpecificity(alias);
    matchedAliases.push(alias);
  }

  return { score, matchedAliases };
}

export interface ScoredIndexEntry extends AliasMatch {
  entry: NormalizedIndexEntry;
}

/**
 * Rank entries by score. Ties break on id so the same request always returns the same
 * order, which is what makes retrieval evidence comparable between runs.
 */
export function rankIndexEntries(
  entries: NormalizedIndexEntry[],
  normalizedText: string,
): ScoredIndexEntry[] {
  return entries
    .map((entry) => ({ entry, ...scoreIndexEntry(entry, normalizedText) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
}

/**
 * Family hint from the alias table, used as a fallback by `detectPartFamily`.
 *
 * Returns `null` when nothing matches, which keeps "unknown" an honest answer rather
 * than a guess. Family detection stays advisory: it selects a parameter schema, it
 * never gates generation.
 */
export function matchFamilyAlias(request: string): PartFamily | null {
  const normalizedText = normalizeRetrievalText(request);
  if (!normalizedText) return null;

  const ranked = rankIndexEntries(FAMILY_ENTRIES, normalizedText);
  const best = ranked[0];
  if (!best || !best.entry.family || best.entry.family === "unknown") return null;
  return best.entry.family;
}
