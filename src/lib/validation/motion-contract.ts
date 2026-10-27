import type { ValidationResult } from "@/lib/mesh-validator";

/**
 * Motion contract check for requests approved as "functional / motion-ready".
 *
 * Static assemblies can look complete while ignoring the motion intent: every
 * piston at the same phase, no crank-angle control, internals buried in a solid
 * block. This check does not prove the kinematics are correct; it verifies the
 * minimum editable contract that makes the model actually movable in the UI.
 */
const MOTION_INTENT_PATTERN =
  /(?:motion[-_ ]?ready|functional motion|kinematic|animat(?:e|ed|ion)|moving assembly)/i;

export interface MotionContractInput {
  inputRequest: string;
  intentResult?: unknown;
  scadSource: string;
}

function searchableText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function isMotionReadyIntent(inputRequest: string, intentResult?: unknown): boolean {
  return MOTION_INTENT_PATTERN.test(`${inputRequest}\n${searchableText(intentResult)}`);
}

function findMotionAngleParameter(scadSource: string): string | null {
  for (const rawLine of scadSource.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;?(.*)$/);
    if (!match) continue;
    const [, key, value, comment] = match;
    // A configuration angle such as v_angle = 90 is not a motion control. Require
    // a crank/drive/rotation-flavoured angle name (crank_angle, motion_angle,
    // rotation, theta, ...), optionally backed by a full-rotation customizer range.
    const keyLooksMovable = /(?:crank|motion|rotat|drive|swing|joint|shaft|knob).*(?:angle|deg|theta)|(?:angle|theta).*(?:crank|motion|rotat|drive|swing)|^(?:angle|theta|rotation|rot_angle|motion_angle|crank_angle)$/i.test(key);
    if (!keyLooksMovable) continue;
    const hasRotationRange = /\[\s*-?\d+(?:\.\d+)?\s*:\s*-?\d+(?:\.\d+)?\s*:\s*(?:360|359|355|350)\b/.test(comment);
    if (hasRotationRange || Math.abs(Number(value)) <= 360) return key;
  }
  return null;
}

function findKinematicFunction(scadSource: string): string | null {
  const functions = scadSource.matchAll(
    /^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*=\s*([\s\S]*?);/gim,
  );
  for (const match of functions) {
    if (/\b(?:sin|cos|tan|atan2)\s*\(/i.test(match[2])) return match[1];
  }
  return null;
}

function hasPhasedCrank(scadSource: string): boolean {
  return (
    /(?:pin|phase|throw|firing)_?angles\s*=/i.test(scadSource)
    || /\[\s*0\s*,\s*90\s*,\s*(?:180|270)\b/.test(scadSource)
  );
}

export function evaluateMotionContract(input: MotionContractInput): ValidationResult | null {
  if (!isMotionReadyIntent(input.inputRequest, input.intentResult)) return null;

  const scadSource = input.scadSource;
  const motionParameter = findMotionAngleParameter(scadSource);
  const kinematicFunction = findKinematicFunction(scadSource);
  const phasedCrank = hasPhasedCrank(scadSource);
  const cutaway = /^\s*cutaway\s*=\s*(?:true|false|\d)/im.test(scadSource);
  const modelsMovingParts = /(?:piston|connecting[_\s-]?rod|conrod|crank(?:shaft|_))/i.test(scadSource);

  const missing: string[] = [];
  if (!motionParameter) {
    missing.push("top-level motion angle parameter (e.g. crank_angle = 45; // [0:1:360])");
  }
  if (!kinematicFunction) {
    missing.push("kinematic function using sin/cos/atan2 to derive part positions");
  }
  if (modelsMovingParts && !phasedCrank) {
    missing.push("per-cylinder phase angles (e.g. pin_angles = [0, 90, 270, 180])");
  }
  if (!cutaway) {
    missing.push("cutaway switch that exposes the internal assembly");
  }

  const passed = missing.length === 0;
  return {
    rule_id: "M001",
    rule_name: "Motion Contract",
    level: "ENGINEERING",
    passed,
    status: passed ? "PASS" : "FAIL",
    // A request explicitly approved as motion-ready must not be delivered as a
    // static assembly; treat a missing motion contract as blocking so the repair
    // loop (and human review) sees it.
    is_critical: true,
    message: passed
      ? `Motion-ready assembly exposes ${motionParameter} and kinematic function ${kinematicFunction}${phasedCrank ? " with phased crank pins" : ""} and a cutaway view.`
      : `Motion-ready request is not actually movable: missing ${missing.join("; ")}.`,
  };
}
