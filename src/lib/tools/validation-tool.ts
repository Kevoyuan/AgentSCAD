import {
  clearValidationCache,
  getLastMeshData,
  validateStl,
  type ValidationResult,
} from "@/lib/mesh-validator";
import { validatePreviewAgainstRequest } from "@/lib/visual-validator";
import { checkCompile } from "@/lib/validation/compile-check";
import { checkBoundingBox } from "@/lib/validation/bbox-check";
import { checkComponents } from "@/lib/validation/component-check";
import { checkHoleCount } from "@/lib/validation/hole-check";
import { computeReport, type ValidationCheck, type ValidationReport } from "@/lib/validation/report";
import type { CadValidationTargets } from "@/lib/harness/types";

export { clearValidationCache, validateStl, validatePreviewAgainstRequest };
export type { ValidationResult, ValidationCheck, ValidationReport };

export interface ValidateRenderedInput {
  inputRequest: string;
  partFamily: string | null;
  scadSource: string;
  stlFilePath: string;
  previewImagePath: string;
  wallThickness?: number;
  renderLog?: {
    openscad_version: string;
    render_time_ms: number;
    stl_triangles: number;
    stl_vertices: number;
    png_resolution: string | null;
    warnings: string[];
  };
  validationTargets?: CadValidationTargets;
  skipVisual?: boolean;
}

/**
 * Run all deterministic validation checks against rendered artifacts.
 *
 * Combines:
 * - Mesh validation (Python/trimesh — R001/R002/R003)
 * - Visual validation (vision LLM — V001)
 * - Compile check (C001 — render log analysis)
 * - Bounding box check (B001 — vs validation_targets.expected_bbox)
 * - Component check (C002 — floating parts detection)
 * - Hole count check (H001 — Euler characteristic genus estimate)
 */
export async function validateRenderedArtifacts(
  input: ValidateRenderedInput
): Promise<ValidationResult[]> {
  const meshResults = await validateStl(input.stlFilePath, input.wallThickness);

  // Visual validation runs only when explicitly requested (Phase 4: user-triggered)
  const visualResults: ValidationResult[] = input.skipVisual
    ? []
    : await validatePreviewAgainstRequest({
        inputRequest: input.inputRequest,
        partFamily: input.partFamily,
        scadSource: input.scadSource,
        previewImagePath: input.previewImagePath,
      });

  // New deterministic checks (Phase 2)
  const additionalChecks: ValidationCheck[] = [];

  // C001 — Compile check
  if (input.renderLog) {
    additionalChecks.push(checkCompile(input.renderLog));
  }

  // Mesh-derived checks (B001, C002, H001)
  const meshData = getLastMeshData();
  if (meshData) {
    additionalChecks.push(
      checkBoundingBox(meshData, input.validationTargets?.expected_bbox)
    );
    additionalChecks.push(checkComponents(meshData));

    // Estimate required holes from validation targets
    const holeRelatedChecks = input.validationTargets?.required_feature_checks?.filter(
      (c) => c.toLowerCase().includes("hole")
    );
    const expectedMinHoles = holeRelatedChecks?.length;
    additionalChecks.push(checkHoleCount(meshData, expectedMinHoles));
  }

  // Convert ValidationCheck → ValidationResult for backward compat
  const additionalResults: ValidationResult[] = additionalChecks.map((check) => ({
    rule_id: check.rule_id,
    rule_name: check.rule_name,
    level: check.level,
    passed: check.passed,
    is_critical: check.is_critical,
    message: check.message,
  }));

  return [...meshResults, ...visualResults, ...additionalResults];
}

export function getCriticalValidationFailures(results: ValidationResult[]): ValidationResult[] {
  return results.filter((rule) => !rule.passed && rule.is_critical);
}

/**
 * Build a structured validation report from results array.
 */
export function buildValidationReport(results: ValidationResult[]): ValidationReport {
  const checks: ValidationCheck[] = results.map((r) => ({
    rule_id: r.rule_id,
    rule_name: r.rule_name,
    level: r.level as ValidationCheck["level"],
    passed: r.passed,
    is_critical: r.is_critical,
    message: r.message,
  }));
  return computeReport(checks);
}
