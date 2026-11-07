import {test,expect} from "bun:test";
import {sampleRigidTrajectory} from "./rigid-trajectory";
import {translationMatrix} from "./path-and-motion";
import {validateAssemblySpec} from "./assembly-spec";
import {checkDeclaredPoseDisassembly} from "./declared-pose-disassembly";
import {checkDeclaredPoseAssembly} from "./declared-pose-assembly";
import {boxStl} from "../geometry/__tests__/solids";
import fixture from "../../../scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json";

const rotate={type:"rotate",axis:{origin:[0,0,0],direction:[0,0,1]},angleDeg:90};
const trajectory={traversal:"forward",stages:[rotate,{type:"translate",deltaMm:[3,0,0]}]};
const bounds={maxTranslationStepMm:.25,maxRotationStepDeg:5};
test("stages use declared world axes and order, not interpolation between two matrices",()=>{
 const result=sampleRigidTrajectory({assembledPose:translationMatrix([2,0,0]),trajectory,...bounds});
 const end=result.poses.at(-1)!;
 expect(end[3]).toBeCloseTo(3,9);expect(end[7]).toBeCloseTo(2,9);expect(end[11]).toBe(0);
 expect(end.slice(12)).toEqual([0,0,0,1]);
 expect(result.collision.status).toBe("NOT_RUN");expect(result.physical.status).toBe("NOT_RUN");
 for(let i=1;i<result.poses.length;i++){
  const a=result.poses[i-1],b=result.poses[i];
  expect(Math.hypot(b[3]-a[3],b[7]-a[7],b[11]-a[11])).toBeLessThanOrEqual(.25+1e-9);
 }
 const swapped=sampleRigidTrajectory({assembledPose:translationMatrix([2,0,0]),trajectory:{...trajectory,stages:[trajectory.stages[1],rotate]},...bounds});
 expect(swapped.poses.at(-1)![3]).toBeCloseTo(0,9);expect(swapped.poses.at(-1)![7]).toBeCloseTo(5,9);
});
test("explicit reverse is the same sampled route backwards, including offset rotations",()=>{
 const input={assembledPose:translationMatrix([3,0,0]),trajectory:{traversal:"forward",stages:[{...rotate,axis:{origin:[1,0,0],direction:[0,0,2]}}]},...bounds};
 const forward=sampleRigidTrajectory(input);
 const reverse=sampleRigidTrajectory({...input,trajectory:{...input.trajectory,traversal:"reverse"}});
 expect(forward.poses.at(-1)![3]).toBeCloseTo(1,9);expect(forward.poses.at(-1)![7]).toBeCloseTo(2,9);
 expect(reverse.poses).toEqual([...forward.poses].reverse());
});
test("multiple complete turns are sampled, not collapsed to their equal endpoints",()=>{
 const result=sampleRigidTrajectory({assembledPose:translationMatrix([0,0,0]),trajectory:{traversal:"forward",stages:[{...rotate,angleDeg:-720}]},...bounds});
 expect(result.poseCount).toBe(145);
 expect(result.poses[18][1]).toBeCloseTo(1,9); // negative 90 degrees
 expect(result.poses.at(-1)![0]).toBeCloseTo(1,9);
});
test("invalid, ambiguous and over-budget trajectories never degrade to endpoint-only checks",()=>{
 const input={assembledPose:translationMatrix([0,0,0]),trajectory,...bounds};
 expect(()=>sampleRigidTrajectory({...input,maxPoses:2})).toThrow("sampling budget");
 expect(()=>sampleRigidTrajectory({...input,trajectory:{traversal:"forward",stages:[{...rotate,angleDeg:0}]}})).toThrow();
 expect(()=>sampleRigidTrajectory({...input,trajectory:{traversal:"forward",stages:[{type:"translate",deltaMm:[0,0,0]}]}})).toThrow();
 const operation={id:"remove",action:"disassemble",instanceId:"moving-instance",waypoints:[],tools:[],rigidTrajectory:trajectory};
 expect(validateAssemblySpec({...fixture,operations:[operation]}).success).toBe(true);
 expect(validateAssemblySpec({...fixture,operations:[{...operation,action:"assemble"}]}).success).toBe(false);
 expect(validateAssemblySpec({...fixture,operations:[{...operation,waypoints:[translationMatrix([0,0,0])]}]}).success).toBe(false);
});
test("the existing collision and inventory checks remain authoritative after expansion",()=>{
 const spec={schemaVersion:1,units:"mm",coordinateSystem:"right-handed",parts:[{id:"body",name:"Body",selector:"body",source:"generated",material:null}],
  instances:[{id:"base",partId:"body",subassemblyId:null,transform:translationMatrix([0,3,0])},{id:"moving",partId:"body",subassemblyId:null,transform:translationMatrix([0,0,0])}],
  groundedInstanceId:"base",connections:[],subassemblies:[],motions:[],manufacturing:null,assumptions:[],unknowns:[],
  operations:[{id:"remove",action:"disassemble",instanceId:"moving",tools:[],waypoints:[],rigidTrajectory:{traversal:"forward",stages:[{type:"translate",deltaMm:[0,6,0]}]}}]};
 const meshes={body:boxStl([0,0,0],[1,1,1])};
 expect(checkDeclaredPoseDisassembly({spec,meshes}).status).toBe("FAIL");
 const insertion={...spec,operations:[{...spec.operations[0],action:"assemble",rigidTrajectory:{...spec.operations[0].rigidTrajectory,traversal:"reverse"}}]};
 expect(checkDeclaredPoseAssembly({spec:insertion,meshes}).status).toBe("FAIL");
 const clear={...spec,instances:[{...spec.instances[0],transform:translationMatrix([3,3,0])},spec.instances[1]]};
 const before=JSON.stringify(clear);
 const removed=checkDeclaredPoseDisassembly({spec:clear,meshes});
 expect(removed.status).toBe("PASS");
 expect(removed.trajectoryExpansions[0].expansion.poseCount).toBe(25);
 const inserted=checkDeclaredPoseAssembly({spec:{...clear,operations:insertion.operations},meshes});
 expect(inserted.status).toBe("PASS");expect(JSON.stringify(clear)).toBe(before);
 const over=checkDeclaredPoseDisassembly({spec:{...clear,operations:[{...clear.operations[0],rigidTrajectory:{traversal:"forward",stages:[{type:"translate",deltaMm:[0,3000,0]}]}}]},meshes});
 expect(over.status).toBe("NOT_RUN");expect(over.results).toHaveLength(0);
});
