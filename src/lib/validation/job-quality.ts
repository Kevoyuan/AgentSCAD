import { buildDeliveryReadiness, type DeliveryReadinessInput } from "./delivery-readiness";
import { buildValidationReport, type ValidationResult } from "@/lib/tools/validation-tool";

export interface JobQualityInput extends Omit<DeliveryReadinessInput, "validationResults"> {
  validationResults: ValidationResult[];
}

export function buildJobQuality(input: JobQualityInput) {
  const readiness = buildDeliveryReadiness(input);
  const validationReport = {
    ...buildValidationReport(input.validationResults),
    delivery: readiness,
  };

  return {
    readiness,
    validationReport,
    qualityScore: readiness.score,
    validationReportJson: JSON.stringify(validationReport),
  };
}
