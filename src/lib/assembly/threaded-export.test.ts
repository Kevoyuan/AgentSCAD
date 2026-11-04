import { expect,test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "./embedded-spec";

test("threaded fixture declares two independent parts without inventing untested release or handedness",async()=>{
  const source=await readFile("benchmarks/assembly/threaded_fastener.scad","utf8");
  const embedded=extractEmbeddedAssemblySpec(source);
  expect(embedded.status).toBe("valid");
  if(embedded.status!=="valid")return;
  const spec=embedded.spec;
  expect(spec.parts.map(p=>p.id)).toEqual(["bolt","nut"]);
  expect(spec.instances.map(i=>i.partId)).toEqual(["bolt","nut"]);
  expect(spec.groundedInstanceId).toBe("bolt");
  expect(spec.connections[0].type).toBe("screw");
  expect(spec.connections[0].pitchMm).toBe(1.5);
  expect(spec.operations).toEqual([]);
  expect(spec.unknowns.some(x=>x.includes("handedness"))).toBe(true);
  expect(spec.unknowns.some(x=>x.includes("two touching shells"))).toBe(true);
});
