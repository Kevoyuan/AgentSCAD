#!/usr/bin/env bun
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { checkDisassemblySequence } from "../../src/lib/assembly/disassembly-sequence";
import { measurementExitCode } from "../../src/lib/assembly/measurement-status";

// An original fixture experiment, not a claim that generated mechanisms work.
async function main() {
  const scadSource = await readFile(process.argv[2] ?? "benchmarks/assembly/slider_crank.scad", "utf8");
  const plan = JSON.parse(await readFile(process.argv[3] ?? "scripts/eval/assembly-fixtures/slider-crank-disassembly.json", "utf8"));
  const root = path.resolve(".agentscad/experiments");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "slider-crank-disassembly-"));
  await writeFile(path.join(directory, "source.scad"), scadSource);
  const parameters = { agentscad_pose: true, motion_angle: 0 };
  await writeFile(path.join(directory, "render-parameters.json"), JSON.stringify(parameters));
  const parts = await renderAssemblyParts({ scadSource, parameters,
    parts: [plan.groundedInstanceId, ...plan.steps.map((s: { instanceId: string }) => s.instanceId)].map(id => ({ partId: id, selector: id })),
  });
  for (const p of parts) await writeFile(path.join(directory, `${p.partId}.stl`), p.stl);
  const meshes = Object.fromEntries(parts.map(p => [p.partId, p.stl]));
  const good = checkDisassemblySequence({ meshes, plan });
  const negativePlan = process.argv[4]
    ? JSON.parse(await readFile(process.argv[4], "utf8"))
    : { ...plan, steps: [plan.steps[1], plan.steps[0], ...plan.steps.slice(2)] };
  const wrongOrder = checkDisassemblySequence({ meshes, plan: negativePlan });
  await writeFile(path.join(directory, "report.json"), JSON.stringify({ good, wrongOrder }, null, 2));
  console.log(JSON.stringify({ directory, good: good.status, wrongOrder: wrongOrder.status,
    results: good.results, blocked: wrongOrder.results.find(r => r.status === "FAIL"),
    boundary: "Only the supplied meshes and sampled paths are checked; complete retention, tools, load and physical assembly remain unverified." }, null, 2));
  process.exitCode = good.status === "PASS" && wrongOrder.status === "FAIL" ? 0 : measurementExitCode(good.status) || 1;
}
main().catch(error => { console.error(error); process.exitCode = 2; });
