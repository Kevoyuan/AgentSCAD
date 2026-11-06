import {test,expect} from "bun:test";
import {validateAssemblyArtifact} from "./assembly-validation";
test("single part validation adds no assembly work",async()=>{
 expect(await validateAssemblyArtifact({inputRequest:"cube",scadSource:"cube(1);"})).toEqual([]);
});
test("an explicit assembly requirement without declaration blocks repair and delivery",async()=>{
 const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链，可组装可拆",scadSource:"cube(1);"});
 expect(row.status).toBe("FAIL");expect(row.is_critical).toBe(true);expect(row.passed).toBe(false);
});
test("a malformed declaration preserves its actual parse failure",async()=>{
 const [row]=await validateAssemblyArtifact({inputRequest:"铰链",scadSource:"/* AGENTSCAD_ASSEMBLY_V1\n{}\nEND_AGENTSCAD_ASSEMBLY */\ncube(1);"});
 expect(row.status).toBe("FAIL");expect(row.message).toContain("specification");
});
