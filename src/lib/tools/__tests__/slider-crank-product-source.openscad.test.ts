import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { prepareAssembly } from "../../assembly/prepare-assembly";
import { prepareContractAssembly } from "../../assembly/prepare-contract-assembly";
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
  return prepareContractAssembly({
    scadSource, spec: extracted.spec,
    contractSnapshot: { contract, request },
    contractGate: { evidenceCurrent: true, reason: "Researcher test confirmation; not a user decision." },
    sourceSamplingSeed: "11223344556677889900aabbccddeeff",
  });
}

test("product preparation derives slider-crank kinematics and carries rigid plus source motion evidence", async () => {
  const result = await prepare();
  expect(result.manifest.evidence.sourceMotion.status).toBe("PASS");
  expect(result.manifest.evidence.sourceMotion.reason).toContain("Source input verification PASS");
  expect(result.manifest.sourceMotion?.results).toHaveLength(5);
  expect(result.manifest.evidence.rigidMotion.status).toBe("PASS");
  expect(result.manifest.evidence.rigidMotion.reason).toContain("free of interference");
  expect(result.manifest.evidence.motion.status).toBe("PASS");
  expect(result.fits[0].status).toBe("PASS");
  expect(result.fits[0].measuredStatus).toBe("PASS");
  // Only the driven revolute has a fit requirement here; the other three
  // connections remain explicitly unmeasured rather than being assumed clear.
  expect(result.manifest.evidence.jointFrames.status).toBe("NOT_RUN");
  expect(result.manifest.evidence.jointFrames.reason).toContain("No measured axes for");
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
