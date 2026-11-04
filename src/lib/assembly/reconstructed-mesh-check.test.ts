import { expect, test } from "bun:test";
import { boxStl, mergeStl } from "../geometry/__tests__/solids";
import { checkReconstructedMesh } from "./reconstructed-mesh-check";
import { translationMatrix } from "./path-and-motion";
import { removalSequenceFromSpec } from "./disassembly-sequence";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "./embedded-spec";

const local=boxStl([0,0,0],[1,2,3]);
const posed=boxStl([4,5,6],[5,7,9]);
test("export transform recreates every triangle and a wrong placement fails",()=>{
  const good=checkReconstructedMesh({local,posed,transform:translationMatrix([4,5,6])});
  expect(good.status).toBe("PASS");
  expect("matchedTriangles" in good && good.matchedTriangles).toBe(12);
  expect(checkReconstructedMesh({local,posed,transform:translationMatrix([4,5,7])}).status).toBe("FAIL");
});
test("triangle order and winding are not mistaken for different surfaces",()=>{
  const reordered=Buffer.from(posed);
  for(let i=0;i<12;i++) {
    posed.copy(reordered,84+i*50,84+(11-i)*50,84+(12-i)*50);
    const a=Buffer.from(reordered.subarray(84+i*50+12,84+i*50+24));
    reordered.copy(reordered,84+i*50+12,84+i*50+24,84+i*50+36);
    a.copy(reordered,84+i*50+24);
  }
  expect(checkReconstructedMesh({local,posed:reordered,transform:translationMatrix([4,5,6])}).status).toBe("PASS");
});
test("matching bounds do not hide additional interior geometry",()=>{
  const extra=mergeStl(posed,boxStl([4.1,5.1,6.1],[4.2,5.2,6.2]));
  expect(checkReconstructedMesh({local,posed:extra,transform:translationMatrix([4,5,6])}).status).toBe("NOT_RUN");
});
test("nonrigid and invalid transforms cannot certify reconstruction",()=>{
  const scaled=translationMatrix([4,5,6]);scaled[0]=2;
  expect(()=>checkReconstructedMesh({local,posed,transform:scaled})).toThrow();
  expect(()=>checkReconstructedMesh({local,posed,transform:translationMatrix([4,5,6]),toleranceMm:NaN})).toThrow();
});
test("keyed source carries all five manufacturing parts and ordered release operations",async()=>{
  const source=await readFile("benchmarks/assembly/slider_crank_keyed.scad","utf8");
  const e=extractEmbeddedAssemblySpec(source);
  expect(e.status).toBe("valid");if(e.status!=="valid")return;
  expect(e.spec.parts.map(p=>p.id)).toContain("eccentric_key");
  expect(e.spec.instances).toHaveLength(5);
  expect(e.spec.operations.map(o=>o.instanceId)).toEqual(["eccentric_key","slider","rod","crank"]);
  expect(e.spec.unknowns.some(s=>s.includes("retention"))).toBe(true);
  const frozen=JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-keyed-disassembly.json","utf8"));
  expect(removalSequenceFromSpec(e.spec)).toEqual(frozen);
  const changed=structuredClone(e.spec);
  changed.operations[0].waypoints[0][3]+=1;
  expect(()=>removalSequenceFromSpec(changed)).toThrow("start");
  const omitted=structuredClone(e.spec);omitted.operations.shift();
  expect(()=>removalSequenceFromSpec(omitted)).toThrow("every");
});
