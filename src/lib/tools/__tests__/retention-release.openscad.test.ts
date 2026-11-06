import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderAssemblyParts } from "../assembly-part-renderer";
import { checkTranslationProbe } from "../../assembly/translation-probe";
import { checkRigidPosePath } from "../../assembly/rigid-pose-path";
import { rotationAboutAxis } from "../../assembly/path-and-motion";
import { checkPartConnectivity } from "../../assembly/part-connectivity";
import { checkPartIdentity } from "../../assembly/part-identity-check";

test("original two-part rigid stop allows an explicit rotate-then-withdraw release", async () => {
  const scadSource = await readFile("benchmarks/assembly/bayonet_retention.scad", "utf8");
  const artifacts = await renderAssemblyParts({ scadSource, parts: [{ partId: "support", selector: "support" }, { partId: "rotor", selector: "rotor" }, { partId: "all", selector: "all" }] });
  const parts = artifacts.filter(part => part.partId !== "all");
  const all = artifacts.find(part => part.partId === "all")!;
  expect(checkPartIdentity({ parts: parts.map(part => ({ ...part, selector: part.partId })), assemblyMesh: all }).status).toBe("PASS");
  const moving = parts.find(part => part.partId === "rotor")!.stl;
  const obstacles = { support: parts.find(part => part.partId === "support")!.stl };
  for (const part of parts) expect(checkPartConnectivity(part.stl).status).toBe("PASS");
  const workPoses = Array.from({ length: 19 }, (_, i) => rotationAboutAxis([0,0,0],[0,0,1],(-45+i*5)*Math.PI/180));
  const work = checkRigidPosePath({ moving, obstacles, poses: workPoses, maxTranslationStepMm: .25, maxRotationStepDeg: 5.001 });
  expect(work.status).toBe("PASS");
  for (const sign of [-1,1]) {
    const held = checkTranslationProbe({ moving, obstacles, translationMm: [0,0,sign*4], samples: 33, expected: "blocked" });
    expect(held.status).toBe("PASS");
    expect(held.reason).not.toContain("starting pose");
  }
  const poses = Array.from({ length: 19 }, (_, i) => rotationAboutAxis([0,0,0],[0,0,1],i*5*Math.PI/180));
  for (let i=1;i<=32;i++) { const pose=[...poses[18]]; pose[11]=i/8; poses.push(pose); }
  const release = checkRigidPosePath({ moving, obstacles, poses, maxTranslationStepMm: .25, maxRotationStepDeg: 5.001, requireSeparatedEnd: true });
  expect(release.status).toBe("PASS");
  expect(release.coverage).toContain("sampled");
  // Direct extraction must fail even though the deliberately unlocked path clears.
  const direct = checkTranslationProbe({ moving, obstacles, translationMm: [0,0,4], samples: 33, expected: "clear" });
  expect(direct.status).toBe("FAIL");
  // Independent necessary fit bounds for the rectangular lug and slot.
  // For |angle| <= 45°, its X projection is >= 6*cos(45°), above the 2.6 mm slot.
  expect(6/Math.sqrt(2)).toBeGreaterThan(2.6);
  // At 90°, the 2 x 6 mm lug fits the centred 2.6 x 6.6 mm opening.
  expect(2).toBeLessThan(2.6); expect(6).toBeLessThan(6.6);
}, 60000);
