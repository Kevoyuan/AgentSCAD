import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import { checkAssemblyReconstruction } from "../assembly-reconstruction";
import { renderScadToStlWasm } from "../openscad-wasm-runtime";
import { boxStl } from "../../geometry/__tests__/solids";
import { translationMatrix } from "../../assembly/path-and-motion";

const spec={schemaVersion:1,units:"mm",coordinateSystem:"right-handed",
  parts:[{id:"block",name:"Block",selector:"block",source:"generated",material:null}],
  instances:[0,1].map(x=>({id:`block${x}`,partId:"block",subassemblyId:null,transform:translationMatrix([x,0,0])})),
  subassemblies:[],connections:[],groundedInstanceId:null,motions:[],operations:[],manufacturing:null,assumptions:[],unknowns:[]};

test("official WASM evaluates Boolean reconstruction source and rejects a known volume mismatch",async()=>{
  // Actual checksum-verified WASM, not a stub. The adapter only moves the source
  // and returned binary STL across the existing runtime's string API.
  const render=async(source:string,output:string,definitions:Record<string,unknown>|undefined,options?:{signal?:AbortSignal})=>{
    const mesh=await renderScadToStlWasm(await fs.readFile(source,"utf8"),definitions,options?.signal);
    await fs.writeFile(output,mesh);return "";
  };
  const meshes={block:boxStl([0,0,0],[3,3,3])};
  const same=await checkAssemblyReconstruction({spec,meshes,assemblyMesh:boxStl([0,0,0],[4,3,3]),render});
  expect(same.status).toBe("PASS");expect(same.comparison).toBe("mesh-symmetric-difference");
  const different=await checkAssemblyReconstruction({spec,meshes,assemblyMesh:boxStl([0,0,0],[5,3,3]),render});
  expect(different.status).toBe("FAIL");expect(different.residualVolumeMm3).toBeCloseTo(9,5);
},60000);
