import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const python = process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON || "python3";
const available = spawnSync(python, ["-c", "import trimesh, numpy, scipy, rtree, networkx"]).status === 0;
if (!available && process.env.CI) throw new Error("CI must install the Python mesh validation dependencies");
if (!available) console.warn("Skipping manufacturing geometry regressions: install mesh dependencies or set AGENTSCAD_MESH_VALIDATOR_PYTHON.");

(available ? describe : describe.skip)("manufacturing geometry", () => {
  test("measures sheet gauge, enclosure walls and unavailable evidence honestly", () => {
    const result = spawnSync(python, ["scripts/tests/test_manufacturing_geometry.py", "ThicknessTests", "-v"], {
      encoding: "utf8", timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("Ran 8 tests");
  });

  test("preserves sheet WARN and unavailable SKIP through the public validator", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentscad-material-"));
    try {
      const fixtures = spawnSync(python, ["-c", `
import sys, trimesh
from pathlib import Path
root = Path(sys.argv[1])
trimesh.creation.annulus(r_min=3,r_max=10,height=0.8).export(root/'sheet.stl')
mesh = trimesh.creation.box()
mesh.update_faces(list(range(11)))
mesh.export(root/'open.stl')
`, directory], { encoding: "utf8" });
      expect(fixtures.status, fixtures.stderr).toBe(0);
      // Isolate the managed-Python cache and module state from other test suites.
      const result = spawnSync(process.execPath, ["-e", `
import { validateStl } from './src/lib/mesh-validator';
import { getCriticalValidationFailures } from './src/lib/tools/validation-tool';
const rules = [];
for (const file of ['sheet.stl', 'open.stl']) {
  const results = await validateStl(process.env.FIXTURE_DIR + '/' + file);
  const rule = results.find(r => r.rule_id === 'R001');
  rules.push({ ...rule, repairFailures: getCriticalValidationFailures([rule]).length });
}
console.log('RESULT:' + JSON.stringify(rules));
`], {
        encoding: "utf8", timeout: 30_000,
        env: { ...process.env, AGENTSCAD_MESH_VALIDATOR_PYTHON: python, FIXTURE_DIR: directory },
      });
      expect(result.status, result.stderr).toBe(0);
      const line = result.stdout.split("\n").find(line => line.startsWith("RESULT:"));
      const rules = JSON.parse(line!.slice("RESULT:".length));
      expect(rules[0].status).toBe("WARN");
      expect(rules[0].repairFailures).toBe(0);
      expect(rules[1].status).toBe("SKIP");
      expect(rules[1].passed).toBe(false);
      expect(rules[1].repairFailures).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
