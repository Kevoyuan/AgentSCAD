const START = "/* AGENTSCAD_ASSEMBLY_V1";
const END = "END_AGENTSCAD_ASSEMBLY */";

/**
 * A staged repair may ask the model only for the declaration comment. Extract
 * that comment verbatim (fences and prose are ignored) so the existing geometry
 * is never rewritten by the declaration stage.
 */
export function extractDeclarationComment(text: string): string | null {
  const start = text.indexOf(START);
  if (start < 0) return null;
  const end = text.indexOf(END, start + START.length);
  if (end < 0) return null;
  return text.slice(start, end + END.length).trim();
}

/** Replace the one declaration block, or prepend it when the source has none. */
export function spliceDeclarationComment(source: string, comment: string): string {
  if (!comment.trimStart().startsWith(START) || !comment.trimEnd().endsWith(END))
    throw new Error("The declaration comment is not a complete AGENTSCAD_ASSEMBLY_V1 block.");
  const start = source.indexOf(START);
  const end = start < 0 ? -1 : source.indexOf(END, start + START.length);
  if (start >= 0 && end >= 0) {
    return `${source.slice(0, start)}${comment.trim()}${source.slice(end + END.length)}`;
  }
  if (source.includes(END)) throw new Error("The source contains a declaration end marker without a start marker.");
  return `${comment.trim()}\n\n${source}`;
}
