import { describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import {
  createRepairEvent, parseRepairEvent, ASSEMBLY_REPAIR_CHECKER_VERSION,
  type StoredAssemblyRepairEvent,
} from "./repair-ledger";
import { canonicalJson } from "../canonical-json";
const sha=(c:string)=>c.repeat(64);
const binding=()=>({
  jobId:"test-job",runId:randomUUID(),
  sourceSha256:sha("a"),specificationSha256:sha("b"),
  contractSha256:sha("c"),requirementFingerprint:sha("d"),
});
const failedEvidence={identity:"PASS",assembly:"FAIL",motion:"NOT_RUN"} as const;
/**
 * Recompute the envelope hash the same way the ledger does. A direct database
 * writer can do this too, which is exactly why the candidate source binding is
 * checked at the content level instead of trusting the envelope alone.
 */
function reseal(event:StoredAssemblyRepairEvent):StoredAssemblyRepairEvent{
  const {eventSha256:_ignored,...base}=event;
  return {...base,eventSha256:createHash("sha256").update(canonicalJson(base)).digest("hex")};
}
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
        violations:[],accepted:false,phase:"measurement-error",reason:"native render failed",
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
  test("a rejected candidate is replayable only while its bytes and SHA-256 agree",()=>{
    const candidate="difference(){ cube(2); cylinder(r=1,h=3); }";
    const candidateSha=createHash("sha256").update(candidate).digest("hex");
    const b=binding();
    const event=createRepairEvent({...b,eventIndex:2,state:"ATTEMPT",attempt:{
      attempt:1,scadSha256:candidateSha,candidateScadSource:candidate,
      candidateByteLength:Buffer.byteLength(candidate,"utf8"),
      findings:[],evidence:failedEvidence,violations:[],accepted:false,
      phase:"measurement-error",reason:"Native OpenSCAD could not render the candidate",
    }});
    const parsed=parseRepairEvent(JSON.parse(JSON.stringify(event)));
    expect(parsed?.attempt?.candidateScadSource).toBe(candidate);
    expect(parsed?.attempt?.candidateByteLength).toBe(Buffer.byteLength(candidate,"utf8"));
    expect(parsed?.attempt?.scadSha256).toBe(candidateSha);
    // Content-level tampering is refused even after the envelope hash is
    // recomputed, because the stored bytes no longer match their own binding.
    expect(parseRepairEvent(reseal({...event,attempt:{...event.attempt!,candidateScadSource:candidate+"// changed"}}))).toBeNull();
    expect(parseRepairEvent(reseal({...event,attempt:{...event.attempt!,candidateByteLength:1}}))).toBeNull();
    expect(()=>createRepairEvent({...b,eventIndex:3,state:"ATTEMPT",attempt:{
      ...event.attempt!,candidateScadSource:"cube(3);",
    }})).toThrow("SHA-256");
  });
  test("oversized candidate source keeps its digest and byte count but never its text",()=>{
    const oversized="x".repeat(300_000);
    const digest=createHash("sha256").update(oversized).digest("hex");
    const bind=binding();
    const attempt={
      attempt:1,scadSha256:digest,
      findings:[],evidence:failedEvidence,violations:[],accepted:false,
      phase:"proposal-error" as const,reason:"The repaired source exceeded 256 KiB and was rejected before rendering.",
    };
    expect(()=>createRepairEvent({...bind,eventIndex:2,state:"ATTEMPT",attempt:{
      ...attempt,candidateScadSource:oversized,candidateByteLength:Buffer.byteLength(oversized,"utf8"),
    }})).toThrow("256 KiB");
    const withheld=createRepairEvent({...bind,eventIndex:2,state:"ATTEMPT",attempt:{
      ...attempt,candidateByteLength:Buffer.byteLength(oversized,"utf8"),
    }});
    const parsed=parseRepairEvent(JSON.parse(JSON.stringify(withheld)));
    expect(parsed?.attempt?.candidateScadSource).toBeUndefined();
    expect(parsed?.attempt?.candidateByteLength).toBe(300_000);
    expect(parsed?.attempt?.scadSha256).toBe(digest);
    // Oversized text also cannot be smuggled back in by recomputing the envelope.
    expect(parseRepairEvent(reseal({...withheld,attempt:{
      ...withheld.attempt!,candidateScadSource:oversized,
    }}))).toBeNull();
    // A digest-only record is only legitimate above the limit; replayable source
    // below 256 KiB must not be withheld.
    expect(()=>createRepairEvent({...bind,eventIndex:3,state:"ATTEMPT",attempt:{
      ...attempt,candidateByteLength:16,
    }})).toThrow("withheld");
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
