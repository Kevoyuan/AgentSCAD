import { parameterDefsToValues } from "@/lib/stores/job-store";
import {
  extractParameterDefsFromScad,
  mergeExtractedParameters,
} from "@/lib/tools/scad-parameter-extractor";
import type { ParameterDef } from "@/lib/harness/types";

export interface ScadParameterPersistence {
  parameters: ParameterDef[];
  parameterSchema: string;
  parameterValues: string;
}

/**
 * Recompute the editable parameter contract from the SCAD that will actually be
 * persisted. Generation and repair can replace the whole artifact; without this
 * the UI keeps a stale schema (often generic width/depth/height keys that do not
 * exist in the SCAD, so those controls do nothing).
 */
export function buildScadParameterPersistence(
  scadSource: string,
  fallbackParameters: ParameterDef[] = [],
): ScadParameterPersistence {
  const parameters = mergeExtractedParameters(
    extractParameterDefsFromScad(scadSource),
    fallbackParameters,
  );
  return {
    parameters,
    parameterSchema: JSON.stringify(parameters),
    parameterValues: JSON.stringify(parameterDefsToValues(parameters)),
  };
}
