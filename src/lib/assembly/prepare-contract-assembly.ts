import { createHash } from "node:crypto";
import { prepareAssembly } from "./prepare-assembly";
import { validateAssemblySpec } from "./assembly-spec";
import { renderAssemblyParts } from "../tools/assembly-part-renderer";
import { RequirementContractSchema } from "../requirements/requirement-contract";
import { toFitRequirements } from "../requirements/contract-bridge";

/** Shared by explicit verification and export; never invokes a model. */
export async function prepareContractAssembly(input:Parameters<typeof prepareAssembly>[0]) {
  const checked=validateAssemblySpec(input.spec);
  if(!checked.success)throw new Error(`Invalid assembly specification: ${checked.error.message}`);
  const assemblyMesh=input.assemblyMesh??(!input.render
    ?(await renderAssemblyParts({scadSource:input.scadSource,parts:[{partId:"assembly",selector:"all"}],options:input.options}))[0]:null);
  const contract=input.contractSnapshot?RequirementContractSchema.parse(input.contractSnapshot.contract):null;
  const revolute=checked.data.connections.filter(connection=>connection.type==="revolute");
  const clearance=contract?.requirements.find(requirement=>requirement.id==="diametral-clearance"&&requirement.required&&requirement.applicable);
  const autoBound=input.contractGate?.evidenceCurrent===true&&contract?.intent.kind==="revolute-hinge"
    &&contract.requestSha256===createHash("sha256").update(input.contractSnapshot!.request.trim()).digest("hex")
    &&checked.data.connections.length===1&&revolute.length===1&&!!revolute[0].boreInstanceId&&!!clearance;
  const fitRequirements=input.fitRequirements??(autoBound?toFitRequirements(contract!,checked.data):undefined);
  const wantsMotion=contract?.requirements.some(requirement=>requirement.id==="sampled-motion"&&requirement.required&&requirement.applicable);
  const wantsRemoval=contract?.requirements.some(requirement=>requirement.id==="disassembly-path"&&requirement.required&&requirement.applicable);
  const kinematics=input.kinematics??(autoBound&&(wantsMotion||wantsRemoval)?{connectionId:revolute[0].id}:undefined);
  return prepareAssembly({...input,assemblyMesh,fitRequirements,kinematics});
}
