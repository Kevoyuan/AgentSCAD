import { describe, expect, test } from "bun:test";
import {
  buildResearchQueries,
  deriveExpectedBBox,
  filterRelevantResults,
  formatDimensionFacts,
  formatResearchEvidence,
  normalizeResearchDimensions,
  runRequestResearch,
} from "@/lib/research/request-research";
import type { SearchOutcome } from "@/lib/research/web-search";

const IPHONE_REQUEST =
  "Create a parametric CAD model of a hypothetical Apple iPhone 18 Duo concept smartphone "
  + "for manufacturing review, fit-check, and visualization. Units: millimeters.";

function outcome(overrides: Partial<SearchOutcome> = {}): SearchOutcome {
  return {
    status: "OK",
    backend: "keyless",
    query: "iphone 16 pro dimensions specifications",
    results: [
      {
        title: "iPhone 16 Pro",
        url: "https://en.wikipedia.org/wiki/IPhone_16_Pro",
        snippet: "The iPhone 16 Pro measures 149.6 mm high, 71.5 mm wide and 8.25 mm deep.",
      },
    ],
    ...overrides,
  };
}

describe("research query building", () => {
  test("drops request boilerplate and speculative wording", () => {
    const queries = buildResearchQueries(IPHONE_REQUEST);
    expect(queries[0]).toBe("Apple iPhone 18 Duo smartphone dimensions specifications");
    expect(queries[0]).not.toContain("hypothetical");
    expect(queries[0]).not.toContain("Create a parametric");
    expect(queries[0]).not.toContain("manufacturing review");
    // CAD needs feature-level numbers, not just the envelope.
    expect(queries).toHaveLength(3);
    expect(queries.some((query) => query.includes("camera island"))).toBe(true);
  });

  test("searches the device, not the accessory being modeled", () => {
    const queries = buildResearchQueries(
      "Create a parametric CAD model of the Apple iPhone Duo foldable phone case with real device dimensions",
    );
    expect(queries[0]).toStartWith("Apple iPhone Duo");
    expect(queries[0]).toEndWith("dimensions specifications");
    expect(queries[1]).toContain("camera island size lens diameter");
    expect(queries.join(" ")).not.toContain("case");
    expect(queries.join(" ")).not.toContain("real device");
  });

  test("filters results that share nothing with the requested device", () => {
    const results = [
      { title: "IPhone Duo", url: "https://en.wikipedia.org/wiki/IPhone_Duo", snippet: "foldable iPhone" },
      { title: "Samsung Galaxy Z Fold 8", url: "https://en.wikipedia.org/wiki/Galaxy_Z_Fold_8", snippet: "Samsung foldable" },
    ];
    expect(filterRelevantResults(results, "Apple iPhone Duo").map((r) => r.title)).toEqual(["IPhone Duo"]);
    // Never hand the extractor an empty set: fall back to whatever search returned.
    expect(filterRelevantResults(results, "unrelated thing")).toHaveLength(2);
  });

  test("returns no query when the request has nothing searchable", () => {
    expect(buildResearchQueries("a box")).toEqual([]);
    expect(buildResearchQueries("")).toEqual([]);
  });
});

describe("fact formatting", () => {
  test("keeps feature, units, sources, provenance and confidence", () => {
    const dimensions = normalizeResearchDimensions([
      { name: "open length", value: 164.6, unit: "mm", feature: "overall", source: "https://apple.com", official: true, confidence: "high" },
      { name: "open width", value: "117.8", unit: "mm", feature: "overall", source: "https://shop.example", official: false },
      { name: "camera island", value: 38, unit: "mm", feature: "camera", source: "https://gsmarena.com", official: false, confidence: "low" },
      { name: "", value: 12 },
      { name: "unparsable", value: "about thirty" },
    ]);

    expect(dimensions).toHaveLength(3);
    expect(dimensions[1].feature).toBe("overall");
    expect(dimensions[2].feature).toBe("camera");

    const lines = formatDimensionFacts(dimensions);
    expect(lines).toEqual([
      "overall.open_length: 164.6 mm [https://apple.com] (official, high confidence)",
      "overall.open_width: 117.8 mm [https://shop.example] (unverified, medium confidence)",
      "camera.camera_island: 38 mm [https://gsmarena.com] (unverified, low confidence)",
    ]);
  });

  test("derives a bbox target from the largest overall dimensions", () => {
    const dimensions = normalizeResearchDimensions([
      { name: "open_length", value: 164.6, unit: "mm", feature: "overall" },
      { name: "open_width", value: 117.8, unit: "mm", feature: "overall" },
      { name: "open_depth", value: 5.2, unit: "mm", feature: "overall" },
      { name: "weight", value: 254, unit: "g", feature: "weight" },
    ]);
    expect(deriveExpectedBBox({
      version: 1, status: "OK", backend: "keyless", queries: [], sources: [],
      evidence: [], highlights: [], dimensions, unknowns: [], notes: "", fetched_at: new Date().toISOString(),
    })).toEqual([164.6, 117.8, 5.2]);

    // A foldable reports two states; the envelope must come from one of them.
    const foldable = normalizeResearchDimensions([
      { name: "unfolded_width", value: 117.8, unit: "mm", feature: "overall" },
      { name: "unfolded_height", value: 164.6, unit: "mm", feature: "overall" },
      { name: "unfolded_thickness", value: 5.2, unit: "mm", feature: "overall" },
      { name: "folded_width", value: 117.8, unit: "mm", feature: "overall" },
      { name: "folded_height", value: 84.1, unit: "mm", feature: "overall" },
      { name: "folded_thickness", value: 11.3, unit: "mm", feature: "overall" },
    ]);
    expect(deriveExpectedBBox({
      version: 1, status: "OK", backend: "keyless", queries: [], sources: [],
      evidence: [], highlights: [], dimensions: foldable, unknowns: [], notes: "", fetched_at: new Date().toISOString(),
    })).toEqual([164.6, 117.8, 5.2]);

    expect(deriveExpectedBBox(null)).toBeNull();
    expect(deriveExpectedBBox({
      version: 1, status: "OK", backend: null, queries: [], sources: [], evidence: [],
      highlights: [],
      dimensions: dimensions.slice(0, 2), unknowns: [], notes: "", fetched_at: new Date().toISOString(),
    })).toBeNull();
  });
});

describe("runRequestResearch", () => {
  test("is disabled without a backend and never calls the network", async () => {
    let searched = 0;
    const result = await runRequestResearch({
      request: IPHONE_REQUEST,
      env: {},
      searchImpl: async () => {
        searched += 1;
        return outcome();
      },
    });

    expect(searched).toBe(0);
    expect(result.status).toBe("DISABLED");
    expect(result.notes).toContain("TAVILY_API_KEY");
    expect(result.sources).toEqual([]);
  });

  test("honors AGENTSCAD_WEB_RESEARCH=off", async () => {
    const result = await runRequestResearch({
      request: IPHONE_REQUEST,
      env: { AGENTSCAD_WEB_RESEARCH: "off" },
    });
    expect(result.status).toBe("DISABLED");
  });

  test("collects deduped sources and snippet evidence", async () => {
    const result = await runRequestResearch({
      request: IPHONE_REQUEST,
      env: { AGENTSCAD_WEB_RESEARCH: "keyless" },
      skipFactExtraction: true,
      searchImpl: async (query) => outcome({ query }),
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.backend).toBe("keyless");
    expect(result.queries).toHaveLength(3);
    // The same URL appears in both query results and must be stored once.
    expect(result.sources).toEqual(["iPhone 16 Pro — https://en.wikipedia.org/wiki/IPhone_16_Pro"]);
    expect(result.evidence[0]).toContain("149.6 mm");
  });

  test("reports an unavailable lookup with the reason instead of guessing", async () => {
    const result = await runRequestResearch({
      request: IPHONE_REQUEST,
      env: { AGENTSCAD_WEB_RESEARCH: "keyless" },
      searchImpl: async (query) => ({
        status: "UNAVAILABLE",
        backend: "keyless",
        query,
        results: [],
        error: "network down",
      }),
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.notes).toContain("network down");
    expect(result.notes).toContain("assumptions");
  });
});

describe("formatResearchEvidence", () => {
  test("renders a prompt block with sources and a no-official-claims warning", async () => {
    const result = await runRequestResearch({
      request: IPHONE_REQUEST,
      env: { AGENTSCAD_WEB_RESEARCH: "keyless" },
      skipFactExtraction: true,
      searchImpl: async (query) => outcome({ query }),
    });
    const block = formatResearchEvidence(result);

    expect(block).toContain("## External research");
    expect(block).toContain("https://en.wikipedia.org/wiki/IPhone_16_Pro");
    expect(block).toContain("Do not claim the model is an official product");
  });

  test("renders nothing when research produced no evidence", () => {
    expect(formatResearchEvidence(null)).toBe("");
    expect(formatResearchEvidence({
      version: 1,
      status: "UNAVAILABLE",
      backend: null,
      queries: [],
      sources: [],
      evidence: [],
      highlights: [],
      dimensions: [],
      unknowns: [],
      notes: "nothing",
      fetched_at: new Date().toISOString(),
    })).toBe("");
  });
});
