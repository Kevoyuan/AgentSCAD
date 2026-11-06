import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateAssemblySpec } from "../assembly/assembly-spec";
import type { prepareContractAssembly } from "../assembly/prepare-contract-assembly";
import { deriveRequirementContract } from "../requirements/extract-requirements";
import { assessAssemblyRequirements } from "./assembly-requirement-assertions";

const contract = deriveRequirementContract({ request: "两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆" });
const specFile = "scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json";
type Prepared = Awaited<ReturnType<typeof prepareContractAssembly>>;

test("requirements use the candidate's own export, fit and sampled motion evidence", async () => {
  const spec = validateAssemblySpec(JSON.parse(await readFile(specFile, "utf8")));
  expect(spec.success).toBe(true);
  if (!spec.success) return;
  const prepared = {
    parts: [{}, {}], manifest: { evidence: { identity: { status: "PASS", reason: "distinct" }, motion: { status: "PASS", reason: "sampled" } } },
    kinematics: { motion: { status: "PASS", rangeDeg: { min: -45, max: 45 } } },
    fits: [{ connectionId: "hinge", status: "PASS", measuredStatus: "PASS", diametralClearanceMm: { min: 0.39, max: 0.42 }, stationsMm: [-4, 0, 4] }],
  } as unknown as Prepared;
  const results = (candidate: Prepared) => Object.fromEntries(assessAssemblyRequirements(contract, spec.data, candidate).map(item => [item.id, item]));
  const good = results(prepared);
  for (const id of ["distinct-exported-parts", "motion-range-deg", "motion-range-negative-end", "motion-range-positive-end", "diametral-clearance"])
    expect(good[id].status).toBe("PASS");
  expect(good["motion-range-deg"].reason).toContain("does not prove continuous clearance");

  const missingPart = results({ ...prepared, parts: prepared.parts.slice(0, 1) });
  expect(missingPart["distinct-exported-parts"].status).toBe("FAIL");
  const unresolvedIdentity = results({ ...prepared, manifest: { ...prepared.manifest, evidence: { ...prepared.manifest.evidence, identity: { status: "NOT_RUN", reason: "not confirmed" } } } });
  expect(unresolvedIdentity["distinct-exported-parts"].status).toBe("NOT_RUN");

  const narrow = results({ ...prepared, kinematics: { ...prepared.kinematics!, motion: { ...prepared.kinematics!.motion, rangeDeg: { min: -30, max: 45 } } } });
  expect(narrow["motion-range-negative-end"].status).toBe("FAIL");
  expect(narrow["motion-range-positive-end"].status).toBe("PASS");
  const collision = results({ ...prepared, manifest: { ...prepared.manifest, evidence: { ...prepared.manifest.evidence, motion: { status: "FAIL", reason: "collision" } } } });
  expect(collision["motion-range-negative-end"].status).toBe("NOT_RUN");

  expect(results({ ...prepared, fits: [] })["diametral-clearance"].status).toBe("NOT_RUN");
  const straddles = results({ ...prepared, fits: [{ ...prepared.fits[0], diametralClearanceMm: { min: 0.34, max: 0.42 } }] });
  expect(straddles["diametral-clearance"].status).toBe("ERROR");
  const tooWide = results({ ...prepared, fits: [{ ...prepared.fits[0], diametralClearanceMm: { min: 0.46, max: 0.5 } }] });
  expect(tooWide["diametral-clearance"].status).toBe("FAIL");
  const unconfirmed = results({ ...prepared, fits: [{ ...prepared.fits[0], status: "NOT_RUN", reason: "not confirmed" }] });
  expect(unconfirmed["diametral-clearance"].status).toBe("NOT_RUN");
});
