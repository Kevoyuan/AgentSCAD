import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { sampleSliderCrankSource } from "../slider-crank-measurement";
import setup from "../../../../scripts/eval/assembly-fixtures/slider-crank-geometry.json";

test("actual regenerated crank, rod and slider contours follow the frozen oracle", async () => {
  const scadSource = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const result = await sampleSliderCrankSource({ ...setup, scadSource });
  expect(result.status, JSON.stringify(result.samples)).toBe("PASS");
  expect(result.samples).toHaveLength(9);
  for (const sample of result.samples) {
    expect(sample.status).toBe("PASS");
    if ("maxErrorMm" in sample) expect(sample.maxErrorMm!).toBeLessThan(0.02);
  }
  expect(result.collision.status, JSON.stringify(result.collision.samples)).toBe("PASS");
  expect(result.collision.samples.every(s => s.pairs?.length === 6)).toBe(true);
  // Cross-pose evidence: the radius and axis come from the circle the pin
  // traces, the rod has to keep one length, and the pins have to stay on +Y.
  expect(result.motion?.status, JSON.stringify(result.motion)).toBe("PASS");
  expect(result.motion!.crank!.radiusMm).toBeCloseTo(8, 2);
  expect(result.motion!.crank!.residualMm).toBeLessThan(0.02);
  expect(result.motion!.rodLengthMm!.spread).toBeLessThan(0.02);
  expect(result.motion!.axisDriftMm).toBeLessThan(0.02);
  expect(result.motion!.coverage.poses).toBe(9);
  expect(result.motion!.axisCheck.performed).toBe(true);
  expect(result.physical.status).toBe("NOT_RUN");
}, 120000);

test("an idle variable and a coarser mesh leave the cross-pose verdict unchanged", async () => {
  const source = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  // `unused_label` is never read and $fn only changes tessellation of the same
  // circles. Neither is a geometric parameter, so neither may move the verdict.
  const injected = source.replace("$fn = 64;", "unused_label = 42;\n$fn = 48;");
  expect(injected).not.toBe(source);
  const result = await sampleSliderCrankSource({ ...setup, scadSource: injected, angles: [0, 60, 120, 180, 240, 300] });
  expect(result.motion?.status, JSON.stringify(result.motion)).toBe("PASS");
  expect(result.motion!.crank!.radiusMm).toBeCloseTo(8, 2);
  expect(result.motion!.rodLengthMm!.spread).toBeLessThan(0.02);
}, 120000);

test("a changed crank radius is measured from the trace, not read from the source", async () => {
  const source = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const injected = source.replace("crank_radius = 8;", "crank_radius = 9;");
  expect(injected).not.toBe(source);
  const result = await sampleSliderCrankSource({ ...setup, scadSource: injected, angles: [0, 60, 120, 180, 240, 300] });
  expect(result.motion?.status, JSON.stringify(result.motion)).toBe("FAIL");
  expect(result.motion!.crank!.radiusMm).toBeCloseTo(9, 2);
  expect(result.motion!.failures.some(failure => failure.includes("traces a circle of 9"))).toBe(true);
}, 120000);

test("a crank turning about the wrong axis is refused, not passed", async () => {
  const source = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const injected = source.replace(
    'if (id == "crank") rotate([0, placed ? motion_angle : 0, 0]) crank_local();',
    'if (id == "crank") rotate([placed ? motion_angle : 0, 0, 0]) crank_local();',
  );
  expect(injected).not.toBe(source);
  const result = await sampleSliderCrankSource({ ...setup, scadSource: injected, angles: [0, 60, 120, 180, 240, 300] });
  expect(result.motion?.status).not.toBe("PASS");
  expect(result.status).not.toBe("PASS");
}, 120000);

test("an unused motion parameter and an uncoupled rod cannot pass mesh-based motion checks", async () => {
  const source = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const staticSource = source.replaceAll("sin(motion_angle)", "sin(0)")
    .replaceAll("cos(motion_angle)", "cos(0)")
    .replace("placed ? motion_angle : 0", "0");
  const frozen = await sampleSliderCrankSource({ ...setup, scadSource: staticSource, angles: [90] });
  expect(frozen.status, JSON.stringify(frozen.samples)).toBe("FAIL");
  const wrongRod = await sampleSliderCrankSource({ ...setup,
    scadSource: source.replace("rod_angle = atan2(-cx, travel);", "rod_angle = 0;"), angles: [90] });
  expect(wrongRod.status, JSON.stringify(wrongRod.samples)).toBe("FAIL");
  const observed = wrongRod.samples[0];
  expect("couplingErrorMm" in observed && observed.couplingErrorMm! > 1).toBe(true);
  const shifted = await sampleSliderCrankSource({ ...setup,
    scadSource: source.replace('if (id == "crank") rotate', 'if (id == "crank") translate([1, 0, 0]) rotate'), angles: [90] });
  expect(shifted.status, JSON.stringify(shifted.samples)).toBe("FAIL");
  expect(shifted.collision.status).toBe("FAIL");
}, 120000);

test("correct landmarks do not hide a missing bearing hole in the frame", async () => {
  const source = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const result = await sampleSliderCrankSource({ ...setup, angles: [0],
    scadSource: source.replace("translate([0, -10.1, 0]) y_cylinder(2.2, 4.2);", "") });
  expect(result.landmarkStatus, JSON.stringify(result.samples)).toBe("PASS");
  expect(result.status).toBe("FAIL");
  expect(result.collision.status).toBe("FAIL");
}, 120000);

 test("one valid pose is incomplete motion evidence", async () => {
  const scadSource = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const result = await sampleSliderCrankSource({ ...setup, scadSource, angles: [0] });
  expect(result.landmarkStatus).toBe("PASS");
  expect(result.collision.status).toBe("PASS");
  expect(result.motion?.status).toBe("NOT_RUN");
  expect(result.status).toBe("NOT_RUN");
}, 120000);

test("actual slider-crank removal order is checked against the remaining meshes", async () => {
  const { renderAssemblyParts } = await import("../assembly-part-renderer");
  const { checkDisassemblySequence } = await import("../../assembly/disassembly-sequence");
  const plan = JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-disassembly.json", "utf8"));
  const scadSource = await readFile("benchmarks/assembly/slider_crank.scad", "utf8");
  const parts = await renderAssemblyParts({ scadSource,
    parameters: { agentscad_pose: true, motion_angle: 0 },
    parts: ["frame", "crank", "rod", "slider"].map(id => ({ partId: id, selector: id })),
  });
  const meshes = Object.fromEntries(parts.map(p => [p.partId, p.stl]));
  const good = checkDisassemblySequence({ meshes, plan });
  expect(good.status).toBe("PASS");
  expect(good.results.map(r => r.samplesEvaluated)).toEqual([81, 81, 81]);
  expect(good.remainingInstanceIds).toEqual(["frame"]);
  const wrong = checkDisassemblySequence({ meshes, plan: { ...plan, steps: [plan.steps[1], plan.steps[0], plan.steps[2]] } });
  expect(wrong.status).toBe("FAIL");
  expect(wrong.results[0].blockedAt?.otherInstanceId).toBe("slider");
  expect(wrong.results.slice(1).every(r => r.status === "NOT_RUN")).toBe(true);
  expect(good.physical.status).toBe("NOT_RUN");
}, 120000);

test("eccentric key is included in motion collision checks and must precede rod removal", async () => {
  const { checkDisassemblySequence } = await import("../../assembly/disassembly-sequence");
  const source = await readFile("benchmarks/assembly/slider_crank_keyed.scad", "utf8");
  const keyedSetup = JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-keyed-geometry.json", "utf8"));
  const plan = JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-keyed-disassembly.json", "utf8"));
  const wrongPlan = JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-keyed-wrong-order.json", "utf8"));
  let zeroMeshes: Record<string, Buffer> = {};
  const motion = await sampleSliderCrankSource({ ...keyedSetup, scadSource: source, angles: [0, 90, 180, 270],
    onArtifacts: async (angle, parts) => {
      if (angle === 0) zeroMeshes = Object.fromEntries(parts.map(p => [p.partId, p.stl]));
    },
  });
  expect(motion.status, JSON.stringify(motion.collision)).toBe("PASS");
  expect(motion.collision.samples.every(s => s.pairs?.length === 10)).toBe(true);
  expect(Object.keys(zeroMeshes)).toHaveLength(5);
  const good = checkDisassemblySequence({ meshes: zeroMeshes, plan });
  expect(good.status).toBe("PASS");
  const blocked = checkDisassemblySequence({ meshes: zeroMeshes, plan: wrongPlan });
  expect(blocked.status).toBe("FAIL");
  expect(blocked.results[1].blockedAt?.otherInstanceId).toBe("eccentric_key");
  expect(blocked.results[1].blockedAt!.fraction).toBeGreaterThan(0);
  expect(blocked.results[2].status).toBe("NOT_RUN");
}, 120000);

test("guided slider blocks lateral withdrawal while retaining its sampled working stroke", async () => {
  const { renderAssemblyParts } = await import("../assembly-part-renderer");
  const { checkTranslationProbe } = await import("../../assembly/translation-probe");
  const { checkDisassemblySequence, removalSequenceFromSpec } = await import("../../assembly/disassembly-sequence");
  const { extractEmbeddedAssemblySpec } = await import("../../assembly/embedded-spec");
  const source = await readFile("benchmarks/assembly/slider_crank_guided.scad", "utf8");
  const embedded = extractEmbeddedAssemblySpec(source);
  expect(embedded.status).toBe("valid");
  if (embedded.status !== "valid") return;
  const parts = await renderAssemblyParts({ scadSource:source,
    parameters:{agentscad_pose:true,motion_angle:0},parts:embedded.spec.parts.map(p=>({partId:p.id,selector:p.selector})) });
  const meshes = Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  const obstacles = {frame:meshes.frame,guide_front:meshes.guide_front};
  for(const translationMm of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]] as Array<[number,number,number]>) {
    const result=checkTranslationProbe({moving:meshes.slider,obstacles,translationMm,samples:21,expected:"blocked"});
    expect(result.status,JSON.stringify(result)).toBe("PASS");
  }
  expect(checkTranslationProbe({moving:meshes.slider,obstacles,translationMm:[0,0,-16],samples:65,expected:"clear"}).status).toBe("PASS");
  expect(checkTranslationProbe({moving:meshes.slider,obstacles:{frame:meshes.frame},translationMm:[0,1,0],samples:21,expected:"blocked"}).status).toBe("FAIL");
  const plan=removalSequenceFromSpec(embedded.spec);
  expect(checkDisassemblySequence({meshes,plan}).status).toBe("PASS");
  const wrong=JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-guided-wrong-order.json","utf8"));
  const blocked=checkDisassemblySequence({meshes,plan:wrong});
  expect(blocked.status).toBe("FAIL");
  expect(blocked.results.find(r=>r.status==='FAIL')?.blockedAt?.otherInstanceId).toBe("guide_front");
},120000);

test("main shaft key is carried into the frame stop and shares one manufacturing design", async () => {
  const { renderAssemblyParts } = await import("../assembly-part-renderer");
  const { checkTranslationProbe } = await import("../../assembly/translation-probe");
  const { extractEmbeddedAssemblySpec } = await import("../../assembly/embedded-spec");
  const { checkReconstructedMesh } = await import("../../assembly/reconstructed-mesh-check");
  const { translationMatrix } = await import("../../assembly/path-and-motion");
  const source=await readFile("benchmarks/assembly/slider_crank_shaft_keyed.scad","utf8");
  const embedded=extractEmbeddedAssemblySpec(source);
  expect(embedded.status).toBe("valid");if(embedded.status!=="valid")return;
  expect(embedded.spec.parts).toHaveLength(7);
  expect(embedded.spec.instances.filter(i=>i.partId==='eccentric_key')).toHaveLength(2);
  expect(embedded.spec.instances.filter(i=>i.partId==='guide_lock')).toHaveLength(2);
  const parts=await renderAssemblyParts({scadSource:source,parameters:{agentscad_pose:true,motion_angle:0},parts:embedded.spec.instances.map(i=>({partId:i.id,selector:i.id}))});
  const meshes=Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  expect(checkReconstructedMesh({local:meshes.eccentric_key,posed:meshes.main_key,transform:translationMatrix([0,-16,-8])}).status).toBe("PASS");
  for(const direction of [-1,1]) {
    const probe=checkTranslationProbe({moving:meshes.crank,companions:{main_key:meshes.main_key},obstacles:{frame:meshes.frame},translationMm:[0,3*direction,0],samples:61,expected:"blocked"});
    expect(probe.status,JSON.stringify(probe)).toBe("PASS");
  }
  expect(checkTranslationProbe({moving:meshes.crank,obstacles:{frame:meshes.frame},translationMm:[0,3,0],samples:61,expected:"blocked"}).status).toBe("FAIL");
},120000);

test("guide retainers must be turned and pulled before the guide can leave", async () => {
  const { renderAssemblySpecParts } = await import("../assembly-part-renderer");
  const { extractEmbeddedAssemblySpec } = await import("../../assembly/embedded-spec");
  const { checkDeclaredPoseDisassembly } = await import("../../assembly/declared-pose-disassembly");
  const source=await readFile("benchmarks/assembly/slider_crank_shaft_keyed.scad","utf8");
  const embedded=extractEmbeddedAssemblySpec(source);
  expect(embedded.status).toBe("valid");if(embedded.status!=="valid")return;
  const {parts}=await renderAssemblySpecParts(source,embedded.spec);
  const meshes=Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  const good=checkDeclaredPoseDisassembly({spec:embedded.spec,meshes});
  expect(good.status,JSON.stringify(good)).toBe("PASS");
  expect(good.results.filter(r=>r.instanceId.startsWith("guide_lock")).every(r=>r.status==="PASS")).toBe(true);

  // The guide cannot leave while both retainers are still seated.
  const guideFirst=structuredClone(embedded.spec);
  const guideIndex=guideFirst.operations.findIndex(o=>o.instanceId==="guide_front");
  const [guide]=guideFirst.operations.splice(guideIndex,1);
  guideFirst.operations.unshift(guide);
  const blockedGuide=checkDeclaredPoseDisassembly({spec:guideFirst,meshes});
  expect(blockedGuide.status).toBe("FAIL");
  const guidePath=blockedGuide.results[0].path;
  expect(guidePath && "blockedAt" in guidePath ? guidePath.blockedAt?.obstacleId : undefined).toBe("guide_lock_right");

  // Pulling a locked retainer straight out hits the wall; only the turn frees it.
  const straight=structuredClone(embedded.spec);
  const lock=straight.operations.find(o=>o.instanceId==="guide_lock_right")!;
  const start=lock.waypoints[0];
  const end=[...start];end[7]+=5;
  lock.waypoints=[start,end] as typeof lock.waypoints;
  const blockedLock=checkDeclaredPoseDisassembly({spec:straight,meshes});
  expect(blockedLock.status).toBe("FAIL");
  const lockPath=blockedLock.results[0].path;
  expect(lockPath && "blockedAt" in lockPath ? lockPath.blockedAt?.obstacleId : undefined).toBe("frame");
},120000);

test("seated quarter-turn capture requires lift, rotation and translation in order", async () => {
  const { renderAssemblyParts } = await import("../assembly-part-renderer");
  const { checkRigidPosePath } = await import("../../assembly/rigid-pose-path");
  const { quarterTurnPath } = await import("../../../../scripts/eval/assembly-fixtures/quarter-turn-paths");
  const scadSource=await readFile("benchmarks/assembly/quarter_turn_seated.scad","utf8");
  const parts=await renderAssemblyParts({scadSource,parameters:{agentscad_pose:true,lock_angle:90},parts:[{partId:"pin",selector:"pin"},{partId:"sleeve",selector:"sleeve"}]});
  const meshes=Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  const options={moving:meshes.pin,obstacles:{sleeve:meshes.sleeve},maxTranslationStepMm:0.151,maxRotationStepDeg:5.001};
  const releasePath=quarterTurnPath(-90,1);
  expect(checkRigidPosePath({...options,poses:releasePath,requireSeparatedEnd:true}).status).toBe("PASS");
  expect(checkRigidPosePath({...options,poses:[...releasePath].reverse()}).status).toBe("PASS");
  for(const poses of [quarterTurnPath(0),quarterTurnPath(-90),quarterTurnPath(-45,1)]) {
    const result=checkRigidPosePath({...options,poses,requireSeparatedEnd:true});
    expect(result.status).toBe("FAIL");
    expect("blockedAt" in result && result.blockedAt.poseIndex).toBeGreaterThan(0);
  }
},120000);

test("embedded quarter-turn operations execute on local manufacturing meshes", async () => {
  const { extractEmbeddedAssemblySpec } = await import("../../assembly/embedded-spec");
  const { renderAssemblySpecParts } = await import("../assembly-part-renderer");
  const { checkDeclaredPoseDisassembly } = await import("../../assembly/declared-pose-disassembly");
  const { quarterTurnPath } = await import("../../../../scripts/eval/assembly-fixtures/quarter-turn-paths");
  const { multiplyMatrices } = await import("../../assembly/path-and-motion");
  const source=await readFile("benchmarks/assembly/quarter_turn_seated.scad","utf8");
  const embedded=extractEmbeddedAssemblySpec(source);
  expect(embedded.status).toBe("valid");if(embedded.status!=="valid")return;
  const {parts}=await renderAssemblySpecParts(source,embedded.spec);
  const meshes=Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  const actual=checkDeclaredPoseDisassembly({spec:embedded.spec,meshes});
  expect(actual.status,JSON.stringify(actual)).toBe("PASS");
  expect(actual.results[0].path?.posesEvaluated).toBe(116);
  const wrong=structuredClone(embedded.spec);
  const start=wrong.instances.find(i=>i.id==='pin')!.transform;
  wrong.operations[0].waypoints=quarterTurnPath(-90).map(p=>multiplyMatrices(p,start)) as typeof wrong.operations[0]['waypoints'];
  expect(checkDeclaredPoseDisassembly({spec:wrong,meshes}).status).toBe("FAIL");
},120000);
