import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { AssemblySpec } from "../../assembly/assembly-spec";
import { verifySourcePoses } from "../source-pose-verification";
import { buildSliderCrankSourcePoseProtocol } from "../slider-crank-source-pose";

const identity: AssemblySpec["instances"][number]["transform"] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const fixturePath = "benchmarks/assembly/slider_crank.scad";
async function sliderSource() { return readFile(fixturePath, "utf8"); }
function sliderSpec(): AssemblySpec {
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: ["frame", "crank", "rod", "slider"].map((id) => ({ id, name: id, selector: id, source: "generated" as const, material: null })),
    instances: ["frame1:frame", "crank1:crank", "rod1:rod", "slider1:slider"].map((pair) => {
      const [id, partId] = pair.split(":");
      return { id, partId, subassemblyId: null, transform: identity };
    }),
    subassemblies: [], connections: [], groundedInstanceId: "frame1", motions: [], operations: [],
    manufacturing: null, assumptions: [], unknowns: [],
  };
}
const roles = { frame: "frame1", crank: "crank1", rod: "rod1", slider: "slider1" };
const protocol = (spec: AssemblySpec, anglesDeg: number[], budgetMs = 180000) =>
  buildSliderCrankSourcePoseProtocol({ spec, instances: roles, crankRadiusMm: 8, rodLengthMm: 28, motionParameter: "motion_angle", anglesDeg, budgetMs });

test("source-driven slider-crank motion matches independent analytic poses", async () => {
  const scadSource = await sliderSource();
  const spec = sliderSpec();
  const result = await verifySourcePoses({ scadSource, spec, ...protocol(spec, [0, 60, 120, 240, 300]) });
  expect(result.status).toBe("PASS");
  expect(result.results).toHaveLength(5);
  for (const caseResult of result.results) {
    expect(caseResult.status, `${caseResult.id}: ${JSON.stringify(caseResult)}`).toBe("PASS");
    expect(caseResult.assembly?.status).toBe("PASS");
  }
  expect(result.hasObservableChange).toBe(true);
}, 300000);

test("a changed crank radius is measured from the rendered source", async () => {
  const spec = sliderSpec();
  const scadSource = (await sliderSource()).replace("crank_radius = 8;", "crank_radius = 9;");
  const result = await verifySourcePoses({ scadSource, spec, ...protocol(spec, [0, 90], 120000) });
  expect(result.status).toBe("FAIL");
  expect(result.results.some((caseResult) => caseResult.comparisons?.some((row) => row.result.status === "FAIL"))).toBe(true);
}, 180000);

test("an unused motion parameter cannot drive the declared poses", async () => {
  const spec = sliderSpec();
  const scadSource = (await sliderSource()).replace("rotate([0, placed ? motion_angle : 0, 0])", "rotate([0, 0, 0])");
  const result = await verifySourcePoses({ scadSource, spec, ...protocol(spec, [0, 90], 120000) });
  expect(result.status).toBe("NOT_RUN");
  // The reference angle is legitimately static; at 90° the crank is unchanged
  // while the other links moved, so its phase is unverified rather than a pass.
  const crank = result.results.find((caseResult) => caseResult.id === "angle-90")?.comparisons?.find((row) => row.instanceId === "crank1");
  expect(crank?.result.status).toBe("NOT_RUN");
  expect(crank?.observability?.status).toBe("NOT_RUN");
}, 180000);

test("the 180-degree sample records an unobservable phase instead of a pass", async () => {
  const spec = sliderSpec();
  const result = await verifySourcePoses({ scadSource: await sliderSource(), spec, ...protocol(spec, [0, 180], 120000) });
  expect(result.status).toBe("NOT_RUN");
  const reasons = result.results.flatMap((caseResult) => caseResult.comparisons ?? [])
    .filter((row) => row.observability?.status === "NOT_RUN").map((row) => `${row.instanceId}: ${row.observability?.reason}`);
  expect(reasons.join(" ")).toContain("crank1");
  expect(reasons.join(" ")).toContain("surface-difference witness");
}, 180000);
