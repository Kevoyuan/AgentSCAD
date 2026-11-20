import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateAssemblySpec } from "./assembly-spec";
import { runProductionAssemblyRepair } from "./assembly-repair-job";
import type { AssemblyMeasurement } from "./repair-loop";
import { deriveRequirementContract } from "../requirements/extract-requirements";

const userRequest="A complete hinged assembly that rotates 45 degrees with clearance 0.35 to 0.45 mm";
async function fixture() {
  const source=await readFile("benchmarks/assembly/axial_hinge.scad","utf8");
  const parsed=validateAssemblySpec(JSON.parse(
    await readFile("scripts/eval/assembly-fixtures/axial-hinge.spec.json","utf8")));
  if(!parsed.success)throw new Error("fixture invalid");
  const scad=(code:string, spec=parsed.data)=>
    "/* AGENTSCAD_ASSEMBLY_V1\n"+JSON.stringify(spec)+
    "\nEND_AGENTSCAD_ASSEMBLY */\n"+code;
  return {
    spec:parsed.data,source:scad(source),scad,contract:deriveRequirementContract({request:userRequest}),
  };
}
const frozenFit=[{connectionId:"hinge",boreInstanceId:"moving-instance",diametralClearanceMm:{min:0.35,max:0.45}}];
const evidence=(status:"PASS"|"FAIL"|"NOT_RUN"):AssemblyMeasurement["manifest"]=>({
  evidence:{
    identity:{status:"PASS",reason:"separately rendered"},
    assembly:{status,reason:status==="FAIL"?"measured clearance outside contract":"measured"},
    motion:{status:"PASS",reason:"range sampled"},
  },
  contract:{evidenceCurrent:true},
  fits:[{
    connectionId:"hinge",status,measuredStatus:status,
    reason:status==="FAIL"?"diametral clearance below required band":"measured",
    diametralClearanceMm:{min:status==="FAIL"?0.20:0.39,max:status==="FAIL"?0.22:0.41},
    boreDiameterMm:{min:6.4,max:6.4},shaftDiameterMm:{min:6,max:6},
  }],
});
describe("A07 production closure with frozen original user requirements",()=>{
  test("a measured failure is fed to one opted-in proposal, then independently remeasured",async()=>{
    const f=await fixture();
    const proposals:string[]=[];const checked:string[]=[];
    const events:string[]=[];
    const revised=f.scad(f.source.split("END_AGENTSCAD_ASSEMBLY */\n")[1]+"\n// repaired");
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async context=>{
        proposals.push(context.prompt);
        expect(context.currentScad).toBe(f.source);
        expect(context.findings.length).toBeGreaterThan(0);
        return {scad:revised};
      },
      measureOverride:async source=>{
        checked.push(source);
        return {
          spec:f.spec,manifest:evidence(source===f.source?"FAIL":"PASS"),
          kinematics:null,fitRequirements:frozenFit,
        };
      },
      onAttempt:item=>{events.push(item.phase??"");},
    });
    expect(checked).toEqual([f.source,revised]);
    expect(proposals).toHaveLength(1);
    expect(result.stoppedBecause).toBe("no-findings");
    expect(result.evidenceComplete).toBe(true);
    expect(result.finalScad).toBe(revised);
    expect(events).toEqual(["measured","measured"]);
  });

  test("source without the embedded frozen declaration cannot invoke the model or render",async()=>{
    const f=await fixture();
    let proposalCount=0;
    await expect(runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:"cube(1);",spec:f.spec,
      contract:f.contract,maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async()=>{proposalCount++;return {scad:"cube(2);"};},
    })).rejects.toThrow("exact versioned assembly declaration");
    expect(proposalCount).toBe(0);
  });

  test("a source-changing but declaration-weakening proposal is refused before any re-render",async()=>{
    const f=await fixture();
    const weakened=structuredClone(f.spec);
    weakened.connections[0].range={min:-5,max:5,unit:"deg"};
    let measurements=0;
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async()=>({scad:f.scad("cube(2);",weakened)}),
      measureOverride:async()=>{
        measurements++;
        return {spec:f.spec,manifest:evidence("FAIL"),kinematics:null,fitRequirements:frozenFit};
      },
    });
    expect(result.stoppedBecause).toBe("invariant-violated");
    expect(measurements).toBe(1);
    expect(result.finalScad).toBe(f.source);
  });

  test("an inconclusive measurement cannot cause any paid repair call",async()=>{
    const f=await fixture();
    let proposals=0;
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:2,signal:new AbortController().signal,
      modelProposal:async()=>{proposals++;return {scad:"cube(2);"};},
      measureOverride:async()=>({spec:f.spec,manifest:evidence("NOT_RUN"),kinematics:null,fitRequirements:frozenFit}),
    });
    expect(proposals).toBe(0);
    expect(result.stoppedBecause).toBe("incomplete-evidence");
  });
});
