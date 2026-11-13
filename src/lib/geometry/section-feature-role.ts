/**
 * Observes a local section of actual STL triangles independently of the
 * candidate's bore/shaft label. Filled shaft => one enclosing contour;
 * surrounding void in a tube => two enclosing contours.
 *
 * This is NOT proof that the observed section is the intended feature, that
 * a hole continues between stations, or that the entire part is manifold.
 */
import { normalize, planeBasis, readBinaryStl, sectionMesh, type Vec3, type MeshSection } from "./stl-mesh";

export type ObservedSectionRole = "shaft" | "bore";
export type SectionRoleEvidence = {
  method: "sampled-closed-section-radial-parity/v1";
  status: "OBSERVED" | "NOT_RUN";
  observedRole: ObservedSectionRole | null;
  reason: string;
  stationsChecked: number;
  stationsRequested: number;
  crossingsPerRay: number | null;
  coverage: string;
};

const EPS_MM = 1e-5;
const RAYS = 29;
const MAX_STATIONS = 16;
const MAX_SECTION_SEGMENTS = 8192;
const MAX_STL_BYTES = 64 * 1024 * 1024;

/** Closed degree-two section edge graph; open and non-manifold cuts fail. */
function closedContours(section: MeshSection): boolean {
  if (section.dropped > 0 || section.segments.length < 3 || section.segments.length > MAX_SECTION_SEGMENTS) return false;
  const nodes = new Map<string, { point: [number, number]; degree: number }>();
  const edges = new Set<string>();
  const node = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const key = Math.round(x / EPS_MM) + ":" + Math.round(y / EPS_MM);
    const previous = nodes.get(key);
    if (previous && Math.hypot(previous.point[0] - x, previous.point[1] - y) > EPS_MM) return null;
    if (!previous) nodes.set(key, { point: [x, y], degree: 0 });
    return key;
  };
  for (const segment of section.segments) {
    if (Math.hypot(segment.bx - segment.ax, segment.by - segment.ay) <= EPS_MM * 2) return false;
    const a = node(segment.ax, segment.ay);
    const b = node(segment.bx, segment.by);
    if (a === null || b === null || a === b) return false;
    const key = a < b ? a + "|" + b : b + "|" + a;
    if (edges.has(key)) return false;
    edges.add(key);
    nodes.get(a)!.degree++;
    nodes.get(b)!.degree++;
  }
  return [...nodes.values()].every(value => value.degree === 2);
}

/** Count crossings for one ray. Vertex/grazing hits are inconclusive. */
function crossings(section: MeshSection, seed: [number, number], angle: number): number | null {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let count = 0;
  for (const segment of section.segments) {
    const ex = segment.bx - segment.ax, ey = segment.by - segment.ay;
    const ox = segment.ax - seed[0], oy = segment.ay - seed[1];
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) <= 1e-12) {
      if (Math.abs(ox * dy - oy * dx) <= EPS_MM) return null;
      continue;
    }
    const t = (ox * ey - oy * ex) / determinant;
    const along = (ox * dy - oy * dx) / determinant;
    if (t < -EPS_MM || along < -EPS_MM || along > 1 + EPS_MM) continue;
    if (t <= EPS_MM || along <= EPS_MM || along >= 1 - EPS_MM) return null;
    count++;
  }
  return count;
}

/**
 * At most 16 bounded sections, 29 angular rays per section.
 * Candidate centres are in each cut-plane basis and do not themselves
 * independently establish which cylindrical feature was intended.
 */
export function observeSectionFeatureRole(input: {
  stl: Buffer;
  axis: { origin: Vec3; direction: Vec3 };
  stationsMm: number[];
  centers?: Array<[number, number]>;
}): SectionRoleEvidence {
  const base: SectionRoleEvidence = {
    method: "sampled-closed-section-radial-parity/v1",
    status: "NOT_RUN",
    observedRole: null,
    reason: "",
    stationsChecked: 0,
    stationsRequested: input.stationsMm.length,
    crossingsPerRay: null,
    coverage: "Only sampled 2D cut planes and 29 radial rays per plane. No through-hole continuity, feature intent, mesh-wide topology, calibrated uncertainty, or physical fit.",
  };
  if (input.stl.length > MAX_STL_BYTES ||
      input.stationsMm.length < 2 || input.stationsMm.length > MAX_STATIONS ||
      input.stationsMm.some(value => !Number.isFinite(value)) ||
      (input.centers && (input.centers.length !== input.stationsMm.length ||
        input.centers.some(c => c.length !== 2 || !c.every(Number.isFinite))))) {
    return { ...base, reason: "Invalid or oversized section input; at least two bounded axial stations are required." };
  }

  let mesh: ReturnType<typeof readBinaryStl>, direction: Vec3;
  try {
    mesh = readBinaryStl(input.stl);
    direction = normalize(input.axis.direction);
    if (input.axis.origin.length !== 3 || !input.axis.origin.every(Number.isFinite)) throw new Error("Invalid section origin");
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : "Could not read mesh or axis." };
  }

  let observedRole: ObservedSectionRole | null = null;
  let crossingsPerRay: number | null = null;
  for (let i = 0; i < input.stationsMm.length; i++) {
    const offset = input.stationsMm[i];
    const origin: Vec3 = [
      input.axis.origin[0] + direction[0] * offset,
      input.axis.origin[1] + direction[1] * offset,
      input.axis.origin[2] + direction[2] * offset,
    ];
    const seed: [number, number] = input.centers?.[i] ?? [0, 0];
    const section = sectionMesh(mesh, origin, direction);
    if (!closedContours(section)) return {
      ...base, stationsChecked: i, reason: "The sampled cut is open, degenerate, non-manifold, or too complex to classify.",
    };

    let localCount: number | null = null;
    for (let ray = 0; ray < RAYS; ray++) {
      const angle = 2 * Math.PI * (ray + 0.371) / RAYS;
      const count = crossings(section, seed, angle);
      if (count === null || (count !== 1 && count !== 2) || (localCount !== null && count !== localCount)) {
        return { ...base, stationsChecked: i, reason: "The cut does not consistently contain one solid boundary or two surrounding void boundaries around the candidate center." };
      }
      localCount = count;
    }
    const role = localCount === 1 ? "shaft" : "bore";
    if (observedRole !== null && observedRole !== role) {
      return { ...base, stationsChecked: i, reason: "The observed section role changes between axial stations." };
    }
    observedRole = role;
    crossingsPerRay = localCount;
  }
  return {
    ...base,
    status: "OBSERVED",
    observedRole,
    stationsChecked: input.stationsMm.length,
    crossingsPerRay,
    reason: observedRole === "bore"
      ? "Two closed enclosing contours were observed at every sampled plane (local void candidate)."
      : "One closed enclosing contour was observed at every sampled plane (local solid candidate).",
  };
}
