// ---------------------------------------------------------------------------
// Request research stage
//
// Turns "search the web for this product's real dimensions" into validated,
// source-linked evidence that the generator can use. It is additive: when no
// backend is configured or the lookup fails, the pipeline keeps running on the
// user's stated assumptions and the job records why research was unavailable.
// ---------------------------------------------------------------------------

import { parseJsonObject } from "@/lib/harness/structured-output";
import { createChatCompletionWithFallback } from "@/lib/tools/model-router";
import {
  detectSearchBackend,
  resolveWebResearchMode,
  webSearch,
  type SearchBackend,
  type SearchOutcome,
  type SearchResult,
} from "./web-search";

export interface ResearchResultV1 {
  version: 1;
  status: "OK" | "PARTIAL" | "UNAVAILABLE" | "DISABLED";
  backend: string | null;
  queries: string[];
  sources: string[];
  evidence: string[];
  /** Short source sentences. Kept separate from `evidence` so prose that resolves
   * ambiguity ("the iPhone Duo is a foldable smartphone") survives dimension extraction. */
  highlights: string[];
  dimensions: ResearchDimension[];
  unknowns: string[];
  notes: string;
  fetched_at: string;
}

export type ResearchFeature =
  | "overall"
  | "display"
  | "camera"
  | "buttons"
  | "ports"
  | "hinge"
  | "weight"
  | "material"
  | "other";

export interface ResearchDimension {
  name: string;
  value: number;
  unit: string;
  feature: ResearchFeature;
  source: string;
  official: boolean;
  confidence: "high" | "medium" | "low";
}

const MAX_QUERIES = 3;
const MAX_SOURCES = 6;
const MAX_EVIDENCE = 14;

/**
 * What a CAD model of a device actually needs beyond the overall envelope.
 * Anything not found is reported as an unknown so the generator knows it is guessing.
 */
const CAD_CRITICAL_FEATURES = [
  "camera island / bump footprint and height",
  "lens diameters and spacing",
  "button positions, lengths and protrusion",
  "port and speaker cutout dimensions",
  "display active area and bezel widths",
  "corner radii and edge chamfers",
  "hinge geometry and fold thickness",
];

const REQUEST_BOILERPLATE = [
  /^please\s+/i,
  /^(?:create|generate|design|make|build|model|draw)\s+(?:me\s+)?(?:a|an|the)?\s*/i,
  /^(?:a|an|the)\s+/i,
  /^parametric\s+/i,
  /^cad\s+model\s+of\s+/i,
  /^model\s+of\s+/i,
  /^(?:请)?(?:帮我)?(?:生成|设计|做|建立|建)\s*(?:一个|个)?\s*/,
];

const REQUEST_CLAUSE_STOPPERS = [
  /\bfor (?:manufacturing|fit[- ]?check|visualization|3d printing|printing|production)\b/i,
  // Accessories and context clauses describe the *part*, not the device we must look up.
  /\b(?:phone|device|silicone|leather|tpu)?\s?(?:case|cover|shell|skin|enclosure|holder|mount|bracket)\b/i,
  /\bwith\b/i,
  /\bunits?\s*:/i,
  /\bif (?:official|exact|real)\b/i,
  /\buse the following\b/i,
  /\bassum(?:e|ed|ing)\b/i,
  /\bwith (?:a|an)\b/i,
  /\bincluding\b/i,
  /\bso that\b/i,
];

/**
 * Reduce a free-form request to the entity a search engine can answer for.
 *
 * "create an Apple iPhone Duo foldable phone case with real device dimensions" has to
 * become "Apple iPhone Duo": extra words make the engine return unrelated devices.
 */
export function extractResearchEntity(request: string): string {
  const firstSentence = request.split(/[。.!?\n]/)[0] ?? request;
  let entity = firstSentence.trim();

  const stopper = REQUEST_CLAUSE_STOPPERS
    .map((pattern) => pattern.exec(entity)?.index ?? -1)
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  if (stopper !== undefined) {
    entity = entity.slice(0, stopper).trim();
  }

  for (const pattern of REQUEST_BOILERPLATE) {
    entity = entity.replace(pattern, "");
  }
  entity = entity.replace(/[,;:]+$/, "").replace(/\s+/g, " ").trim();

  const words = entity.split(" ").filter(Boolean);
  if (words.length > 12) {
    entity = words.slice(0, 12).join(" ");
  }
  // Speculative wording ("hypothetical", "concept") poisons a real lookup.
  const bareEntity = entity
    .replace(/\b(?:concept|hypothetical|fictional|imaginary)\b/gi, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // A one-word generic noun ("box") is not worth a lookup; require some substance.
  const primary = bareEntity.length >= 5 ? bareEntity : entity;
  return primary.length >= 5 ? primary : "";
}

export function buildResearchQueries(request: string): string[] {
  const primary = extractResearchEntity(request);
  if (!primary) return [];

  const queries = [`${primary} dimensions specifications`];
  // CAD needs feature-level numbers, not just the envelope: camera island footprint,
  // lens spacing, button placement and case cutouts are what the geometry depends on.
  if (primary.split(" ").length >= 2) {
    queries.push(`${primary} camera island size lens diameter mm`);
    queries.push(`${primary} buttons cutout speaker port dimensions mm`);
  }
  return Array.from(new Set(queries)).slice(0, MAX_QUERIES);
}

function formatSource(result: SearchResult): string {
  const title = result.title?.trim() || result.url;
  return `${title} — ${result.url}`;
}

const RELEVANCE_STOPWORDS = new Set([
  "the", "and", "for", "with", "real", "device", "dimensions", "specifications", "size",
  "mm", "pro", "max", "plus", "concept", "hypothetical", "phone", "smartphone", "foldable",
]);

function relevanceTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !RELEVANCE_STOPWORDS.has(token)),
  );
}

/**
 * Drop results that share nothing with the requested entity. Without this, a query
 * about an Apple device happily returns Samsung pages and the extractor then reports
 * (correctly) that nothing applies.
 */
export function filterRelevantResults(results: SearchResult[], entity: string): SearchResult[] {
  const wanted = relevanceTokens(entity);
  if (wanted.size === 0) return results;
  const relevant = results.filter((result) => {
    const haystack = relevanceTokens(`${result.title} ${result.snippet}`);
    for (const token of wanted) {
      if (haystack.has(token)) return true;
    }
    return false;
  });
  return relevant.length > 0 ? relevant : results;
}

interface RawDimension {
  name?: unknown;
  value?: unknown;
  unit?: unknown;
  feature?: unknown;
  source?: unknown;
  official?: unknown;
  confidence?: unknown;
}

const KNOWN_FEATURES: ResearchFeature[] = [
  "overall",
  "display",
  "camera",
  "buttons",
  "ports",
  "hinge",
  "weight",
  "material",
  "other",
];

function normalizeFeature(value: unknown): ResearchFeature {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (KNOWN_FEATURES as string[]).includes(candidate) ? (candidate as ResearchFeature) : "other";
}

/** Validate whatever the extractor returned before it reaches the prompt. */
export function normalizeResearchDimensions(raw: unknown): ResearchDimension[] {
  if (!Array.isArray(raw)) return [];
  const dimensions: ResearchDimension[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as RawDimension;
    const name = typeof candidate.name === "string" ? candidate.name.trim().replace(/\s+/g, "_") : "";
    const numeric = typeof candidate.value === "number"
      ? candidate.value
      : typeof candidate.value === "string"
        ? Number.parseFloat(candidate.value)
        : Number.NaN;
    if (!name || !Number.isFinite(numeric)) continue;
    const unit = typeof candidate.unit === "string" && candidate.unit.trim() ? candidate.unit.trim() : "mm";
    const confidence = typeof candidate.confidence === "string" ? candidate.confidence.trim().toLowerCase() : "";
    dimensions.push({
      name,
      value: numeric,
      unit,
      feature: normalizeFeature(candidate.feature),
      source: typeof candidate.source === "string" ? candidate.source.trim() : "",
      official: candidate.official === true,
      confidence: confidence === "high" || confidence === "low" ? confidence : "medium",
    });
    if (dimensions.length >= MAX_EVIDENCE) break;
  }
  return dimensions;
}

export function formatDimensionFacts(dimensions: ResearchDimension[]): string[] {
  const lines: string[] = [];
  for (const dimension of dimensions) {
    const source = dimension.source ? ` [${dimension.source}]` : "";
    const provenance = dimension.official ? "official" : "unverified";
    lines.push(
      `${dimension.feature}.${dimension.name}: ${dimension.value} ${dimension.unit}${source} (${provenance}, ${dimension.confidence} confidence)`,
    );
  }
  return lines;
}

async function extractFactsFromSnippets(
  request: string,
  results: SearchResult[],
  model?: string | null,
  signal?: AbortSignal,
): Promise<{ dimensions: ResearchDimension[]; unknowns: string[] }> {
  if (results.length === 0) return { dimensions: [], unknowns: [] };
  const corpus = results
    .slice(0, MAX_SOURCES)
    .map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet.slice(0, 700)}`)
    .join("\n\n");

  try {
    const raw = await createChatCompletionWithFallback({
      messages: [
        {
          role: "system",
          content: [
            "You extract CAD-usable dimensions from web snippets for a parametric model.",
            "Return only JSON: {\"dimensions\":[{\"name\":\"snake_case\",\"value\":number,\"unit\":\"mm|g\",\"feature\":\"overall|display|camera|buttons|ports|hinge|weight|material|other\",\"source\":\"url\",\"official\":true|false,\"confidence\":\"high|medium|low\"}],\"unknowns\":[\"string\"]}.",
            "Only report numbers that literally appear in the snippets. Convert inches to mm only when the inch value is explicit (1 in = 25.4 mm). Never estimate or interpolate.",
            "Mark official=true only when the value comes from the manufacturer's own page or an official store listing for this exact model.",
            "Use one row per measurable dimension, including feature-level numbers such as camera island size, lens diameter, button length, cutout width and corner radius when present.",
            `List in \"unknowns\" every CAD-critical feature the snippets do not cover. CAD-critical features are: ${CAD_CRITICAL_FEATURES.join("; ")}.`,
            "Returning {\"dimensions\":[],\"unknowns\":[...]} is a valid and expected answer.",
          ].join(" "),
        },
        {
          role: "user",
          content: `Request: ${request}\n\nSnippets:\n${corpus}`,
        },
      ],
      model: model?.trim() || undefined,
      stream: false,
      signal,
    });
    const parsed = parseJsonObject<{ dimensions?: unknown; unknowns?: unknown }>(raw);
    const unknowns = Array.isArray(parsed.unknowns)
      ? Array.from(new Set(
          parsed.unknowns
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            // Keep feature names; drop the model's paragraph-long explanations.
            .filter((item) => item.length > 0 && item.length <= 90),
        )).slice(0, 8)
      : [];
    return { dimensions: normalizeResearchDimensions(parsed.dimensions), unknowns };
  } catch {
    return { dimensions: [], unknowns: [] };
  }
}

export interface RunRequestResearchInput {
  request: string;
  model?: string | null;
  signal?: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  searchImpl?: (query: string, options: { backend: SearchBackend | null; signal?: AbortSignal }) => Promise<SearchOutcome>;
  skipFactExtraction?: boolean;
}

/**
 * Run the research stage. Never throws: research is advisory input, and a failed
 * lookup must be visible in the result rather than silently replaced by guesses.
 */
export async function runRequestResearch(input: RunRequestResearchInput): Promise<ResearchResultV1> {
  const env = input.env ?? process.env;
  const fetchedAt = new Date().toISOString();
  const base = {
    version: 1 as const,
    backend: null as string | null,
    queries: [] as string[],
    sources: [] as string[],
    evidence: [] as string[],
    highlights: [] as string[],
    dimensions: [] as ResearchDimension[],
    unknowns: [] as string[],
    fetched_at: fetchedAt,
  };

  const mode = resolveWebResearchMode(env);
  if (mode === "off") {
    return { ...base, status: "DISABLED", notes: "Web research is disabled (AGENTSCAD_WEB_RESEARCH=off)." };
  }

  const backend = detectSearchBackend(env);
  if (!backend) {
    return {
      ...base,
      status: "DISABLED",
      notes:
        "No web search backend configured. Add TAVILY_API_KEY, EXA_API_KEY, BRAVE_SEARCH_API_KEY or SERPER_API_KEY, "
        + "or set AGENTSCAD_WEB_RESEARCH=keyless to use the free Wikipedia/DuckDuckGo sources.",
    };
  }

  const queries = buildResearchQueries(input.request);
  if (queries.length === 0) {
    return { ...base, status: "UNAVAILABLE", backend: backend.id, notes: "Could not derive a search query from the request." };
  }
  const entity = extractResearchEntity(input.request);

  const search = input.searchImpl
    ?? ((query: string, options: { backend: SearchBackend | null; signal?: AbortSignal }) =>
      webSearch(query, { backend: options.backend, signal: options.signal, env }));

  const outcomes = await Promise.all(
    queries.map((query) => search(query, { backend, signal: input.signal })),
  );
  const collected: SearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const outcome of outcomes) {
    for (const result of outcome.results) {
      if (!result.url || seenUrls.has(result.url)) continue;
      seenUrls.add(result.url);
      collected.push(result);
    }
  }
  const results = filterRelevantResults(collected, entity);

  if (results.length === 0) {
    const reason = outcomes.find((outcome) => outcome.error)?.error ?? "no results";
    return {
      ...base,
      backend: backend.id,
      queries,
      status: "UNAVAILABLE",
      notes: `Web search returned no usable results (${reason}). Generation continues on the stated assumptions.`,
    };
  }

  const extracted = input.skipFactExtraction
    ? { dimensions: [] as ResearchDimension[], unknowns: [] as string[] }
    : await extractFactsFromSnippets(input.request, results, input.model, input.signal);
  const fallbackEvidence = results
    .slice(0, MAX_EVIDENCE)
    .map((result) => `${result.title}: ${result.snippet}`.trim());
  const evidence = extracted.dimensions.length > 0
    ? formatDimensionFacts(extracted.dimensions)
    : fallbackEvidence;
  const unknowns = extracted.unknowns.length > 0
    ? extracted.unknowns
    : extracted.dimensions.length > 0
      ? CAD_CRITICAL_FEATURES
      : [];

  return {
    ...base,
    backend: backend.id,
    queries,
    sources: results.slice(0, MAX_SOURCES).map(formatSource),
    evidence,
    highlights: results
      .slice(0, 3)
      .map((result) => `${result.title}: ${result.snippet}`.trim().slice(0, 320))
      .filter(Boolean),
    dimensions: extracted.dimensions,
    unknowns,
    status: extracted.dimensions.length > 0 ? "OK" : "PARTIAL",
    notes: extracted.dimensions.length > 0
      ? `Extracted ${extracted.dimensions.length} dimension(s) from ${results.length} result(s). ${unknowns.length > 0 ? `${unknowns.length} CAD-critical feature(s) remain unknown.` : ""}`
      : `Found ${results.length} result(s) but could not extract measurable facts; raw snippets are attached for review.`,
  };
}

/**
 * Build the `[x, y, z]` extent triple for B001 out of researched body dimensions.
 * Orientation is unknown at research time, so the values are sorted descending.
 */
export function deriveExpectedBBox(result: ResearchResultV1 | null | undefined): number[] | null {
  if (!result || result.dimensions.length === 0) return null;
  const overall = result.dimensions.filter(
    (dimension) => dimension.feature === "overall" && dimension.value > 0 && dimension.unit.startsWith("mm"),
  );

  // A foldable reports two states. Mixing them produces an impossible envelope
  // (164.6 × 117.8 × 84.1), so pick one state and use it consistently.
  const states: Array<{ label: string; pattern: RegExp }> = [
    { label: "unfolded", pattern: /unfold|open/i },
    { label: "folded", pattern: /fold|closed|clamshell/i },
  ];
  for (const state of states) {
    const values = overall
      .filter((dimension) => state.pattern.test(dimension.name))
      .map((dimension) => dimension.value);
    const unique = Array.from(new Set(values)).sort((a, b) => b - a);
    if (unique.length >= 3) return unique.slice(0, 3);
  }

  const unique = Array.from(new Set(overall.map((dimension) => dimension.value))).sort((a, b) => b - a);
  return unique.length >= 3 ? unique.slice(0, 3) : null;
}

/** Render research as a prompt section. Empty string when there is nothing to say. */
export function formatResearchEvidence(result: ResearchResultV1 | null | undefined): string {
  if (!result || (result.sources.length === 0 && result.evidence.length === 0)) return "";
  const lines = [
    "## External research (web evidence, verify before trusting)",
    `Status: ${result.status}${result.backend ? ` via ${result.backend}` : ""}`,
    ...(result.dimensions.length > 0
      ? [
          "Dimensions found (feature.name: value unit [source]):",
          ...result.evidence.map((line) => `- ${line}`),
        ]
      : result.evidence.length > 0
        ? ["Raw snippets:", ...result.evidence.map((line) => `- ${line}`)]
        : []),
    ...(result.unknowns.length > 0
      ? [
          "CAD-critical features NOT found (you must choose values and say so in design_rationale):",
          ...result.unknowns.map((line) => `- ${line}`),
        ]
      : []),
    ...(result.sources.length > 0 ? ["Sources:", ...result.sources.map((line) => `- ${line}`)] : []),
    ...(result.highlights.length > 0
      ? ["Source highlights:", ...result.highlights.map((line) => `- ${line}`)]
      : []),
    "",
    "Use the researched numbers as the starting point whenever they are more specific than the user's baseline.",
    "Researched values describe the finished product; when modeling a case or enclosure, add clearance on top of them.",
    "Do not claim the model is an official product. Keep every dimension editable as a top-level parameter.",
  ];
  return lines.join("\n");
}
