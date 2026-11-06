import { expect, test } from "bun:test";
import { prismStl } from "../geometry/__tests__/prism";
import { tubeStl } from "../geometry/__tests__/solids";
import { measureRevoluteFit } from "./fit-measurement";
import { checkMeasuredJointFrames, JOINT_FRAME_CONSISTENCY_LIMITS } from "./measured-joint-frame";

const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const spec=()=>({schemaVersion:1,units:"mm",coordinateSystem:"right-handed",
  parts:["bore","shaft"].map(id=>({id,name:id,selector:id,source:"generated",material:null})),
  instances:["bore","shaft"].map(id=>({id,partId:id,subassemblyId:null,transform:[...I]})),
  subassemblies:[],groundedInstanceId:null,connections:[{id:"joint",type:"revolute",a:"bore",b:"shaft",frameA:{origin:[0,0,0],direction:[0,0,1]},frameB:{origin:[0,0,0],direction:[0,0,1]},range:{min:-45,max:45,unit:"deg"},pitchMm:null,ratio:null,allowedContact:[]}],
  motions:[],operations:[],manufacturing:null,assumptions:[],unknowns:[]});
const meshes=()=>({bore:tubeStl({innerRadius:3.2,outerRadius:5,height:10,segments:64}),shaft:prismStl({radius:3,height:12,z0:-1,segments:64})});
function transform(stl:Buffer,angleDeg:number,xOffset:number) {
  const out=Buffer.from(stl),a=angleDeg*Math.PI/180;
  for(let i=0;i<out.readUInt32LE(80);i++)for(let v=0;v<3;v++) {
    const p=84+50*i+12+12*v,x=stl.readFloatLE(p),z=stl.readFloatLE(p+8);
    out.writeFloatLE(Math.cos(a)*x+Math.sin(a)*z+xOffset,p);out.writeFloatLE(-Math.sin(a)*x+Math.cos(a)*z,p+8);
  }
  return out;
}
function measure(declaration:unknown,parts:Record<string,Buffer>,stationsMm?:number[]) {
  const measurement=measureRevoluteFit({spec:declaration,meshes:parts,connectionId:"joint",boreInstanceId:"bore",stationsMm});
  return {measurement,evidence:checkMeasuredJointFrames({spec:declaration,measurement,limits:JOINT_FRAME_CONSISTENCY_LIMITS})};
}

test("real bore/shaft axes remain consistent under a common non-origin instance placement",()=>{
  const declaration=spec();for(const instance of declaration.instances)instance.transform=[0,-1,0,10,1,0,0,20,0,0,1,3,0,0,0,1];
  const result=measure(declaration,meshes());
  expect(result.evidence.status).toBe("PASS");expect(result.evidence.sides).toHaveLength(2);
});

test("two equally displaced features do not hide their mismatch with the declared axis",()=>{
  const parts=meshes();parts.bore=transform(parts.bore,0,.1);parts.shaft=transform(parts.shaft,0,.1);
  const result=measure(spec(),parts);
  expect(result.measurement.status).toBe("MEASURED");expect(result.measurement.axis!.offsetMm).toBeLessThan(1e-4);
  expect(result.evidence.status).toBe("FAIL");
  expect(result.evidence.sides[0].offsetMm).toBeCloseTo(.1,4);
});

test("slightly tilted coaxial features are compared with the declared direction",()=>{
  const parts=meshes();parts.bore=transform(parts.bore,.2,0);parts.shaft=transform(parts.shaft,.2,0);
  const result=measure(spec(),parts);
  expect(result.measurement.status).toBe("MEASURED");expect(result.evidence.status).toBe("FAIL");
  expect(result.evidence.sides[0].angleDeg).toBeCloseTo(.2,2);
});

test("a wrong orthogonal axis or two bores cannot yield a verified joint frame",()=>{
  const parts=meshes();parts.bore=transform(parts.bore,90,0);parts.shaft=transform(parts.shaft,90,0);
  expect(measure(spec(),parts).evidence.status).toBe("ERROR");
  const twoBores=meshes();twoBores.shaft=twoBores.bore;
  const missingPin=measure(spec(),twoBores);
  expect(missingPin.evidence.status).toBe("ERROR");expect(missingPin.measurement.reason).toContain("shaft role");
  const solidAsBore=meshes();solidAsBore.bore=prismStl({radius:3.2,height:10,segments:64});
  const missingHole=measure(spec(),solidAsBore);
  expect(missingHole.evidence.status).toBe("ERROR");expect(missingHole.measurement.reason).toContain("bore role");
});

test("one measured section and invalid numerical limits cannot certify an axis",()=>{
  const result=measure(spec(),meshes(),[5]);
  expect(result.measurement.status).toBe("MEASURED");expect(result.evidence.status).toBe("NOT_RUN");
  expect(checkMeasuredJointFrames({spec:spec(),measurement:result.measurement,limits:{maxOffsetMm:NaN,maxAngleDeg:1}}).status).toBe("ERROR");
});
