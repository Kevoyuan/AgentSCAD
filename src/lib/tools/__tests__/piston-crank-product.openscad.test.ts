import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { prepareContractAssembly } from "../../assembly/prepare-contract-assembly";
import { deriveRequirementContract } from "../../requirements/extract-requirements";
import { assessAssemblyRequirements } from "../../validation/assembly-requirement-assertions";

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
  // These are the remaining honest gaps: the current assembly still collides at
  // the -45° endpoint and source/reconstruction evidence is budget-limited.
  expect(result.manifest.evidence.rigidMotion.status).toBe("FAIL");
  expect(result.manifest.evidence.sourceMotion.status).not.toBe("PASS");
  expect(result.manifest.evidence.reconstruction.status).not.toBe("PASS");
}, 600000);
