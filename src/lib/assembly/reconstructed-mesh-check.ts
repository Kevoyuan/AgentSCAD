import { createHash } from "crypto";
import { readBinaryStl, type Vec3 } from "../geometry/stl-mesh";
import { transformPoint } from "../geometry/mesh-collision";

/** Conservative certificate for equal tessellated surfaces after placement.
 * A different triangulation is NOT_RUN, not proof of different CAD geometry.
 * Winding, watertightness, intended identity and physical function are not checked.
 */
export function checkReconstructedMesh(input: { local: Buffer; posed: Buffer; transform: number[]; toleranceMm?: number }) {
  const tolerance = input.toleranceMm ?? 1e-4;
  const m = [...input.transform];
  if (!(tolerance >= 1e-6 && tolerance <= 0.1) || m.length !== 16 || m.some(x => !Number.isFinite(x))) throw new Error("Invalid reconstruction transform/tolerance");
  if (m.slice(12).some((x, i) => Math.abs(x - (i === 3 ? 1 : 0)) > 1e-8)) throw new Error("Expected homogeneous transform");
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
    const dot = m[a] * m[b] + m[4+a] * m[4+b] + m[8+a] * m[8+b];
    if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-6) throw new Error("Expected rigid transform");
  }
  const det = m[0]*(m[5]*m[10]-m[6]*m[9])-m[1]*(m[4]*m[10]-m[6]*m[8])+m[2]*(m[4]*m[9]-m[5]*m[8]);
  if (Math.abs(det - 1) > 1e-6) throw new Error("Expected right-handed transform");
  const local = readBinaryStl(input.local), posed = readBinaryStl(input.posed);
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const base = { method: "bijective-triangle-vertex-correspondence/v1", localSha256: sha(input.local), posedSha256: sha(input.posed), transform: m, toleranceMm: tolerance,
    coverage: "Unoriented triangulated surfaces at one pose; no watertightness, semantic identity, motion or manufacturing claim." };
  if (local.triangleCount > 50_000 || posed.triangleCount > 50_000) return { ...base, status: "NOT_RUN", reason: "Triangle budget exceeded" };
  const triangles = (coords: Float64Array, matrix?: number[]) => {
    const list: Vec3[][] = [];
    for (let i=0; i<coords.length; i+=9) {
      const t: Vec3[] = [];
      for (let j=0;j<9;j+=3) {
        const v: Vec3 = [coords[i+j],coords[i+j+1],coords[i+j+2]];
        t.push(matrix ? transformPoint(matrix,v) : v);
      }
      list.push(t);
    }
    return list;
  };
  const a = triangles(local.coordinates,m), b = triangles(posed.coordinates);
  const bounds = (ts: Vec3[][]) => {
    const out=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(const t of ts) for(const v of t) for(let k=0;k<3;k++) { out[k]=Math.min(out[k],v[k]);out[k+3]=Math.max(out[k+3],v[k]); }
    return out;
  };
  const ab=bounds(a),bb=bounds(b);
  const bboxErrorMm=Math.max(...ab.map((v,i)=>Math.abs(v-bb[i])));
  if(bboxErrorMm>tolerance) return {...base,status:"FAIL",reason:"Placed export and rendered pose have different bounds",bboxErrorMm};
  if(a.length!==b.length) return {...base,status:"NOT_RUN",reason:"Triangulations differ; surface-distance comparison is required",bboxErrorMm};
  const cell=(t:Vec3[])=>[0,1,2].map(k=>Math.floor((t[0][k]+t[1][k]+t[2][k])/3/tolerance));
  const grid=new Map<string,number[]>();
  b.forEach((t,i)=>{const key=cell(t).join(',');const bucket=grid.get(key)??[];bucket.push(i);grid.set(key,bucket);});
  const used=new Set<number>(); let comparisons=0,maxVertexErrorMm=0;
  const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for(const t of a) {
    const c=cell(t);let match=-1,error=Infinity;
    outer: for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++) {
      for(const i of grid.get([c[0]+x,c[1]+y,c[2]+z].join(','))??[]) {
        if(used.has(i))continue;
        if(++comparisons>1_000_000)return {...base,status:"NOT_RUN",reason:"Correspondence budget exceeded"};
        for(const p of permutations) {
          const e=Math.max(...t.map((v,j)=>Math.hypot(...v.map((n,k)=>n-b[i][p[j]][k]))));
          if(e<=tolerance){match=i;error=e;break outer;}
        }
      }
    }
    if(match<0)return {...base,status:"NOT_RUN",reason:"No triangle correspondence; different tessellation or geometry needs independent surface comparison",bboxErrorMm};
    used.add(match);maxVertexErrorMm=Math.max(maxVertexErrorMm,error);
  }
  return {...base,status:"PASS",reason:"Every transformed exported triangle matches one rendered-pose triangle within tolerance",matchedTriangles:used.size,maxVertexErrorMm,bboxErrorMm};
}
