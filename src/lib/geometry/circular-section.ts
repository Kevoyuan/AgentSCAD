import { readBinaryStl, sectionMesh, type SectionSegment, type Vec3 } from "./stl-mesh";

/** Extract circular contours without seeding their centres from a motion formula.
 * The plane and radius filter are measurement setup, not proof of feature identity.
 * Only closed degree-two contours are accepted. Interior and exterior contours
 * are both returned; material/void classification is deliberately not inferred.
 */
export function measureCircularSections(input: {
  stl: Buffer; origin: Vec3; normal: Vec3;
  radiusMm: { min: number; max: number };
}) {
  const { min, max } = input.radiusMm;
  if (![...input.origin, ...input.normal, min, max].every(Number.isFinite) || min <= 0 || max < min) throw new Error("Invalid circular section setup");
  const section = sectionMesh(readBinaryStl(input.stl), input.origin, input.normal);
  if (section.dropped || section.segments.length > 5000) throw new Error("Incomplete or oversized section");
  const tolerance = 1e-5;
  const nodes: Array<{ x: number; y: number; edges: number[] }> = [];
  const cells = new Map<string, number[]>();
  const node = (x: number, y: number) => {
    const cx = Math.floor(x / tolerance), cy = Math.floor(y / tolerance);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (Math.hypot(nodes[id].x - x, nodes[id].y - y) <= tolerance) return id;
      }
    }
    const id = nodes.length;
    nodes.push({ x, y, edges: [] });
    const key = `${cx},${cy}`;
    cells.set(key, [...cells.get(key) ?? [], id]);
    return id;
  };
  const edges: Array<{ a: number; b: number; segment: SectionSegment }> = [];
  const seen = new Set<string>();
  for (const segment of section.segments) {
    const a = node(segment.ax, segment.ay), b = node(segment.bx, segment.by);
    if (a === b) continue;
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes[a].edges.push(edges.length); nodes[b].edges.push(edges.length);
    edges.push({ a, b, segment });
  }
  if (nodes.some(n => n.edges.length !== 2)) throw new Error("Section contains an open or ambiguous contour");
  const visited = new Set<number>();
  const circles: Array<{ center: Vec3; radiusMm: { min: number; max: number }; formErrorMm: number }> = [];
  let contourCount = 0;
  for (let first = 0; first < edges.length; first++) {
    if (visited.has(first)) continue;
    if (++contourCount > 64) throw new Error("Too many section contours");
    const pending = [first], segments: SectionSegment[] = [], loopNodes = new Set<number>();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const e = edges[id]; segments.push(e.segment);
      loopNodes.add(e.a); loopNodes.add(e.b);
      for (const n of [nodes[e.a], nodes[e.b]]) {
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
        for (const next of n.edges) if (!visited.has(next)) pending.push(next);
      }
    }
    // A circle in the radius window cannot have a larger section envelope.
    if (x1 - x0 > 2 * max + tolerance || y1 - y0 > 2 * max + tolerance) continue;
    // A plane cuts triangulated side walls at both true polygon corners and
    // collinear triangle seams. Remove only seams, then test a regular polygon
    // directly. Angular ray sampling aliases a rotated polygon's circumradius.
    const corners = [...loopNodes].filter(id => {
      const n = nodes[id];
      const neighbours = n.edges.map(eid => nodes[edges[eid].a === id ? edges[eid].b : edges[eid].a]);
      const [a, b] = neighbours;
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      return chord <= tolerance || Math.abs((n.x - a.x) * (b.y - a.y) - (n.y - a.y) * (b.x - a.x)) / chord > tolerance;
    }).map(id => nodes[id]);
    // Low-sided polygons are not treated as circular features by this method.
    if (corners.length < 16) continue;
    const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;
    const radii = corners.map(p => Math.hypot(p.x - cx, p.y - cy));
    const radiusMax = Math.max(...radii), formErrorMm = radiusMax - Math.min(...radii);
    if (formErrorMm > tolerance * 10) continue;
    const angles = corners.map(p => Math.atan2(p.y - cy, p.x - cx)).sort((a, b) => a - b);
    const step = 2 * Math.PI / angles.length;
    if (angles.some((a, i) => Math.abs((i + 1 === angles.length ? angles[0] + 2 * Math.PI : angles[i + 1]) - a - step) > 1e-3)) continue;
    let radiusMin = Infinity;
    for (const s of segments) {
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      radiusMin = Math.min(radiusMin, Math.abs((cx - s.ax) * dy - (cy - s.ay) * dx) / Math.hypot(dx, dy));
    }
    // All segments must lie on neighbouring polygon chords, not on a star or
    // another self-crossing traversal of otherwise circular vertices.
    if (Math.abs(radiusMin - radiusMax * Math.cos(Math.PI / corners.length)) > tolerance * 10) continue;
    if (radiusMin < min || radiusMax > max) continue;
    const center = input.origin.map((value, k) => value + section.u[k] * cx + section.v[k] * cy) as Vec3;
    circles.push({ center, radiusMm: { min: radiusMin, max: radiusMax }, formErrorMm });
  }
  return { circles, contourCount, origin: input.origin, normal: section.normal, endpointToleranceMm: tolerance };
}
