#!/usr/bin/env bun
/** Exposed original development reference. No model calls or human acceptance. */
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { judgeAssemblyCandidate } from "./judge-assembly";
import { ASSEMBLY_VERIFIER_SOURCES } from "../../src/lib/assembly/verification-types";

const sha = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const protocolPath = "scripts/eval/assembly-fixtures/hinge-operations-protocol.json";
const protocolBytes = await readFile(protocolPath);
const protocol = JSON.parse(protocolBytes.toString());
for (const [file, expected] of Object.entries(protocol.inputs)) {
  if (sha(await readFile(file)) !== expected) throw new Error(`Frozen reference input changed: ${file}`);
}
const archive = await mkdtemp(resolve(".agentscad/experiments/hinge-operations-"));
await writeFile(join(archive, "protocol.json"), protocolBytes);
for (const file of Object.keys(protocol.inputs)) {
  const dest = join(archive, "inputs", file);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(file, dest);
}
const toolFiles = [...new Set([...ASSEMBLY_VERIFIER_SOURCES, import.meta.path.replace(process.cwd() + "/", ""),
  "scripts/eval/judge-assembly.ts", "scripts/eval/assembly-evidence.ts", "src/lib/assembly/repair-findings.ts",
  "src/lib/requirements/extract-requirements.ts", "scripts/eval/audit-hinge-operations.py"])];
const tools: Array<{file:string;sha256:string}> = [];
for (const file of toolFiles) {
  const dest = join(archive, "tools", file);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(file, dest);
  tools.push({ file, sha256: sha(await readFile(file)) });
}
await writeFile(join(archive, "tools.json"), JSON.stringify({ scope: "Listed direct sources, not a hermetic transitive runtime", tools }, null, 2));
const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
const original = JSON.parse(await readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json", "utf8"));
const results: Array<{ id: string; expected: unknown;
  measured: { assemblyPath: string; disassembly: string; rawAxisProbe: string | undefined } | undefined;
  judgementPassed: boolean; matched: boolean }> = [];
for (const expected of protocol.cases) {
  const spec = structuredClone(original);
  if (expected.id === "absent") spec.operations = [];
  if (expected.id === "cross-insertion") { spec.operations[0].waypoints[0][3] = 40; spec.operations[0].waypoints[0][11] = 0; }
  if (expected.id === "short-removal") spec.operations[1].waypoints[1][11] = 0.5;
  const source = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;
  const dir = join(archive, expected.id); await mkdir(dir);
  await writeFile(join(dir, "source.scad"), source);
  await writeFile(join(dir, "specification.json"), JSON.stringify(spec, null, 2));
  let measured: {assemblyPath:string;disassembly:string;rawAxisProbe:string|undefined} | undefined;
  const judgement = await judgeAssemblyCandidate({ prompt: protocol.request, scad: source, onPrepared: async (prepared, whole) => {
    for (const part of prepared.parts) await writeFile(join(dir, `${part.partId}.stl`), part.stl);
    await writeFile(join(dir, "assembly.stl"), whole.stl);
    await writeFile(join(dir, "manifest.json"), JSON.stringify(prepared.manifest, null, 2));
    measured = { assemblyPath: prepared.manifest.evidence.assemblyPath.status,
      disassembly: prepared.manifest.evidence.disassembly.status, rawAxisProbe: prepared.kinematics?.path.status };
  }});
  await writeFile(join(dir, "judgement.json"), JSON.stringify(judgement, null, 2));
  const matched = measured?.assemblyPath === expected.assemblyPath && measured?.disassembly === expected.disassembly && judgement.passed === expected.judgePassed;
  results.push({ id: expected.id, expected, measured, judgementPassed: judgement.passed, matched });
}
const codeUnchangedDuringRun = (await Promise.all(tools.map(async tool => sha(await readFile(tool.file)) === tool.sha256))).every(Boolean);
const report = { protocolSha256: sha(protocolBytes), codeUnchangedDuringRun, results,
  status: results.every(result => result.matched) && codeUnchangedDuringRun ? "PASS" : "FAIL",
  scope: "PASS means the four prespecified development outcomes matched. Machine-derived digital contract only; no human acceptance, hidden-set score, full geometry certification or physical function.",
  physical: "NOT_RUN", modelCalls: 0 };
await writeFile(join(archive, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ archive, ...report }, null, 2));
process.exitCode = report.status === "PASS" ? 0 : 1;
