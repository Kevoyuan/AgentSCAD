// ---------------------------------------------------------------------------
// H001 — Through-Hole Count Check
//
// Estimates the number of through-holes in a watertight mesh using the
// Euler characteristic: genus = (2 - euler) / 2.
//
// Only meaningful for watertight meshes. For non-watertight meshes,
// the check is skipped with an explanation.
// ---------------------------------------------------------------------------

import type { ValidationCheck, RawMeshData } from "./validation-types";

export function checkHoleCount(
  meshData: RawMeshData,
  expectedMinHoles?: number
): ValidationCheck {
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

  const { genus, vertices, faces, edges } = meshData;
  const euler = vertices - edges + faces;

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

export function inferExpectedMinimumHoleCount(checks: string[] | undefined): number | undefined {
  const holeChecks = (checks ?? []).filter((check) => /holes?|孔/i.test(check));
  if (holeChecks.length === 0) return undefined;

  return holeChecks.reduce((total, check) => {
    const lower = check.toLowerCase();
    const digitMatches = Array.from(lower.matchAll(
      /\b(\d{1,2})\s*(?:x\s*)?(?:(?!mm\b)[a-z-]+\s+){0,3}holes?\b/g,
    ));
    const wordMatches = Array.from(lower.matchAll(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[a-z-]+\s+){0,3}holes?\b/g,
    ));
    const chineseMatches = Array.from(check.matchAll(/([一两二三四五六七八九十])(?:个)?(?:通孔|孔)/g));
    const explicit = [
      ...digitMatches.map((match) => Number(match[1])),
      ...wordMatches.map((match) => ENGLISH_COUNTS[match[1]] ?? 0),
      ...chineseMatches.map((match) => CHINESE_COUNTS[match[1]] ?? 0),
    ].filter((value) => value > 0);
    return total + (explicit.length > 0 ? explicit.reduce((sum, value) => sum + value, 0) : 1);
  }, 0);
}
