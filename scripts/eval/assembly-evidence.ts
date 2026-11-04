#!/usr/bin/env bun
/**
 * Compare independent, externally obtained measurements with a frozen contract.
 * This module never renders geometry, measures an STL, or authenticates the
 * measurement provider. A PASS is only the stated comparison, not a guarantee
 * of physical function or of the provenance asserted in the input.
 */
import { readFile } from "node:fs/promises";

export type Status = "PASS" | "FAIL" | "SKIP" | "ERROR" | "NOT_RUN";
export type Layer = "intent" | "parts" | "assembly" | "motion" | "physical" | "performance";
export type Requirement = {
  id: string;
  layer: Layer;
  required: boolean;
  applicable: boolean;
  expected:
    | { kind: "equals"; value: string | boolean | number }
    | { kind: "range"; min: number; max: number; unit: string }
    /** "At least this much", e.g. a rotation that must reach ±45°. */
    | { kind: "atLeast"; min: number; unit: string };
};
export type Observation = {
  id: string;
  status: "MEASURED" | "ERROR" | "NOT_RUN";
  value?: string | boolean | number;
  uncertainty?: number;
  unit?: string;
  /** SHA-256 of the artifact being assessed; not an attestation of the data. */
  artifactSha256?: string;
  method?: string;
  toolVersion?: string;
  coverage?: string;
  reason?: string;
};
export type Result = { id: string; layer: Layer; required: boolean; status: Status; reason: string; observation?: Observation };

export function evaluateRequirement(requirement: Requirement, observation?: Observation): Result {
  const result = (status: Status, reason: string): Result => ({ id: requirement.id, layer: requirement.layer, required: requirement.required, status, reason, ...(observation ? { observation } : {}) });
  const expected = requirement.expected;
  if (expected.kind === "equals" && (!["boolean", "number", "string"].includes(typeof expected.value) || (typeof expected.value === "number" && !Number.isFinite(expected.value)))) return result("ERROR", "Invalid frozen exact value.");
  if (expected.kind === "range" && (!Number.isFinite(expected.min) || !Number.isFinite(expected.max) || expected.min > expected.max || typeof expected.unit !== "string" || !expected.unit.trim())) return result("ERROR", "Invalid frozen range.");
  if (expected.kind === "atLeast" && (!Number.isFinite(expected.min) || typeof expected.unit !== "string" || !expected.unit.trim())) return result("ERROR", "Invalid frozen lower bound.");
  if (!requirement.applicable) return result("SKIP", "The frozen contract marks this assertion not applicable.");
  if (!observation || observation.status === "NOT_RUN") return result("NOT_RUN", observation?.reason ?? "No independent measurement supplied.");
  if (observation.id !== requirement.id) return result("ERROR", "Observation does not identify this requirement.");
  if (observation.status === "ERROR") return result("ERROR", observation.reason ?? "Measurement failed.");
  if (observation.status !== "MEASURED") return result("ERROR", "Invalid observation status.");
  if (typeof observation.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(observation.artifactSha256) || typeof observation.method !== "string" || !observation.method.trim() || typeof observation.toolVersion !== "string" || !observation.toolVersion.trim() || typeof observation.coverage !== "string" || !observation.coverage.trim()) {
    return result("ERROR", "Measured evidence requires artifact SHA-256, method, tool version and coverage.");
  }
  if (expected.kind === "equals") {
    if (typeof observation.value !== typeof expected.value || (typeof observation.value === "number" && !Number.isFinite(observation.value))) return result("ERROR", "Measured value has the wrong type or is not finite.");
    if (observation.uncertainty !== undefined && observation.uncertainty !== 0) return result("ERROR", "Exact comparisons cannot discard measurement uncertainty.");
    return result(observation.value === expected.value ? "PASS" : "FAIL", "Compared the measured value with the frozen exact requirement.");
  }
  if (expected.kind !== "range") {
    if (expected.kind !== "atLeast") return result("ERROR", "Unknown requirement kind.");
    if (typeof observation.value !== "number" || !Number.isFinite(observation.value) || observation.unit !== expected.unit || typeof observation.uncertainty !== "number" || !Number.isFinite(observation.uncertainty) || observation.uncertainty < 0) return result("ERROR", "A lower-bound measurement requires a finite value, matching unit and non-negative uncertainty.");
    const reached = observation.value - observation.uncertainty;
    if (!Number.isFinite(reached)) return result("ERROR", "Measurement interval is not finite.");
    // The pessimistic end is compared, so uncertainty can never buy a pass.
    if (reached >= expected.min) return result("PASS", `Even the low end of the measurement (${reached}) reaches the frozen minimum (${expected.min}).`);
    if (observation.value + observation.uncertainty < expected.min) return result("FAIL", `The measurement is below the frozen minimum (${expected.min}).`);
    return result("ERROR", "Measurement uncertainty overlaps the frozen minimum; repeat with sufficient precision.");
  }
  if (typeof observation.value !== "number" || !Number.isFinite(observation.value) || observation.unit !== expected.unit || typeof observation.uncertainty !== "number" || !Number.isFinite(observation.uncertainty) || observation.uncertainty < 0) return result("ERROR", "A range measurement requires a finite value, matching unit and non-negative uncertainty.");
  const low = observation.value - observation.uncertainty;
  const high = observation.value + observation.uncertainty;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return result("ERROR", "Measurement interval is not finite.");
  if (low >= expected.min && high <= expected.max) return result("PASS", "The full measurement interval is within the frozen bounds.");
  if (high < expected.min || low > expected.max) return result("FAIL", "The full measurement interval is outside the frozen bounds.");
  return result("ERROR", "Measurement uncertainty overlaps a requirement boundary; repeat with sufficient precision.");
}

export function evaluateAssembly(requirements: Requirement[], observations: Observation[]) {
  if (!Array.isArray(requirements) || !Array.isArray(observations) || requirements.length === 0) throw new Error("A non-empty frozen requirement list and observations array are required.");
  const ids = new Set<string>();
  for (const requirement of requirements) {
    if (!requirement || typeof requirement.id !== "string" || !requirement.id.trim() || ids.has(requirement.id) || !["intent", "parts", "assembly", "motion", "physical", "performance"].includes(requirement.layer) || typeof requirement.required !== "boolean" || typeof requirement.applicable !== "boolean" || !requirement.expected || !["equals", "range", "atLeast"].includes(requirement.expected.kind)) throw new Error("Invalid or duplicate frozen requirement.");
    ids.add(requirement.id);
  }
  const observed = new Map<string, Observation>();
  for (const observation of observations) {
    if (!observation || !ids.has(observation.id) || observed.has(observation.id)) throw new Error("Unknown or duplicate observation.");
    observed.set(observation.id, observation);
  }
  const evidence = requirements.map((requirement) => evaluateRequirement(requirement, observed.get(requirement.id)));
  const required = evidence.filter((item) => item.required);
  // No evidence is silently promoted to PASS, including SKIP on a required check.
  const gatePassed = required.length > 0 && required.every((item) => item.status === "PASS");
  return { schema_version: "agentscad.assembly-evidence.v1", gate_passed: gatePassed, evidence };
}

if (import.meta.main) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error("Usage: bun scripts/eval/assembly-evidence.ts <contract.json> [observations.json]");
    const contract = JSON.parse(await readFile(file, "utf8"));
    const observations = process.argv[3] ? JSON.parse(await readFile(process.argv[3], "utf8")) : [];
    const report = evaluateAssembly(contract.requirements, observations);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.gate_passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
