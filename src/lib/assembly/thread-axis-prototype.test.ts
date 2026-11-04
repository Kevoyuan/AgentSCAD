import { expect,test } from "bun:test";
import { prismStl } from "../geometry/__tests__/prism";
import { exploreThreadAxis,exploreThreadCoaxiality } from "./thread-axis-prototype";
function shiftAndTilt(stl:Buffer,offset:number,slope:number) {
  const copy=Buffer.from(stl), count=copy.readUInt32LE(80);
  for(let i=0;i<count;i++)for(let v=0;v<3;v++) {
    const at=84+i*50+12+12*v;
    copy.writeFloatLE(copy.readFloatLE(at)+offset+slope*copy.readFloatLE(at+8),at);
  }
  return copy;
}
test("axis candidates observe shifted and tilted geometry but cannot assert a calibrated pass",()=>{
  const original=prismStl({radius:4.5,height:10,segments:64});
  const a=exploreThreadAxis(original,[2,5,8]);
  const b=exploreThreadAxis(shiftAndTilt(original,0.5,0.1),[2,5,8]);
  expect(a.status).toBe("NOT_RUN");expect(b.status).toBe("NOT_RUN");
  expect("axis" in a && a.axis).toBeDefined();expect("axis" in b && b.axis).toBeDefined();
  const c=exploreThreadCoaxiality(a,b);
  expect(c.status).toBe("NOT_RUN");
  expect("offsetEstimateMm" in c && c.offsetEstimateMm!).toBeGreaterThan(0.7);
  expect("angleEstimateDeg" in c && c.angleEstimateDeg!).toBeGreaterThan(4);
});
test("unsupported radii and insufficient stations never create a successful axis",()=>{
  expect(()=>exploreThreadAxis(prismStl({radius:4.5,height:10,segments:64}),[2,5])).toThrow();
  const unsupported=exploreThreadAxis(prismStl({radius:1,height:10,segments:64}),[2,5,8]);
  expect(unsupported.status).toBe("NOT_RUN");
  expect("axis" in unsupported).toBe(false);
});
