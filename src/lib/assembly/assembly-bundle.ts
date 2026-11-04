import { createHash } from "crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { prepareAssembly, type AssemblyFitRequirement } from "./prepare-assembly";
import type { RenderedAssemblyPart } from "../tools/assembly-part-renderer";
import type { ScadExecutionOptions } from "../tools/scad-renderer";
import type { AssemblySpec } from "./assembly-spec";
import { canonicalJson } from "../canonical-json";

/** Exporting N identical files labelled as different parts would be a lie, so it is refused. */
export class AssemblyIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyIdentityError";
  }
}

type Renderer = (source: string, spec: AssemblySpec, options?: ScadExecutionOptions) => Promise<{ parts: RenderedAssemblyPart[]; purchasedPartIds: string[] }>;

/** Omit per-run timing from the archive while retaining the fixed total budget,
 * evidence, coverage and verdict. A timed-out run is still NOT_RUN: under load
 * a different verdict legitimately produces different archive bytes.
 */
function stableDisassemblyRecord(record: Awaited<ReturnType<typeof prepareAssembly>>["manifest"]["declaredDisassembly"]) {
  const { elapsedMs: _elapsedMs, ...stable } = record as typeof record & { elapsedMs?: number };
  const stableReason = (reason: string) => /^Path exceeded its [0-9.eE+-]+ ms evaluation budget$/.test(reason)
    ? "Path exceeded its remaining sequence evaluation budget"
    : reason;
  return {
    ...stable,
    results: record.results.map(result => {
      if (!result.path) return { ...result, reason: stableReason(result.reason) };
      const { budgetMs: _remainingBudgetMs, ...path } = result.path;
      return { ...result, reason: stableReason(result.reason), path: { ...path, reason: stableReason(path.reason) } };
    }),
  };
}

/**
 * The README is derived from the evidence actually recorded for this build.
 * Fixed claims would go stale as soon as a layer starts being measured.
 */
function readme(
  manifest: {
    sourceSha256: string;
    parts: Array<{ id: string; source: string; quantity: number }>;
    specificationSha256: string;
    contract?: { evidenceCurrent: boolean | null; reason: string; binding?: { sha256: string; revision: number; requestSha256: string } | null };
    evidence: Record<string, { status: string; reason?: string }>;
  },
  parts: RenderedAssemblyPart[],
): string {
  const layers = ["identity", "assembly", "disassembly", "motion", "physical"];
  const contract = manifest.contract;
  const standing = contract === undefined || contract.evidenceCurrent === null
    ? "confirmation not evaluated"
    : contract.evidenceCurrent ? "confirmed against the current request" : "NOT CONFIRMED";
  return [
    "AgentSCAD assembly part bundle",
    "",
    "This archive contains one STL per generated part, manifest.json and specification.json.",
    "specification.json is the validated canonical assembly declaration; its exact",
    "UTF-8 bytes hash to specificationSha256. It is a declaration, not proof of function.",
    "",
    "Quantities from declared assembly instances:",
    ...manifest.parts.map(part => `- ${part.id}: ${part.quantity} (${part.source})`),
    "One STL represents one part design; manufacture the stated quantity.",
    "",
    "Requirement contract:",
    `- ${standing}`,
    ...(contract?.binding ? [
      `- contractSha256: ${contract.binding.sha256}`,
      `- contractRevision: ${contract.binding.revision}`,
      `- requestSha256: ${contract.binding.requestSha256}`,
    ] : ["- contract binding: unavailable"]),
    ...(contract === undefined || contract.evidenceCurrent === null || contract.evidenceCurrent ? [] : [`  ${contract.reason}`]),
    "",
    "Evidence recorded when this bundle was built:",
    ...layers.map((layer) => {
      const item = manifest.evidence[layer];
      return `- ${layer}: ${item?.status ?? "NOT_RUN"} — ${item?.reason ?? "not recorded"}`;
    }),
    "",
    "A PASS is limited to the method and coverage stated above. No layer in this",
    "archive proves that a part is the intended part, that the assembly can be",
    "assembled, that it moves, or that it works when printed.",
    "",
    `sourceSha256: ${manifest.sourceSha256}`,
    `specificationSha256: ${manifest.specificationSha256}`,
    `generated parts: ${parts.length}`,
    "",
  ].join("\n");
}

/**
 * Builds the archive in memory. Nothing is written to disk and nothing is
 * published unless every part rendered: a partial bundle is worse than none.
 */
export async function buildAssemblyBundle(input: {
  scadSource: string;
  spec: unknown;
  options?: ScadExecutionOptions;
  render?: Renderer;
  assemblyMesh?: { stl: Buffer; sha256?: string } | null;
  /** Frozen fit requirements; without them the assembly layer stays NOT_RUN. */
  fitRequirements?: AssemblyFitRequirement[];
  /** Confirmation state of the contract the results are judged against. */
  contractGate?: { evidenceCurrent: boolean; reason?: string | null };
  contractSnapshot?: Parameters<typeof prepareAssembly>[0]["contractSnapshot"];
  /** Fixes archive timestamps; identical evidence produces identical bytes. */
  modifiedAt?: Date;
}) {
  const prepared = await prepareAssembly(input);
  if (prepared.identity.distinctness.status === "FAIL") {
    throw new AssemblyIdentityError(prepared.identity.distinctness.reason);
  }
  const mtime = input.modifiedAt ?? new Date("1980-01-01T00:00:00Z");
  // ZIP stores a 1980-based DOS timestamp; anything outside that range is unrepresentable.
  if (!Number.isFinite(mtime.getTime()) || mtime.getUTCFullYear() < 1980 || mtime.getUTCFullYear() > 2099) throw new Error("Archive timestamp must be between 1980 and 2099");
  const files: Zippable = {};
  for (const part of prepared.parts) {
    // STL is already dense; storing avoids spending CPU to save a few percent.
    files[`${part.partId}.stl`] = [new Uint8Array(part.stl), { level: 0, mtime }];
  }
  const triangles = new Map(prepared.parts.map((part) => [part.partId, part.triangleCount]));
  const manifest = {
    ...prepared.manifest,
    declaredDisassembly: stableDisassemblyRecord(prepared.manifest.declaredDisassembly),
    bundleSchemaVersion: 1 as const,
    parts: prepared.manifest.parts.map((part) => ({
      ...part,
      fileName: part.source === "generated" ? `${part.id}.stl` : null,
      triangleCount: triangles.get(part.id) ?? null,
    })),
    evidence: {
      ...prepared.manifest.evidence,
      // Keep the contract-gated status and reason, and add the raw findings as
      // detail. Overwriting the status here would let an unconfirmed contract
      // present a PASS in the archive that the manifest had downgraded.
      identity: { ...prepared.manifest.evidence.identity, distinctness: prepared.identity.distinctness, containment: prepared.identity.containment },
    },
  };
  files["manifest.json"] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6, mtime }];
  const specification = canonicalJson(prepared.spec);
  if (createHash("sha256").update(specification).digest("hex") !== manifest.specificationSha256) throw new Error("Assembly specification hash mismatch");
  files["specification.json"] = [strToU8(specification), { level: 6, mtime }];
  files["README.txt"] = [strToU8(readme(manifest, prepared.parts)), { level: 6, mtime }];
  const zip = Buffer.from(zipSync(files));
  return {
    zip,
    sha256: createHash("sha256").update(zip).digest("hex"),
    manifest,
    parts: prepared.parts,
    identity: prepared.identity,
    purchasedPartIds: prepared.purchasedPartIds,
  };
}
