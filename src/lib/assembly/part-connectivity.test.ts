import {test,expect} from "bun:test";
import {checkPartConnectivity} from "./part-connectivity";
function tetra(size=1,offset=[0,0,0]){
 const p=[[0,0,0],[size,0,0],[0,size,0],[0,0,size]].map(v=>v.map((x,k)=>x+offset[k]));
 return [[0,2,1],[0,1,3],[0,3,2],[1,2,3]].map(t=>t.map(i=>p[i]));
}
function stl(triangles:number[][][]){const b=Buffer.alloc(84+50*triangles.length);b.writeUInt32LE(triangles.length,80);triangles.forEach((t,i)=>t.flat().forEach((x,j)=>b.writeFloatLE(x,84+50*i+12+4*j)));return b;}
test("single closed surface passes the limited connectivity check",()=>{
 const r=checkPartConnectivity(stl(tetra()));expect(r.status).toBe("PASS");expect(r.components.length).toBe(1);
});
test("two separated closed pieces fail with an actual separating slab",()=>{
 const r=checkPartConnectivity(stl([...tetra(),...tetra(1,[3,0,0])]));expect(r.status).toBe("FAIL");expect(r.separator).toEqual({axis:0,lower:1,upper:3});
});
test("nested cavity surfaces are not mistaken for separate manufactured parts",()=>{
 const r=checkPartConnectivity(stl([...tetra(10),...tetra(1,[1,1,1]).map(t=>[...t].reverse())]));expect(r.status).toBe("NOT_RUN");expect(r.components.length).toBe(2);
});
test("point touching and overlapping shells are not certified as robust connections",()=>{
 for(const x of [1,.5])expect(checkPartConnectivity(stl([...tetra(),...tetra(1,[x,0,0])])).status).toBe("NOT_RUN");
});
test("open, malformed and oversized inputs cannot pass",()=>{
 expect(checkPartConnectivity(stl(tetra().slice(1))).status).toBe("NOT_RUN");
 expect(checkPartConnectivity(Buffer.alloc(2)).status).toBe("ERROR");
 const b=Buffer.alloc(84);b.writeUInt32LE(50001,80);expect(checkPartConnectivity(b).status).toBe("NOT_RUN");
});
