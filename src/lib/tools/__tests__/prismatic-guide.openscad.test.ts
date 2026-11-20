import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { prepareAssembly } from "../../assembly/prepare-assembly";

const fixturePath = "benchmarks/assembly/prismatic_guide_declared.scad";
const requirement = [{ connectionId: "slide", boreInstanceId: "guide1", diametralClearanceMm: { min: 0.2, max: 0.6 } }];

async function prepare(scadSource: string) {
  const extracted = extractEmbeddedAssemblySpec(scadSource);
  if (extracted.status !== "valid") throw new Error(`declared guide is ${extracted.status}`);
  return prepareAssembly({ scadSource, spec: extracted.spec, fitRequirements: requirement });
}

test("a cylindrical prismatic pair is measured with the bore/shaft method", async () => {
  const scadSource = await readFile(fixturePath, "utf8");
  const result = await prepare(scadSource);
  expect(result.fits).toHaveLength(1);
  expect(result.fits[0].status).toBe("PASS");
  expect(result.fits[0].measuredStatus).toBe("PASS");
  expect(result.fits[0].diametralClearanceMm!.min).toBeGreaterThan(0.35);
  expect(result.fits[0].diametralClearanceMm!.max).toBeLessThan(0.45);
  expect(result.fits[0].jointFrames?.measuredStatus, JSON.stringify(result.fits[0].jointFrames)).toBe("PASS");
}, 300000);

test("an undersized clearance fails the cylindrical prismatic measurement", async () => {
  const tampered = (await readFile(fixturePath, "utf8")).replace("slider_radius = 4.8;", "slider_radius = 4.95;");
  const result = await prepare(tampered);
  expect(result.fits[0].status).toBe("FAIL");
  expect(result.fits[0].diametralClearanceMm!.min).toBeLessThan(0.2);
}, 300000);
