// ---------------------------------------------------------------------------
// Validation types — shared across all validators
// ---------------------------------------------------------------------------

export interface ValidationCheck {
  rule_id: string;
  rule_name: string;
  level: "ENGINEERING" | "MANUFACTURING" | "SEMANTIC" | "INFO";
  passed: boolean;
  is_critical: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationReport {
  ok: boolean;
  score: number; // 0–1
  checks: ValidationCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    critical_failures: number;
  };
}

export interface RawMeshData {
  bbox: { length: number; width: number; height: number; unit: string } | null;
  vertices: number;
  faces: number;
  edges: number;
  isWatertight: boolean;
  isVolume: boolean;
  componentCount: number;
  eulerCharacteristic: number;
  genus: number; // through-hole count estimate (only valid if watertight)
}
