import { createHash } from "node:crypto";
import { prepareAssembly, type AssemblyFitRequirement } from "./prepare-assembly";
import { validateAssemblySpec } from "./assembly-spec";
import { renderAssemblyParts } from "../tools/assembly-part-renderer";
import { RequirementContractSchema } from "../requirements/requirement-contract";
import { toFitRequirements } from "../requirements/contract-bridge";
import { automaticHingeKinematics } from "./automatic-hinge-kinematics";
import { automaticSliderCrankKinematics } from "./automatic-slider-crank";

/** Shared by explicit verification and export; never invokes a model. */
export async function prepareContractAssembly(input:Parameters<typeof prepareAssembly>[0]) {
  const checked=validateAssemblySpec(input.spec);
  if(!checked.success)throw new Error(`Invalid assembly specification: ${checked.error.message}`);
  input={...input,spec:checked.data,
    contractGate:input.contractGate?{...input.contractGate}:undefined,
    contractSnapshot:input.contractSnapshot?structuredClone(input.contractSnapshot):undefined,
    fitRequirements:input.fitRequirements?structuredClone(input.fitRequirements):undefined,
    kinematics:input.kinematics?structuredClone(input.kinematics):undefined};
  const assemblyMesh=input.assemblyMesh??(!input.render
    ?(await renderAssemblyParts({scadSource:input.scadSource,parts:[{partId:"assembly",selector:"all"}],options:input.options}))[0]:null);
  const contract=input.contractSnapshot?RequirementContractSchema.parse(input.contractSnapshot.contract):null;
  const revolute=checked.data.connections.filter(connection=>connection.type==="revolute");
  const clearance=contract?.requirements.find(requirement=>requirement.id==="diametral-clearance"&&requirement.required&&requirement.applicable);
  const autoBound=input.contractGate?.evidenceCurrent===true&&contract?.intent.kind==="revolute-hinge"
    &&contract.requestSha256===createHash("sha256").update(input.contractSnapshot!.request.trim()).digest("hex")
    &&checked.data.connections.length===1&&revolute.length===1&&!!revolute[0].boreInstanceId&&!!clearance;
  let fitRequirements=input.fitRequirements??(autoBound?toFitRequirements(contract!,checked.data):undefined);
  const wantsMotion=contract?.requirements.some(requirement=>requirement.id==="sampled-motion"&&requirement.required&&requirement.applicable);
  const wantsRemoval=contract?.requirements.some(requirement=>requirement.id==="disassembly-path"&&requirement.required&&requirement.applicable);
  let kinematics=input.kinematics??(autoBound&&(wantsMotion||wantsRemoval)?automaticHingeKinematics(checked.data):undefined);
  // A confirmed, request-matching crank-slider contract can drive the canonical
  // multi-joint source protocol. The driven revolute still needs a measured fit
  // for the source gate, so derive one only when the contract names a clearance
  // and the declaration names which instance carries the bore.
  const slider=automaticSliderCrankKinematics(checked.data);
  const requestMatches=!!contract&&!!input.contractSnapshot
    &&contract.requestSha256===createHash("sha256").update(input.contractSnapshot.request.trim()).digest("hex");
  if(!kinematics&&slider&&input.contractGate?.evidenceCurrent===true&&requestMatches&&contract&&wantMotion(contract)){
    kinematics={connectionId:slider.crankAxisConnectionId,sliderCrank:true};
    if(!fitRequirements){
      const clearance=contract.requirements.find(requirement=>requirement.id==="diametral-clearance"&&requirement.required&&requirement.applicable);
      if(clearance){
        const derived:AssemblyFitRequirement[]=[];
        for(const connection of checked.data.connections.filter(item=>(item.type==="revolute"||item.type==="prismatic")&&item.boreInstanceId)){
          try{derived.push(...toFitRequirements(contract,checked.data,{connectionId:connection.id,boreInstanceId:connection.boreInstanceId,allowPrismatic:true}));}
          catch{/* absence stays visible as NOT_RUN for that joint */ }
        }
        if(derived.length)fitRequirements=derived;
      }
    }
  }
  return prepareAssembly({...input,assemblyMesh,fitRequirements,kinematics});
}

function wantMotion(contract: import("../requirements/requirement-contract").RequirementContract) {
  return contract.requirements.some((requirement) => requirement.id === "sampled-motion"
    && requirement.required && requirement.applicable);
}
