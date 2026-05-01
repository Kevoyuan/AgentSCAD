import type { ValidationResult } from "@/lib/mesh-validator";

export type PartFamily =
  | "spur_gear"
  | "device_stand"
  | "electronics_enclosure"
  | "phone_case"
  | "unknown";

export interface ParameterDef {
  key: string;
  label: string;
  kind: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  source: string;
  editable: boolean;
  description: string;
  group: string;
}

export interface CadFeature {
  name: string;
  type: string;
  required: boolean;
  parameters: Record<string, number>;
  description: string;
}

export interface CadConstraints {
  dimensions: Record<string, number>;
  assumptions: string[];
  manufacturing: { min_wall_thickness: number; printable: boolean };
  geometry: { must_be_manifold: boolean; centered: boolean; no_floating_parts: boolean };
  code: { use_parameters: boolean; use_library_modules: boolean; avoid_magic_numbers: boolean; top_level_module: string };
}

export interface CadValidationTargets {
  expected_bbox: number[];
  required_feature_checks: string[];
  forbidden_failure_modes: string[];
}

export interface LLMGenerationResult {
  summary: string;
  parameters: ParameterDef[];
  scad_source: string;
}

export interface StructuredGenerationResult extends LLMGenerationResult {
  part_type: string;
  units: string;
  features: CadFeature[];
  constraints: CadConstraints;
  modeling_plan: string[];
  design_rationale: string[];
  validation_targets: CadValidationTargets;
}

export interface RenderLog {
  openscad_version: string;
  render_time_ms: number;
  stl_triangles: number;
  stl_vertices: number;
  png_resolution: string | null;
  warnings: string[];
}

export interface RenderedArtifacts {
  artifactsDir: string;
  scadFilePath: string;
  stlFilePath: string;
  pngFilePath: string;
  stlPath: string;
  pngPath: string;
  renderLog: RenderLog;
}

export interface ExecutionLogEntry {
  timestamp: string;
  event: string;
  message: string;
}

export type { ValidationResult };
