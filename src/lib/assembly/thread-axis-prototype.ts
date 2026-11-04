import { createHash } from "crypto";
import { meshBounds,readBinaryStl,sectionMesh } from "../geometry/stl-mesh";

/** Exploratory circle-arc fits. Thresholds describe the observable subset, not
 * a calibrated uncertainty bound; no fit from this prototype authorizes PASS.
 * Each part must have a centred, dominating symmetric outer silhouette (the
 * hex heads in the original fixture). Its bbox is used only as a search seed.
 */
export function exploreThreadAxis(stl:Buffer,offsetsMm:number[]) {
  if(offsetsMm.length<3 || offsetsMm.length>16 || offsetsMm.some(v=>!Number.isFinite(v)) || offsetsMm.some((v,i)=>i>0&&v<=offsetsMm[i-1]))throw new Error("Expected 3–16 increasing finite station offsets");
  const mesh=readBinaryStl(stl),bounds=meshBounds(mesh);
  const seed:[number,number]=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2];
  const stations:Array<{z:number;center:[number,number];radiusMm:number;radialRmsMm:number;coverageDeg:number;points:number}>=[];
  let random=1849;
  const pick=(n:number)=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%n;};
  for(const offset of offsetsMm) {
    const z=bounds.min[2]+offset;
    if(z<=bounds.min[2]||z>=bounds.max[2])return {status:"NOT_RUN" as const,reason:"Station outside mesh interior",stations};
    const section=sectionMesh(mesh,[0,0,z],[0,0,1]);
    if(section.dropped||section.segments.length>5000)return {status:"NOT_RUN" as const,reason:"Incomplete or oversized section",stations};
    const unique=new Map<string,[number,number]>();
    for(const e of section.segments)for(const p of [[e.ax,e.ay],[e.bx,e.by]] as Array<[number,number]>) {
      const r=Math.hypot(p[0]-seed[0],p[1]-seed[1]);
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
      if(r<4||r>5.3||Math.hypot(x-seed[0],y-seed[1])>2)continue;
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
    stations.push({z,center:[best.x,best.y],radiusMm:best.r,radialRmsMm:best.rms,coverageDeg:best.coverage,points:best.support.length});
  }
  const meanZ=stations.reduce((s,p)=>s+p.z,0)/stations.length;
  const meanX=stations.reduce((s,p)=>s+p.center[0],0)/stations.length,meanY=stations.reduce((s,p)=>s+p.center[1],0)/stations.length;
  const denom=stations.reduce((s,p)=>s+(p.z-meanZ)**2,0);
  if(denom<0.5)return {status:"NOT_RUN" as const,reason:"Stations are too close to estimate an axis",stations};
  const dx=stations.reduce((s,p)=>s+(p.z-meanZ)*(p.center[0]-meanX),0)/denom;
  const dy=stations.reduce((s,p)=>s+(p.z-meanZ)*(p.center[1]-meanY),0)/denom;
  const residualMm=Math.max(...stations.map(p=>Math.hypot(p.center[0]-(meanX+dx*(p.z-meanZ)),p.center[1]-(meanY+dy*(p.z-meanZ)))));
  return {status:"NOT_RUN" as const,reason:"Exploratory fit only: no independently calibrated bias/uncertainty bound, so alignment cannot pass or fail",stations,
    axis:{point:[meanX,meanY,meanZ],slope:[dx,dy],residualMm},seed,
    artifactSha256:createHash("sha256").update(stl).digest("hex"),
    coverage:"Three or more selected Z sections; radius filter 4–5.3 mm; 0.03 mm radial band; at least 12 unique section points and 120 degrees of arc. The estimated arc may not be the intended thread feature. No physical or continuous-axis proof."};
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
