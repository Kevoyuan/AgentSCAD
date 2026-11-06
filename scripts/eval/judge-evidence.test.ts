import {expect,test} from "bun:test";
import {deriveRequirementContract} from "../../src/lib/requirements/extract-requirements";
import {motionRangeObservations, declaredPathObservation} from "./judge-assembly";
import {evaluateAssembly} from "./assembly-evidence";

const provenance={artifactSha256:"a".repeat(64),toolVersion:"unit-reference"};
const requirements=(request:string)=>deriveRequirementContract({request}).requirements.filter(r=>r.id.startsWith("motion-range-"));
const observed=(status:string,min:number,max:number)=>motionRangeObservations({status,rangeDeg:{min,max},coverage:"Listed ideal test poses only"},provenance);

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
