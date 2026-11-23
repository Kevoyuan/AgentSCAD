import { expect, test } from "bun:test";
import { checkAssemblyReconstruction } from "../assembly-reconstruction";
import { renderAssemblyParts } from "../assembly-part-renderer";
import { translationMatrix } from "../../assembly/path-and-motion";
import { buildAssemblyBundle } from "../../assembly/assembly-bundle";
import { reconstructAssemblyBundle } from "../../assembly/reconstruct-assembly-bundle";

const spec = (parts: string[], instances: Array<{id:string;partId:string;transform:number[]}>) => ({
  schemaVersion:1,units:"mm",coordinateSystem:"right-handed",
  parts:parts.map(id=>({id,name:id,selector:id,source:"generated",material:null})),
  instances:instances.map(instance=>({...instance,subassemblyId:null})),
  subassemblies:[],connections:[],groundedInstanceId:null,motions:[],operations:[],manufacturing:null,assumptions:[],unknowns:[],
});

test("native reconstruction and the exported ZIP match an independent pose of repeated instances", async () => {
  const scad = `agentscad_part="all";
    pose_shift=0;
    module item(){cube([2,3,4]);}
    if(agentscad_part=="item") item(); else {translate([4+pose_shift,5,6]) item();translate([-7,3,2])rotate([0,0,90])item();}`;
  const rendered = await renderAssemblyParts({scadSource:scad,parts:[{partId:"item",selector:"item"},{partId:"all",selector:"all"}]});
  const rotated = [0,-1,0,-7,1,0,0,3,0,0,1,2,0,0,0,1];
  const declaration=spec(["item"],[{id:"one",partId:"item",transform:translationMatrix([4,5,6])},{id:"two",partId:"item",transform:rotated}]);
  const result=await checkAssemblyReconstruction({spec:declaration,meshes:{item:rendered[0].stl},assemblyMesh:rendered[1].stl});
  expect(result.status).toBe("PASS");
  expect(result.instanceIds).toEqual(["one","two"]);
  expect(result.residualTriangles).toBe(0);

  const bundle = await buildAssemblyBundle({ scadSource: scad, spec: declaration });
  const correct = reconstructAssemblyBundle({ zip: bundle.zip, referenceStl: rendered[1].stl }).report;
  expect(correct.archiveIntegrity).toBe("PASS");
  expect(correct.reconstruction).toBe("COMPLETE");
  expect(correct.instances.map(instance => instance.id)).toEqual(["one", "two"]);
  expect(correct.reference.status).toBe("PASS");
  expect(correct.reference.artifactSha256).toBe(rendered[1].sha256);

  const [wrongPose] = await renderAssemblyParts({
    scadSource: scad,
    parts: [{ partId: "all", selector: "all" }],
    parameters: { pose_shift: 1 },
  });
  const wrong = reconstructAssemblyBundle({ zip: bundle.zip, referenceStl: wrongPose.stl }).report;
  expect(wrong.archiveIntegrity).toBe("PASS");
  expect(wrong.reference.status).toBe("FAIL");
  expect(wrong.reference.bboxErrorMm).toBeCloseTo(1);
},30000);

test("equal bounds and volume cannot hide a misplaced exported part", async () => {
  const scad=`agentscad_part="all"; module base(){cube([10,10,1]);} module item(){cube([1,2,3]);}
    if(agentscad_part=="base")base();else if(agentscad_part=="item")item();else{base();translate([5,3,3])item();}`;
  const rendered=await renderAssemblyParts({scadSource:scad,parts:[{partId:"base",selector:"base"},{partId:"item",selector:"item"},{partId:"all",selector:"all"}]});
  const declaration=spec(["base","item"],[{id:"base1",partId:"base",transform:translationMatrix([0,0,0])},{id:"item1",partId:"item",transform:translationMatrix([3,3,3])}]);
  const result=await checkAssemblyReconstruction({spec:declaration,meshes:{base:rendered[0].stl,item:rendered[1].stl},assemblyMesh:rendered[2].stl});
  expect(result.status).toBe("FAIL");
  expect(result.residualVolumeMm3).toBeCloseTo(12,5);
},30000);

test("overlapping placed exports are compared as a solid union rather than triangle soup", async () => {
  const scad=`agentscad_part="all";if(agentscad_part=="item")cube(3);else union(){cube(3);translate([1,0,0])cube(3);}`;
  const rendered=await renderAssemblyParts({scadSource:scad,parts:[{partId:"item",selector:"item"},{partId:"all",selector:"all"}]});
  const result=await checkAssemblyReconstruction({spec:spec(["item"],[{id:"one",partId:"item",transform:translationMatrix([0,0,0])},{id:"two",partId:"item",transform:translationMatrix([1,0,0])}]),meshes:{item:rendered[0].stl},assemblyMesh:rendered[1].stl});
  expect(result.status).toBe("PASS");
},30000);

test("normal bundle exports bind measured reconstruction and preserve the contract gate",async()=>{
  const source=`agentscad_part="all";module a(){cube([2,3,4]);}module b(){cube([1,2,1]);}
    if(agentscad_part=="a")a();else if(agentscad_part=="b")b();else{translate([10,20,30])a();translate([15,20,30])b();}`;
  const declaration=spec(["a","b"],[{id:"a1",partId:"a",transform:translationMatrix([10,20,30])},{id:"b1",partId:"b",transform:translationMatrix([15,20,30])}]);
  const passed=await buildAssemblyBundle({scadSource:source,spec:declaration,contractGate:{evidenceCurrent:true}});
  expect(passed.manifest.evidence.reconstruction.status).toBe("PASS");
  expect(passed.manifest.evidence.identity.status).toBe("PASS");
  expect(passed.manifest.reconstruction.partSha256.a).toBe(passed.parts.find(part=>part.partId==="a")!.sha256);
  const unconfirmed=await buildAssemblyBundle({scadSource:source,spec:declaration,contractGate:{evidenceCurrent:false}});
  expect(unconfirmed.manifest.evidence.reconstruction.status).toBe("NOT_RUN");
  expect(unconfirmed.manifest.reconstruction.status).toBe("NOT_RUN");
  expect(unconfirmed.manifest.reconstruction.measuredStatus).toBe("PASS");
  declaration.instances[1].transform=translationMatrix([16,20,30]);
  const touching=await buildAssemblyBundle({scadSource:source,spec:declaration,contractGate:{evidenceCurrent:false}});
  // Adjacent pieces of a symmetric difference can leave a nonmanifold contact
  // sheet. Keep the diagnostic; never reinterpret a tool limitation as PASS.
  expect(touching.manifest.evidence.reconstruction.status).toBe("ERROR");
  expect(touching.manifest.reconstruction.diagnostics).toContain("2-manifold");
  declaration.instances[1].transform=translationMatrix([17,20,30]);
  const failed=await buildAssemblyBundle({scadSource:source,spec:declaration,contractGate:{evidenceCurrent:false}});
  expect(failed.manifest.evidence.reconstruction.status).toBe("FAIL");
  expect(failed.manifest.reconstruction.measuredStatus).toBe("FAIL");
},30000);
