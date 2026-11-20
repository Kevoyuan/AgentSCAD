/**
 * OpenSCAD reserves `module`, so generated source that uses it as a variable
 * name fails to compile. Rename that use without touching declarations.
 *
 * Comments and strings are masked first: the assembly contract lives in a block
 * comment, and rewriting a word inside it would silently corrupt the JSON.
 */
export function maskScadCommentsAndStrings(scadSource: string): string {
  return scadSource.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*(?:"|$)/g,
    (match) => match.replace(/[^\r\n]/g, " "));
}

const PROTOCOL_TAG = /<\/?｜｜DSML｜｜[^>\r\n]{0,200}>/g;

/**
 * Some providers leak their tool-call protocol tokens into the code block.
 * Remove them only when they appear outside comments and strings, so an
 * assembly declaration or a text literal is never rewritten silently.
 */
export function stripProtocolMarkup(scadSource: string): string {
  const masked = maskScadCommentsAndStrings(scadSource);
  const edits: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = PROTOCOL_TAG.exec(masked))) edits.push(match.index);
  if (!edits.length) return scadSource;
  let result = scadSource;
  for (const start of edits.reverse()) {
    const closing = result.indexOf(">", start);
    if (closing >= 0) result = result.slice(0, start) + result.slice(closing + 1);
  }
  return result;
}

export function sanitizeGeneratedScadSource(scadSource: string): string {
  const source = stripProtocolMarkup(scadSource);
  const masked = maskScadCommentsAndStrings(source);
  const reserved = /\bmodule\b(?!\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/g;
  const edits: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = reserved.exec(masked))) edits.push(match.index);
  if (edits.length === 0) return source;
  let result = source;
  for (const start of edits.reverse()) result = result.slice(0, start) + "tooth_module" + result.slice(start + "module".length);
  return result;
}
