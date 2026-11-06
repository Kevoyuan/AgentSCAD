import {readBinaryStl} from "../geometry/stl-mesh";

/** Exact STL edge connectivity; never merge near vertices or infer cavity solids. */
export function checkPartConnectivity(stl:Buffer) {
  const base={method:"exact-edge-components-and-separating-plane/v1",coverage:"Stored Float32 mesh coordinates only. A single closed edge-connected surface is not proof of no self-intersections, positive wall thickness, manufacture or function."};
  const result=(status:"PASS"|"FAIL"|"ERROR"|"NOT_RUN",reason:string,components:Array<{min:number[];max:number[]}>=[],separator:null|{axis:number;lower:number;upper:number}=null)=>({...base,status,reason,components,separator});
  if(stl.length>=84&&stl.readUInt32LE(80)>50000)return result("NOT_RUN","Connectivity exceeds the 50000 triangle budget");
  let mesh;try{mesh=readBinaryStl(stl);}catch(e){return result("ERROR",String(e));}
  const parents=Array.from({length:mesh.triangleCount},(_,i)=>i);
  const find=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const edges=new Map<string,{triangle:number;count:number;orientation:number}>();
  for(let i=0;i<mesh.triangleCount;i++){
    const v=[0,1,2].map(j=>Array.from(mesh.coordinates.slice(i*9+j*3,i*9+j*3+3)).join(","));
    const q=mesh.coordinates.slice(i*9,i*9+9),u=[q[3]-q[0],q[4]-q[1],q[5]-q[2]],w=[q[6]-q[0],q[7]-q[1],q[8]-q[2]];
    if(u[1]*w[2]-u[2]*w[1]===0&&u[2]*w[0]-u[0]*w[2]===0&&u[0]*w[1]-u[1]*w[0]===0)return result("ERROR","Zero-area triangle");
    if(new Set(v).size!==3)return result("ERROR","Degenerate triangle vertices");
    for(let j=0;j<3;j++){
      const a=v[j],b=v[(j+1)%3],key=a<b?`${a}|${b}`:`${b}|${a}`,sign=a<b?1:-1;
      const edge=edges.get(key);
      if(edge){parents[find(i)]=find(edge.triangle);edge.count++;edge.orientation+=sign;}
      else edges.set(key,{triangle:i,count:1,orientation:sign});
    }
  }
  if([...edges.values()].some(e=>e.count!==2||e.orientation!==0))return result("NOT_RUN","Open, inconsistently oriented or non-manifold edges prevent closed-surface connectivity certification");
  const groups=new Map<number,{min:number[];max:number[]}>();
  for(let i=0;i<mesh.triangleCount;i++){
    const root=find(i),box=groups.get(root)??{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let j=0;j<3;j++)for(let k=0;k<3;k++){
      const x=mesh.coordinates[i*9+j*3+k];box.min[k]=Math.min(box.min[k],x);box.max[k]=Math.max(box.max[k],x);
    }groups.set(root,box);
  }
  const components=[...groups.values()];
  if(components.length===1)return result("PASS","One closed edge-connected surface; solid validity and minimum connection thickness remain unverified",components);
  for(let axis=0;axis<3;axis++){
    const sorted=[...components].sort((a,b)=>a.min[axis]-b.min[axis]);let upper=sorted[0].max[axis];
    for(const box of sorted.slice(1)){
      if(box.min[axis]-upper>1e-6)return result("FAIL","An empty axis-aligned slab separates this declared part into disconnected pieces",components,{axis,lower:upper,upper:box.min[axis]});
      upper=Math.max(upper,box.max[axis]);
    }
  }
  return result("NOT_RUN","Multiple closed surfaces without a certified separating slab: cavities, touching or overlapping shells require further solid analysis",components);
}
