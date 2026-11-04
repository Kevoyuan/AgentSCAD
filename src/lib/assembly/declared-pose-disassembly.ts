import { createHash } from "crypto";
import { validateAssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { checkRigidPosePath } from "./rigid-pose-path";
import type { MeasurementStatus } from "./measurement-status";
import { sampleScrewPath } from "./screw-path";
import { multiplyMatrices } from "./path-and-motion";

/** Execute world-space poses from the declaration. Two-endpoint translations
 * and explicitly parameterized screw trajectories can be sampled; arbitrary
 * rotations need explicit dense poses.
 */
export function checkDeclaredPoseDisassembly(input: {
  spec: unknown;
  /** One local manufacturing mesh per part; repeated instances share it. */
  meshes: Record<string, Buffer>;
  maxTranslationStepMm?: number;
  maxRotationStepDeg?: number;
  /** Ceiling for the whole sequence. Callers that need a shorter run pass less. */
  budgetMs?: number;
}) {
  const started=performance.now();
  const parsed=validateAssemblySpec(input.spec);
  if(!parsed.success)throw new Error("Invalid assembly specification");
  const spec=parsed.data;
  const base={method:"declared-dense-pose-disassembly/v1",specificationSha256:assemblySpecificationHash(spec),
    coverage:"Declared instances and explicit or ideal screw sampled poses only. Removed parts are taken to external storage; transport, support, continuous clearance, thread engagement, tools and physical function are not checked."};
  if(!spec.groundedInstanceId)return {...base,status:"NOT_RUN" as const,reason:"No grounded instance was declared",results:[]};
  const operations=spec.operations.filter(o=>o.action==='disassemble');
  if(!operations.length)return {...base,status:"NOT_RUN" as const,reason:"No disassembly operations were declared",results:[]};
  const expected=spec.instances.filter(i=>i.id!==spec.groundedInstanceId).map(i=>i.id).sort();
  if(JSON.stringify(expected)!==JSON.stringify(operations.map(o=>o.instanceId).sort())) {
    return {...base,status:"ERROR" as const,reason:"Every non-grounded instance must be removed exactly once",results:[]};
  }
  const maxTranslationStepMm=input.maxTranslationStepMm??0.25;
  const maxRotationStepDeg=input.maxRotationStepDeg??5.001;
  const budgetMs=input.budgetMs??5000;
  if(!Number.isFinite(maxTranslationStepMm)||maxTranslationStepMm<=0||!Number.isFinite(maxRotationStepDeg)||maxRotationStepDeg<=0||maxRotationStepDeg>180||!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>60000) {
    return {...base,status:"ERROR" as const,reason:"Invalid sampling bounds",results:[]};
  }
  const rotationGapDeg=(a:number[],b:number[])=>Math.acos(Math.max(-1,Math.min(1,([0,1,2,4,5,6,8,9,10].reduce((sum,k)=>sum+a[k]*b[k],0)-1)/2)))*180/Math.PI;
  let estimatedPairs=0;
  let samplingError:string|null=null;
  let samplingUnavailable:string|null=null;
  const sampledOperations=operations.map(op=>{
    let poses=op.waypoints;
    if(samplingUnavailable)return {...op,waypoints:[]};
    if(op.screwTrajectory) {
      if(performance.now()-started>budgetMs) {
        samplingUnavailable=`Declared sequence exceeded its ${budgetMs} ms evaluation budget during sampling`;
        return {...op,waypoints:[]};
      }
      const s=op.screwTrajectory;
      const instance=spec.instances.find(i=>i.id===op.instanceId)!;
      // Bound displacement of the instance origin as well as angular travel;
      // an axis offset from that origin can otherwise violate the path checker.
      const radius=Math.hypot(instance.transform[3]-s.axis.origin[0],instance.transform[7]-s.axis.origin[1],instance.transform[11]-s.axis.origin[2]);
      const originTravelPerDegree=s.leadMm/360+radius*Math.PI/180;
      const maxStepDeg=Math.min(maxRotationStepDeg,maxTranslationStepMm/originTravelPerDegree);
      try {
        const poseCount=Math.ceil(Math.abs(s.endAngleDeg-s.startAngleDeg)/maxStepDeg)+1;
        if(poseCount>4096 || !Number.isSafeInteger(poseCount))throw new Error("Screw path exceeds the pose budget of 4096");
        if(estimatedPairs+poseCount*(spec.instances.length-1)>20_000)throw new Error("Screw path exceeds the pair evaluation budget");
        const expanded=sampleScrewPath({units:"mm",axis:s.axis,hand:s.hand,leadMm:s.leadMm,
          startAngleDeg:s.startAngleDeg,endAngleDeg:s.endAngleDeg,maxStepDeg});
        poses=expanded.poses.map(p=>multiplyMatrices(p,instance.transform)) as typeof poses;
      } catch(error) {
        samplingUnavailable??=`Operation ${op.id} screw trajectory could not be sampled within the pose budget: ${error instanceof Error?error.message:"unknown error"}`;
        poses=[];
      }
    }
    if(poses.length===2) {
      const [a,b]=poses;
      const pureTranslation=[0,1,2,4,5,6,8,9,10].every(k=>Math.abs(a[k]-b[k])<1e-8);
      if(!pureTranslation) {
        // Rotation cannot be guessed from two endpoints: the arc between them is
        // unknown, and interpolating orientation would invent poses nobody declared.
        if(rotationGapDeg(a,b)>maxRotationStepDeg+1e-6)samplingError??=`Operation ${op.id} declares a two-endpoint rotation larger than the ${maxRotationStepDeg}° step; declare explicit dense waypoints instead of a start and an end pose`;
      } else {
        const distance=Math.hypot(b[3]-a[3],b[7]-a[7],b[11]-a[11]);
        const count=Math.ceil(distance/maxTranslationStepMm)+1;
        if(count>4096)samplingError??=`Operation ${op.id} moves ${distance.toFixed(2)} mm, which needs ${count} samples at ${maxTranslationStepMm} mm and exceeds the 4096-pose evaluation budget`;
        else if(count>=2)poses=Array.from({length:count},(_,i)=>a.map((v,k)=>[3,7,11].includes(k)?v+(b[k]-v)*i/(count-1):v) as typeof a);
      }
    }
    estimatedPairs+=poses.length*(spec.instances.length-1);
    return {...op,waypoints:poses};
  });
  if(samplingError)return {...base,status:"ERROR" as const,reason:samplingError,results:[]};
  if(samplingUnavailable)return {...base,status:"NOT_RUN" as const,reason:samplingUnavailable,results:[]};
  if(spec.instances.length>33 || estimatedPairs>20_000)return {...base,status:"NOT_RUN" as const,reason:"Declared path exceeds the evaluation budget",results:[]};
  const usedPartIds=new Set(spec.instances.map(i=>i.partId));
  if(spec.parts.some(p=>usedPartIds.has(p.id)&&(p.source!=='generated'||!input.meshes[p.id]))) {
    return {...base,status:"NOT_RUN" as const,reason:"A declared instance lacks an available generated-part mesh",results:[]};
  }
  const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  const partHashes=Object.fromEntries([...usedPartIds].map(id=>[id,sha(input.meshes[id])]));
  const remaining=new Set(spec.instances.map(i=>i.id));
  const results:Array<{operationId:string;instanceId:string;status:MeasurementStatus;reason:string;path?:ReturnType<typeof checkRigidPosePath>}> = [];
  let status:MeasurementStatus="PASS";
  for(const op of sampledOperations) {
    const entry={operationId:op.id,instanceId:op.instanceId};
    if(status!=="PASS") {results.push({...entry,status:"NOT_RUN",reason:"Previous removal did not pass; remaining scene cannot be assumed"});continue;}
    const remainingMs=budgetMs-(performance.now()-started);
    if(remainingMs<=0){status="NOT_RUN";results.push({...entry,status,reason:`Declared sequence exceeded its ${budgetMs} ms evaluation budget`});continue;}
    const instance=spec.instances.find(i=>i.id===op.instanceId)!;
    if(!op.waypoints.length || op.waypoints[0].some((v,i)=>Math.abs(v-instance.transform[i])>1e-6)) {
      status="ERROR";results.push({...entry,status,reason:"Operation does not start at the declared assembly pose"});continue;
    }
    const others=spec.instances.filter(i=>remaining.has(i.id)&&i.id!==op.instanceId);
    try {
      const path=checkRigidPosePath({moving:input.meshes[instance.partId],
        obstacles:Object.fromEntries(others.map(i=>[i.id,input.meshes[i.partId]])),
        obstacleTransforms:Object.fromEntries(others.map(i=>[i.id,i.transform])),
        poses:op.waypoints,maxTranslationStepMm,maxRotationStepDeg,requireSeparatedEnd:true,budgetMs:remainingMs});
      status=path.status;
      if(status==="PASS" && performance.now()-started>budgetMs) {
        status="NOT_RUN";results.push({...entry,status,reason:`Declared sequence exceeded its ${budgetMs} ms evaluation budget`,path});continue;
      }
      results.push({...entry,status,reason:path.reason,path});
      if(status==='PASS')remaining.delete(op.instanceId);
    }catch(error) {
      status="ERROR";results.push({...entry,status,reason:error instanceof Error?error.message:"Path evaluation failed"});
    }
  }
  const elapsed=performance.now()-started;
  const expiredAtCompletion=status==="PASS" && elapsed>budgetMs;
  if(expiredAtCompletion)status="NOT_RUN";
  return {...base,status,budgetMs,elapsedMs:Math.round(elapsed),reason:expiredAtCompletion?`Declared sequence exceeded its ${budgetMs} ms evaluation budget`:status==='PASS'?"Every declared removal passed at its sampled poses":"The declared removal sequence is not verified",partHashes,results,remainingInstanceIds:[...remaining]};
}
