import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { prepareContractAssembly } from "../../assembly/prepare-contract-assembly";
import { deriveRequirementContract } from "../../requirements/extract-requirements";
import { assessAssemblyRequirements } from "../../validation/assembly-requirement-assertions";
import { validateAssemblyArtifact } from "../../validation/assembly-validation";
import { buildAssemblyBundle } from "../../assembly/assembly-bundle";
import { strFromU8, unzipSync } from "fflate";

const request = "做一个曲柄滑块机构，曲柄半径 8 mm，连杆长度 28 mm，直径间隙 0.1 到 0.6 mm，能转 ±45 度";
const fixturePath = "benchmarks/assembly/piston_crank_declared.scad";

test("the piston-in-cylinder slider-crank measures all four joints and mechanism dimensions", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const extracted = extractEmbeddedAssemblySpec(scadSource);
  if (extracted.status !== "valid") throw new Error(`declared piston crank is ${extracted.status}`);
  const contract = deriveRequirementContract({ request });
  const result = await prepareContractAssembly({
    scadSource, spec: extracted.spec,
    contractSnapshot: { contract, request },
    contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    sourceSamplingSeed: "11223344556677889900aabbccddeeff",
    reconstructionBudgetMs: 60000,
  });
  expect(result.fits).toHaveLength(4);
  for (const fit of result.fits) {
    expect(fit.status, `${fit.connectionId}: ${fit.reason}`).toBe("PASS");
    expect(fit.jointFrames?.measuredStatus, `${fit.connectionId}: ${fit.jointFrames?.measuredReason}`).toBe("PASS");
  }
  expect(result.manifest.evidence.jointFrames.status).toBe("PASS");
  expect(result.manifest.evidence.identity.status).toBe("PASS");
  expect(result.manifest.evidence.topology.status).toBe("PASS");
  expect(result.manifest.mechanismDimensions.status).toBe("MEASURED");
  expect(result.manifest.mechanismDimensions.crankRadiusMm).toBeCloseTo(8, 6);
  expect(result.manifest.mechanismDimensions.rodLengthMm).toBeCloseTo(28, 6);
  const assertions = Object.fromEntries(assessAssemblyRequirements(contract, extracted.spec, result).map((item) => [item.id, item]));
  for (const id of ["crank-radius", "rod-length", "diametral-clearance"])
    expect(assertions[id].status, `${id}: ${JSON.stringify(assertions[id])}`).toBe("PASS");
  expect(result.manifest.evidence.rigidMotion.status).toBe("PASS");
  expect(result.manifest.evidence.sourceMotion.status).toBe("PASS");
  expect(result.manifest.evidence.motion.status).toBe("PASS");
  expect(result.manifest.evidence.assembly.status).toBe("PASS");
  expect(result.manifest.evidence.reconstruction.status).toBe("PASS");
}, 600000);

test("the four-joint piston-crank reaches A001 through the env-configured reconstruction budget", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const previous = process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS;
  process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS = "60000";
  try {
    // No explicit budget is passed: prepareContractAssembly must resolve the
    // same operations setting used by the product evidence/bundle routes.
    const prepare: typeof prepareContractAssembly = (input) => prepareContractAssembly({
      ...input,
      contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    });
    const [row] = await validateAssemblyArtifact({ inputRequest: request, scadSource }, prepare);
    expect(row.status, row.message).toBe("PASS");
    expect(row.passed).toBe(true);
    expect(row.message).toContain("Digital evidence only");
    const evidence = row.assemblyEvidence?.manifest.evidence;
    for (const id of ["identity", "topology", "reconstruction", "jointFrames", "assembly", "rigidMotion", "sourceMotion", "motion"])
      expect(evidence?.[id as keyof typeof evidence]?.status, id).toBe("PASS");
    const assertions = Object.fromEntries((row.assemblyEvidence?.requirements ?? []).map((item) => [item.id, item.status]));
    for (const id of ["crank-radius", "rod-length", "diametral-clearance", "motion-range-deg"])
      expect(assertions[id], id).toBe("PASS");
  } finally {
    if (previous === undefined) delete process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS;
    else process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS = previous;
  }
}, 600000);


test("the piston-crank bundle carries the four-joint A001 evidence with a configured budget", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const extracted = extractEmbeddedAssemblySpec(scadSource);
  if (extracted.status !== "valid") throw new Error(`declared piston crank is ${extracted.status}`);
  const contract = deriveRequirementContract({ request });
  const bundle = await buildAssemblyBundle({
    scadSource, spec: extracted.spec,
    contractSnapshot: { contract, request },
    contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    sourceSamplingSeed: "11223344556677889900aabbccddeeff",
    reconstructionBudgetMs: 60000,
    modifiedAt: new Date("2026-11-17T00:00:00Z"),
  });
  const layers = bundle.manifest.evidence;
  for (const id of ["identity", "topology", "reconstruction", "jointFrames", "assembly", "rigidMotion", "sourceMotion", "motion"])
    expect(layers[id as keyof typeof layers]?.status, `${id}: ${layers[id as keyof typeof layers]?.reason}`).toBe("PASS");
  expect(bundle.manifest.fits).toHaveLength(4);
  expect(bundle.manifest.mechanismDimensions.status).toBe("MEASURED");
  const files = unzipSync(new Uint8Array(bundle.zip));
  const readme = strFromU8(files["README.txt"]);
  expect(readme).toContain("- reconstruction: PASS");
  expect(readme).toContain("- jointFrames: PASS");
  expect(readme).toContain("- motion: PASS");
  expect(readme).toContain("- crank radius: 8.000 mm");
  expect(readme).toContain("- rod length: 28.000 mm");
}, 600000);
