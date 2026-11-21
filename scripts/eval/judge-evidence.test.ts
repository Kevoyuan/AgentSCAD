import {expect,test} from "bun:test";
import {deriveRequirementContract} from "../../src/lib/requirements/extract-requirements";
import {motionRangeObservations, sampledMotionEvidence, declaredPathObservation, unresolvedContractEvidence, declaredTranslationProbeEvidence} from "./judge-assembly";
import {evaluateAssembly} from "./assembly-evidence";

const provenance={artifactSha256:"a".repeat(64),toolVersion:"unit-reference"};
test("declared experiments cannot disappear when their measurement is missing",()=>{
  expect(declaredTranslationProbeEvidence({})).toEqual([]);
  expect(declaredTranslationProbeEvidence({translationProbes:[{}]})).toEqual([{id:"declared-translation-probes",status:"NOT_RUN"}]);
  expect(declaredTranslationProbeEvidence({translationProbes:[{}]},{status:"FAIL"})).toEqual([{id:"declared-translation-probes",status:"FAIL"}]);
});
const requirements=(request:string)=>deriveRequirementContract({request}).requirements.filter(r=>r.id.startsWith("motion-range-"));
const observed=(status:string,min:number,max:number)=>motionRangeObservations({status,rangeDeg:{min,max},coverage:"Listed ideal test poses only"},provenance);

test("a missing retention condition remains NOT_RUN even when measured paths and motion pass",()=>{
  const contract=deriveRequirementContract({request:"两件式铰链，间隙0.35到0.45mm，能转±45°，可组装可拆卸，3D打印"});
  const evidence=unresolvedContractEvidence(contract);
  expect(evidence.find(item=>item.id==="unresolved-axial-retention")?.status).toBe("NOT_RUN");
  expect(evidence.some(item=>item.id==="unresolved-material")).toBe(false);
  expect(unresolvedContractEvidence({...contract,unknowns:contract.unknowns.filter(item=>item.id!=="axial-retention")})).toEqual([]);
});

test("a declared range on a failed motion check cannot appear as verified reach",()=>{
  const result=evaluateAssembly(requirements("铰链能转±90°"),observed("FAIL",-90,90));
  expect(result.gate_passed).toBe(false);
  expect(result.evidence.every(e=>e.status==="NOT_RUN")).toBe(true);
});

test("positive-only travel cannot satisfy a symmetric requested range",()=>{
  const result=evaluateAssembly(requirements("铰链能转±90°"),observed("PASS",0,90));
  expect(result.gate_passed).toBe(false);
  expect(result.evidence.find(e=>e.id==="motion-range-negative-end")?.status).toBe("FAIL");
  expect(evaluateAssembly(requirements("铰链能转±90°"),observed("PASS",-90,90)).gate_passed).toBe(true);
});

test("signed asymmetric intervals preserve both endpoints while allowing additional travel",()=>{
  const requested=requirements("铰链能转-90到-30度");
  expect(requested).toHaveLength(3);
  expect(evaluateAssembly(requested,observed("PASS",-90,-60)).gate_passed).toBe(false);
  expect(evaluateAssembly(requested,observed("PASS",-100,-20)).gate_passed).toBe(true);
});

test("the actual can-be-disassembled wording remains a required assertion",()=>{
  const contract=deriveRequirementContract({request:"做一个两件式铰链，直径间隙0.2到0.3mm，能转±90°，可以拆开，3D打印"});
  expect(contract.requirements.find(r=>r.id==="disassembly-path")?.required).toBe(true);
  const forbidden=deriveRequirementContract({request:"做一个不可以拆开的铰链"});
  expect(forbidden.requirements.some(r=>r.id==="disassembly-path")).toBe(false);
});

test("an absent declared removal cannot be replaced by a passing automatic axis probe",()=>{
  const requirement=deriveRequirementContract({request:"两件式铰链，可拆"}).requirements.filter(r=>r.id==="disassembly-path");
  for(const status of ["NOT_RUN","ERROR","FAIL"]){
    const observation=declaredPathObservation("disassembly-path",{status,reason:"Declared sequence did not pass"},"Declared operations only",provenance);
    const report=evaluateAssembly(requirement,[observation]);
    expect(report.gate_passed).toBe(false);
  }
  const passed=declaredPathObservation("disassembly-path",{status:"PASS",reason:"Every required instance removed"},"Complete declared sequence",provenance);
  expect(evaluateAssembly(requirement,[passed]).gate_passed).toBe(true);
});

test("sampled rigid motion is reported separately from unavailable source-driven motion",()=>{
  // A declaration without a source pose protocol cannot be source-verified, but
  // the rigid sample it does support must stay a measured result.
  const passing=sampledMotionEvidence("PASS",{status:"PASS",rangeDeg:{min:-45,max:45},coverage:"5 sampled angles"},provenance);
  expect(passing.sampled.status).toBe("MEASURED");
  expect(passing.sampled.value).toBe(true);
  expect(passing.ranges.map(item=>item.status)).toEqual(["MEASURED","MEASURED","MEASURED"]);
  const missing=sampledMotionEvidence("NOT_RUN",null,provenance);
  expect(missing.sampled.status).toBe("NOT_RUN");
  expect(missing.ranges.every(item=>item.status==="NOT_RUN")).toBe(true);
  const failed=sampledMotionEvidence("FAIL",{status:"FAIL",rangeDeg:null,coverage:"blocked sample"},provenance);
  expect(failed.sampled.status).toBe("MEASURED");
  expect(failed.sampled.value).toBe(false);
  // A witnessed block is a failure, not a fabricated range coverage.
  expect(failed.ranges.every(item=>item.status==="NOT_RUN")).toBe(true);
});
