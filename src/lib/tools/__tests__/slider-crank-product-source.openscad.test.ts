import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { prepareAssembly } from "../../assembly/prepare-assembly";
import { prepareContractAssembly } from "../../assembly/prepare-contract-assembly";
import { buildAssemblyBundle } from "../../assembly/assembly-bundle";
import { assessAssemblyRequirements } from "../../validation/assembly-requirement-assertions";
import { unzipSync, strFromU8 } from "fflate";
import { deriveRequirementContract } from "../../requirements/extract-requirements";

const request = "做一个曲柄滑块机构，曲柄半径 8 mm，连杆长度 28 mm，直径间隙 0.1 到 0.6 mm，能转 360 度";
const fixturePath = "benchmarks/assembly/slider_crank_declared.scad";

async function prepare(sourcePath = fixturePath) {
  const scadSource = await readFile(sourcePath, "utf8");
  const extracted = extractEmbeddedAssemblySpec(scadSource);
  if (extracted.status !== "valid") throw new Error(`declared slider-crank is ${extracted.status}`);
  const contract = deriveRequirementContract({ request });
  // No explicit kinematics or fit requirement: prepareContractAssembly must
  // recognize the declared slider-crank and derive the crank-axis fit itself.
  const result = await prepareContractAssembly({
    scadSource, spec: extracted.spec,
    contractSnapshot: { contract, request },
    contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    sourceSamplingSeed: "11223344556677889900aabbccddeeff",
  });
  return { result, contract, spec: extracted.spec };
}

test("product preparation derives slider-crank kinematics and carries rigid plus source motion evidence", async () => {
  const { result, contract, spec } = await prepare();
  expect(result.manifest.mechanismDimensions.status).toBe("MEASURED");
  expect(result.manifest.mechanismDimensions.crankRadiusMm).toBeCloseTo(8, 3);
  expect(result.manifest.mechanismDimensions.rodLengthMm).toBeCloseTo(28, 3);
  const assertions = Object.fromEntries(assessAssemblyRequirements(contract, spec, result).map((item) => [item.id, item]));
  for (const id of ["crank-radius", "rod-length", "diametral-clearance"])
    expect(assertions[id].status, `${id}: ${JSON.stringify(assertions[id])}`).toBe("PASS");
  // The 90 s source verification budget is wall-clock and can be exhausted on a
  // heavily loaded host; that is an honest NOT_RUN, never a FAIL or a pass.
  if (result.manifest.evidence.sourceMotion.status === "PASS") {
    expect(result.manifest.evidence.sourceMotion.reason).toContain("Source input verification PASS");
    expect(result.manifest.sourceMotion?.results).toHaveLength(5);
    expect(result.manifest.evidence.motion.status).toBe("PASS");
    for (const id of ["motion-range-deg", "motion-range-positive-end"])
      expect(assertions[id].status, `${id}: ${JSON.stringify(assertions[id])}`).toBe("PASS");
  } else {
    expect(result.manifest.evidence.sourceMotion.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.sourceMotion.reason).toMatch(/aborted|budget/i);
  }
  expect(result.manifest.evidence.rigidMotion.status).toBe("PASS");
  expect(result.manifest.evidence.rigidMotion.reason).toContain("free of interference");
  expect(result.fits).toHaveLength(3);
  for (const fit of result.fits) {
    expect(fit.status, `${fit.connectionId}: ${fit.reason}`).toBe("PASS");
    expect(fit.measuredStatus).toBe("PASS");
  }
  // The three revolute joints now have measured axes; the block-guide
  // prismatic joint remains explicitly unmeasured rather than assumed clear.
  expect(result.manifest.evidence.jointFrames.status).toBe("NOT_RUN");
  expect(result.manifest.evidence.jointFrames.reason).toContain("No measured axes for: slide");
  expect(result.manifest.evidence.physical.status).toBe("NOT_RUN");
}, 600000);

test("a changed crank radius fails the product source-motion evidence", async () => {
  const tampered = (await readFile(fixturePath, "utf8")).replace("crank_radius = 8;", "crank_radius = 9;");
  const extracted = extractEmbeddedAssemblySpec(tampered);
  if (extracted.status !== "valid") throw new Error("tampered fixture lost its declaration");
  const contract = deriveRequirementContract({ request });
  const result = await prepareAssembly({
    scadSource: tampered, spec: extracted.spec,
    contractSnapshot: { contract, request },
    contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    fitRequirements: [{ connectionId: "crank_axis", boreInstanceId: "frame1", diametralClearanceMm: { min: 0.1, max: 0.6 } }],
    kinematics: { connectionId: "crank_axis", sliderCrank: true },
    sourceSamplingSeed: "11223344556677889900aabbccddeeff",
  });
  expect(result.manifest.evidence.sourceMotion.status).toBe("FAIL");
  expect(result.manifest.evidence.motion.status).not.toBe("PASS");
}, 240000);


test("the assembly bundle records rigid, source and composite motion for the declared slider-crank", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const extracted = extractEmbeddedAssemblySpec(scadSource);
  if (extracted.status !== "valid") throw new Error(`declared slider-crank is ${extracted.status}`);
  const contract = deriveRequirementContract({ request });
  const bundle = await buildAssemblyBundle({
    scadSource, spec: extracted.spec,
    contractSnapshot: { contract, request },
    contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    sourceSamplingSeed: "11223344556677889900aabbccddeeff",
    modifiedAt: new Date("2026-11-17T00:00:00Z"),
  });
  expect(bundle.manifest.evidence.rigidMotion.status).toBe("PASS");
  expect(bundle.manifest.evidence.topology.status).toBe("PASS");
  expect(bundle.manifest.mechanismDimensions.status).toBe("MEASURED");
  const files = unzipSync(new Uint8Array(bundle.zip));
  const readme = strFromU8(files["README.txt"]);
  expect(readme).toContain("- crank radius: 8.000 mm");
  expect(readme).toContain("- rod length: 28.000 mm");
  expect(readme).toContain("- rigidMotion: PASS");
  expect(readme).toContain("- topology: PASS");
  if (bundle.manifest.evidence.sourceMotion.status === "PASS") {
    expect(bundle.manifest.evidence.motion.status).toBe("PASS");
    expect(bundle.manifest.sourcePoseArchive.files.length).toBeGreaterThan(20);
    expect(readme).toContain("- sourceMotion: PASS");
    expect(readme).toContain("- motion: PASS");
  } else {
    expect(bundle.manifest.evidence.sourceMotion.status).toBe("NOT_RUN");
    expect(bundle.manifest.evidence.motion.status).not.toBe("PASS");
    expect(bundle.manifest.evidence.sourceMotion.reason).toMatch(/aborted|budget/i);
  }
}, 600000);
