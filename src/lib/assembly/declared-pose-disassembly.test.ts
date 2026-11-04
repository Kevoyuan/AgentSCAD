import { expect,test } from "bun:test";
import { checkDeclaredPoseDisassembly } from "./declared-pose-disassembly";
import { boxStl } from "../geometry/__tests__/solids";
import { translationMatrix, rotationAboutAxis, multiplyMatrices } from "./path-and-motion";
import { validateAssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
const mesh=boxStl([0,0,0],[1,1,1]);
function fixture(blocked=false) {
  const instances=[{id:"base",partId:"shared",subassemblyId:null,transform:translationMatrix([blocked?10:8,2,0])},
    {id:"a",partId:"shared",subassemblyId:null,transform:translationMatrix([10,0,0])},
    {id:"b",partId:"shared",subassemblyId:null,transform:translationMatrix([13,0,0])}];
  return {schemaVersion:1,units:"mm",coordinateSystem:"right-handed",parts:[{id:"shared",name:"Shared geometry",selector:"shared",source:"generated",material:null}],instances,
    subassemblies:[],groundedInstanceId:"base",connections:[],motions:[],manufacturing:null,assumptions:[],unknowns:[],
    operations:["b","a"].map(id=>({id:`remove_${id}`,action:"disassemble",instanceId:id,tools:[],waypoints:Array.from({length:25},(_,i)=>translationMatrix([id==='a'?10:13,i/4,0]))}))};
}
test("parsing an existing declaration preserves its original canonical hash",()=>{
  const original=fixture();
  const parsed=validateAssemblySpec(original);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Fixture invalid");
  expect(assemblySpecificationHash(parsed.data)).toBe(assemblySpecificationHash(original as unknown as typeof parsed.data));
  expect("screwTrajectory" in parsed.data.operations[0]).toBe(false);
});
test("one local mesh is placed separately for each instance during declared removal",()=>{
  const good=checkDeclaredPoseDisassembly({spec:fixture(),meshes:{shared:mesh}});
  expect(good.status).toBe("PASS");
  expect("remainingInstanceIds" in good && good.remainingInstanceIds).toEqual(["base"]);
  const bad=checkDeclaredPoseDisassembly({spec:fixture(true),meshes:{shared:mesh}});
  expect(bad.status).toBe("FAIL");
  expect(bad.results[0].status).toBe("PASS");
  expect(bad.results[1].path && "blockedAt" in bad.results[1].path && bad.results[1].path.blockedAt.obstacleId).toBe("base");
});
test("unsupported sparse rotations or shifted operations cannot manufacture a successful path",()=>{
  const sparse=fixture();sparse.operations[0].waypoints=[sparse.operations[0].waypoints[0],multiplyMatrices(sparse.operations[0].waypoints[24],rotationAboutAxis([0,0,0],[0,0,1],Math.PI/2))];
  const result=checkDeclaredPoseDisassembly({spec:sparse,meshes:{shared:mesh}});
  expect(result.status).toBe("ERROR");
  // Nothing is evaluated when the declaration itself cannot be sampled: reporting
  // per-operation results would imply the rest of the sequence was attempted.
  expect(result.reason).toContain("dense waypoints");
  expect(result.results).toHaveLength(0);
  const shifted=fixture();shifted.operations[0].waypoints[0][3]+=1;
  expect(checkDeclaredPoseDisassembly({spec:shifted,meshes:{shared:mesh}}).status).toBe("ERROR");
});
test("absent evidence and incomplete inventories cannot pass",()=>{
  expect(checkDeclaredPoseDisassembly({spec:fixture(),meshes:{}}).status).toBe("NOT_RUN");
  const empty=fixture();empty.operations=[];
  expect(checkDeclaredPoseDisassembly({spec:empty,meshes:{shared:mesh}}).status).toBe("NOT_RUN");
  const missing=fixture();missing.operations.pop();
  expect(checkDeclaredPoseDisassembly({spec:missing,meshes:{shared:mesh}}).status).toBe("ERROR");
});

test("two endpoints expand only a pure straight translation",()=>{
  const spec=fixture();
  for(const op of spec.operations)op.waypoints=[op.waypoints[0],op.waypoints[24]];
  const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh}});
  expect(result.status).toBe("PASS");
  expect(result.results[0].path?.posesEvaluated).toBe(25);
});

test("an over-long straight removal is refused instead of falling back to its two endpoints",()=>{
  const spec=fixture();
  // 3000 mm at 0.25 mm would need 12001 samples; silently checking only the ends
  // would let a part pass through anything in between.
  spec.operations[0].waypoints=[translationMatrix([10,0,0]),translationMatrix([10,0,3000])];
  const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh}});
  expect(result.status).toBe("ERROR");
  expect(result.reason).toContain("4096");
  expect(result.results).toHaveLength(0);
});

test("a rotation given as two endpoints is refused, not interpolated",()=>{
  const spec=fixture();
  const start=translationMatrix([10,0,0]);
  spec.operations[0].waypoints=[start,multiplyMatrices(start,rotationAboutAxis([0,0,0],[0,0,1],Math.PI/2))];
  const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh}});
  expect(result.status).toBe("ERROR");
  expect(result.reason).toContain("dense waypoints");
});

test("the whole sequence runs inside one budget and refuses an invalid one",()=>{
  const starved=checkDeclaredPoseDisassembly({spec:fixture(),meshes:{shared:mesh},budgetMs:1e-6});
  expect(starved.status).toBe("NOT_RUN");
  expect(JSON.stringify(starved.results)).toContain("budget");
  for(const budgetMs of [0,-1,60001,Number.NaN]) {
    const invalid=checkDeclaredPoseDisassembly({spec:fixture(),meshes:{shared:mesh},budgetMs});
    expect(invalid.status).toBe("ERROR");
    expect(invalid.reason).toBe("Invalid sampling bounds");
  }
});

test("sequence cannot report PASS if its budget expires after its last path",()=>{
  const spec=fixture();
  spec.instances=spec.instances.filter(i=>i.id!=="a");
  spec.operations=spec.operations.filter(o=>o.instanceId!=="a");
  spec.operations[0].waypoints=[translationMatrix([13,0,0]),translationMatrix([13,0.25,0])];
  const original=performance.now;
  let calls=0;
  // Entry, step entry, child entry, both pose entries and both collision checks,
  // then child success check all happen within budget; the sequence's own
  // completion check observes the expired deadline.
  Object.defineProperty(performance,"now",{configurable:true,value:()=>++calls<=8?0:100});
  try {
    const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh},budgetMs:1});
    expect(result.status).toBe("NOT_RUN");
    expect(result.results[0].reason).toContain("budget");
  } finally {Object.defineProperty(performance,"now",{configurable:true,value:original});}
});

test("deadline expiry while finalising the sequence remains visible",()=>{
  const spec=fixture();
  spec.instances=spec.instances.filter(i=>i.id!=="a");
  spec.operations=spec.operations.filter(o=>o.instanceId!=="a");
  spec.operations[0].waypoints=[translationMatrix([13,0,0]),translationMatrix([13,0.25,0])];
  const original=performance.now;
  let calls=0;
  Object.defineProperty(performance,"now",{configurable:true,value:()=>++calls<=9?0:100});
  try {
    const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh},budgetMs:1});
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("budget");
    expect(result.results[0].status).toBe("PASS");
  } finally {Object.defineProperty(performance,"now",{configurable:true,value:original});}
});

test("declared helical trajectory expands from the instance pose and checks the full sampled path",()=>{
  const spec=fixture();
  spec.instances=spec.instances.filter(i=>i.id!=="a");
  const trajectory={axis:{origin:[13,0,0],direction:[0,0,1]},hand:"right",leadMm:6,startAngleDeg:0,endAngleDeg:360};
  spec.operations=[{...spec.operations[0],waypoints:[],screwTrajectory:trajectory} as typeof spec.operations[0]];
  const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh},budgetMs:10000});
  expect(result.status).toBe("PASS");
  expect(result.results[0].path?.posesEvaluated).toBe(73);
  // A blocking part half way along the screw cannot be missed by endpoint testing.
  spec.instances[0].transform=translationMatrix([13,0,3]);
  expect(checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh},budgetMs:10000}).status).toBe("FAIL");
});

test("ambiguous screw declarations and trajectories exceeding the sampling budget never pass",()=>{
  const spec=fixture();
  spec.instances=spec.instances.filter(i=>i.id!=="a");
  const trajectory={axis:{origin:[13,0,0],direction:[0,0,1]},hand:"right",leadMm:6,startAngleDeg:0,endAngleDeg:360};
  spec.operations=[{...spec.operations[0],screwTrajectory:trajectory} as typeof spec.operations[0]];
  expect(()=>checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh}})).toThrow("Invalid assembly specification");
  spec.operations=[{...spec.operations[0],waypoints:[],screwTrajectory:{...trajectory,endAngleDeg:100000}} as typeof spec.operations[0]];
  const result=checkDeclaredPoseDisassembly({spec,meshes:{shared:mesh}});
  expect(result.status).toBe("NOT_RUN");
  expect(result.reason).toContain("pose budget");
});
