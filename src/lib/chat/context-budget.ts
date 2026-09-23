export const CHAT_HISTORY_CHAR_BUDGET = 24_000;
export const CHAT_SCAD_CHAR_BUDGET = 30_000;

export interface ChatTurn { role: "user" | "assistant"; content: string }

/** Retain the latest complete turns; never cut a user instruction mid-sentence. */
export function selectRecentChatTurns(value: unknown, budget = CHAT_HISTORY_CHAR_BUDGET): ChatTurn[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const turns = value.filter((item): item is ChatTurn =>
    item && typeof item === "object"
      && (item.role === "user" || item.role === "assistant")
      && typeof item.content === "string"
  );
  if (turns.length === 0 || turns.at(-1)?.role !== "user") return null;
  if (turns.at(-1)!.content.length > budget) return null;
  let remaining = budget;
  const selected: ChatTurn[] = [];
  for (const turn of turns.toReversed()) {
    if (turn.content.length > remaining) break;
    selected.push(turn);
    remaining -= turn.content.length;
  }
  return selected.reverse();
}

export function boundedContextJson(value: unknown, budget: number): string {
  const json = JSON.stringify(value);
  return json && json.length <= budget ? json : "Omitted because it exceeds the context budget";
}
