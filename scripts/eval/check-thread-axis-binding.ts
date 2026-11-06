#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exploreThreadAxis, type ExploratoryFeatureBinding } from "../../src/lib/assembly/thread-axis-prototype";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const protocolBytes = await readFile("scripts/eval/assembly-fixtures/thread-axis-binding-protocol.json");
  const protocol = JSON.parse(protocolBytes.toString()) as {
    input: string; inputSha256: string; stationsMm: number[];
    cases: Array<{ id: string; translateXmm: number; role: ExploratoryFeatureBinding["role"]; seedMm: [number, number]; targetCenterMm: [number, number] | null }>;
  };
  const original = await readFile(protocol.input);
  if (sha(original) !== protocol.inputSha256) throw new Error("Frozen input mesh hash mismatch");
  const root = ".agentscad/experiments";
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "thread-axis-binding-"));
  const results: Array<{ id: string; meshSha256: string; errorMm: number | null; fit: ReturnType<typeof exploreThreadAxis> }> = [];
  for (const example of protocol.cases) {
    const mesh = Buffer.from(original);
    for (let triangle = 0; triangle < mesh.readUInt32LE(80); triangle++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        const position = 84 + triangle * 50 + 12 + vertex * 12;
        mesh.writeFloatLE(mesh.readFloatLE(position) + example.translateXmm, position);
      }
    }
    const fit = exploreThreadAxis(mesh, protocol.stationsMm, { seedMm: example.seedMm, role: example.role });
    const axis = "axis" in fit ? fit.axis : undefined;
    const errorMm = axis && example.targetCenterMm
      ? Math.hypot(axis.point[0] - example.targetCenterMm[0], axis.point[1] - example.targetCenterMm[1]) : null;
    results.push({ id: example.id, meshSha256: sha(mesh), errorMm, fit });
    await writeFile(path.join(directory, `${example.id}.stl`), mesh);
  }
  const algorithm = await readFile("src/lib/assembly/thread-axis-prototype.ts");
  const script = await readFile("scripts/eval/check-thread-axis-binding.ts");
  const report = {
    status: "NOT_RUN", scope: "Feature-binding development cases only. Calibration, real threaded feature identity and assembly coaxiality remain unexecuted.",
    protocolSha256: sha(protocolBytes), algorithmSha256: sha(algorithm), scriptSha256: sha(script), results,
  };
  await Promise.all([
    writeFile(path.join(directory, "protocol.json"), protocolBytes),
    writeFile(path.join(directory, "algorithm.ts"), algorithm),
    writeFile(path.join(directory, "experiment.ts"), script),
    writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2)),
  ]);
  console.log(JSON.stringify({ directory, protocolSha256: report.protocolSha256, results: results.map(r => ({ id: r.id, errorMm: r.errorMm, hasAxis: "axis" in r.fit, reason: r.fit.reason })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 2; });
