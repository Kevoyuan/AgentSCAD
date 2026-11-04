#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkTranslationProbe } from "../../src/lib/assembly/translation-probe";
async function main() {
  if(!process.argv[2])throw new Error("Supply a shaft-keyed disassembly artifact directory");
  const directory=path.resolve(process.argv[2]);
  const [crank,key,frame]=await Promise.all(["crank","main_key","frame"].map(id=>readFile(path.join(directory,`${id}.stl`))));
  const forward=checkTranslationProbe({moving:crank,companions:{main_key:key},obstacles:{frame},translationMm:[0,3,0],samples:61,expected:"blocked"});
  const backward=checkTranslationProbe({moving:crank,companions:{main_key:key},obstacles:{frame},translationMm:[0,-3,0],samples:61,expected:"blocked"});
  const released=checkTranslationProbe({moving:crank,obstacles:{frame},translationMm:[0,3,0],samples:61,expected:"clear"});
  const report={scope:"Isolated crank and carried key against frame; rigid carriage is assumed. Key self-retention, other bodies, rotation/load and physical operation are not proved.",forward,backward,released};
  await writeFile(path.join(directory,"shaft-retention.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({directory,...report},null,2));
  process.exitCode=[forward,backward,released].every(x=>x.status==='PASS')?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=2;});
