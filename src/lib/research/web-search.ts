// ---------------------------------------------------------------------------
// Web search backends
//
// AgentSCAD is local-first: the operator decides how research reaches the model.
// Keyed backends (Tavily / Exa / Brave / Serper) are used automatically when their
// key is present. The keyless backend (Wikipedia + DuckDuckGo Instant Answer) is
// opt-in via AGENTSCAD_WEB_RESEARCH=keyless so no test or offline run ever dials out.
// ---------------------------------------------------------------------------

export type SearchBackendId = "tavily" | "exa" | "brave" | "serper" | "keyless";

export interface SearchBackend {
  id: SearchBackendId;
  label: string;
  requiresKey: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  status: "OK" | "UNAVAILABLE";
  backend: SearchBackendId | null;
  query: string;
  results: SearchResult[];
  error?: string;
}

export type WebResearchMode = "off" | "auto" | "keyless";

const KEYED_BACKENDS: Array<{ id: SearchBackendId; label: string; envKey: string }> = [
  { id: "tavily", label: "Tavily", envKey: "TAVILY_API_KEY" },
  { id: "exa", label: "Exa", envKey: "EXA_API_KEY" },
  { id: "brave", label: "Brave Search", envKey: "BRAVE_SEARCH_API_KEY" },
  { id: "serper", label: "Serper", envKey: "SERPER_API_KEY" },
];

const KEYLESS_BACKEND: SearchBackend = {
  id: "keyless",
  label: "Wikipedia + DuckDuckGo (keyless)",
  requiresKey: false,
};

const SEARCH_TIMEOUT_MS = 15_000;
const WIKIPEDIA_HTML_BASE = "https://en.wikipedia.org/api/rest_v1/page/html/";
/**
 * Wikimedia throttles clients without a descriptive User-Agent (429). Identify the
 * tool, as their API policy requires.
 */
const RESEARCH_USER_AGENT = "AgentSCAD/1.0 (local-first parametric CAD app; research stage)";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const searchCache = new Map<string, { at: number; outcome: SearchOutcome }>();

/**
 * Pages that publish dimension tables a CAD model actually needs. Keyless research
 * can read these directly, so an OEM spec page beats a search snippet.
 */
const SPEC_PAGE_HOSTS = [
  "apple.com",
  "samsung.com",
  "gsmarena.com",
  "phonearena.com",
  "notebookcheck.net",
];

export function isSpecPageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SPEC_PAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export function resolveWebResearchMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebResearchMode {
  const raw = (env.AGENTSCAD_WEB_RESEARCH ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  if (raw === "keyless" || raw === "on" || raw === "true" || raw === "1") return "keyless";
  return "auto";
}

/**
 * Pick the backend for this environment.
 *
 * `auto` only uses keyed providers, so the default install never makes surprise
 * outbound calls. Set AGENTSCAD_WEB_RESEARCH=keyless to allow the free sources.
 */
export function detectSearchBackend(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SearchBackend | null {
  const mode = resolveWebResearchMode(env);
  if (mode === "off") return null;

  const keyed = KEYED_BACKENDS.find((candidate) => (env[candidate.envKey] ?? "").trim());
  if (keyed) {
    return { id: keyed.id, label: keyed.label, requiresKey: true };
  }

  return mode === "keyless" ? KEYLESS_BACKEND : null;
}

function cleanText(value: unknown, maxLength = 400): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Response parsers (pure, unit-tested)
// ---------------------------------------------------------------------------

export function parseTavilyResponse(payload: unknown): SearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
  return payload.results.filter(isRecord).map((row) => ({
    title: cleanText(row.title, 160),
    url: cleanText(row.url, 500),
    snippet: cleanText(row.content),
  })).filter((row) => row.url);
}

export function parseExaResponse(payload: unknown): SearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
  return payload.results.filter(isRecord).map((row) => ({
    title: cleanText(row.title, 160),
    url: cleanText(row.url, 500),
    snippet: cleanText(row.text ?? row.summary),
  })).filter((row) => row.url);
}

export function parseBraveResponse(payload: unknown): SearchResult[] {
  if (!isRecord(payload)) return [];
  const web = payload.web;
  if (!isRecord(web) || !Array.isArray(web.results)) return [];
  return web.results.filter(isRecord).map((row) => ({
    title: cleanText(row.title, 160),
    url: cleanText(row.url, 500),
    snippet: cleanText(row.description),
  })).filter((row) => row.url);
}

export function parseSerperResponse(payload: unknown): SearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.organic)) return [];
  return payload.organic.filter(isRecord).map((row) => ({
    title: cleanText(row.title, 160),
    url: cleanText(row.link, 500),
    snippet: cleanText(row.snippet),
  })).filter((row) => row.url);
}

export function parseWikipediaSearchResponse(payload: unknown): SearchResult[] {
  if (!isRecord(payload)) return [];
  const query = payload.query;
  if (!isRecord(query) || !Array.isArray(query.search)) return [];
  return query.search.filter(isRecord).map((row) => ({
    title: cleanText(row.title, 160),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanText(row.title, 160).replace(/ /g, "_"))}`,
    snippet: cleanText(typeof row.snippet === "string" ? row.snippet.replace(/<[^>]+>/g, "") : ""),
  })).filter((row) => row.title);
}

export function parseDuckDuckGoInstantAnswer(payload: unknown): SearchResult[] {
  if (!isRecord(payload)) return [];
  const results: SearchResult[] = [];
  const abstract = cleanText(payload.AbstractText, 600);
  const abstractUrl = cleanText(payload.AbstractURL, 500);
  if (abstract && abstractUrl) {
    results.push({ title: cleanText(payload.Heading, 160) || "DuckDuckGo Instant Answer", url: abstractUrl, snippet: abstract });
  }
  if (Array.isArray(payload.RelatedTopics)) {
    for (const topic of payload.RelatedTopics) {
      if (!isRecord(topic)) continue;
      const text = cleanText(topic.Text, 400);
      const url = cleanText(topic.FirstURL, 500);
      if (text && url) results.push({ title: text.slice(0, 80), url, snippet: text });
    }
  }
  return results;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  minus: "-",
  times: "×",
  "#160": " ",
  "#215": "×",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#?[a-z0-9]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    return HTML_ENTITIES[key] ?? match;
  });
}

/**
 * Pull the measurable part out of a Wikipedia article's HTML.
 *
 * Product dimensions live in the infobox, which the plain-text extract API drops
 * entirely. This keeps the windows that actually contain a number plus a unit so the
 * fact extractor receives "149.6 × 71.5 × 8.25 mm (5.890 × 2.815 × 0.325 in)" instead
 * of a 250 KB page.
 */
export function extractDimensionExcerpt(pageHtml: string, maxChars = 1_600): string {
  const text = decodeHtmlEntities(
    pageHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();

  // Wikipedia's HTML carries the infobox twice: once as rendered text and once as
  // embedded wikitext JSON. The JSON survives tag stripping, so score windows and
  // discard the ones that still look like markup or template source.
  const noise = /(\{"|\[\[|\|wt|data-mw|\\")/i;
  const triple = /\d+(?:\.\d+)?\s*[×x]\s*\d+(?:\.\d+)?(?:\s*[×x]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|in)\b/i;
  const anchors = [
    ...text.matchAll(/dimensions?|camera (?:bump|island|module)|lens (?:diameter|aperture)|cut-?out|button|hinge|corner radius|bezel|thickness/gi),
    ...text.matchAll(/\d+(?:\.\d+)?\s*(?:mm|cm|g\b|oz\b)/gi),
  ].map((match) => match.index ?? 0).sort((a, b) => a - b);

  const scored: Array<{ index: number; window: string; score: number }> = [];
  for (const index of anchors) {
    const start = Math.max(0, index - 60);
    const window = text.slice(start, Math.min(text.length, index + 200)).trim().slice(0, 240);
    if (noise.test(window)) continue;
    const score = (triple.test(window) ? 4 : 0)
      + (/dimensions?/i.test(window) ? 2 : 0)
      + (/camera (?:bump|island|module)|lens|button|hinge|cut-?out|radius/i.test(window) ? 1 : 0);
    if (score === 0) continue;
    scored.push({ index, window, score });
  }

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const picked: string[] = [];
  const numberSignatures = new Set<string>();
  let total = 0;
  for (const candidate of scored) {
    if (picked.includes(candidate.window)) continue;
    // Windows around the same numbers repeat the same figures; keep one of each.
    const signature = Array.from(new Set(candidate.window.match(/\d+(?:\.\d+)?/g) ?? []))
      .sort()
      .join(",");
    if (signature && numberSignatures.has(signature)) continue;
    if (signature) numberSignatures.add(signature);
    picked.push(candidate.window);
    total += candidate.window.length;
    if (total >= maxChars) break;
  }
  return picked.join(" | ").slice(0, maxChars);
}

function wikipediaTitleFromUrl(url: string): string | null {
  const match = /^https?:\/\/[a-z]+\.wikipedia\.org\/wiki\/(.+)$/i.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backend calls
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers = {
    "User-Agent": RESEARCH_USER_AGENT,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  let lastError = "search request failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const response = await fetchImpl(url, {
      ...init,
      headers,
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    if (response.ok) return response.json();

    lastError = `search request failed (${response.status})`;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) break;
    const retryAfter = Number(response.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1_000, 3_000)
      : 400 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(lastError);
}

async function searchKeyless(
  fetchImpl: FetchLike,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const wikipediaUrl =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}`
    + `&srsearch=${encodeURIComponent(query)}`;
  const duckUrl =
    `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=${encodeURIComponent(query)}`;

  const [wikipedia, duck] = await Promise.allSettled([
    fetchJson(fetchImpl, wikipediaUrl, { method: "GET" }, signal),
    fetchJson(fetchImpl, duckUrl, { method: "GET" }, signal),
  ]);

  const results = [
    ...(wikipedia.status === "fulfilled" ? parseWikipediaSearchResponse(wikipedia.value) : []),
    ...(duck.status === "fulfilled" ? parseDuckDuckGoInstantAnswer(duck.value) : []),
  ];

  if (results.length === 0) {
    // Never report "no results" when the truth is "the source rejected us": the
    // pipeline log has to say 429/blocked so the operator can act on it.
    const reasons = [
      `wikipedia: ${wikipedia.status === "rejected" ? (wikipedia.reason instanceof Error ? wikipedia.reason.message : "failed") : "no hits"}`,
      `duckduckgo: ${duck.status === "rejected" ? (duck.reason instanceof Error ? duck.reason.message : "failed") : "no hits"}`,
    ];
    throw new Error(reasons.join("; "));
  }

  // Deepen the pages that actually carry dimension tables: the top Wikipedia hit
  // (its infobox) and any OEM/spec-site result (Apple's own spec sheet, GSMArena).
  const deepened = await Promise.all(
    results.map(async (result, index) => {
      const wikiTitle = index < 3 ? wikipediaTitleFromUrl(result.url) : null;
      const specPage = isSpecPageHost(result.url);
      if (!wikiTitle && !specPage) return result;
      try {
        const target = wikiTitle ? `${WIKIPEDIA_HTML_BASE}${encodeURIComponent(wikiTitle)}` : result.url;
        const response = await fetchImpl(target, {
          method: "GET",
          headers: { "User-Agent": RESEARCH_USER_AGENT },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });
        if (!response.ok) return result;
        const excerpt = extractDimensionExcerpt(await response.text());
        // The search snippet is usually just the article intro; the infobox excerpt is
        // what carries numbers. Prefer the excerpt whenever it actually measured something.
        const excerptNumbers = excerpt.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
        if (excerptNumbers < 2) return result;
        return { ...result, snippet: excerpt };
      } catch {
        return result;
      }
    }),
  );

  return deepened;
}

/**
 * Run one web search. Never throws: an unusable backend or a dead network returns
 * status UNAVAILABLE so the pipeline can continue on stated assumptions instead of
 * pretending the lookup succeeded.
 */
export async function webSearch(
  query: string,
  options: {
    backend?: SearchBackend | null;
    limit?: number;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<SearchOutcome> {
  const env = options.env ?? process.env;
  const backend = options.backend === undefined ? detectSearchBackend(env) : options.backend;
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheable = options.fetchImpl === undefined && backend !== null;
  const cacheKey = `${backend?.id ?? "none"}:${limit}:${query}`;

  if (cacheable) {
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.outcome;
  }

  if (!backend) {
    return {
      status: "UNAVAILABLE",
      backend: null,
      query,
      results: [],
      error: resolveWebResearchMode(env) === "off"
        ? "web research disabled by AGENTSCAD_WEB_RESEARCH=off"
        : "no search backend configured (add TAVILY_API_KEY/EXA_API_KEY/BRAVE_SEARCH_API_KEY/SERPER_API_KEY or set AGENTSCAD_WEB_RESEARCH=keyless)",
    };
  }

  try {
    let results: SearchResult[];
    if (backend.id === "tavily") {
      const payload = await fetchJson(fetchImpl, "https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          max_results: limit,
          search_depth: "basic",
        }),
      }, options.signal);
      results = parseTavilyResponse(payload);
    } else if (backend.id === "exa") {
      const payload = await fetchJson(fetchImpl, "https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": env.EXA_API_KEY ?? "" },
        body: JSON.stringify({ query, numResults: limit, contents: { text: { maxCharacters: 600 } } }),
      }, options.signal);
      results = parseExaResponse(payload);
    } else if (backend.id === "brave") {
      const payload = await fetchJson(
        fetchImpl,
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
        {
          method: "GET",
          headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY ?? "" },
        },
        options.signal,
      );
      results = parseBraveResponse(payload);
    } else if (backend.id === "serper") {
      const payload = await fetchJson(fetchImpl, "https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": env.SERPER_API_KEY ?? "" },
        body: JSON.stringify({ q: query, num: limit }),
      }, options.signal);
      results = parseSerperResponse(payload);
    } else {
      results = await searchKeyless(fetchImpl, query, limit, options.signal);
    }

    const outcome: SearchOutcome = { status: "OK", backend: backend.id, query, results: results.slice(0, limit) };
    if (cacheable) searchCache.set(cacheKey, { at: Date.now(), outcome });
    return outcome;
  } catch (error) {
    const outcome: SearchOutcome = {
      status: "UNAVAILABLE",
      backend: backend.id,
      query,
      results: [],
      error: error instanceof Error ? error.message : "unknown search error",
    };
    // Failures are cached too: repeated jobs should not keep hammering a rate-limited
    // source inside the same session.
    if (cacheable) searchCache.set(cacheKey, { at: Date.now(), outcome });
    return outcome;
  }
}
