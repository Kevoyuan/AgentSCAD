import { validateAssemblySpec } from "./assembly-spec";
import type { RevoluteFitMeasurement } from "./fit-measurement";
import { cross, dot, normalize, subtract, type Vec3 } from "../geometry/stl-mesh";
import { transformPoint } from "../geometry/mesh-collision";

/** Digital representation-consistency limits; not printer or bearing tolerances. */
export const JOINT_FRAME_CONSISTENCY_LIMITS = Object.freeze({maxOffsetMm:0.01,maxAngleDeg:0.1});
export interface MeasuredJointFrameEvidence {
  connectionId:string;
  status:"PASS"|"FAIL"|"ERROR"|"NOT_RUN";
  reason:string;
  method:"sampled-cylindrical-axes-vs-declared-frames/v1";
  limits:{maxOffsetMm:number;maxAngleDeg:number};
  sides:Array<{instanceId:string;role:"bore"|"shaft";offsetMm:number;angleDeg:number;stationCount:number;lateralDeviationMm:number;
    declaredAxis:{point:Vec3;direction:Vec3};measuredAxis:{point:Vec3;direction:Vec3};materialAtStations:Array<{offsetMm:number;state:string}>}>;
  measuredPair:{offsetMm:number;angleDeg:number}|null;
  coverage:string;
}

/** Undirected axes; opposite parameter directions do not change a geometric line. */
function compare(a:{point:Vec3;direction:Vec3},b:{point:Vec3;direction:Vec3}) {
  const da=normalize(a.direction),db=normalize(b.direction),delta=subtract(b.point,a.point);
  const offsetMm=Math.hypot(...cross(delta,da));
  const angleDeg=Math.atan2(Math.hypot(...cross(da,db)),Math.abs(dot(da,db)))*180/Math.PI;
  if(![offsetMm,angleDeg].every(Number.isFinite))throw new Error("Nonfinite axis comparison");
  return {offsetMm,angleDeg};
}

/**
 * A comparison of deterministic mesh measurements, never JSON self-attestation.
 * The supplied measurement must originate from measureRevoluteFit. Its section
 * axes are seeded by the declaration; this does not independently search for a
 * different hole or prove semantic feature identity. Failure to measure is not
 * reinterpreted as an observed wrong axis.
 */
export function checkMeasuredJointFrames(input:{
  spec:unknown;
  measurement:RevoluteFitMeasurement;
  limits:{maxOffsetMm:number;maxAngleDeg:number};
}):MeasuredJointFrameEvidence {
  const limits={...input.limits};
  const base:MeasuredJointFrameEvidence={connectionId:input.measurement.connectionId,status:"NOT_RUN",reason:"",method:"sampled-cylindrical-axes-vs-declared-frames/v1",limits,sides:[],measuredPair:null,
    coverage:"Both selected mating features at their measured axial stations, using material-role-checked sections. Offset is perpendicular distance at the reported station reference. Declared seed/role selection and cylindrical-domain assumptions remain; no independent semantic identity, continuous surface or manufacturing error bound."};
  const finish=(status:MeasuredJointFrameEvidence["status"],reason:string)=>({...base,status,reason});
  if(!Number.isFinite(limits.maxOffsetMm)||limits.maxOffsetMm<0||!Number.isFinite(limits.maxAngleDeg)||limits.maxAngleDeg<0||limits.maxAngleDeg>90)return finish("ERROR","Invalid digital joint-frame consistency limits.");
  const checked=validateAssemblySpec(input.spec);
  if(!checked.success)return finish("ERROR","Invalid assembly specification.");
  const connection=checked.data.connections.find(item=>item.id===input.measurement.connectionId);
  if(!connection||(connection.type!=="revolute"&&connection.type!=="prismatic"))return finish("NOT_RUN","No supported cylindrical joint connection for the measured features.");
  const measurement=input.measurement;
  if(measurement.status!=="MEASURED")return finish(measurement.status,`Mating features were not measured: ${measurement.reason}`);
  const sides=[measurement.bore,measurement.shaft];
  if(!sides[0]||!sides[1]||new Set(sides.map(side=>side!.instanceId)).size!==2||!sides.every(side=>side!.instanceId===connection.a||side!.instanceId===connection.b))return finish("ERROR","Measured feature instances do not match the connection.");
  try {
    for(const side of sides) {
      const axis=side!.axisInAssembly;
      if(!axis||side!.measurement.stations.length<2)return finish("NOT_RUN","At least two measured station centres are needed for each feature axis.");
      const expectedMaterial=side!.role==="bore"?"OUTSIDE":"INSIDE";
      if(!side!.measurement.stations.every(station=>station.materialState===expectedMaterial))return finish("ERROR","Measured station material-role evidence is missing or inconsistent.");
      const instance=checked.data.instances.find(item=>item.id===side!.instanceId)!;
      if(instance.partId!==side!.partId)return finish("ERROR","Measured part identity does not match its declared instance.");
      const frame=side!.instanceId===connection.a?connection.frameA:connection.frameB;
      if(!frame)return finish("NOT_RUN","A declared local joint frame is missing.");
      const m=instance.transform,d=frame.direction;
      const declared={point:transformPoint(m,frame.origin),direction:normalize([m[0]*d[0]+m[1]*d[1]+m[2]*d[2],m[4]*d[0]+m[5]*d[1]+m[6]*d[2],m[8]*d[0]+m[9]*d[1]+m[10]*d[2]])};
      const comparison=compare(declared,axis);
      const lateralDeviationMm=side!.measurement.axis?.lateralDeviationMm;
      if(lateralDeviationMm===undefined||!Number.isFinite(lateralDeviationMm))return finish("ERROR","Feature-axis straightness was not recorded.");
      base.sides.push({instanceId:side!.instanceId,role:side!.role,...comparison,stationCount:side!.measurement.stations.length,lateralDeviationMm,
        declaredAxis:declared,measuredAxis:{point:[...axis.point],direction:[...axis.direction]},
        materialAtStations:side!.measurement.stations.map(station=>({offsetMm:station.offsetMm,state:station.materialState!}))});
    }
    base.measuredPair=compare(sides[0]!.axisInAssembly!,sides[1]!.axisInAssembly!);
    const failures=base.sides.filter(side=>side.offsetMm>limits.maxOffsetMm||side.angleDeg>limits.maxAngleDeg||side.lateralDeviationMm>limits.maxOffsetMm);
    if(failures.length)return finish("FAIL",`Measured feature axes disagree with their declared frames: ${failures.map(side=>`${side.instanceId}: offset ${side.offsetMm.toFixed(6)} mm, angle ${side.angleDeg.toFixed(6)}°, lateral deviation ${side.lateralDeviationMm.toFixed(6)} mm`).join("; ")}. Limits ${limits.maxOffsetMm} mm / ${limits.maxAngleDeg}° apply to digital consistency, not physical fit.`);
    if(base.measuredPair.offsetMm>limits.maxOffsetMm||base.measuredPair.angleDeg>limits.maxAngleDeg)return finish("FAIL",`Measured mating axes do not coincide: offset ${base.measuredPair.offsetMm.toFixed(6)} mm, angle ${base.measuredPair.angleDeg.toFixed(6)}° against digital consistency limits ${limits.maxOffsetMm} mm / ${limits.maxAngleDeg}°.`);
    return finish("PASS","Both measured mating axes agree with the declared frames and each other within the stated digital consistency limits at the sampled stations.");
  } catch(error) {
    return finish("ERROR",`Measured joint axes could not be compared: ${error instanceof Error?error.message:String(error)}`);
  }
}
