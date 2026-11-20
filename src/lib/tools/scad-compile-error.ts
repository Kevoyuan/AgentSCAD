import {maskScadCommentsAndStrings} from "./scad-sanitizer";

/**
 * Only source/geometry diagnostics should spend another model call on repair.
 * Capacity, timeout, integrity, spawn, and storage failures need an operational
 * retry instead of asking the model to rewrite otherwise valid CAD.
 *
 * Compile-budget timeouts are routed separately by the pipeline (one bounded
 * simplification repair), so they must stay out of this source-diagnostic gate.
 */
export function isRepairableScadCompileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const infrastructureFailure = /(?:renderer is busy|queue wait exceeded|timed out|integrity check|ENOENT|EACCES|spawn|capacity|output exceeded|maxBuffer)/i;
  if (infrastructureFailure.test(message)) return false;

  return /(?:parser error|syntax error|CGAL|applyHull|convex_hull|top level object is empty|produced an empty STL|cannot resolve external libraries|does not support external files or fonts|SCAD source exceeds)/i.test(message);
}

/** Add source locations only after a renderer has rejected the candidate. */
export function annotateScadCompileError(error: unknown, source: string): unknown {
  if (!isRepairableScadCompileError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SCAD_PROTOCOL_MARKUP")) return error;
  const masked = maskScadCommentsAndStrings(source);
  const matches = [...masked.matchAll(/<\/?｜｜DSML｜｜[ \t]+[A-Za-z_][A-Za-z0-9_ -]{0,80}>/g)];
  if (!matches.length) return error;
  const locations = matches.slice(0,8).map(match => {
    const line = masked.slice(0,match.index).split("\n").length;
    return `line ${line}: ${match[0]}`;
  });
  return Object.assign(new Error(`${message}\nSCAD_PROTOCOL_MARKUP. ${matches.length} protocol tags outside comments/strings. ${locations.join(" | ")}. Raw source retained. Geometry checks remain unexecuted.`), {cause:error});
}
