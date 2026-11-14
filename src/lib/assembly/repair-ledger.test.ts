import { describe, expect, test } from "bun:test";
import { randomUUID, createHash } from "node:crypto";
import {
  createRepairEvent, parseRepairEvent, ASSEMBLY_REPAIR_CHECKER_VERSION,
} from "./repair-ledger";
const sha=(c:string)=>c.repeat(64);
const binding=()=>({
  jobId:"test-job",runId:randomUUID(),
  sourceSha256:sha("a"),specificationSha256:sha("b"),
  contractSha256:sha("c"),requirementFingerprint:sha("d"),
});
describe("A07 append-only repair event encoding",()=>{
  test("start, measured attempt, and failed stop are distinct and tamper evident",()=>{
    const bind=binding();
    const started=createRepairEvent({...bind,eventIndex:0,state:"STARTED"});
    expect(started.checkerVersion).toBe(ASSEMBLY_REPAIR_CHECKER_VERSION);
    expect(parseRepairEvent(JSON.parse(JSON.stringify(started)))).toEqual(started);
    const attempt=createRepairEvent({...bind,eventIndex:1,state:"ATTEMPT",
      attempt:{
        attempt:1,scadSha256:sha("e"),
        findings:[],evidence:{identity:"PASS",assembly:"FAIL",motion:"NOT_RUN"},
        violations:[],accepted:false,phase:"rejected-before-render",reason:"narrowed range",
      },
    });
    expect(parseRepairEvent(attempt)?.attempt?.accepted).toBe(false);
    const aborted=createRepairEvent({...bind,eventIndex:2,state:"ABORTED",terminal:{
      stoppedBecause:"aborted",reason:"Job changed during model call",finalScadSha256:sha("a"),
      evidenceComplete:false,reviewCandidateScad:null,
    }});
    expect(parseRepairEvent(aborted)?.state).toBe("ABORTED");
    expect(parseRepairEvent({...attempt,attempt:{...attempt.attempt!,accepted:true}})).toBeNull();
    expect(parseRepairEvent({...started,eventSha256:sha("f")})).toBeNull();
  });
  test("persisted unsuccessful candidate source can be replayed only when its bytes and SHA-256 agree",()=>{
    const candidate="difference(){ cube(2); cylinder(r=1,h=3); }";
    const sha=createHash("sha256").update(candidate).digest("hex");
    const b=binding();
    const event=createRepairEvent({...b,eventIndex:2,state:"ATTEMPT",attempt:{
      attempt:1,scadSha256:sha,candidateScadSource:candidate,
      candidateByteLength:Buffer.byteLength(candidate,"utf8"),
      findings:[],evidence:{identity:"PASS",assembly:"FAIL",motion:"NOT_RUN"},
      violations:[],accepted:false,phase:"measurement-error",reason:"OpenSCAD failed",
    }});
    expect(parseRepairEvent(event)?.attempt?.candidateScadSource).toBe(candidate);
    const mutated={...event,attempt:{...event.attempt!,candidateScadSource:candidate+"// changed"}};
    expect(parseRepairEvent(mutated)).toBeNull();
    expect(()=>createRepairEvent({...b,eventIndex:3,state:"ATTEMPT",attempt:{
      ...event.attempt!,candidateScadSource:"cube(3);",
    }})).toThrow("SHA-256");
  });

  test("candidate SCAD is bounded, and only a terminal event may carry it",()=>{
    const bind=binding();
    expect(()=>createRepairEvent({...bind,eventIndex:0,state:"FINISHED",
      terminal:{
        stoppedBecause:"no-findings",reason:"fixed",
        finalScadSha256:sha("b"),evidenceComplete:true,
        reviewCandidateScad:"x".repeat(300000),
      }})).toThrow("256 KiB");
    expect(()=>createRepairEvent({...bind,eventIndex:0,state:"ATTEMPT"})).toThrow("Inconsistent");
    expect(()=>createRepairEvent({...bind,eventIndex:0,state:"STARTED",
      terminal:{
        stoppedBecause:"error",reason:"fake",finalScadSha256:sha("a"),
        evidenceComplete:false,reviewCandidateScad:null,
      }})).toThrow("Inconsistent");
  });
});
