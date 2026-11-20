import { describe, expect, test } from "bun:test";
import { repairMeasuredFailures, type AssemblyMeasurement } from "./repair-loop";
import type { AssemblyEvidenceManifest } from "./repair-findings";

const POSE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const spec = () => ({
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: [
    { id: "leaf", name: "Leaf", selector: "leaf", source: "generated", material: null },
    { id: "pin", name: "Pin", selector: "pin", source: "generated", material: null },
  ],
  instances: [
    { id: "leaf-a", partId: "leaf", subassemblyId: null, transform: POSE },
    { id: "leaf-b", partId: "leaf", subassemblyId: null, transform: POSE },
    { id: "pin-1", partId: "pin", subassemblyId: null, transform: POSE },
  ],
  subassemblies: [], groundedInstanceId: "leaf-a",
  connections: [{
    id: "hinge", type: "revolute", a: "leaf-a", b: "leaf-b",
    frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
    range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null,
    boreInstanceId: "leaf-b", allowedContact: [],
  }],
  motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
});

/** A manifest whose only measured result is the clearance at the hinge. */
function measured(status: "PASS" | "FAIL", clearance = { min: 0.392, max: 0.407 }): AssemblyEvidenceManifest {
  return {
    evidence: {
      identity: { status: "PASS", reason: "two distinct parts" },
      assembly: { status, reason: status === "PASS" ? "clearance in band" : "clearance out of band" },
      motion: { status: "PASS", reason: "range sampled" },
    },
    contract: { evidenceCurrent: true },
    fits: status === "FAIL"
      ? [{
          connectionId: "hinge", status: "FAIL", measuredStatus: "FAIL",
          reason: "outside the frozen band", diametralClearanceMm: clearance,
          boreDiameterMm: { min: 6.4, max: 6.4 }, shaftDiameterMm: { min: 6, max: 6 },
        }]
      : [{
          connectionId: "hinge", status: "PASS", measuredStatus: "PASS",
          reason: "in band", diametralClearanceMm: clearance,
          boreDiameterMm: { min: 6.4, max: 6.4 }, shaftDiameterMm: { min: 6, max: 6 },
        }],
  };
}

const measurement = (status: "PASS" | "FAIL", overrides: Partial<AssemblyMeasurement> = {}): AssemblyMeasurement => ({
  spec: spec(), manifest: measured(status), kinematics: null,
  fitRequirements: [{ connectionId: "hinge", boreInstanceId: "leaf-b", diametralClearanceMm: { min: 0.1, max: 0.3 } }],
  ...overrides,
});

describe("the measured repair loop", () => {
  test("a passing assembly is not repaired at all", async () => {
    let proposals = 0;
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => measurement("PASS"),
      propose: async () => { proposals += 1; return { scad: "cube(2);" }; },
    });
    expect(proposals).toBe(0);
    expect(result.stoppedBecause).toBe("no-findings");
    expect(result.attempts).toHaveLength(1);
    expect(result.findings).toEqual([]);
  });

  test("one measured failure drives one repair, and the second measurement closes it", async () => {
    const prompts: string[] = [];
    const measurements: string[] = [];
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge that turns freely", scad: "cube(1);",
      measure: async (scad) => { measurements.push(scad); return scad === "cube(1);" ? measurement("FAIL") : measurement("PASS"); },
      propose: async (prompt) => { prompts.push(prompt); return { scad: "cube(2);" }; },
    });
    expect(measurements).toEqual(["cube(1);", "cube(2);"]);
    expect(prompts).toHaveLength(1);
    // The prompt carries the numbers the model must hit, not just "clearance is wrong".
    expect(prompts[0]).toContain("measured: 0.392–0.407 mm");
    expect(prompts[0]).toContain("required: 0.100–0.300 mm");
    expect(prompts[0]).toContain("a hinge that turns freely");
    expect(result.stoppedBecause).toBe("no-findings");
    expect(result.attempts.map((attempt) => attempt.evidence.assembly)).toEqual(["FAIL", "PASS"]);
    expect(result.attempts.map((attempt) => attempt.accepted)).toEqual([true, true]);
    expect(result.findings).toEqual([]);
    // The loop reports the candidate it actually ended on.
    expect(result.final.manifest.evidence.assembly.status).toBe("PASS");
  });

  test("a repair that deletes a part is refused and the previous candidate is kept", async () => {
    const gutted = spec();
    gutted.parts = gutted.parts.filter((part) => part.id !== "pin");
    gutted.instances = gutted.instances.filter((instance) => instance.partId !== "pin");
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => scad === "cube(1);" ? measurement("FAIL") : measurement("FAIL", { spec: gutted }),
      propose: async () => ({ scad: "difference() { cube(1); }" }),
    });
    expect(result.stoppedBecause).toBe("invariant-violated");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].accepted).toBe(false);
    expect(result.attempts[1].violations.map((violation) => violation.code)).toEqual(["part-removed", "instance-removed"]);
    expect(result.reason).toContain("weakened the assembly");
    // The rejected candidate is recorded but never becomes the answer.
    expect(result.final.spec).toEqual(spec());
    expect(result.findings).toHaveLength(1);
  });

  test("returning the same source ends the loop instead of re-measuring it", async () => {
    let measurements = 0;
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => { measurements += 1; return measurement("FAIL"); },
      propose: async () => ({ scad: "cube(1);" }),
    });
    expect(result.stoppedBecause).toBe("no-progress");
    expect(measurements).toBe(1);
    expect(result.attempts).toHaveLength(1);
  });

  test("the attempt budget bounds the loop and the shortfall is reported", async () => {
    let proposals = 0;
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);", maxAttempts: 2,
      measure: async () => measurement("FAIL"),
      propose: async (_prompt, attempt) => { proposals += 1; return { scad: `cube(${attempt + 1});` }; },
    });
    expect(proposals).toBe(2);
    expect(result.stoppedBecause).toBe("attempt-budget");
    expect(result.attempts).toHaveLength(3);
    expect(result.findings).toHaveLength(1);
    expect(result.reason).toContain("2 repair attempt(s)");
  });

  test("the budget cannot be raised past the hard cap", async () => {
    let proposals = 0;
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(0);", maxAttempts: 99,
      measure: async () => measurement("FAIL"),
      propose: async (_prompt, attempt) => { proposals += 1; return { scad: `cube(${attempt});` }; },
    });
    expect(proposals).toBe(5);
    expect(result.stoppedBecause).toBe("attempt-budget");
  });

  test("a repair that will not render keeps the last measurement that worked", async () => {
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => {
        if (scad !== "cube(1);") throw new Error("OpenSCAD exited with status 1");
        return measurement("FAIL");
      },
      propose: async () => ({ scad: "not scad at all" }),
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("could not be measured");
    expect(result.reason).toContain("OpenSCAD exited");
    // The failure to render is not evidence about the original part.
    expect(result.final.manifest.evidence.assembly.status).toBe("FAIL");
    expect(result.attempts).toHaveLength(1);
  });

  test("an empty proposal is refused rather than measured", async () => {
    let measurements = 0;
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => { measurements += 1; return measurement("FAIL"); },
      propose: async () => ({ scad: "   " }),
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("empty source");
    expect(measurements).toBe(1);
  });

  test("a model call that throws leaves the original candidate intact", async () => {
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => measurement("FAIL"),
      propose: async () => { throw new Error("rate limited"); },
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("rate limited");
    expect(result.final.manifest.evidence.assembly.status).toBe("FAIL");
  });

  test("progress is reported after every attempt, including the original", async () => {
    const seen: number[] = [];
    await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => scad === "cube(1);" ? measurement("FAIL") : measurement("PASS"),
      propose: async () => ({ scad: "cube(2);" }),
      onAttempt: (attempt) => seen.push(attempt.attempt),
    });
    expect(seen).toEqual([0, 1]);
  });

  test("a repair that shrinks the declared range is refused even though the motion would pass", async () => {
    const narrow = spec();
    narrow.connections[0].range = { min: -10, max: 10, unit: "deg" };
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => scad === "cube(1);" ? measurement("FAIL") : measurement("PASS", { spec: narrow }),
      propose: async () => ({ scad: "cube(2);" }),
    });
    // The measurement passed, but the pass was bought by shrinking the joint.
    expect(result.stoppedBecause).toBe("invariant-violated");
    expect(result.attempts[1].violations[0].code).toBe("range-shrunk");
    expect(result.final.manifest.evidence.assembly.status).toBe("FAIL");
  });
});
