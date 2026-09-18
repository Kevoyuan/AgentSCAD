import { describe, expect, test } from "bun:test";
import {
  decodeHtmlEntities,
  detectSearchBackend,
  extractDimensionExcerpt,
  parseBraveResponse,
  parseDuckDuckGoInstantAnswer,
  parseExaResponse,
  parseSerperResponse,
  parseTavilyResponse,
  parseWikipediaSearchResponse,
  resolveWebResearchMode,
  webSearch,
} from "@/lib/research/web-search";

describe("web search backend selection", () => {
  test("defaults to auto and refuses to dial out without a key", () => {
    expect(resolveWebResearchMode({})).toBe("auto");
    expect(detectSearchBackend({})).toBeNull();
  });

  test("uses the first configured keyed provider", () => {
    expect(detectSearchBackend({ TAVILY_API_KEY: "t" })?.id).toBe("tavily");
    expect(detectSearchBackend({ EXA_API_KEY: "e" })?.id).toBe("exa");
    expect(detectSearchBackend({ BRAVE_SEARCH_API_KEY: "b" })?.id).toBe("brave");
    expect(detectSearchBackend({ SERPER_API_KEY: "s" })?.id).toBe("serper");
    // A keyed backend always outranks the free sources.
    expect(detectSearchBackend({ TAVILY_API_KEY: "t", AGENTSCAD_WEB_RESEARCH: "keyless" })?.id).toBe("tavily");
  });

  test("keyless sources are opt-in and can be switched off entirely", () => {
    expect(detectSearchBackend({ AGENTSCAD_WEB_RESEARCH: "keyless" })?.id).toBe("keyless");
    expect(detectSearchBackend({ AGENTSCAD_WEB_RESEARCH: "on" })?.id).toBe("keyless");
    expect(detectSearchBackend({ AGENTSCAD_WEB_RESEARCH: "off", TAVILY_API_KEY: "t" })).toBeNull();
    expect(resolveWebResearchMode({ AGENTSCAD_WEB_RESEARCH: "OFF" })).toBe("off");
  });
});

describe("web search response parsing", () => {
  test("pulls dimensions out of Wikipedia infobox HTML", () => {
    const html = [
      "<div class=\"infobox\"><table><tr><th>Dimensions</th>",
      "<td>Pro: 149.6 &#215; 71.5 &#215; 8.25 mm (5.890 &#215; 2.815 &#215; 0.325 in)",
      "Pro Max: 163.0 &#215; 77.6 &#215; 8.25 mm</td></tr>",
      "<tr><th>Weight</th><td>199 g (7.0 oz)</td></tr></table></div>",
      "<p>Unrelated prose that should not win the window.</p>",
    ].join("");
    const excerpt = extractDimensionExcerpt(html);

    expect(excerpt).toContain("149.6");
    expect(excerpt).toContain("mm");
    expect(decodeHtmlEntities("5.890 &#215; 2.815")).toBe("5.890 × 2.815");
  });

  test("parses Wikipedia search hits into sources", () => {
    const results = parseWikipediaSearchResponse({
      query: { search: [{ title: "iPhone 16 Pro", snippet: "<span>Apple</span> smartphone" }] },
    });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://en.wikipedia.org/wiki/iPhone_16_Pro");
    expect(results[0].snippet).toBe("Apple smartphone");
  });

  test("parses DuckDuckGo instant answers", () => {
    const results = parseDuckDuckGoInstantAnswer({
      Heading: "iPhone 16 Pro",
      AbstractText: "The iPhone 16 Pro is a smartphone.",
      AbstractURL: "https://en.wikipedia.org/wiki/IPhone_16_Pro",
      RelatedTopics: [{ Text: "iPhone 16 - smartphone", FirstURL: "https://duckduckgo.com/iPhone_16" }],
    });
    expect(results.map((result) => result.url)).toEqual([
      "https://en.wikipedia.org/wiki/IPhone_16_Pro",
      "https://duckduckgo.com/iPhone_16",
    ]);
  });

  test("parses keyed provider payloads", () => {
    expect(parseTavilyResponse({ results: [{ title: "t", url: "https://a", content: "c" }] })).toHaveLength(1);
    expect(parseExaResponse({ results: [{ title: "e", url: "https://b", text: "x" }] })).toHaveLength(1);
    expect(parseBraveResponse({ web: { results: [{ title: "b", url: "https://c", description: "d" }] } })).toHaveLength(1);
    expect(parseSerperResponse({ organic: [{ title: "s", link: "https://d", snippet: "e" }] })).toHaveLength(1);
    expect(parseTavilyResponse({})).toEqual([]);
    expect(parseBraveResponse({ web: {} })).toEqual([]);
  });
});

describe("webSearch", () => {
  test("reports UNAVAILABLE and makes no request when nothing is configured", async () => {
    let called = 0;
    const outcome = await webSearch("iphone dimensions", {
      backend: null,
      env: { AGENTSCAD_WEB_RESEARCH: "off" },
      fetchImpl: (async () => {
        called += 1;
        throw new Error("should not be called");
      }) as unknown as typeof fetch,
    });

    expect(called).toBe(0);
    expect(outcome.status).toBe("UNAVAILABLE");
    expect(outcome.error).toContain("disabled");
  });

  test("merges keyless sources and tolerates one endpoint failing", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("wikipedia.org")) throw new Error("wikipedia blocked");
      return new Response(JSON.stringify({
        Heading: "iPhone 16 Pro",
        AbstractText: "147.6 x 71.5 x 8.25 mm body.",
        AbstractURL: "https://en.wikipedia.org/wiki/IPhone_16_Pro",
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const outcome = await webSearch("iPhone 16 Pro dimensions", {
      backend: { id: "keyless", label: "keyless", requiresKey: false },
      fetchImpl,
      env: { AGENTSCAD_WEB_RESEARCH: "keyless" },
    });

    expect(outcome.status).toBe("OK");
    expect(outcome.results[0].snippet).toContain("147.6");
  });

  test("surfaces a dead backend instead of throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const outcome = await webSearch("anything", {
      backend: { id: "keyless", label: "keyless", requiresKey: false },
      fetchImpl,
      env: { AGENTSCAD_WEB_RESEARCH: "keyless" },
    });

    expect(outcome.status).toBe("UNAVAILABLE");
    expect(outcome.error).toContain("network down");
  });

  test("reports per-source state instead of a bare 'no results'", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("wikipedia.org/w/api.php")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ AbstractText: "", AbstractURL: "" }), { status: 200 });
    }) as unknown as typeof fetch;

    const outcome = await webSearch("obscure thing", {
      backend: { id: "keyless", label: "keyless", requiresKey: false },
      fetchImpl,
      env: { AGENTSCAD_WEB_RESEARCH: "keyless" },
    });

    expect(outcome.status).toBe("UNAVAILABLE");
    expect(outcome.error).toContain("wikipedia: search request failed (429)");
    expect(outcome.error).toContain("duckduckgo: no hits");
  });
});
