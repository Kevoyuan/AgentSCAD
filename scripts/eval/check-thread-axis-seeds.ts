#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exploreThreadAxis, exploreThreadCoaxiality } from "../../src/lib/assembly/thread-axis-prototype";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const protocolBytes = await readFile(process.argv[2] ?? "scripts/eval/assembly-fixtures/thread-axis-seed-protocol.json");
  const protocol = JSON.parse(protocolBytes.toString()) as {
    input: string; inputSha256: string; stationsMm: number[]; seedsMm: [number, number][];
    sampling?: "ray-hits" | "visible-segment-endpoints" | "enclosing-contour-endpoints";
  };
  const mesh = await readFile(protocol.input);
  if (sha(mesh) !== protocol.inputSha256) throw new Error("Frozen input mesh hash mismatch");
  const results = protocol.seedsMm.map(seedMm => ({
    seedMm, fit: exploreThreadAxis(mesh, protocol.stationsMm, { seedMm, role: "bore", sampling: protocol.sampling }),
  }));
  const comparisons = results.map(item => ({ seedMm: item.seedMm, comparison: exploreThreadCoaxiality(results[0].fit, item.fit) }));
  const algorithm = await readFile("src/lib/assembly/thread-axis-prototype.ts");
  const collision = await readFile("src/lib/geometry/mesh-collision.ts");
  const section = await readFile("src/lib/geometry/stl-mesh.ts");
  const contours = await readFile("src/lib/geometry/section-contours.ts");
  const script = await readFile("scripts/eval/check-thread-axis-seeds.ts");
  const report = {
    status: "NOT_RUN", sampling: protocol.sampling??"ray-hits", protocolSha256: sha(protocolBytes), inputSha256: sha(mesh),
    algorithmSha256: sha(algorithm), collisionSha256: sha(collision), sectionSha256: sha(section), contoursSha256: sha(contours), scriptSha256: sha(script),
    results, comparisons,
    scope: "Visible seed-sensitivity development study. Absolute axis truth, calibrated uncertainty, continuous geometry and physical function remain unverified.",
  };
  const root = ".agentscad/experiments";
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "thread-axis-seeds-"));
  await Promise.all([
    writeFile(path.join(directory, "protocol.json"), protocolBytes), writeFile(path.join(directory, "input.stl"), mesh),
    writeFile(path.join(directory, "algorithm.ts"), algorithm), writeFile(path.join(directory, "mesh-collision.ts"), collision),
    writeFile(path.join(directory, "stl-mesh.ts"), section), writeFile(path.join(directory, "experiment.ts"), script),
    writeFile(path.join(directory, "section-contours.ts"), contours),
    writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2)),
  ]);
  console.log(JSON.stringify({ directory, protocolSha256: report.protocolSha256, comparisons }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 2; });
