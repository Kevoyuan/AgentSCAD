/**
 * A06: conservative swept *analytic rigid-part* collision evidence.
 *
 * A single-source parameter is checked independently at isolated frames by
 * source-pose-observer.ts. This module asks an additional, different question:
 * do the *declared rigid-part meshes* collide at a queried angle, or can an
 * ENTIRE interval be safely excluded using a mathematical displacement bound?
 *
 * It deliberately does not claim that OpenSCAD source parameters generate
 * precisely this rigid mechanism BETWEEN reference frames. Consequently even
 * an analytic rigid sweep PASS cannot promote user-product motion or physical
 * acceptance; this is auxiliary measured geometry evidence only.
 */
import { createHash } from "node:crypto";
import type { AssemblySpec } from "./assembly-spec";
import { multiplyMatrices, rotationAboutAxis } from "./path-and-motion";
import type { RenderedAssemblyPart } from "../tools/assembly-part-renderer";
import { readBinaryStl, type Vec3 } from "../geometry/stl-mesh";
import { buildBvh, bvhIntersects, placeBvh, type Bvh, type PlacedBvh } from "../geometry/mesh-collision";

export type RigidSweepStatus = "PASS" | "FAIL" | "NOT_RUN";
export type SweepInterval = { fromDeg: number; toDeg: number; reason: string };
export type RigidSweepEvidence = {
  method: "bounded-rigid-axis-swept-aabb/v1";
  status: RigidSweepStatus;
  reason: string;
  movingInstanceId: string;
  movingPartSha256: string;
  obstaclePartSha256: Record<string, string>;
  inputAnglesDeg: number[];
  evaluatedAnglesDeg: number[];
  initialMaximumAngleGapDeg: number;
  maximumUnresolvedGapDeg: number;
  certifiedIntervals: number;
  unresolvedIntervals: SweepInterval[];
  testedTrianglePairs: number;
  collisionAt: {
    angleDeg: number;
    obstacleInstanceId: string;
    collision: string;
    testedPairs: number;
    movingWorldFromLocal: number[];
    obstacleWorldFromLocal: number[];
    movingMeshSha256: string;
    obstacleMeshSha256: string;
    trianglePair: { movingTriangleIndex: number; obstacleTriangleIndex: number } | null;
    witnessCentroidPointMm: Vec3 | null;
    reason: string;
  } | null;
  budget: { maxDepth: number; maxEvaluations: number; maxPairTests: number; budgetMs: number };
  coverage: string;
};

const SHA = (stl: Buffer) => createHash("sha256").update(stl).digest("hex");
const DEFAULT_BUDGET_MS = 12_000;

function finite(v: number) { return Number.isFinite(v); }
function axisDistance(point: Vec3, origin: Vec3, direction: Vec3): number {
  const x = point[0]-origin[0], y = point[1]-origin[1], z = point[2]-origin[2];
  const along = x*direction[0] + y*direction[1] + z*direction[2];
  return Math.hypot(x-along*direction[0], y-along*direction[1], z-along*direction[2]);
}
function placedPoint(matrix: number[], point: Vec3): Vec3 {
  return [
    matrix[0]*point[0]+matrix[1]*point[1]+matrix[2]*point[2]+matrix[3],
    matrix[4]*point[0]+matrix[5]*point[1]+matrix[6]*point[2]+matrix[7],
    matrix[8]*point[0]+matrix[9]*point[1]+matrix[10]*point[2]+matrix[11],
  ];
}
/** A rigid triangle's maximum distance to the rotation axis is attained at a vertex. */
function maximumVertexAxisRadius(mesh: Bvh["mesh"], transform: number[], origin: Vec3, direction: Vec3) {
  let radius = 0;
  for (let i = 0; i < mesh.coordinates.length; i += 3) {
    radius = Math.max(radius, axisDistance(
      placedPoint(transform, [mesh.coordinates[i],mesh.coordinates[i+1],mesh.coordinates[i+2]]),
      origin, direction,
    ));
  }
  return radius;
}
function boxesDisjointWithPadding(a: Float64Array, b: Float64Array, padding: number, eps: number): boolean {
  // The moving triangle geometry for the entire angular interval lies inside
  // its midpoint AABB expanded by the maximum possible vertex displacement.
  // Separated padded boxes therefore rigorously exclude surface intersection
  // AND volume containment for every analytic rigid pose in that interval.
  return [0,1,2].some(k => a[k+3]+padding+eps < b[k] || b[k+3]+eps < a[k]-padding);
}
function requireBudgetNumber(value: number, low: number, high: number, label: string) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error("Invalid sweep " + label);
}

export function verifyAnalyticRigidSweep(input: {
  spec: AssemblySpec;
  parts: RenderedAssemblyPart[];
  movingInstanceId: string;
  axis: { origin: Vec3; direction: Vec3 };
  anglesDeg: number[];
  maxDepth?: number;
  maxEvaluations?: number;
  maxPairTests?: number;
  budgetMs?: number;
  signal?: AbortSignal;
}): RigidSweepEvidence {
  const started = performance.now();
  const maxDepth = input.maxDepth ?? 9;
  const maxEvaluations = input.maxEvaluations ?? 96;
  const maxPairTests = input.maxPairTests ?? 80_000;
  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS;
  requireBudgetNumber(maxDepth, 0, 12, "subdivision depth");
  requireBudgetNumber(maxEvaluations, 2, 256, "angle evaluations");
  requireBudgetNumber(maxPairTests, 1, 2_000_000, "triangle-pair limit");
  requireBudgetNumber(budgetMs, 1, 60_000, "wall deadline");
  if (input.anglesDeg.length < 3 || input.anglesDeg.length > 9 ||
    input.anglesDeg.some(v => !finite(v) || Math.abs(v)>180) ||
    input.anglesDeg.some((v,i) => i>0 && v <= input.anglesDeg[i-1]) ||
    input.anglesDeg.length > maxEvaluations ||
    !input.axis.origin.every(finite) || !input.axis.direction.every(finite)) {
    throw new Error("Invalid monotonic sweep angle samples or world joint axis");
  }
  const axisNorm = Math.hypot(...input.axis.direction);
  if (!(axisNorm>1e-9)) throw new Error("Invalid sweep rotation axis");
  const direction: Vec3 = input.axis.direction.map(v=>v/axisNorm) as Vec3;
  const moving = input.spec.instances.find(i=>i.id===input.movingInstanceId);
  if (!moving || input.spec.instances.length<2 || input.spec.instances.length>12 ||
    input.parts.length !== input.spec.parts.length ||
    input.spec.parts.some(p=>p.source!=="generated")) throw new Error("Incomplete generated assembly for swept comparison");
  const data = new Map(input.parts.map(part => [part.partId, part]));
  if (data.size !== input.spec.parts.length) throw new Error("Unresolved duplicate rendered part");
  const movingPart = data.get(moving.partId);
  if (!movingPart) throw new Error("Moving part has no rendered mesh");
  const bytes = input.parts.reduce((sum,part)=>sum+part.stl.length,0);
  if (bytes>128*1024*1024 || input.parts.some(part=>part.stl.length>64*1024*1024)) throw new Error("Swept mesh byte limit exceeded");
  const movingMesh = readBinaryStl(movingPart.stl);
  const movingBvh = buildBvh(movingMesh);
  if (movingBvh.degenerateTriangles>0) throw new Error("Swept moving STL has degenerate triangles");
  const obstacles: Array<{id:string; bvh:PlacedBvh; stlSha256:string; world:number[]}> = [];
  for (const instance of input.spec.instances) {
    if (instance.id===moving.id) continue;
    const part = data.get(instance.partId);
    if (!part) throw new Error("Obstacle instance has missing generated mesh");
    const tree = buildBvh(readBinaryStl(part.stl));
    if (tree.degenerateTriangles>0) throw new Error("Swept obstacle STL has degenerate triangles");
    obstacles.push({id:instance.id,bvh:placeBvh(tree,instance.transform),stlSha256:SHA(part.stl),world:instance.transform});
  }
  const radius = maximumVertexAxisRadius(movingMesh,moving.transform,input.axis.origin,direction);
  if (!finite(radius)) throw new Error("Unbounded swept mesh radius");
  const movingHash = SHA(movingPart.stl);
  const initialMaximumAngleGapDeg = Math.max(...input.anglesDeg.slice(1).map((x,i)=>x-input.anglesDeg[i]));
  const tested: number[] = [];
  const known = new Map<number,"CLEAR"|"FAIL"|"UNKNOWN">();
  const unresolvedIntervals: SweepInterval[] = [];
  let certifiedIntervals = 0, testedTrianglePairs = 0;
  let first: RigidSweepEvidence["collisionAt"] = null;
  let stoppedBecause: string|null = null;
  const expired = () => input.signal?.aborted || performance.now()-started>=budgetMs;
  const transformation = (angle:number) => multiplyMatrices(
    rotationAboutAxis(input.axis.origin,direction,angle*Math.PI/180),
    moving.transform,
  );
  const base = {
    method:"bounded-rigid-axis-swept-aabb/v1" as const,
    movingInstanceId:moving.id,movingPartSha256:movingHash,
    obstaclePartSha256:Object.fromEntries(obstacles.map(o=>[o.id,o.stlSha256])),
    inputAnglesDeg:input.anglesDeg.slice(),
    initialMaximumAngleGapDeg,
    budget:{maxDepth,maxEvaluations,maxPairTests,budgetMs},
    coverage:"Actual generated-part STL meshes, stationary instance world matrices and declared one-axis analytic rigid rotation. Midpoint AABB enlarged by 2*r*sin(angleGap/4) is an all-angle conservative envelope. PASS means analytic rigid geometry separated throughout the enumerated interval ONLY. OpenSCAD source parameter semantics BETWEEN independent reference samples, intended physical mechanism, permitted contacts, tools, forces and manufactured clearance are NOT VERIFIED.",
  };
  const point = (angle:number):"CLEAR"|"FAIL"|"UNKNOWN"=>{
    const existing=known.get(angle);
    if(existing) return existing;
    if(expired()) {stoppedBecause="Swept evaluation deadline or job abort";return "UNKNOWN";}
    if(tested.length>=maxEvaluations){stoppedBecause="Swept angle-evaluation budget exceeded";return "UNKNOWN";}
    const world = transformation(angle);
    const actual=placeBvh(movingBvh,world);
    tested.push(angle);
    for(const obstacle of obstacles){
      if(expired()){stoppedBecause="Swept evaluation deadline or job abort";known.set(angle,"UNKNOWN");return "UNKNOWN";}
      const available=maxPairTests-testedTrianglePairs;
      if(available<=0){stoppedBecause="Swept total triangle-pair budget exhausted";known.set(angle,"UNKNOWN");return "UNKNOWN";}
      const hit=bvhIntersects(actual,obstacle.bvh,{maxPairTests:available});
      testedTrianglePairs+=hit.testedPairs;
      if(hit.status==="UNKNOWN") {
        stoppedBecause=hit.reason;
        known.set(angle,"UNKNOWN");return "UNKNOWN";
      }
      if(hit.blocked) {
        first={angleDeg:angle,obstacleInstanceId:obstacle.id,collision:hit.status,
          testedPairs:hit.testedPairs,movingWorldFromLocal:world,
          obstacleWorldFromLocal:obstacle.world,movingMeshSha256:movingHash,
          obstacleMeshSha256:obstacle.stlSha256,
          trianglePair:hit.pair ? {movingTriangleIndex:hit.pair.a,obstacleTriangleIndex:hit.pair.b}:null,
          witnessCentroidPointMm:hit.point,reason:hit.reason};
        known.set(angle,"FAIL");return "FAIL";
      }
    }
    known.set(angle,"CLEAR");return "CLEAR";
  };
  const unresolved = (a:number,b:number,reason:string)=>{
    if(unresolvedIntervals.length<128)unresolvedIntervals.push({fromDeg:a,toDeg:b,reason});
  };
  // The original independently rendered source angles are always tested,
  // including endpoints, even if broadphase would prove their whole interval clear.
  for(const angle of input.anglesDeg){
    const result=point(angle);
    if(result==="FAIL"||result==="UNKNOWN")break;
  }
  let unresolvedAfterBudget=false;
  const sweep=(a:number,b:number,depth:number):void=>{
    if(first||stoppedBecause) {unresolvedAfterBudget=true;return;}
    const mid=(a+b)/2;
    const matrix=transformation(mid);
    const placed=placeBvh(movingBvh,matrix);
    // Maximum distance travelled by any vertex from midpoint throughout
    // [a,b] for a fixed-axis rotation. Angles are <=180° by validation.
    const padding=2*radius*Math.sin(((b-a)*Math.PI/180)/4)+1e-6;
    if(obstacles.every(o=>boxesDisjointWithPadding(placed.worldBounds,o.bvh.worldBounds,padding,1e-6))){
      certifiedIntervals++;
      return;
    }
    if(depth>=maxDepth){
      unresolved(a,b,"Expanded swept AABB still overlaps an obstacle at maximum subdivision depth");
      return;
    }
    const state=point(mid);
    if(state==="FAIL")return;
    if(state==="UNKNOWN"){
      unresolved(a,b,stoppedBecause??"Collision sampling inconclusive");
      return;
    }
    sweep(a,mid,depth+1);
    if(!first&&!stoppedBecause)sweep(mid,b,depth+1);
  };
  if(!first&&!stoppedBecause){
    for(let i=1;i<input.anglesDeg.length;i++){
      sweep(input.anglesDeg[i-1],input.anglesDeg[i],0);
      if(first||stoppedBecause)break;
    }
  }
  if(expired()&&!stoppedBecause) stoppedBecause="Swept evaluation deadline or job abort";
  if(stoppedBecause && !first && !unresolvedIntervals.length)
    unresolved(input.anglesDeg[0],input.anglesDeg[input.anglesDeg.length-1],stoppedBecause);
  const maximumUnresolvedGapDeg = unresolvedIntervals.length
    ? Math.max(...unresolvedIntervals.map(item=>item.toDeg-item.fromDeg))
    : stoppedBecause ? initialMaximumAngleGapDeg : 0;
  const status:RigidSweepStatus=first?"FAIL":stoppedBecause||unresolvedIntervals.length||unresolvedAfterBudget?"NOT_RUN":"PASS";
  const reason=first
    ? "An actual STL collision was measured at a bounded sampled angle; source semantics outside checked angles remain unverified."
    : status==="PASS"?"All analytic rigid-motion intervals have mathematically conservative separated swept AABB envelopes."
    : stoppedBecause??"The conservative envelope cannot prove separation for every angular interval at the current budget.";
  return {...base,status,reason,
    evaluatedAnglesDeg:tested,
    maximumUnresolvedGapDeg,certifiedIntervals,
    unresolvedIntervals,testedTrianglePairs,collisionAt:first,
  };
}
