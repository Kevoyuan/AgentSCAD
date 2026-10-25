// ---------------------------------------------------------------------------
// H001 — Through-Hole Count Check
//
// Estimates the number of through-holes in a watertight mesh using the
// Euler characteristic: total genus = (2 * componentCount - euler) / 2.
// This estimates topological handles, not hole diameter, placement, or fit.
//
// Only meaningful for watertight meshes. For non-watertight meshes,
// the check is skipped with an explanation.
// ---------------------------------------------------------------------------

import type { CadValidationTargets } from "@/lib/harness/types";
import type { ValidationCheck, RawMeshData } from "./validation-types";

export function checkHoleCount(
  meshData: RawMeshData,
  expectedMinHoles?: number,
  expectedMaxHoles?: number
): ValidationCheck {
  const invalidCount = (value: unknown) => value !== undefined &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0);
  if (invalidCount(expectedMinHoles) || invalidCount(expectedMaxHoles) ||
      (expectedMinHoles !== undefined && expectedMaxHoles !== undefined && expectedMinHoles > expectedMaxHoles)) {
    return {
      rule_id: "H001", rule_name: "Through-Hole Count", level: "ENGINEERING",
      passed: false, status: "ERROR", is_critical: true,
      message: "Invalid through-hole count contract — expected non-negative integer bounds",
    };
  }
  if (!meshData.isWatertight) {
    return {
      rule_id: "H001",
      rule_name: "Through-Hole Count",
      level: "ENGINEERING",
      passed: true,
      status: "SKIP",
      is_critical: false,
      message: "Skipped — mesh is not watertight; Euler-based hole detection is unreliable",
      details: { isWatertight: false },
    };
  }

  const { genus, vertices, faces, edges, eulerCharacteristic: euler } = meshData;

  if (expectedMaxHoles !== undefined && genus > expectedMaxHoles) {
    return {
      rule_id: "H001", rule_name: "Through-Hole Count", level: "ENGINEERING",
      passed: false, status: "FAIL", is_critical: true,
      message: `Expected at most ${expectedMaxHoles} through-hole(s), but detected ${genus}.`,
      details: { genus, expectedMinHoles, expectedMaxHoles, euler },
    };
  }
  if (genus === 0) {
    const hasExpectation = expectedMinHoles !== undefined;
    const meetsExpectation = hasExpectation && expectedMinHoles <= 0;
    return {
      rule_id: "H001",
      rule_name: "Through-Hole Count",
      level: "ENGINEERING",
      passed: meetsExpectation,
      status: !hasExpectation ? "SKIP" : meetsExpectation ? "PASS" : "FAIL",
      is_critical: hasExpectation && !meetsExpectation,
      message: !hasExpectation
        ? `Skipped — no expected through-hole count was specified (detected genus=0, euler=${euler})`
        : meetsExpectation
          ? `No through-holes required or detected (genus=0, euler=${euler})`
          : `Expected at least ${expectedMinHoles} through-hole(s), but detected none (genus=0, euler=${euler})`,
      details: { genus, euler, vertices, faces, edges },
    };
  }

  if (expectedMinHoles !== undefined && genus < expectedMinHoles) {
    return {
      rule_id: "H001",
      rule_name: "Through-Hole Count",
      level: "ENGINEERING",
      passed: false,
      status: "FAIL",
      is_critical: true,
      message: `Expected at least ${expectedMinHoles} through-hole(s), but detected only ${genus}. ` +
        `Check that hole-generating cylinders fully penetrate the part body in difference().`,
      details: { genus, euler, expectedMinHoles, vertices, faces, edges },
    };
  }

  const expectedText = expectedMinHoles !== undefined
    ? ` (expected ≥ ${expectedMinHoles})`
    : "";

  return {
    rule_id: "H001",
    rule_name: "Through-Hole Count",
    level: "ENGINEERING",
    passed: expectedMinHoles === undefined || genus >= expectedMinHoles,
    status: expectedMinHoles === undefined ? "SKIP" : "PASS",
    is_critical: expectedMinHoles !== undefined,
    message: expectedMinHoles === undefined
      ? `Skipped — no expected through-hole count was specified (detected ${genus}, genus=${genus}, euler=${euler})`
      : `Detected ${genus} through-hole(s)${expectedText} (genus=${genus}, euler=${euler})`,
    details: { genus, euler, vertices, faces, edges, expectedMinHoles },
  };
}

const ENGLISH_COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const CHINESE_COUNTS: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** Legacy prose fallback. Only explicit counts are evidence; unknown means SKIP.
 * Group aliases prevent repeated acceptance sentences from counting twice.
 * Ambiguous totals use the strongest lower bound, not an invented sum.
 * New generation should provide expected_through_holes directly.
 */
export function inferExpectedMinimumHoleCount(checks: string[] | undefined): number | undefined {
  const groups = new Map<string, number>();
  let forbidsHoles = false;
  for (const check of checks ?? []) {
    if (/\b(?:no|zero)\s+(?:through[- ]?)?holes?\b|(?:无|没有|不允许|不得有)(?:任何)?(?:通)?孔|(?:0|零)\s*(?:个)?\s*(?:通)?孔|\b0\s+(?:through[- ]?)?holes?\b/i.test(check)) {
      forbidsHoles = true;
    }
    // Blind/recessed holes do not change genus. Split clauses so they cannot
    // consume or suppress another independently specified through-hole group.
    for (const clause of check.split(/[,;，；。]|以及|和|\band\b/i)) {
      if (/\bblind\b|盲孔|沉孔/.test(clause.toLowerCase())) continue;
      const matches = [
        ...clause.toLowerCase().matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:x\s*)?((?:(?!mm\b)[a-z-]+\s+){0,3})holes?\b/g),
        ...clause.matchAll(/([0-9]+|[一两二三四五六七八九十]+)\s*(?:个)?\s*((?:安装|固定|中心|中央|螺栓|螺丝|贯穿|通)*)孔/g),
      ];
      for (const match of matches) {
        const raw = match[1];
        let count = /^\d+$/.test(raw) ? Number(raw) : ENGLISH_COUNTS[raw];
        if (count === undefined) {
          const parts = raw.split("十");
          count = parts.length === 2
            ? (parts[0] ? CHINESE_COUNTS[parts[0]] : 1) * 10 + (parts[1] ? CHINESE_COUNTS[parts[1]] : 0)
            : CHINESE_COUNTS[raw];
        }
        if (!Number.isSafeInteger(count) || count <= 0) continue;
        const modifier = match[2] ?? "";
        const group = /mounting|bolt|screw|安装|固定|螺栓|螺丝/.test(modifier) ? "mounting"
          : /central|center|中心|中央/.test(modifier) ? "central" : "total";
        groups.set(group, Math.max(groups.get(group) ?? 0, count));
      }
    }
  }
  const grouped = (groups.get("mounting") ?? 0) + (groups.get("central") ?? 0);
  const minimum = Math.max(groups.get("total") ?? 0, grouped);
  // Contradictory prose is not a usable acceptance contract.
  if (forbidsHoles && minimum > 0) return undefined;
  return minimum > 0 ? minimum : forbidsHoles ? 0 : undefined;
}

/** Explicit targets take precedence over the legacy prose lower bound. */
export function checkHoleTargets(meshData: RawMeshData, targets?: CadValidationTargets): ValidationCheck {
  const exact = targets?.expected_through_holes;
  const minimum = exact !== undefined ? exact : inferExpectedMinimumHoleCount(targets?.required_feature_checks);
  return checkHoleCount(meshData, minimum, exact !== undefined ? exact : (minimum === 0 ? 0 : undefined));
}
