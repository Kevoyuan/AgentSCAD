import {createHash} from "node:crypto";
import {canonicalJson} from "../canonical-json";
import {RigidTrajectorySchema,validateRigidTransform} from "./assembly-spec";
import {multiplyMatrices,rotationAboutAxis,translationMatrix} from "./path-and-motion";
import type {Vec3} from "../geometry/stl-mesh";

/** Expand explicit world-space stages, never infer a path from endpoint poses.
 * Stage order and signed angle travel (including complete turns) are preserved. */
export function sampleRigidTrajectory(input:{assembledPose:number[];trajectory:unknown;maxTranslationStepMm:number;maxRotationStepDeg:number;maxPoses?:number}) {
  const anchor=validateRigidTransform(input.assembledPose);
  const checked=RigidTrajectorySchema.safeParse(input.trajectory);
  if(!anchor.success||!checked.success)throw new Error("Invalid rigid trajectory or assembled pose");
  const maxPoses=input.maxPoses??4096;
  if(!Number.isInteger(maxPoses)||maxPoses<2||maxPoses>4096||![input.maxTranslationStepMm,input.maxRotationStepDeg].every(n=>Number.isFinite(n)&&n>0)||input.maxRotationStepDeg>180)throw new Error("Invalid rigid trajectory sampling budget");
  const poses:number[][]=[[...anchor.data]];
  for(const stage of checked.data.stages){
    const start=poses.at(-1)!;
    let intervals:number;
    if(stage.type==="translate")intervals=Math.max(1,Math.ceil(Math.hypot(...stage.deltaMm)/input.maxTranslationStepMm));
    else {
      const length=Math.hypot(...stage.axis.direction);
      if(!Number.isFinite(length))throw new Error("Rotation axis magnitude exceeds numeric range");
      const unit=stage.axis.direction.map(v=>v/length);
      const d=[start[3]-stage.axis.origin[0],start[7]-stage.axis.origin[1],start[11]-stage.axis.origin[2]];
      const radius=Math.hypot(d[1]*unit[2]-d[2]*unit[1],d[2]*unit[0]-d[0]*unit[2],d[0]*unit[1]-d[1]*unit[0]);
      const travel=Math.abs(stage.angleDeg)*Math.PI/180;
      // Arc length bounds frame-origin chord travel even for an offset axis.
      intervals=Math.max(1,Math.ceil(Math.abs(stage.angleDeg)/input.maxRotationStepDeg),Math.ceil(radius*travel/input.maxTranslationStepMm));
    }
    if(!Number.isSafeInteger(intervals)||poses.length+intervals>maxPoses)throw new Error(`Rigid trajectory exceeds the ${maxPoses}-pose sampling budget`);
    let changed=false;
    for(let i=1;i<=intervals;i++){
      const fraction=i/intervals;
      const transform=stage.type==="translate"
        ?translationMatrix(stage.deltaMm.map(v=>v*fraction) as Vec3)
        :rotationAboutAxis(stage.axis.origin,stage.axis.direction,stage.angleDeg*fraction*Math.PI/180);
      const pose=multiplyMatrices(transform,start);
      if(!validateRigidTransform(pose).success)throw new Error("Rigid trajectory loses finite rigid-transform precision");
      if(pose.some((v,k)=>Math.abs(v-start[k])>1e-12))changed=true;
      poses.push(pose);
    }
    if(!changed)throw new Error("Rigid trajectory stage loses motion at available numeric precision");
  }
  if(checked.data.traversal==="reverse")poses.reverse();
  return {method:"staged-world-rigid-trajectory/v1" as const,assembledPose:[...anchor.data],declaration:checked.data,
    poses,poseCount:poses.length,posesSha256:createHash("sha256").update(canonicalJson(poses)).digest("hex"),
    maxTranslationStepMm:input.maxTranslationStepMm,maxRotationStepDeg:input.maxRotationStepDeg,
    coverage:"Declared world translation/rotation stages from the assembled reference only; reverse explicitly traverses identical sampled poses in reverse. No inferred release mechanism, continuous clearance, source-parameter coupling, tool access, load or physical reversibility.",
    collision:{status:"NOT_RUN" as const,reason:"Sampling constructs poses; no collision query was performed."},physical:{status:"NOT_RUN" as const,reason:"No specimen was tested."}};
}
