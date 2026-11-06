import {test,expect} from "bun:test";
import fs from "node:fs/promises";
import {validateAssemblyArtifact} from "../../validation/assembly-validation";
test("normal validation measures actual selected hinge meshes and preserves unconfirmed standing",async()=>{
 const spec=JSON.parse(await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
 const geometry=await fs.readFile("benchmarks/assembly/axial_hinge.scad","utf8");
 const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${geometry}`;
 const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆",scadSource:source});
 expect(row.status).toBe("NOT_RUN");expect(row.passed).toBe(false);
 expect(row.assemblyEvidence?.manifest.contract.evidenceCurrent).toBe(false);
 expect(row.assemblyEvidence?.manifest.declaredAssembly.measuredStatus).toBe("PASS");
 expect(row.assemblyEvidence?.manifest.declaredDisassembly.measuredStatus).toBe("PASS");
 expect(row.assemblyEvidence?.manifest.fits[0].measuredStatus).toBe("PASS");
 expect(row.assemblyEvidence?.manifest.evidence.motion.status).toBe("NOT_RUN");
},60000);
