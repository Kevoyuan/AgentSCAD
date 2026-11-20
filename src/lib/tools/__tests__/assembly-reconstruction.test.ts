import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import { checkAssemblyReconstruction } from "../assembly-reconstruction";
import { boxStl } from "../../geometry/__tests__/solids";
import { translationMatrix } from "../../assembly/path-and-motion";

const cube=boxStl([0,0,0],[2,3,4]);
const different=boxStl([0,0,0],[3,4,5]);
const declaration=()=>({schemaVersion:1,units:"mm",coordinateSystem:"right-handed",
  parts:[{id:"item",name:"Item",selector:"item",source:"generated",material:null}],
  instances:[{id:"one",partId:"item",subassemblyId:null,transform:translationMatrix([0,0,0])}],
  subassemblies:[],connections:[],groundedInstanceId:null,motions:[],operations:[],manufacturing:null,assumptions:[],unknowns:[]});

test("missing whole geometry or a purchased instance cannot count as reconstructed",async()=>{
  expect((await checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube}})).status).toBe("NOT_RUN");
  const spec=declaration();spec.parts[0].source="purchased";
  const missing=await checkAssemblyReconstruction({spec,meshes:{},assemblyMesh:cube});
  expect(missing.status).toBe("NOT_RUN");expect(missing.reason).toContain("purchased");
});

test("invalid topology and oversized placed instance counts are rejected before execution",async()=>{
  let calls=0;const render=async()=>{calls++;return "";};
  const broken=Buffer.from(cube.subarray(0,134));broken.writeUInt32LE(1,80);
  expect((await checkAssemblyReconstruction({spec:declaration(),meshes:{item:broken},assemblyMesh:cube,render})).status).toBe("ERROR");
  const large=Buffer.alloc(84+50001*50);large.writeUInt32LE(50001,80);
  expect((await checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube},assemblyMesh:large,render})).status).toBe("NOT_RUN");
  expect(calls).toBe(0);
});

test("an absent sentinel or render diagnostic cannot masquerade as empty difference",async()=>{
  const result=await checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube},assemblyMesh:different,
    render:async(_source,output)=>{await fs.writeFile(output,cube);return "";}});
  expect(result.status).toBe("ERROR");expect(result.reason).toContain("sentinel");
  const warning=await checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube},assemblyMesh:different,
    render:async()=>"WARNING: Ignoring unknown module rebuilt"});
  expect(warning.status).toBe("ERROR");
});

test("internal reconstruction timeout stays unmeasured and caller cancellation propagates",async()=>{
  const result=await checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube},assemblyMesh:different,budgetMs:15,
    render:async(_source,_output,_definitions,options)=>new Promise((_resolve,reject)=>{
      if(options?.signal?.aborted)reject(new Error("cancelled"));
      else options?.signal?.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true});
    })});
  expect(result.status).toBe("NOT_RUN");expect(result.reason).toContain("budget");
  const controller=new AbortController();controller.abort();
  await expect(checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube},assemblyMesh:cube,options:{signal:controller.signal}})).rejects.toThrow();
});

test("an exact oriented triangle match needs no Boolean and claims no measured volume",async()=>{
  const result=await checkAssemblyReconstruction({spec:declaration(),meshes:{item:cube},assemblyMesh:cube,
    render:async()=>{throw new Error("No Boolean should execute");}});
  expect(result.status).toBe("PASS");expect(result.comparison).toBe("exact-oriented-triangles");
  expect(result.residualVolumeMm3).toBeNull();expect(result.differenceSha256).toBeNull();
});
