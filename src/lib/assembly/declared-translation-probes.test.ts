import { test, expect } from "bun:test";
import fixture from "../../../scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json";
import { AssemblySpecSchema, validateAssemblySpec } from "./assembly-spec";
import { checkDeclaredTranslationProbes } from "./declared-translation-probes";
import { assertRepairPreservesAssembly, collectAssemblyFindings } from "./repair-findings";
import { checkTranslationProbe } from "./translation-probe";
import { boxStl } from "../geometry/__tests__/solids";

const probe = {id:"hold",instanceId:"moving-instance",startTransform:fixture.instances[1].transform,translationMm:[4,0,0],samples:17,expected:"blocked"};
const makeSpec = () => AssemblySpecSchema.parse({...fixture,translationProbes:[probe]});
const meshes = {moving:boxStl([0,0,0],[1,1,1]),fixed:boxStl([2,-1,-1],[3,2,2])};

test("optional probes retain old canonical declarations and validate their references", () => {
  expect(Object.hasOwn(AssemblySpecSchema.parse(fixture),"translationProbes")).toBe(false);
  for (const change of [{instanceId:"absent"},{instanceId:"fixed-instance"},{translationMm:[0,0,0]},{samples:66},{startTransform:[1,2]}])
    expect(validateAssemblySpec({...fixture,translationProbes:[{...probe,...change}]}).success).toBe(false);
  expect(validateAssemblySpec({...fixture,translationProbes:[probe,probe]}).success).toBe(false);
});

test("declared blocked and clear expectations are measured, not trusted", () => {
  const spec = makeSpec();
  expect(checkDeclaredTranslationProbes({spec,meshes}).status).toBe("PASS");
  spec.translationProbes![0].expected = "clear";
  const failed = checkDeclaredTranslationProbes({spec,meshes});
  expect(failed.status).toBe("FAIL");
  const findings = collectAssemblyFindings({manifest:{evidence:{},fits:[],translationProbes:failed},kinematics:null});
  expect(findings[0].kind).toBe("translation-probe");
  expect(findings[0].message).toContain("hold");
});

test("missing purchased obstacles and excessive requests are unavailable, not clear", () => {
  const spec = makeSpec();
  spec.parts[0].source="purchased";
  expect(checkDeclaredTranslationProbes({spec,meshes:{moving:meshes.moving}}).status).toBe("NOT_RUN");
  spec.translationProbes=Array.from({length:64},(_,i)=>({...spec.translationProbes![0],id:`probe${i}`,samples:65}));
  expect(checkDeclaredTranslationProbes({spec,meshes}).status).toBe("NOT_RUN");
  expect(checkDeclaredTranslationProbes({spec:AssemblySpecSchema.parse(fixture),meshes}).status).toBe("NOT_RUN");
});

test("geometry repair cannot delete or weaken an existing experiment", () => {
  const before=makeSpec();
  for(const change of [{expected:"clear" as const},{samples:2},{translationMm:[.1,0,0] as [number,number,number]}]) {
    const after=makeSpec();Object.assign(after.translationProbes![0],change);
    expect(assertRepairPreservesAssembly({before,after}).violations.some(v=>v.code==="probe-changed")).toBe(true);
  }
  expect(assertRepairPreservesAssembly({before,after:fixture}).ok).toBe(false);
  expect(assertRepairPreservesAssembly({before,after:makeSpec()}).ok).toBe(true);
});

test("expired work cannot become successful geometric evidence", () => {
  expect(checkTranslationProbe({moving:meshes.moving,obstacles:{fixed:meshes.fixed},translationMm:[4,0,0],samples:17,expected:"blocked",budgetMs:Number.MIN_VALUE}).status).toBe("NOT_RUN");
  const controller=new AbortController();controller.abort();
  expect(()=>checkDeclaredTranslationProbes({spec:makeSpec(),meshes,signal:controller.signal})).toThrow();
});
