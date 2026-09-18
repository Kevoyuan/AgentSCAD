import { describe, expect, test } from "bun:test";

import {
  FAMILY_ENTRIES,
  PATTERN_ENTRIES,
  RETRIEVAL_INDEX_SCHEMA_VERSION,
  matchFamilyAlias,
  normalizeRetrievalText,
  rankIndexEntries,
} from "./retrieval-index";

describe("retrieval index", () => {
  test("normalizes case, full-width forms and punctuation", () => {
    expect(normalizeRetrievalText("Mounting（Plate）４孔")).toBe("mounting plate 4孔");
    expect(normalizeRetrievalText("  支架 / 底座  ")).toBe("支架 底座");
  });

  test("keeps the declared schema version", () => {
    expect(RETRIEVAL_INDEX_SCHEMA_VERSION).toBe(1);
  });

  test("resolves Chinese family aliases the English keyword list never had", () => {
    expect(matchFamilyAlias("做一个手机支架")).toBe("device_stand");
    expect(matchFamilyAlias("设计一个电子外壳")).toBe("electronics_enclosure");
    expect(matchFamilyAlias("正齿轮 20 齿")).toBe("spur_gear");
    expect(matchFamilyAlias("手机保护套")).toBe("phone_case");
  });

  test("returns no family when the request does not say enough", () => {
    expect(matchFamilyAlias("行星发动机模型")).toBeNull();
    expect(matchFamilyAlias("")).toBeNull();
    expect(matchFamilyAlias("帮我做个东西")).toBeNull();
  });

  test("hard negatives keep a planetary gearbox out of the spur-gear family", () => {
    // 齿轮 alone is a spur gear; 行星齿轮 is a reduction mechanism and must not be.
    expect(matchFamilyAlias("齿轮")).toBe("spur_gear");
    expect(matchFamilyAlias("行星齿轮电机")).toBeNull();
    expect(matchFamilyAlias("planetary gearbox")).toBeNull();
    expect(matchFamilyAlias("worm gear")).toBeNull();
  });

  test("family entries declare their family in id, not in a family field", () => {
    const resolved = FAMILY_ENTRIES.filter((entry) => entry.family !== null).map(
      (entry) => entry.family,
    );
    expect(resolved.sort()).toEqual([
      "device_stand",
      "electronics_enclosure",
      "phone_case",
      "spur_gear",
    ]);
  });

  test("ranking is deterministic and drops zero-score entries", () => {
    const ranked = rankIndexEntries(PATTERN_ENTRIES, "bolt pattern for a bracket");
    expect(ranked.map((hit) => hit.entry.id)).toEqual([
      "hole_patterns",
      "bracket_patterns",
    ]);
    expect(rankIndexEntries(PATTERN_ENTRIES, "行星发动机模型")).toEqual([]);
  });
});
