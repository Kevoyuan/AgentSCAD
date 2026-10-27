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
