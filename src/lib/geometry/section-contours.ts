import type { MeshSection } from "./stl-mesh";

type Point = [number, number];
const JOIN_MM = 1e-7;

/** Exploratory contour binding. The caller must separately establish solid/void
 * membership. A section must consist entirely of degree-two closed loops.
 * Joining tolerance handles section interpolation roundoff and is reported.
 * Self-crossings between segment interiors are not checked here.
 */
export function selectEnclosingContour(section: MeshSection, seed: Point) {
  const base = { joinToleranceMm: JOIN_MM, coverage: "Closed section loops only. Segment-interior self-intersection and physical feature identity are unverified." };
  const unavailable = (reason: string) => ({ ...base, status: "NOT_RUN" as const, reason, points: [] as Point[] });
  if (section.dropped || section.segments.length < 3 || section.segments.length > 5000) return unavailable("Incomplete or oversized contour section");
  if (seed.length !== 2 || !seed.every(Number.isFinite)) throw new Error("Expected finite section seed");
  const points: Point[] = [];
  const neighbors: number[][] = [];
  const buckets = new Map<string, number[]>();
  const vertex = (point: Point): number => {
    const x = Math.floor(point[0] / JOIN_MM), y = Math.floor(point[1] / JOIN_MM);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const index of buckets.get(`${x + dx},${y + dy}`) ?? []) {
        if (Math.hypot(points[index][0] - point[0], points[index][1] - point[1]) <= JOIN_MM) return index;
      }
    }
    const index = points.length;
    points.push(point);
    neighbors.push([]);
    const key = `${x},${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    buckets.set(key, bucket);
    return index;
  };
  for (const segment of section.segments) {
    if (![segment.ax, segment.ay, segment.bx, segment.by].every(Number.isFinite)) return unavailable("Nonfinite contour coordinates");
    const a = vertex([segment.ax, segment.ay]), b = vertex([segment.bx, segment.by]);
    if (a === b || neighbors[a].includes(b)) return unavailable("Degenerate or duplicate contour edge");
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  if (neighbors.some(edges => edges.length !== 2)) return unavailable("Contour has open or branching vertices");
  const visited = new Set<number>();
  const enclosing: Array<{ points: Point[]; areaMm2: number }> = [];
  let loopCount = 0;
  for (let start = 0; start < points.length; start++) {
    if (visited.has(start)) continue;
    const loop: Point[] = [];
    let current = start, previous = -1;
    do {
      if (visited.has(current)) return unavailable("Contour traversal did not close at its starting vertex");
      visited.add(current);
      loop.push(points[current]);
      const next = neighbors[current].find(index => index !== previous)!;
      previous = current;
      current = next;
    } while (current !== start);
    loopCount++;
    if (loop.length < 3) return unavailable("Contour has too few vertices");
    let twiceArea = 0, inside = false;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const fraction = Math.max(0, Math.min(1, ((seed[0] - a[0]) * dx + (seed[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(seed[0] - a[0] - fraction * dx, seed[1] - a[1] - fraction * dy) <= JOIN_MM) return unavailable("Seed lies on a contour boundary");
      twiceArea += a[0] * b[1] - b[0] * a[1];
      if ((a[1] > seed[1]) !== (b[1] > seed[1]) && seed[0] < a[0] + (seed[1] - a[1]) * dx / dy) inside = !inside;
    }
    if (inside) enclosing.push({ points: loop, areaMm2: Math.abs(twiceArea) / 2 });
  }
  enclosing.sort((a, b) => a.areaMm2 - b.areaMm2);
  if (!enclosing.length) return unavailable("No contour encloses the seed");
  if (enclosing[0].areaMm2 <= JOIN_MM * JOIN_MM || (enclosing[1] && Math.abs(enclosing[0].areaMm2 - enclosing[1].areaMm2) <= JOIN_MM * JOIN_MM)) return unavailable("Contour area is degenerate or ambiguous");
  return { ...base, status: "SELECTED" as const, reason: "Selected the smallest enclosing loop", points: enclosing[0].points, areaMm2: enclosing[0].areaMm2, loopCount };
}
