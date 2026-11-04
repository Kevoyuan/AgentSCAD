/**
 * OpenSCAD reserves `module`, so generated source that uses it as a variable
 * name fails to compile. Rename that use without touching declarations.
 *
 * Comments and strings are masked first: the assembly contract lives in a block
 * comment, and rewriting a word inside it would silently corrupt the JSON.
 */
export function sanitizeGeneratedScadSource(scadSource: string): string {
  const masked = scadSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"/g,
    (match) => match.replace(/[^\r\n]/g, " "));
  const reserved = /\bmodule\b(?!\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/g;
  const edits: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = reserved.exec(masked))) edits.push(match.index);
  if (edits.length === 0) return scadSource;
  let result = scadSource;
  for (const start of edits.reverse()) result = result.slice(0, start) + "tooth_module" + result.slice(start + "module".length);
  return result;
}
