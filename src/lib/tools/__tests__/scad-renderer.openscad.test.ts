import { mkdtemp, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { renderPng, renderStl } from "@/lib/tools/scad-renderer";

async function hasOpenScad(): Promise<boolean> {
  try {
    await $`${process.env.OPENSCAD_BIN || "openscad"} --version`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function hasPythonMeshDependencies(): Promise<boolean> {
  try {
    await $`python3 -c "import trimesh, numpy, scipy, rtree"`.quiet();
    return true;
  } catch {
    return false;
  }
}

const openscadAvailable = await hasOpenScad();

if (!openscadAvailable) {
  console.warn("Skipping OpenSCAD integration tests: openscad not found.");
}

const describeOpenScad = openscadAvailable ? describe : describe.skip;

describeOpenScad("scad-renderer OpenSCAD integration", () => {
  test("renders SCAD source to STL and PNG artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentscad-openscad-test-"));
    const scadPath = path.join(tempDir, "model.scad");
    const stlPath = path.join(tempDir, "model.stl");
    const pngPath = path.join(tempDir, "preview.png");

    await writeFile(
      scadPath,
      [
        "$fn = 24;",
        "difference() {",
        "  cube([20, 12, 4], center = true);",
        "  translate([-5, 0, 0]) cylinder(h = 8, d = 3, center = true);",
        "  translate([5, 0, 0]) cylinder(h = 8, d = 3, center = true);",
        "}",
        "",
      ].join("\n"),
      "utf8"
    );

    await renderStl(scadPath, stlPath);
    await renderPng(scadPath, pngPath);

    await expect(stat(stlPath).then((result) => result.size)).resolves.toBeGreaterThan(0);
    await expect(stat(pngPath).then((result) => result.size)).resolves.toBeGreaterThan(0);

    if (!(await hasPythonMeshDependencies())) {
      console.warn("Skipping mesh validation assertion: Python mesh dependencies are not installed.");
      return;
    }

    const validation = await $`python3 scripts/validate_stl.py ${stlPath} --min-wall 1.2`.text();
    const parsed = JSON.parse(validation);

    expect(parsed.error).toBeFalsy();
    expect(parsed.summary.total).toBeGreaterThan(0);
    expect(parsed.summary.boundingBox).toBeTruthy();
  });
});
