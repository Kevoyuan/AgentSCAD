#!/usr/bin/env bun
import { readFile,writeFile,mkdir,mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { exploreThreadAxis, exploreThreadCoaxiality } from "../../src/lib/assembly/thread-axis-prototype";

/** Offline research only; no acceptance verdict and no CAD or model calls. */
function deform(stl:Buffer,offsetMm:number,slope:number) {
  const b=Buffer.from(stl), count=b.readUInt32LE(80);
  let minZ=Infinity;
  for(let i=0;i<count;i++)for(let v=0;v<3;v++)minZ=Math.min(minZ,b.readFloatLE(84+i*50+20+12*v));
  for(let i=0;i<count;i++)for(let v=0;v<3;v++) {
    const p=84+i*50+12+12*v;
    b.writeFloatLE(b.readFloatLE(p)+offsetMm+slope*(b.readFloatLE(p+8)-minZ),p);
  }
  return b;
}
async function main() {
  const root=path.resolve(process.argv[2]??'.agentscad/experiments/threaded-fastener-jeYSbU');
  const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  const inputs:Record<string,string>={};
  const results:Array<{turn:number;name:string;bolt:ReturnType<typeof exploreThreadAxis>;nut:ReturnType<typeof exploreThreadAxis>;comparison:ReturnType<typeof exploreThreadCoaxiality>}>=[];
  for(const turn of [90,270]) {
    const [bolt,nut]=await Promise.all(['bolt','nut'].map(part=>readFile(path.join(root,`turn-${turn}-${part}.stl`))));
    inputs[`turn-${turn}-bolt.stl`]=sha(bolt);inputs[`turn-${turn}-nut.stl`]=sha(nut);
    const axis=exploreThreadAxis(bolt,[7.2,11.2,16.2]);
    for(const [name,mesh] of [['actual',nut],['offset_0.4',deform(nut,0.4,0)],['tilt_0.1',deform(nut,0,0.1)]] as Array<[string,Buffer]>) {
      const other=exploreThreadAxis(mesh,[0.6,1.6,3.6]);
      results.push({turn,name,bolt:axis,nut:other,comparison:exploreThreadCoaxiality(axis,other)});
    }
  }
  const store=path.resolve('.agentscad/experiments');await mkdir(store,{recursive:true});
  const directory=await mkdtemp(path.join(store,'thread-axis-holdout-'));
  const algorithm=await readFile('src/lib/assembly/thread-axis-prototype.ts');
  const script=await readFile('scripts/eval/explore-thread-axis.ts');
  const report={status:'NOT_RUN',reason:'Exploratory fit has no independently calibrated uncertainty bound.',inputRoot:root,inputs,
    codeSha256:{algorithm:sha(algorithm),script:sha(script)},stationOffsetsMm:{bolt:[7.2,11.2,16.2],nut:[0.6,1.6,3.6]},results};
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(directory,'algorithm.ts'),algorithm);
  await writeFile(path.join(directory,'experiment.ts'),script);
  console.log(JSON.stringify({directory,status:report.status,inputs,results:results.map(r=>({turn:r.turn,name:r.name,comparison:r.comparison}))},null,2));
  if(results.some(r=>r.comparison.status!=='NOT_RUN'))throw new Error('Uncalibrated result must never report a pass');
}
main().catch(error=>{console.error(error);process.exitCode=2;});
