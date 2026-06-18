import { describe, expect, test } from "bun:test";
import { buildDeliveryReadiness, type DeliveryValidationResult } from "@/lib/validation/delivery-readiness";

const passedRule: DeliveryValidationResult = {
  rule_id: "R001",
  rule_name: "Wall Thickness",
  level: "ENGINEERING",
  passed: true,
  is_critical: true,
  message: "Wall thickness is acceptable",
};

function artifacts(overrides: Partial<Parameters<typeof buildDeliveryReadiness>[0]> = {}) {
  return {
    state: "DELIVERED",
    scadSource: "cube([10, 10, 10]);",
    stlPath: "/artifacts/job/model.stl",
    pngPath: "/artifacts/job/preview.png",
    validationResults: [passedRule],
    ...overrides,
  };
}

describe("delivery readiness", () => {
  test("marks a delivered job ready only when artifacts and actionable validation pass", () => {
    const report = buildDeliveryReadiness(artifacts());

    expect(report.status).toBe("ready");
    expect(report.score).toBe(1);
    expect(report.nextAction).toBe("export");
    expect(report.blockers).toEqual([]);
  });

  test("routes skipped visual or semantic checks to visual review instead of export", () => {
    const report = buildDeliveryReadiness(artifacts({
      validationResults: [
        passedRule,
        {
          rule_id: "V001",
          rule_name: "Visual Design Intent Match",
          level: "SEMANTIC",
          passed: true,
          is_critical: true,
          message: "Skipped visual validation; run visual repair for design intent confidence",
        },
      ],
    }));

    expect(report.status).toBe("review");
    expect(report.nextAction).toBe("visual_repair");
    expect(report.score).toBeLessThan(1);
    expect(report.counts.skipped).toBe(1);
  });

  test("blocks delivery when a critical actionable validation rule fails", () => {
    const report = buildDeliveryReadiness(artifacts({
      validationResults: [
        {
          ...passedRule,
          passed: false,
          message: "Wall thickness is below the printable minimum",
        },
      ],
    }));

    expect(report.status).toBe("blocked");
    expect(report.nextAction).toBe("auto_repair");
    expect(report.blockers[0]).toContain("R001");
  });

  test("requires rebuild when rendered artifacts are missing", () => {
    const report = buildDeliveryReadiness(artifacts({
      stlPath: null,
      pngPath: null,
    }));

    expect(report.status).toBe("unverified");
    expect(report.nextAction).toBe("reprocess");
    expect(report.blockers).toContain("STL artifact is missing");
    expect(report.blockers).toContain("Preview image is missing");
  });

  test("prompts processing for a new job with no artifacts", () => {
    const report = buildDeliveryReadiness({
      state: "NEW",
      scadSource: null,
      stlPath: null,
      pngPath: null,
      validationResults: null,
    });

    expect(report.status).toBe("pending");
    expect(report.nextAction).toBe("process");
    expect(report.score).toBe(0);
  });
});
