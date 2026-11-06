#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exploreThreadAxis } from "../../src/lib/assembly/thread-axis-prototype";
type Vec3 = [number, number, number];
type Pose = { id: string; tiltYdeg: number; rotateZdeg: number; translationMm: Vec3 };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const protocolBytes = await readFile("scripts/eval/assembly-fixtures/thread-axis-reference-protocol.json");
  const protocol = JSON.parse(protocolBytes.toString()) as {
    source: string; sourceSha256: string; inputs: Array<{ id: string; file: string; sha256: string }>;
    stationsMm: number[]; poses: Pose[];
  };
  const source = await readFile(protocol.source);
  if (sha(source) !== protocol.sourceSha256) throw new Error("Reference source hash mismatch");
  const inputs = await Promise.all(protocol.inputs.map(async input => {
    const mesh = await readFile(input.file);
    if (sha(mesh) !== input.sha256) throw new Error(`Reference mesh hash mismatch: ${input.id}`);
    return { ...input, mesh };
  }));
  await mkdir(".agentscad/experiments", { recursive: true });
  const directory = await mkdtemp(path.join(".agentscad/experiments", "thread-axis-reference-"));
  await Promise.all(inputs.map(input => writeFile(path.join(directory, `input-${input.id}.stl`), input.mesh)));
  const results = [] as Array<Record<string, unknown>>;
  for (const input of inputs) for (const pose of protocol.poses) {
    const y = pose.tiltYdeg * Math.PI / 180, z = pose.rotateZdeg * Math.PI / 180;
    const cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    const rotate = ([x, v, w]: Vec3): Vec3 => {
      const a = cy * x + sy * w;
      return [cz * a - sz * v, sz * a + cz * v, -sy * x + cy * w];
    };
    const mesh = Buffer.from(input.mesh);
    let maxRewriteRoundingMm = 0;
    for (let face = 0; face < mesh.readUInt32LE(80); face++) {
      const at = 84 + face * 50;
      const normal = rotate([mesh.readFloatLE(at), mesh.readFloatLE(at + 4), mesh.readFloatLE(at + 8)]);
      normal.forEach((value, k) => mesh.writeFloatLE(value, at + k * 4));
    }
    for (let face = 0; face < mesh.readUInt32LE(80); face++) for (let vertex = 0; vertex < 3; vertex++) {
      const position = 84 + face * 50 + 12 + vertex * 12;
      const rotated = rotate([mesh.readFloatLE(position), mesh.readFloatLE(position + 4), mesh.readFloatLE(position + 8)]);
      const point = rotated.map((value, k) => value + pose.translationMm[k]);
      point.forEach((value, k) => mesh.writeFloatLE(value, position + k * 4));
      maxRewriteRoundingMm = Math.max(maxRewriteRoundingMm, Math.hypot(...point.map((value, k) => value - mesh.readFloatLE(position + k * 4))));
    }
    const seedMm: [number, number] = [pose.translationMm[0], pose.translationMm[1]];
    const fit = exploreThreadAxis(mesh, protocol.stationsMm, { seedMm, role: "bore", sampling: "enclosing-contour-endpoints" });
    const direction: Vec3 = [cz * sy, sz * sy, cy];
    let deviation: { offsetMm: number; angleDeg: number; referenceZMm: number } | null = null;
    if ("axis" in fit && fit.axis) {
      const a = fit.axis;
      const height = a.point[2] - pose.translationMm[2];
      const expectedX = pose.translationMm[0] + direction[0] * height / direction[2];
      const expectedY = pose.translationMm[1] + direction[1] * height / direction[2];
      const measuredDirection = [a.slope[0], a.slope[1], 1];
      const cosine = measuredDirection.reduce((sum, value, k) => sum + value * direction[k], 0) / Math.hypot(...measuredDirection);
      deviation = { offsetMm: Math.hypot(a.point[0] - expectedX, a.point[1] - expectedY), angleDeg: Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI, referenceZMm: a.point[2] };
    }
    const id = `${input.id}-${pose.id}`;
    results.push({ id, inputSha256: input.sha256, meshSha256: sha(mesh), pose, referenceLine: { point: pose.translationMm, direction }, maxRewriteRoundingMm, deviation, fit });
    await writeFile(path.join(directory, `${id}.stl`), mesh);
  }
  const files = ["src/lib/assembly/thread-axis-prototype.ts", "src/lib/geometry/stl-mesh.ts", "src/lib/geometry/section-contours.ts", "src/lib/geometry/mesh-collision.ts", "scripts/eval/check-thread-axis-reference.ts"];
  const codeHashes: Record<string, string> = {};
  for (const file of files) {
    const bytes = await readFile(file);
    codeHashes[file] = sha(bytes);
    await writeFile(path.join(directory, path.basename(file)), bytes);
  }
  const report = { status: "NOT_RUN", protocolSha256: sha(protocolBytes), sourceSha256: sha(source), codeHashes, results, scope: "Deviation from source-construction reference on finite visible inputs. Independent metrological uncertainty, physical manufacture and actual assembly coaxiality remain unverified." };
  await Promise.all([writeFile(path.join(directory, "protocol.json"), protocolBytes), writeFile(path.join(directory, "source.scad"), source), writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2))]);
  console.log(JSON.stringify({ directory, protocolSha256: report.protocolSha256, results: results.map(({id, deviation, maxRewriteRoundingMm}) => ({id, deviation, maxRewriteRoundingMm})) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 2; });
