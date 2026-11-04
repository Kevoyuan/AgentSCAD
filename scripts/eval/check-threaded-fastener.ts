#!/usr/bin/env bun
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { measurementExitCode } from "../../src/lib/assembly/measurement-status";
import { sampleThreadedFastener } from "../../src/lib/tools/thread-measurement";
import { measureThreadGeometry } from "../../src/lib/assembly/thread-geometry";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";

/**
 * Local experiment only: no model calls, no manufacturing. Every reported number
 * comes from meshes OpenSCAD produced for this run, and every negative case is
 * rejected by the same checkers that accept the positive one.
 */
async function main() {
  const sourcePath = process.argv[2] ?? "benchmarks/assembly/threaded_fastener.scad";
  const setupPath = process.argv[3] ?? "scripts/eval/assembly-fixtures/threaded-fastener-geometry.json";
  const scadSource = await readFile(sourcePath, "utf8");
  const rawSetup = await readFile(setupPath, "utf8");
  const setup = JSON.parse(rawSetup);

  const root = path.resolve(".agentscad/experiments");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "threaded-fastener-"));
  await writeFile(path.join(directory, "source.scad"), scadSource);
  await writeFile(path.join(directory, "setup.json"), rawSetup);

  const positive = await sampleThreadedFastener({
    scadSource, ...setup,
    onArtifacts: async (label, parts) => {
      for (const part of parts) await writeFile(path.join(directory, `${label}-${part.partId}.stl`), part.stl);
    },
  });
  await writeFile(path.join(directory, "report.json"), JSON.stringify(positive, null, 2));

  // The static meshes are re-used for the contract negatives: the geometry does
  // not change, only the claim about it, so the checker has to reject the claim.
  const staticParts = await renderAssemblyParts({
    scadSource,
    parts: [{ partId: "bolt", selector: setup.selectors.bolt }, { partId: "nut", selector: setup.selectors.nut }],
    parameters: setup.parameters ?? {},
  });
  const boltStl = staticParts.find((part) => part.partId === "bolt")!.stl;
  const wrongHand = measureThreadGeometry({
    stl: boltStl, role: "external", contract: { ...setup.geometry.external, hand: "left" },
  });
  const wrongPitch = measureThreadGeometry({
    stl: boltStl, role: "external", contract: { ...setup.geometry.external, pitchMm: 1.25 },
  });

  // Two geometry defects that the source can be switched into on purpose.
  const plainBore = await sampleThreadedFastener({
    scadSource, ...setup, parameters: { defect: "plain-bore" }, turns: setup.turns.slice(0, 3),
  });
  const spinOnly = await sampleThreadedFastener({
    scadSource, ...setup, parameters: { defect: "spin-only" }, turns: setup.turns.slice(0, 5),
  });

  const negatives = [
    { id: "declared-left-hand", status: wrongHand.status, rejected: wrongHand.status === "FAIL", reason: wrongHand.failures.join(" ") || wrongHand.reason },
    { id: "declared-wrong-pitch", status: wrongPitch.status, rejected: wrongPitch.status === "FAIL", reason: wrongPitch.failures.join(" ") || wrongPitch.reason },
    { id: "plain-bore", status: plainBore.internal.status, rejected: plainBore.internal.status !== "PASS", reason: plainBore.internal.reason },
    { id: "spin-only", status: spinOnly.motion.status, rejected: spinOnly.motion.status === "FAIL", reason: spinOnly.motion.failures.join(" ") || spinOnly.motion.reason },
  ];
  const summary = {
    directory,
    sourceSha256: createHash("sha256").update(scadSource).digest("hex"),
    setupSha256: createHash("sha256").update(rawSetup).digest("hex"),
    status: positive.status,
    external: {
      status: positive.external.status, pitchMm: positive.external.pitchMm, hand: positive.external.hand,
      majorDiameterMm: positive.external.majorDiameterMm, minorDiameterMm: positive.external.minorDiameterMm,
      phaseBins: positive.external.phaseBins, helixResidualDeg: positive.external.helixResidualDeg,
    },
    internal: {
      status: positive.internal.status, pitchMm: positive.internal.pitchMm, hand: positive.internal.hand,
      majorDiameterMm: positive.internal.majorDiameterMm, minorDiameterMm: positive.internal.minorDiameterMm,
      phaseBins: positive.internal.phaseBins, helixResidualDeg: positive.internal.helixResidualDeg,
    },
    engagement: { status: positive.engagement.status, poses: positive.engagement.poses.length },
    motion: {
      status: positive.motion.status, leadPerTurnMm: positive.motion.leadPerTurnMm, hand: positive.motion.hand,
      advanceResidualMm: positive.motion.advanceResidualMm, orientationSpreadDeg: positive.motion.orientationSpreadDeg,
      boltDriftMm: positive.motion.boltDriftMm, turnsCovered: positive.motion.turnsCovered,
    },
    negatives,
  };
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  const negativesRejected = negatives.every((entry) => entry.rejected);
  process.exitCode = negativesRejected ? measurementExitCode(positive.status) : 3;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
