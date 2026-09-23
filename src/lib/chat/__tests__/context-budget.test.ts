import { describe, expect, test } from "bun:test";

import { boundedContextJson, selectRecentChatTurns } from "../context-budget";

describe("chat context budget", () => {
  test("keeps the newest complete turns and drops older history", () => {
    const turns = [
      { role: "user", content: "a".repeat(60) },
      { role: "assistant", content: "b".repeat(60) },
      { role: "user", content: "latest" },
    ];
    const selected = selectRecentChatTurns(turns, 100);
    expect(selected?.map((turn) => turn.content.length)).toEqual([60, 6]);
  });

  test("rejects history that does not end with a user turn", () => {
    expect(selectRecentChatTurns([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }])).toBeNull();
  });

  test("omits oversized context instead of truncating it silently", () => {
    expect(boundedContextJson({ value: "x".repeat(50) }, 10)).toContain("exceeds the context budget");
    expect(boundedContextJson({ ok: true }, 100)).toBe('{"ok":true}');
  });
});
