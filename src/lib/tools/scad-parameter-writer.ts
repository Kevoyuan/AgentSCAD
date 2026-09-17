import { formatOpenScadDefinition } from "./scad-definitions";

/** Replace global assignment expressions, leaving comments and nested scopes alone. */
export function writeScadParameters(source: string, values: Record<string, unknown>): string {
  // Mask strings/comments without changing offsets, so their punctuation cannot
  // be mistaken for assignments, statement endings, or scope delimiters.
  const masked = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"/g,
    (match) => match.replace(/[^\r\n]/g, " "));
  const topLevel = new Uint8Array(masked.length + 1);
  let braces = 0, parentheses = 0, brackets = 0;
  for (let i = 0; i < masked.length; i++) {
    topLevel[i] = Number(braces === 0 && parentheses === 0 && brackets === 0);
    const ch = masked[i];
    if (ch === "{") braces++;
    if (ch === "}") braces--;
    if (ch === "(") parentheses++;
    if (ch === ")") parentheses--;
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
  }
  const formatted = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    const literal = formatOpenScadDefinition(value);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || literal === null) {
      throw new Error(`Unsupported OpenSCAD parameter: ${key}`);
    }
    formatted.set(key, literal);
  }
  const found = new Set<string>();
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const assignment = /(?:^|[;\n\r}])[\t ]*([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(masked))) {
    const start = match.index + match[0].length;
    if (!topLevel[start - 1] || !formatted.has(match[1])) continue;
    const end = masked.indexOf(";", start);
    if (end < 0) throw new Error(`Unterminated OpenSCAD parameter: ${match[1]}`);
    edits.push({ start, end, text: ` ${formatted.get(match[1])}` });
    found.add(match[1]);
  }
  let result = source;
  for (const edit of edits.reverse()) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  const missing = [...formatted].filter(([key]) => !found.has(key));
  return missing.length
    ? missing.map(([key, value]) => `${key} = ${value};`).join("\n") + "\n" + result
    : result;
}
