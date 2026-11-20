import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
    // The accepted candidate is replayable from its exact returned bytes.
    expect(result.attempts[1].candidateScadSource).toBe(revised);
    expect(result.attempts[1].candidateByteLength).toBe(Buffer.byteLength(revised,"utf8"));
  });

  test("an identical no-op paid proposal is recorded with exact source and model usage",async()=>{
    const f=await fixture();
    const usage={model:"test-model",provider:"unit",latencyMs:35,promptTokens:120,completionTokens:6};
    const phases:string[]=[];
    let measurements=0;
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async context=>({scad:context.currentScad,modelExecution:usage}),
      measureOverride:async()=>{
        measurements++;
        return {spec:f.spec,manifest:evidence("FAIL"),kinematics:null,fitRequirements:frozenFit};
      },
      onAttempt:item=>{phases.push(item.phase??"");},
    });
    // The proposal made no progress, but the paid call is still an immutable attempt.
    expect(result.stoppedBecause).toBe("no-progress");
    expect(measurements).toBe(1);
    expect(phases).toEqual(["measured","no-progress"]);
    expect(result.attempts[1].phase).toBe("no-progress");
    expect(result.attempts[1].candidateScadSource).toBe(f.source);
    expect(result.attempts[1].candidateByteLength).toBe(Buffer.byteLength(f.source,"utf8"));
    expect(result.attempts[1].scadSha256).toBe(result.attempts[0].scadSha256);
    expect(result.attempts[1].modelExecution).toEqual(usage);
    expect(result.finalScad).toBe(f.source);
  });

  test("a returned proposal that cannot be rendered keeps its source, digest and usage",async()=>{
    const f=await fixture();
    const revised=f.scad(f.source.split("END_AGENTSCAD_ASSEMBLY */\n")[1]+"\n// repaired");
    const usage={model:"test-model",provider:"unit",latencyMs:9,promptTokens:210,completionTokens:12};
    let measurements=0;
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async()=>({scad:revised,modelExecution:usage}),
      measureOverride:async source=>{
        measurements++;
        if(source===revised)throw new Error("native OpenSCAD render failed");
        return {spec:f.spec,manifest:evidence("FAIL"),kinematics:null,fitRequirements:frozenFit};
      },
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("could not be measured");
    expect(result.finalScad).toBe(f.source);
    expect(measurements).toBe(2);
    expect(result.attempts[1].phase).toBe("measurement-error");
    expect(result.attempts[1].candidateScadSource).toBe(revised);
    expect(result.attempts[1].scadSha256).toBe(createHash("sha256").update(revised).digest("hex"));
    expect(result.attempts[1].modelExecution).toEqual(usage);
  });

  test("an oversized returned proposal retains digest, byte count and usage but no text",async()=>{
    const f=await fixture();
    const oversized=f.scad(f.source.split("END_AGENTSCAD_ASSEMBLY */\n")[1])+"\n"+" ".repeat(270_000);
    const usage={model:"test-model",provider:"unit",promptTokens:180,completionTokens:4};
    let measurements=0;
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async()=>({scad:oversized,modelExecution:usage}),
      measureOverride:async()=>{
        measurements++;
        return {spec:f.spec,manifest:evidence("FAIL"),kinematics:null,fitRequirements:frozenFit};
      },
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("256 KiB");
    // Only the original was measured: the oversized text was never rendered.
    expect(measurements).toBe(1);
    expect(result.finalScad).toBe(f.source);
    expect(result.attempts[1].phase).toBe("proposal-error");
    expect(result.attempts[1].candidateScadSource).toBeUndefined();
    expect(result.attempts[1].candidateByteLength).toBe(Buffer.byteLength(oversized,"utf8"));
    expect(result.attempts[1].scadSha256).toBe(createHash("sha256").update(oversized).digest("hex"));
    expect(result.attempts[1].modelExecution).toEqual(usage);
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
    const weakenedSource=f.scad("cube(2);",weakened);
    const usage={model:"test-model",provider:"unit",promptTokens:88};
    let measurements=0;
    const result=await runProductionAssemblyRepair({
      originalRequest:userRequest,scadSource:f.source,spec:f.spec,contract:f.contract,
      maxAttempts:1,signal:new AbortController().signal,
      modelProposal:async()=>({scad:weakenedSource,modelExecution:usage}),
      measureOverride:async()=>{
        measurements++;
        return {spec:f.spec,manifest:evidence("FAIL"),kinematics:null,fitRequirements:frozenFit};
      },
    });
    expect(result.stoppedBecause).toBe("invariant-violated");
    expect(measurements).toBe(1);
    expect(result.finalScad).toBe(f.source);
    expect(result.attempts[1].phase).toBe("invariant");
    expect(result.attempts[1].candidateScadSource).toBe(weakenedSource);
    expect(result.attempts[1].modelExecution).toEqual(usage);
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
