/** Original indexed reference surface, independent of OpenSCAD and the axis estimator. */
export interface ThreadReferenceGeometry {
  minorRadiusMm: number; majorRadiusMm: number; outerRadiusMm: number;
  heightMm: number; pitchMm: number; centerMm: [number, number];
}
type Point = [number, number, number];

export function generateThreadReference(g: ThreadReferenceGeometry, angularMultiplier: number, layersPerMm: number, phaseDeg: number) {
  if (![...Object.values(g).filter(v=>typeof v==="number"), ...g.centerMm, angularMultiplier, layersPerMm, phaseDeg].every(Number.isFinite) ||
      g.minorRadiusMm<=0 || g.majorRadiusMm<=g.minorRadiusMm || g.outerRadiusMm<=g.majorRadiusMm || g.heightMm<=0 || g.pitchMm<=0 ||
      !Number.isInteger(angularMultiplier) || angularMultiplier<1 || angularMultiplier>8 || layersPerMm<=0) throw new Error("Invalid reference geometry");
  const count = 20 * angularMultiplier;
  const layers = Math.ceil(g.heightMm * layersPerMm);
  if (layers<1 || layers>512) throw new Error("Reference layer budget exceeded");
  const vertices: Point[] = [];
  const faces: Array<[number,number,number]> = [];
  const innerRadius = (degrees: number) => {
    const t = ((degrees%360)+360)%360;
    if (t<=90) return g.minorRadiusMm;
    if (t<108) return g.minorRadiusMm+(g.majorRadiusMm-g.minorRadiusMm)*(t-90)/18;
    if (t<=342) return g.majorRadiusMm;
    return g.majorRadiusMm-(g.majorRadiusMm-g.minorRadiusMm)*(t-342)/18;
  };
  const index = (layer: number, outer: boolean, node: number) => (layer*2+(outer?1:0))*count+node%count;
  for (let layer=0;layer<=layers;layer++) {
    const z = layer*g.heightMm/layers;
    for (const outer of [false,true]) for (let node=0;node<count;node++) {
      const theta = node*360/count;
      const angle = (theta+phaseDeg+360*z/g.pitchMm)*Math.PI/180;
      const r = outer?g.outerRadiusMm:innerRadius(theta);
      vertices.push([g.centerMm[0]+r*Math.cos(angle),g.centerMm[1]+r*Math.sin(angle),z]);
    }
  }
  for (let layer=0;layer<layers;layer++) for (let node=0;node<count;node++) {
    for (const outer of [false,true]) {
      const a=index(layer,outer,node),b=index(layer,outer,node+1),c=index(layer+1,outer,node+1),d=index(layer+1,outer,node);
      faces.push(...(outer ? [[a,b,c],[a,c,d]] : [[a,c,b],[a,d,c]]) as Array<[number,number,number]>);
    }
  }
  for (let node=0;node<count;node++) for (const top of [false,true]) {
    const layer=top?layers:0;
    const a=index(layer,true,node),b=index(layer,true,node+1),c=index(layer,false,node+1),d=index(layer,false,node);
    faces.push(...(top ? [[a,b,c],[a,c,d]] : [[a,c,b],[a,d,c]]) as Array<[number,number,number]>);
  }
  const stl=Buffer.alloc(84+50*faces.length);
  stl.writeUInt32LE(faces.length,80);
  faces.forEach((face,i)=>{
    const [a,b,c]=face.map(n=>vertices[n]);
    const u=b.map((v,k)=>v-a[k]),v=c.map((w,k)=>w-a[k]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...normal);
    if(length<=1e-12) throw new Error("Reference has a degenerate triangle");
    normal.forEach((n,k)=>stl.writeFloatLE(n/length,84+i*50+k*4));
    [a,b,c].forEach((p,j)=>p.forEach((n,k)=>stl.writeFloatLE(n,84+i*50+12+j*12+k*4)));
  });
  return {stl,triangleCount:faces.length,vertexCount:vertices.length,layers,angularNodes:count};
}
