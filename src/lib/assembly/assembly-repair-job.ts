/**
 * A07 production measurement closure.
 *
 * The *original user-approved contract* supplies one fixed set of measurement
 * targets for every candidate. The candidate can only change generated CAD
 * geometry, not which assertions will be evaluated or which parts exist.
 *
 * This is intentionally limited to assemblies with one unambiguous revolute
 * joint: other mechanisms remain NOT_RUN rather than guessed.
 */
import { extractEmbeddedAssemblySpec } from "./embedded-spec";
import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { prepareAssembly } from "./prepare-assembly";
import { resolveContractFitRequirements } from "../requirements/contract-bridge";
import type { RequirementContract } from "../requirements/requirement-contract";
import { repairMeasuredFailures, type AssemblyMeasurement, type RepairLoopAttempt } from "./repair-loop";
import type { AssemblyFinding } from "./repair-findings";
import { runRepair } from "../repair/repair-controller";

export class AssemblyRepairUnsupported extends Error {
  constructor(message:string){super(message);this.name="AssemblyRepairUnsupported";}
}
export type ProductionAssemblyRepairInput = {
  originalRequest:string;
  scadSource:string;
  spec:AssemblySpec;
  contract:RequirementContract;
  maxAttempts:1|2;
  modelId?:string|null;
  signal:AbortSignal;
  onAttempt?:(attempt:RepairLoopAttempt)=>Promise<void>|void;
  /** Tests may supply a controlled model. Production always uses runRepair. */
  modelProposal?: (context:{
    currentScad:string;
    findings:AssemblyFinding[];
    prompt:string;
    attempt:number;
    signal:AbortSignal;
  })=>Promise<{scad:string;modelExecution?:RepairLoopAttempt["modelExecution"]}>;
  /** Tests may supply observed geometry. The API never overrides the renderer. */
  measureOverride?: (source:string,signal:AbortSignal)=>Promise<AssemblyMeasurement>;
};

export async function runProductionAssemblyRepair(input:ProductionAssemblyRepairInput) {
  if(![1,2].includes(input.maxAttempts))throw new AssemblyRepairUnsupported("At most two opted-in model repairs can run in one request.");
  if(!input.originalRequest.trim()||!input.scadSource.trim())
    throw new AssemblyRepairUnsupported("A current CAD source and immutable user request are required.");
  const parsed=validateAssemblySpec(input.spec);
  if(!parsed.success)throw new AssemblyRepairUnsupported("The original assembly specification is invalid.");
  const stored=extractEmbeddedAssemblySpec(input.scadSource);
  if(stored.status!=="valid"||
      assemblySpecificationHash(stored.spec)!==assemblySpecificationHash(parsed.data)){
    throw new AssemblyRepairUnsupported("The source does not contain the exact versioned assembly declaration. Repair must not guess parts or ranges.");
  }
  if(!input.spec.parts.length||input.spec.parts.length>8||
    input.spec.instances.length>12||input.spec.parts.some(p=>p.source!=="generated"))
    throw new AssemblyRepairUnsupported("A07 currently requires a complete generated assembly (at most eight part designs and twelve instances).");
  if(input.contract.requestSha256!==await hashRequest(input.originalRequest))
    throw new AssemblyRepairUnsupported("Requirement contract belongs to a different user request.");
  const joints=input.spec.connections.filter(c=>c.type==="revolute");
  if(joints.length!==1||joints[0].frameA===null||joints[0].frameB===null)
    throw new AssemblyRepairUnsupported("A07 currently requires exactly one declared revolute joint with both frames.");
  const fitBinding=resolveContractFitRequirements(input.contract,input.spec);
  if(fitBinding.required && fitBinding.status!=="READY")
    throw new AssemblyRepairUnsupported("Frozen user-required fit cannot be independently bound: "+fitBinding.reason);
  // Fixed outside all candidate closures — NEVER follow the proposed source's
  // declared fit bandwidth, sampling granularity or motion range.
  const frozenFitRequirements=fitBinding.requirements;
  const frozenJointId=joints[0].id;
  const motion={
    connectionId:frozenJointId,
    pathSteps:12,
    motionSteps:24,
  };
  const measure=async(scad:string):Promise<AssemblyMeasurement>=>{
    input.signal.throwIfAborted();
    const embedded=extractEmbeddedAssemblySpec(scad);
    if(embedded.status!=="valid"||
      assemblySpecificationHash(embedded.spec)!==assemblySpecificationHash(parsed.data))
      throw new AssemblyRepairUnsupported("Candidate changed frozen assembly declaration.");
    if(input.measureOverride)return input.measureOverride(scad,input.signal);
    const result=await prepareAssembly({
      scadSource:scad,spec:embedded.spec,
      fitRequirements:frozenFitRequirements,kinematics:motion,
      contractSnapshot:{contract:input.contract,request:input.originalRequest},
      contractGate:{evidenceCurrent:true},
      options:{signal:input.signal},
    });
    return {spec:embedded.spec,manifest:result.manifest,
      kinematics:result.kinematics,fitRequirements:frozenFitRequirements};
  };
  return repairMeasuredFailures({
    originalRequest:input.originalRequest,scad:input.scadSource,
    strictEmbeddedSpec:true,maxAttempts:input.maxAttempts,maxWallMs:240_000,
    contract:input.contract,signal:input.signal,measure,
    onAttempt:input.onAttempt,
    propose:async(prompt,attempt,context)=>{
      if(!context)throw new Error("Frozen A07 repair proposal context missing");
      if(input.modelProposal) return input.modelProposal({
        currentScad:context.currentScad,findings:context.findings,
        prompt,attempt,signal:input.signal,
      });
      const actual=await runRepair({
        originalRequest:input.originalRequest,
        partFamily:"assembly",
        currentScadCode:context.currentScad,
        validationResults:[],
        assemblyFindings:context.findings,
        requestedModel:input.modelId,
        signal:input.signal,
      });
      const run=actual.repairMeta.model_execution;
      return {
        scad:actual.generationResult.scad_source,
        modelExecution:run ? {
          model:run.model,provider:run.provider,latencyMs:run.latency_ms,
          ...(typeof run.usage?.promptTokens==="number"
            ? {promptTokens:run.usage.promptTokens}:{}),
          ...(typeof run.usage?.completionTokens==="number"
            ? {completionTokens:run.usage.completionTokens}:{}),
        } : undefined,
      };
    },
  });
}

async function hashRequest(request:string):Promise<string>{
  const {createHash}=await import("node:crypto");
  return createHash("sha256").update(request.trim()).digest("hex");
}
