import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
    const usage = { model: "test-model", provider: "unit", promptTokens: 33 };
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => scad === "cube(1);" ? measurement("FAIL") : measurement("FAIL", { spec: gutted }),
      propose: async () => ({ scad: "difference() { cube(1); }", modelExecution: usage }),
    });
    expect(result.stoppedBecause).toBe("invariant-violated");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].accepted).toBe(false);
    expect(result.attempts[1].phase).toBe("invariant");
    expect(result.attempts[1].candidateScadSource).toBe("difference() { cube(1); }");
    expect(result.attempts[1].modelExecution).toEqual(usage);
    expect(result.attempts[1].violations.map((violation) => violation.code)).toEqual(["part-removed", "instance-removed"]);
    expect(result.reason).toContain("weakened the assembly");
    // The rejected candidate is recorded but never becomes the answer.
    expect(result.final.spec).toEqual(spec());
    expect(result.findings).toHaveLength(1);
  });

  test("returning the same source ends the loop but still records the paid attempt", async () => {
    let measurements = 0;
    const usage = { model: "test-model", provider: "unit", latencyMs: 12, promptTokens: 90, completionTokens: 4 };
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => { measurements += 1; return measurement("FAIL"); },
      propose: async () => ({ scad: "cube(1);", modelExecution: usage }),
    });
    expect(result.stoppedBecause).toBe("no-progress");
    expect(measurements).toBe(1);
    expect(result.attempts).toHaveLength(2);
    // The no-op proposal is not progress, but it is an immutable paid attempt.
    expect(result.attempts[1].phase).toBe("no-progress");
    expect(result.attempts[1].accepted).toBe(false);
    expect(result.attempts[1].candidateScadSource).toBe("cube(1);");
    expect(result.attempts[1].candidateByteLength).toBe(Buffer.byteLength("cube(1);"));
    expect(result.attempts[1].scadSha256).toBe(result.attempts[0].scadSha256);
    expect(result.attempts[1].modelExecution).toEqual(usage);
    expect(result.finalScad).toBe("cube(1);");
  });

  test("an oversized returned model source keeps its digest and usage but never its text", async () => {
    const proposal = "/* too large */" + " ".repeat(270_000);
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => measurement("FAIL"),
      propose: async () => ({ scad: proposal, modelExecution: { model: "test-model", provider: "unit", latencyMs: 7, promptTokens: 100 } }),
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].phase).toBe("proposal-error");
    expect(result.attempts[1].candidateByteLength).toBe(Buffer.byteLength(proposal, "utf8"));
    expect(result.attempts[1].candidateScadSource).toBeUndefined();
    expect(result.attempts[1].scadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.attempts[1].modelExecution).toEqual({ model: "test-model", provider: "unit", latencyMs: 7, promptTokens: 100 });
    expect(result.finalScad).toBe("cube(1);");
  });

  test("the attempt budget bounds the loop and rendered-but-still-failing candidates are recorded", async () => {
    let proposals = 0;
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);", maxAttempts: 2,
      measure: async () => measurement("FAIL"),
      propose: async (_prompt, attempt) => {
        proposals += 1;
        return {
          scad: `cube(${attempt + 1});`,
          modelExecution: { model: "test-model", provider: "unit", promptTokens: attempt * 10, completionTokens: attempt },
        };
      },
    });
    expect(proposals).toBe(2);
    expect(result.stoppedBecause).toBe("attempt-budget");
    expect(result.attempts).toHaveLength(3);
    expect(result.findings).toHaveLength(1);
    expect(result.reason).toContain("2 repair attempt(s)");
    // Every rendered candidate keeps its exact bytes and real model usage, even
    // though it did not close the failure.
    expect(result.attempts.map((attempt) => attempt.phase)).toEqual(["measured", "measured", "measured"]);
    expect(result.attempts.slice(1).map((attempt) => attempt.candidateScadSource)).toEqual(["cube(2);", "cube(3);"]);
    expect(result.attempts[1].candidateByteLength).toBe(Buffer.byteLength("cube(2);"));
    expect(result.attempts[2].modelExecution).toEqual({ model: "test-model", provider: "unit", promptTokens: 20, completionTokens: 2 });
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

  test("a repair that will not render records the returned source and usage", async () => {
    const usage = { model: "test-model", provider: "unit", latencyMs: 21, promptTokens: 64, completionTokens: 9 };
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => {
        if (scad !== "cube(1);") throw new Error("OpenSCAD exited with status 1");
        return measurement("FAIL");
      },
      propose: async () => ({ scad: "not scad at all", modelExecution: usage }),
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("could not be measured");
    expect(result.reason).toContain("OpenSCAD exited");
    // The failure to render is not evidence about the original part.
    expect(result.final.manifest.evidence.assembly.status).toBe("FAIL");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].phase).toBe("measurement-error");
    expect(result.attempts[1].accepted).toBe(false);
    expect(result.attempts[1].candidateScadSource).toBe("not scad at all");
    expect(result.attempts[1].scadSha256).toBe(createHash("sha256").update("not scad at all").digest("hex"));
    expect(result.attempts[1].modelExecution).toEqual(usage);
  });

  test("an empty proposal is refused rather than measured and is still recorded", async () => {
    let measurements = 0;
    const usage = { model: "test-model", provider: "unit", latencyMs: 2, promptTokens: 51, completionTokens: 0 };
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => { measurements += 1; return measurement("FAIL"); },
      propose: async () => ({ scad: "   ", modelExecution: usage }),
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("empty source");
    expect(measurements).toBe(1);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].phase).toBe("proposal-error");
    expect(result.attempts[1].candidateByteLength).toBe(3);
    expect(result.attempts[1].candidateScadSource).toBe("   ");
    expect(result.attempts[1].modelExecution).toEqual(usage);
  });

  test("a model call that throws keeps the original and fabricates no candidate attempt", async () => {
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async () => measurement("FAIL"),
      propose: async () => { throw new Error("rate limited"); },
    });
    expect(result.stoppedBecause).toBe("repair-failed");
    expect(result.reason).toContain("rate limited");
    expect(result.final.manifest.evidence.assembly.status).toBe("FAIL");
    // No source was returned, so there is nothing to bind or replay. Recording
    // an attempt here would claim a candidate that never existed.
    expect(result.attempts).toHaveLength(1);
    expect(result.finalScad).toBe("cube(1);");
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

  test("attempt persistence is awaited before the next paid proposal starts", async () => {
    let proposals = 0;
    let releaseObserver: () => void = () => {};
    const observerGate = new Promise<void>((resolve) => { releaseObserver = resolve; });
    const persisted: number[] = [];
    const running = repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);", maxAttempts: 1,
      measure: async () => measurement("FAIL"),
      propose: async () => { proposals += 1; return { scad: "cube(2);" }; },
      onAttempt: async (attempt) => {
        persisted.push(attempt.attempt);
        if (attempt.attempt === 0) await observerGate;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The loop must not spend the next model call until the first attempt row is durable.
    expect(persisted).toEqual([0]);
    expect(proposals).toBe(0);
    releaseObserver();
    const result = await running;
    expect(persisted).toEqual([0, 1]);
    expect(result.stoppedBecause).toBe("attempt-budget");
  });

  test("a repair that shrinks the declared range is refused even though the motion would pass", async () => {
    const narrow = spec();
    narrow.connections[0].range = { min: -10, max: 10, unit: "deg" };
    const usage = { model: "test-model", provider: "unit", promptTokens: 77 };
    const result = await repairMeasuredFailures({
      originalRequest: "a hinge", scad: "cube(1);",
      measure: async (scad) => scad === "cube(1);" ? measurement("FAIL") : measurement("PASS", { spec: narrow }),
      propose: async () => ({ scad: "cube(2);", modelExecution: usage }),
    });
    // The measurement passed, but the pass was bought by shrinking the joint.
    expect(result.stoppedBecause).toBe("invariant-violated");
    expect(result.attempts[1].violations[0].code).toBe("range-shrunk");
    expect(result.attempts[1].phase).toBe("invariant");
    expect(result.attempts[1].candidateScadSource).toBe("cube(2);");
    expect(result.attempts[1].modelExecution).toEqual(usage);
    expect(result.final.manifest.evidence.assembly.status).toBe("FAIL");
  });
});
