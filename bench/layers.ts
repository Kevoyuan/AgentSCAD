/**
 * The layer model: one evidence taxonomy, two audiences.
 *
 * The product stores per-assertion evidence under its own storage layers
 * (`ASSEMBLY_EVIDENCE_LAYERS` in `src/lib/assembly/verification-types.ts`).
 * That vocabulary is about where a fact is kept. The layers here are about
 * what a human or an agent would *repair*, so they are coarser and each one
 * names a subsystem. Keeping the two separate is deliberate: a scoring model
 * that mirrors a storage schema tends to grow a layer every time storage does,
 * and then the denominator moves for reasons that have nothing to do with
 * capability.
 *
 * Two rules are load-bearing:
 *
 * 1. A layer with no evidence is *unobserved*, not passed. It leaves the
 *    denominator instead of entering the numerator, and it is reported
 *    separately so the gap stays visible.
 * 2. `NOT_RUN` is not coverage. A layer is covered only when every evidence
 *    item that feeds it actually ran and passed.
 */

export type EvidenceStatus = "PASS" | "FAIL" | "SKIP" | "ERROR" | "NOT_RUN";

export const LAYER_IDS = [
  "compile",
  "parts-identity",
  "topology",
  "joint-frames",
  "fit",
  "balance",
  "retention",
  "assembly-path",
  "disassembly-path",
  "rigid-motion",
  "source-motion",
  "reconstruction",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

export interface LayerSpec {
  id: LayerId;
  /** The evidence ids that feed this layer. An id may feed exactly one layer. */
  evidence: readonly string[];
  /** What a drop in this layer points at. This is the repair target, not a label. */
  subsystem: string;
}

/**
 * Ordered by rung: later layers are only reachable once earlier ones hold.
 * Every layer earns its place by having a repair target no other layer shares,
 * not by mirroring a storage enum.
 *
 * Deliberately *not* layers: `intent-preserved` (the product states it has no
 * independent audit), `declared-connection-type` and `declared-translation-probes`
 * (declaration preconditions — when they fail, everything downstream is
 * NOT_RUN anyway), and `repair-preservation` (it belongs to the repair axis,
 * not to the geometry being scored).
 */
export const LAYERS: readonly LayerSpec[] = [
  { id: "compile", evidence: ["compile"], subsystem: "SCAD compilation" },
  { id: "parts-identity", evidence: ["distinct-exported-parts", "measured-part-identity"], subsystem: "Selectors and parting strategy" },
  { id: "topology", evidence: ["part-connectivity", "frame-connectivity"], subsystem: "Boolean ops, wall thickness, connectivity" },
  { id: "joint-frames", evidence: ["measured-joint-frames"], subsystem: "Declared axes and coordinate transforms" },
  { id: "fit", evidence: ["diametral-clearance", "bearing-fit", "guide-clearance"], subsystem: "Bore/shaft dimensions and tolerance" },
  { id: "balance", evidence: ["counterweight-balance"], subsystem: "Crank counterweights and throw phase" },
  { id: "retention", evidence: ["axial-retention", "unresolved-axial-retention"], subsystem: "Retention features and latches" },
  { id: "assembly-path", evidence: ["assembly-path"], subsystem: "Insertion path and clearance" },
  { id: "disassembly-path", evidence: ["disassembly-path"], subsystem: "Removal order" },
  { id: "rigid-motion", evidence: ["rigid-motion", "sampled-motion", "motion-range-deg", "motion-range-negative-end", "motion-range-positive-end"], subsystem: "Kinematics and collision" },
  { id: "source-motion", evidence: ["source-motion"], subsystem: "SCAD parameterisation and pose selectors" },
  { id: "reconstruction", evidence: ["assembly-reconstruction"], subsystem: "Export, re-assembly and budget" },
];

const LAYER_BY_ID = new Map(LAYERS.map((layer) => [layer.id, layer]));

const EVIDENCE_TO_LAYER = new Map<string, LayerId>(
  LAYERS.flatMap((layer) => layer.evidence.map((evidenceId) => [evidenceId, layer.id] as const)),
);

export interface LayerResult {
  layer: LayerId;
  /** `null` when no evidence for this layer was produced at all. */
  status: EvidenceStatus | null;
  /** Evidence ids that fed the verdict, with their own status, in input order. */
  evidence: Array<{ id: string; status: EvidenceStatus }>;
  /** Why the layer is not PASS, in the words of the evidence that failed it. */
  blockers: string[];
}

export interface LayerCoverage {
  /** Layers whose every evidence item passed. */
  passed: number;
  /** Layers with at least one evidence item. The denominator. */
  observed: number;
  /** `passed / observed`; `null` when nothing was observed. */
  ratio: number | null;
  /** Layers with no evidence. Excluded from the ratio, listed so the gap stays visible. */
  unobserved: LayerId[];
}

export interface ScoredLayers {
  layers: LayerResult[];
  coverage: LayerCoverage;
  /** The delivery gate. Not the progress metric. */
  gate: { passed: boolean | null; reason: string };
  /** Evidence ids that belong to no layer. Unknown ids are surfaced, never dropped. */
  unmappedEvidence: string[];
}

const STATUS_RANK: Record<EvidenceStatus, number> = {
  PASS: 0,
  SKIP: 1,
  NOT_RUN: 2,
  FAIL: 3,
  ERROR: 4,
};

/**
 * Worst status wins, using the same precedence as the rest of the repository:
 * ERROR > FAIL > NOT_RUN > SKIP > PASS. A layer cannot be promoted by adding a
 * passing item next to a failing one.
 */
export function worstStatus(statuses: EvidenceStatus[]): EvidenceStatus {
  let worst: EvidenceStatus = "PASS";
  for (const status of statuses) if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  return worst;
}

export function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS_RANK, value);
}

/**
 * The delivery gate: every non-intent evidence item must be PASS.
 *
 * Deliberately local rather than imported from the trial runner. That runner
 * used to export this as `measuredCore` and no longer does — which is the
 * argument, not an inconvenience: a benchmark that imports the system it
 * measures inherits that system's refactors and stops being able to score its
 * own history. The *semantic* is the stable contract, and a test locks it here.
 *
 * `intent-preserved` is excluded because the product states it has no
 * independent audit; scoring it here would invent one.
 */
export function deliveryGate(evidence: Array<{ id: string; status: string }>): { passed: boolean | null; reason: string } {
  const measured = evidence.filter((item) => item.id !== "intent-preserved");
  if (measured.length === 0) return { passed: null, reason: "No non-intent evidence was produced." };
  const failing = measured.filter((item) => item.status !== "PASS");
  if (failing.length > 0) {
    return { passed: false, reason: `Non-intent evidence not all PASS: ${failing.map((item) => `${item.id}:${item.status}`).join(", ")}` };
  }
  return { passed: true, reason: "Every non-intent evidence item is PASS; intent and user acceptance remain unresolved." };
}

/**
 * Scores one candidate's evidence into layers, coverage and the gate.
 *
 * Coverage is the number that moves one layer at a time; the gate is the
 * separate delivery verdict.
 */
export function scoreEvidence(evidence: Array<{ id: string; status: string }>): ScoredLayers {
  const normalized: Array<{ id: string; status: EvidenceStatus }> = [];
  const unmapped: string[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    if (!isEvidenceStatus(item.status)) {
      // An unknown status is a bug in the producer, not a result. Surface it.
      unmapped.push(`${item.id}:${item.status}`);
      continue;
    }
    if (seen.has(item.id)) {
      unmapped.push(`${item.id}:duplicate`);
      continue;
    }
    seen.add(item.id);
    normalized.push({ id: item.id, status: item.status });
    if (!EVIDENCE_TO_LAYER.has(item.id)) unmapped.push(item.id);
  }

  const layers: LayerResult[] = LAYERS.map((spec) => {
    const feeding = normalized.filter((item) => spec.evidence.includes(item.id));
    if (feeding.length === 0) {
      return { layer: spec.id, status: null, evidence: [], blockers: ["No evidence was produced for this layer."] };
    }
    const status = worstStatus(feeding.map((item) => item.status));
    return {
      layer: spec.id,
      status,
      evidence: feeding,
      blockers: feeding.filter((item) => item.status !== "PASS").map((item) => `${item.id}:${item.status}`),
    };
  });

  const observedLayers = layers.filter((layer) => layer.status !== null);
  const passedLayers = observedLayers.filter((layer) => layer.status === "PASS");
  const gate = deliveryGate(normalized);

  return {
    layers,
    coverage: {
      passed: passedLayers.length,
      observed: observedLayers.length,
      ratio: observedLayers.length === 0 ? null : passedLayers.length / observedLayers.length,
      unobserved: layers.filter((layer) => layer.status === null).map((layer) => layer.layer),
    },
    gate,
    unmappedEvidence: unmapped,
  };
}

export function layerSpec(layer: LayerId): LayerSpec {
  const spec = LAYER_BY_ID.get(layer);
  if (!spec) throw new Error(`unknown layer ${layer}`);
  return spec;
}

/**
 * Cross-candidate aggregate: which layer is the bottleneck across a set of
 * candidates, and how often each layer was even observed.
 *
 * A layer that is frequently `NOT_RUN` is a *measurement* gap, not a model
 * gap, and conflating the two is how a roadmap ends up blaming the model for
 * a missing verifier.
 */
/**
 * Why a layer is not passing. The distinction decides where the work goes:
 * a capability gap is the model's, a measurement gap is the verifier's.
 * Conflating them is how a roadmap ends up blaming a model for a missing check.
 *
 * `ERROR` is deliberately *not* folded into either side. Reading the finding
 * text shows why: `diametral-clearance: ERROR` can mean "the bore could not be
 * measured because no bore was drawn" (a capability gap) or "the reconstruction
 * budget ran out" (a harness gap), and the status alone does not say which.
 * Guessing would put the wrong item on the roadmap, so it reports as
 * `undetermined` and asks for the finding.
 */
export type LayerDiagnosis = "healthy" | "capability-gap" | "measurement-gap" | "undetermined" | "unobserved";

export interface LayerAggregate {
  layer: LayerId;
  subsystem: string;
  pass: number;
  fail: number;
  error: number;
  notRun: number;
  skip: number;
  /** Candidates where the layer produced no evidence at all. */
  absent: number;
  /** `pass / (pass + fail + error + notRun + skip)`; `null` when never observed. */
  observedPassRate: number | null;
  diagnosis: LayerDiagnosis;
}

export function diagnose(counts: { pass: number; fail: number; error: number; notRun: number; skip: number }): LayerDiagnosis {
  const observed = counts.pass + counts.fail + counts.error + counts.notRun + counts.skip;
  if (observed === 0) return "unobserved";
  if (counts.pass / observed >= 0.75) return "healthy";
  // NOT_RUN is unambiguous: the check did not run, so the fact was never
  // established. ERROR is not — see the note on the type.
  if (counts.notRun > counts.pass + counts.fail) return "measurement-gap";
  if (counts.error > counts.pass + counts.fail) return "undetermined";
  return "capability-gap";
}

export function aggregateLayers(scored: ScoredLayers[]): LayerAggregate[] {
  return LAYERS.map((spec) => {
    const counts = { pass: 0, fail: 0, error: 0, notRun: 0, skip: 0, absent: 0 };
    for (const candidate of scored) {
      const layer = candidate.layers.find((entry) => entry.layer === spec.id);
      if (!layer || layer.status === null) counts.absent += 1;
      else if (layer.status === "PASS") counts.pass += 1;
      else if (layer.status === "FAIL") counts.fail += 1;
      else if (layer.status === "ERROR") counts.error += 1;
      else if (layer.status === "NOT_RUN") counts.notRun += 1;
      else counts.skip += 1;
    }
    const observed = counts.pass + counts.fail + counts.error + counts.notRun + counts.skip;
    return {
      layer: spec.id,
      subsystem: spec.subsystem,
      ...counts,
      observedPassRate: observed === 0 ? null : counts.pass / observed,
      diagnosis: diagnose(counts),
    };
  });
}
