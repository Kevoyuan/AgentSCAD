import { createHash } from "crypto";
import { castRadialProfile,meshBounds,readBinaryStl,sectionMesh } from "../geometry/stl-mesh";
import { buildBvh,classifyClosedSolidPoint,placeBvh } from "../geometry/mesh-collision";
import { selectEnclosingContour } from "../geometry/section-contours";
import { fitCircleXZ as fitCircle2D } from "./slider-crank-motion";

export interface ExploratoryFeatureBinding {
  /** Caller-selected point in every selected XY section, in mesh coordinates. */
  seedMm: [number, number];
  role: "bore" | "shaft";
  /** Endpoint sampling is experimental. A segment is selected if at least one ray hits it first. */
  sampling?: "ray-hits" | "visible-segment-endpoints" | "enclosing-contour-endpoints";
  circleFit?: "three-point" | "least-squares-support";
}

/** Exploratory circle-arc fits. Thresholds describe the observable subset, not
 * a calibrated uncertainty bound; no fit from this prototype authorizes PASS.
 * Without a binding, each part needs a centred, dominating symmetric outer
 * silhouette whose bbox supplies a search seed. An explicit binding selects
 * the nearest surface visible from its declared seed at each section.
 */
export function exploreThreadAxis(stl:Buffer,offsetsMm:number[],binding?:ExploratoryFeatureBinding) {
  if(offsetsMm.length<3 || offsetsMm.length>16 || offsetsMm.some(v=>!Number.isFinite(v)) || offsetsMm.some((v,i)=>i>0&&v<=offsetsMm[i-1]))throw new Error("Expected 3–16 increasing finite station offsets");
  if(binding && (!Array.isArray(binding.seedMm) || binding.seedMm.length!==2 || !binding.seedMm.every(Number.isFinite) || !["bore","shaft"].includes(binding.role)))throw new Error("Expected a finite feature seed and bore or shaft role");
  if(binding?.sampling && !["ray-hits","visible-segment-endpoints","enclosing-contour-endpoints"].includes(binding.sampling))throw new Error("Unsupported feature sampling method");
  if(binding?.circleFit && !["three-point","least-squares-support"].includes(binding.circleFit))throw new Error("Unsupported circle fit method");
  const mesh=readBinaryStl(stl),bounds=meshBounds(mesh);
  const seed:[number,number]=binding ? [...binding.seedMm] : [(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2];
  const placed=binding ? placeBvh(buildBvh(mesh)) : null;
  const stations:Array<{z:number;center:[number,number];radiusMm:number;radialRmsMm:number;coverageDeg:number;points:number;candidatePoints:number;candidatePointsSha256:string}>=[];
  let random=1849;
  const pick=(n:number)=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%n;};
  for(const offset of offsetsMm) {
    const z=bounds.min[2]+offset;
    if(z<=bounds.min[2]||z>=bounds.max[2])return {status:"NOT_RUN" as const,reason:"Station outside mesh interior",stations};
    const section=sectionMesh(mesh,[0,0,z],[0,0,1]);
    if(section.dropped||section.segments.length>5000)return {status:"NOT_RUN" as const,reason:"Incomplete or oversized section",stations};
    const unique=new Map<string,[number,number]>();
    let fitSeed:[number,number]=seed;
    let candidates:Array<[number,number]>;
    if(binding && placed) {
      // Reject invalid boundary topology before role inference. Union membership
      // keeps overlapping material shells from being mistaken for a bore void.
      const membership=classifyClosedSolidPoint([seed[0],seed[1],z],placed);
      const expected=binding.role==="bore" ? "OUTSIDE" : "INSIDE";
      if(membership!==expected)return {status:"NOT_RUN" as const,reason:"Feature seed does not satisfy the declared role at a station",stations};
      if(binding.sampling==="enclosing-contour-endpoints") {
        const contour=selectEnclosingContour(section,seed);
        if(contour.status!=="SELECTED")return {status:"NOT_RUN" as const,reason:contour.reason,stations};
        candidates=contour.points;
        // The declared seed selects the loop. Filtering and fit search are
        // anchored to that loop's bounds so they cannot reintroduce seed bias.
        fitSeed=[(Math.min(...candidates.map(p=>p[0]))+Math.max(...candidates.map(p=>p[0])))/2,
          (Math.min(...candidates.map(p=>p[1]))+Math.max(...candidates.map(p=>p[1])))/2];
      } else {
        const profile=castRadialProfile(section,seed,720,20);
        if(profile.misses)return {status:"NOT_RUN" as const,reason:"Feature seed has an incomplete nearest-surface radial profile",stations};
        if(binding.sampling==="visible-segment-endpoints") {
          const visible=new Set(profile.segmentIndices);
          // Retain mesh segment order so ray order cannot change the fit's input
          // ordering when two seeds select the same segment set.
          candidates=section.segments.flatMap((segment,index)=>visible.has(index)
            ? [[segment.ax,segment.ay],[segment.bx,segment.by]] as Array<[number,number]> : []);
        } else {
          candidates=Array.from({length:profile.radii.length},(_,i)=>[profile.points[2*i],profile.points[2*i+1]]);
        }
      }
    } else {
      candidates=section.segments.flatMap(e=>[[e.ax,e.ay],[e.bx,e.by]] as Array<[number,number]>);
    }
    for(const p of candidates) {
      const r=Math.hypot(p[0]-fitSeed[0],p[1]-fitSeed[1]);
      if(r>=3.3&&r<=6.5)unique.set(`${Math.round(p[0]*10000)},${Math.round(p[1]*10000)}`,p);
    }
    const points=[...unique.values()];
    if(points.length<12||points.length>5000)return {status:"NOT_RUN" as const,reason:"Insufficient or excessive distinct feature points",stations};
    let best:{x:number;y:number;r:number;support:Array<[number,number]>;rms:number;coverage:number}|null=null;
    for(let iteration=0;iteration<5000;iteration++) {
      const a=points[pick(points.length)],b=points[pick(points.length)],c=points[pick(points.length)];
      const d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));
      if(Math.abs(d)<0.01)continue;
      const aa=a[0]**2+a[1]**2,bb=b[0]**2+b[1]**2,cc=c[0]**2+c[1]**2;
      const x=(aa*(b[1]-c[1])+bb*(c[1]-a[1])+cc*(a[1]-b[1]))/d;
      const y=(aa*(c[0]-b[0])+bb*(a[0]-c[0])+cc*(b[0]-a[0]))/d;
      const r=Math.hypot(a[0]-x,a[1]-y);
      if(r<4||r>5.3||Math.hypot(x-fitSeed[0],y-fitSeed[1])>2)continue;
      const support=points.filter(p=>Math.abs(Math.hypot(p[0]-x,p[1]-y)-r)<=0.03);
      if(support.length<12||(best&&support.length<=best.support.length))continue;
      const angles=support.map(p=>Math.atan2(p[1]-y,p[0]-x)).sort((p,q)=>p-q);
      const gaps=angles.map((v,i)=>(i+1<angles.length?angles[i+1]:angles[0]+2*Math.PI)-v);
      const coverage=(2*Math.PI-Math.max(...gaps))*180/Math.PI;
      const rms=Math.sqrt(support.reduce((sum,p)=>sum+(Math.hypot(p[0]-x,p[1]-y)-r)**2,0)/support.length);
      if(coverage<120||rms>0.03)continue;
      best={x,y,r,support,rms,coverage};
    }
    if(!best)return {status:"NOT_RUN" as const,reason:"No sufficiently supported circular arc at a station",stations};
    if(binding?.circleFit==="least-squares-support") {
      // Reuse the coordinate-independent two-dimensional fit on the frozen
      // consensus support. The helper's XZ field holds this section's XY pair.
      const refined=fitCircle2D(best.support);
      if(!refined)return {status:"NOT_RUN" as const,reason:"Consensus circle refit is singular",stations};
      const [x,y]=refined.centerXZ;
      const r=refined.radiusMm;
      const angles=best.support.map(p=>Math.atan2(p[1]-y,p[0]-x)).sort((a,b)=>a-b);
      const gaps=angles.map((a,i)=>(i+1<angles.length?angles[i+1]:angles[0]+2*Math.PI)-a);
      const coverage=(2*Math.PI-Math.max(...gaps))*180/Math.PI;
      const rms=Math.sqrt(best.support.reduce((sum,p)=>sum+(Math.hypot(p[0]-x,p[1]-y)-r)**2,0)/best.support.length);
      if(![x,y,r,rms,coverage].every(Number.isFinite)||r<4||r>5.3||Math.hypot(x-fitSeed[0],y-fitSeed[1])>2||coverage<120||rms>0.03) {
        return {status:"NOT_RUN" as const,reason:"Consensus refit falls outside the original circle domain",stations};
      }
      best={x,y,r,support:best.support,rms,coverage};
    }
    stations.push({z,center:[best.x,best.y],radiusMm:best.r,radialRmsMm:best.rms,coverageDeg:best.coverage,points:best.support.length,
      candidatePoints:points.length,candidatePointsSha256:createHash("sha256").update(JSON.stringify(points)).digest("hex")});
  }
  const meanZ=stations.reduce((s,p)=>s+p.z,0)/stations.length;
  const meanX=stations.reduce((s,p)=>s+p.center[0],0)/stations.length,meanY=stations.reduce((s,p)=>s+p.center[1],0)/stations.length;
  const denom=stations.reduce((s,p)=>s+(p.z-meanZ)**2,0);
  if(denom<0.5)return {status:"NOT_RUN" as const,reason:"Stations are too close to estimate an axis",stations};
  const dx=stations.reduce((s,p)=>s+(p.z-meanZ)*(p.center[0]-meanX),0)/denom;
  const dy=stations.reduce((s,p)=>s+(p.z-meanZ)*(p.center[1]-meanY),0)/denom;
  const residualMm=Math.max(...stations.map(p=>Math.hypot(p.center[0]-(meanX+dx*(p.z-meanZ)),p.center[1]-(meanY+dy*(p.z-meanZ)))));
  return {status:"NOT_RUN" as const,reason:"Exploratory fit only: no independently calibrated bias/uncertainty bound, so alignment cannot pass or fail",stations,
    axis:{point:[meanX,meanY,meanZ],slope:[dx,dy],residualMm},seed,binding:binding ? {seedMm:[...seed],role:binding.role,sampling:binding.sampling??"ray-hits",circleFit:binding.circleFit??"three-point",
      method:binding.sampling==="enclosing-contour-endpoints"?"enclosing-contour-from-declared-seed/v1":"nearest-surface-from-declared-seed/v1"} : null,
    artifactSha256:createHash("sha256").update(stl).digest("hex"),
    coverage:"Three or more selected Z sections; radius filter 4–5.3 mm; 0.03 mm radial band; at least 12 unique points and 120 degrees of arc. Bound role uses closed-shell union membership. Ray methods use 720 nearest-surface rays within 20 mm and assume a star-shaped section. Endpoint sampling takes both endpoints of first-hit segments; endpoint visibility is unverified. Contour sampling uses the smallest enclosing degree-two loop with a 1e-7 mm join tolerance and anchors filtering/search to its bounding-box center. Nested cavities are filled conservatively. Segment-interior self-crossing, feature identity and calibrated uncertainty remain unverified."};
}

/** Compares exploratory lines only where the measured station intervals overlap.
 * This is not a calibrated acceptance check and therefore always returns NOT_RUN.
 */
export function exploreThreadCoaxiality(bolt:ReturnType<typeof exploreThreadAxis>,nut:ReturnType<typeof exploreThreadAxis>) {
  if(!('axis' in bolt)||!('axis' in nut)||!bolt.axis||!nut.axis)return {status:"NOT_RUN" as const,reason:"Both exploratory axes are required"};
  const low=Math.max(bolt.stations[0].z,nut.stations[0].z),high=Math.min(bolt.stations.at(-1)!.z,nut.stations.at(-1)!.z);
  if(high<low)return {status:"NOT_RUN" as const,reason:"Measured station ranges do not overlap; axis extrapolation is not supported"};
  const z=(low+high)/2;
  const center=(a:NonNullable<typeof bolt.axis>)=>[a.point[0]+a.slope[0]*(z-a.point[2]),a.point[1]+a.slope[1]*(z-a.point[2])];
  const a=center(bolt.axis),b=center(nut.axis);
  const v=[bolt.axis.slope[0],bolt.axis.slope[1],1],w=[nut.axis.slope[0],nut.axis.slope[1],1];
  const dot=v.reduce((s,x,i)=>s+x*w[i],0)/(Math.hypot(...v)*Math.hypot(...w));
  return {status:"NOT_RUN" as const,reason:"Exploratory axis comparison has no calibrated error bound",referenceZMm:z,offsetEstimateMm:Math.hypot(a[0]-b[0],a[1]-b[1]),angleEstimateDeg:Math.acos(Math.min(1,Math.max(-1,dot)))*180/Math.PI};
}
