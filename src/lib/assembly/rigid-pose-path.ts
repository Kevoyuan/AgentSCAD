import { createHash } from "crypto";
import { canonicalJson } from "../canonical-json";
import { validateRigidTransform } from "./assembly-spec";
import { readBinaryStl } from "../geometry/stl-mesh";
import { buildBvh, placeBvh, bvhIntersects } from "../geometry/mesh-collision";

/** Explicit cumulative poses: supports rotation followed by translation without
 * guessing how to interpolate endpoints. Sampling is not continuous clearance.
 */
export function checkRigidPosePath(input: {
  moving: Buffer;
  obstacles: Record<string, Buffer>;
  /** Optional local-to-world placement for each stationary obstacle mesh. */
  obstacleTransforms?: Record<string, number[]>;
  poses: number[][];
  maxTranslationStepMm: number;
  maxRotationStepDeg: number;
  requireSeparatedEnd?: boolean;
  /**
   * Result deadline measured from entry, including mesh parsing and BVH
   * construction. Synchronous work cannot be preempted; a late successful
   * result becomes NOT_RUN once control returns to a deadline check.
   */
  budgetMs?: number;
}) {
  const started=performance.now();
  if (!Array.isArray(input.poses) || input.poses.length < 2 || input.poses.length > 4096) throw new Error("Expected 2–4096 explicit poses");
  if (![input.maxTranslationStepMm,input.maxRotationStepDeg].every(n=>Number.isFinite(n)&&n>0) || input.maxRotationStepDeg>180) throw new Error("Invalid pose sampling bounds");
  const budgetMs=input.budgetMs??5000;
  if(!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>60000)throw new Error("Invalid evaluation budget");
  const poses=input.poses.map(p=>{
    const result=validateRigidTransform(p);
    if(!result.success)throw new Error("Pose must be a finite right-handed rigid transform");
    return result.data;
  });
  let translationStepMm=0,rotationStepDeg=0;
  for(let i=1;i<poses.length;i++) {
    const a=poses[i-1],b=poses[i];
    translationStepMm=Math.max(translationStepMm,Math.hypot(b[3]-a[3],b[7]-a[7],b[11]-a[11]));
    const trace=[0,1,2,4,5,6,8,9,10].reduce((sum,k)=>sum+a[k]*b[k],0);
    rotationStepDeg=Math.max(rotationStepDeg,Math.acos(Math.max(-1,Math.min(1,(trace-1)/2)))*180/Math.PI);
  }
  if(translationStepMm>input.maxTranslationStepMm+1e-8 || rotationStepDeg>input.maxRotationStepDeg+1e-6)throw new Error("Pose gap exceeds declared sampling bounds");
  if(!poses.some(p=>p.some((v,k)=>Math.abs(v-poses[0][k])>1e-10)))throw new Error("A repeated static pose is not a motion path");
  const entries=Object.entries(input.obstacles);
  if(!entries.length || entries.length>32 || entries.length*poses.length>100_000)throw new Error("Invalid obstacle or sampling budget");
  const buffers=[input.moving,...entries.map(([,b])=>b)];
  if(buffers.some(b=>b.length>64*1024*1024)||buffers.reduce((s,b)=>s+b.length,0)>128*1024*1024)throw new Error("Mesh byte budget exceeded");
  const sha=(v:Buffer|string)=>createHash("sha256").update(v).digest("hex");
  const suppliedTransforms=input.obstacleTransforms??{};
  if(Object.keys(suppliedTransforms).some(id=>!Object.hasOwn(input.obstacles,id)))throw new Error("Transform refers to an unknown obstacle");
  const obstacleTransforms=Object.fromEntries(entries.map(([id])=>{
    const checked=validateRigidTransform(suppliedTransforms[id]??[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    if(!checked.success)throw new Error("Obstacle transform must be rigid");
    return [id,checked.data];
  }));
  const moving=buildBvh(readBinaryStl(input.moving));
  const obstacles=entries.map(([id,b])=>({id,placed:placeBvh(buildBvh(readBinaryStl(b)),obstacleTransforms[id])}));
  const base={method:"explicit-rigid-pose-path/v1",movingSha256:sha(input.moving),obstacles:Object.fromEntries(entries.map(([id,b])=>[id,sha(b)])),
    obstacleTransforms,poses,posesSha256:sha(canonicalJson(poses)),translationStepMm,rotationStepDeg,requireSeparatedEnd:input.requireSeparatedEnd??false,budgetMs,
    coverage:"Only explicit sampled rigid poses; translation step describes frame-origin motion, rotation step describes orientation. No continuous swept-volume, tool access, forces, detent stability or physical verification."};
  let testedTrianglePairs = 0;
  for(let i=0;i<poses.length;i++) {
    if(performance.now()-started>budgetMs)return {...base,status:"NOT_RUN" as const,reason:`Path exceeded its ${budgetMs} ms evaluation budget`,posesEvaluated:i,testedTrianglePairs};
    const placed=placeBvh(moving,poses[i]);
    for(const other of obstacles) {
      const collision=bvhIntersects(placed,other.placed);
      testedTrianglePairs += collision.testedPairs;
      if(collision.status==="UNKNOWN")return {
        ...base,status:"NOT_RUN" as const,reason:collision.reason,posesEvaluated:i+1,testedTrianglePairs,
        undecidedAt:{poseIndex:i,obstacleId:other.id,collision:collision.status,testedPairs:collision.testedPairs,budgetExhausted:collision.budgetExhausted,reason:collision.reason},
      };
      if(collision.blocked)return {
        ...base,status:"FAIL" as const,reason:i===0?"Initial pose intersects":"A sampled path pose intersects",posesEvaluated:i+1,testedTrianglePairs,
        blockedAt:{poseIndex:i,obstacleId:other.id,collision:collision.status,testedPairs:collision.testedPairs,collisionReason:collision.reason,
          trianglePair:collision.pair ? {movingTriangleIndex:collision.pair.a,obstacleTriangleIndex:collision.pair.b} : null,
          // The BVH point is a midpoint of triangle centroids, not an exact surface contact point.
          witnessCentroidPointMm:collision.point,
        },
      };
      if(performance.now()-started>budgetMs)return {...base,status:"NOT_RUN" as const,reason:`Path exceeded its ${budgetMs} ms evaluation budget`,posesEvaluated:i+1,testedTrianglePairs};
    }
    if(i===poses.length-1 && input.requireSeparatedEnd) {
      const envelope=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(const o of obstacles)for(let k=0;k<3;k++){envelope[k]=Math.min(envelope[k],o.placed.worldBounds[k]);envelope[k+3]=Math.max(envelope[k+3],o.placed.worldBounds[k+3]);}
      const b=placed.worldBounds;
      if(![0,1,2].some(k=>b[k+3]<envelope[k]-1e-6 || b[k]>envelope[k+3]+1e-6))return {...base,status:"FAIL" as const,reason:"Final pose has not left the obstacle envelope",posesEvaluated:i+1,testedTrianglePairs};
    }
  }
  if(performance.now()-started>budgetMs)return {...base,status:"NOT_RUN" as const,reason:`Path exceeded its ${budgetMs} ms evaluation budget`,posesEvaluated:poses.length,testedTrianglePairs};
  return {...base,status:"PASS" as const,reason:"Every listed pose is clear within the stated sampling coverage",posesEvaluated:poses.length,testedTrianglePairs};
}
