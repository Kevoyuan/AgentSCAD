import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const python = process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON || "python3";
const available = spawnSync(process.env.OPENSCAD_BIN || "openscad", ["--version"]).status === 0
  && spawnSync(python, ["-c", "import trimesh, numpy, scipy, rtree, networkx"]).status === 0;
if (!available && process.env.CI) throw new Error("OpenSCAD integration requires OpenSCAD and Python mesh dependencies");
if (!available) console.warn("Skipping native fit/boolean regressions: OpenSCAD or mesh dependencies unavailable.");

(available ? test : test.skip)("measures round-hole clearance and valid coplanar CGAL booleans", () => {
  const result = spawnSync(python, ["scripts/tests/test_manufacturing_geometry.py", "OpenScadGeometryTests", "-v"], {
    encoding: "utf8", timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toMatch(/Ran [1-9][0-9]* tests/);
}, 60_000);
