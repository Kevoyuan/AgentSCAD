#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkTranslationProbe } from "../../src/lib/assembly/translation-probe";

async function main() {
  if(!process.argv[2])throw new Error("Supply a retained guided-disassembly artifact directory");
  const directory=path.resolve(process.argv[2]);
  const [slider,frame,guide]=await Promise.all(["slider","frame","guide_front"].map(id=>readFile(path.join(directory,`${id}.stl`))));
  const probes: Array<{id:string;translationMm:[number,number,number];samples:number;expected:"clear"|"blocked"}>=[
    {id:"positive-x",translationMm:[1,0,0],samples:21,expected:"blocked"},
    {id:"negative-x",translationMm:[-1,0,0],samples:21,expected:"blocked"},
    {id:"positive-y",translationMm:[0,1,0],samples:21,expected:"blocked"},
    {id:"negative-y",translationMm:[0,-1,0],samples:21,expected:"blocked"},
    {id:"working-z-stroke",translationMm:[0,0,-16],samples:65,expected:"clear"},
  ];
  const results=probes.map(probe=>({id:probe.id,...checkTranslationProbe({...probe,moving:slider,obstacles:{frame,guide_front:guide}})}));
  const released=checkTranslationProbe({moving:slider,obstacles:{frame},translationMm:[0,1,0],samples:21,expected:"clear"});
  const coverProbes: Array<{id:string;translationMm:[number,number,number];samples:number;expected:"clear"|"blocked"}> = [
    {id:"cover-forward",translationMm:[0,1,0],samples:21,expected:"blocked"},
    {id:"cover-backward",translationMm:[0,-1,0],samples:21,expected:"blocked"},
    {id:"cover-downward",translationMm:[0,0,-1],samples:21,expected:"blocked"},
    {id:"cover-release",translationMm:[0,0,40],samples:161,expected:"clear"},
  ];
  const coverResults=coverProbes.map(p=>({id:p.id,...checkTranslationProbe({...p,moving:guide,obstacles:{frame}})}));
  const report={coverResults,scope:"Slider, frame and front guide only; crank/rod/key deliberately excluded to isolate the guide. No complete mechanism DOF claim.",results,released};
  await writeFile(path.join(directory,"guide-probes.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({directory,...report},null,2));
  process.exitCode=[...results,...coverResults].every(r=>r.status==='PASS')&&released.status==='PASS'?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=2;});
