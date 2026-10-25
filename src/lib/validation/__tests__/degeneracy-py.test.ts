import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import os from "os";
import { checkDegenerateGeometry } from "../degeneracy-check";
import type { RawMeshData } from "../validation-types";
import path from "path";

// Exercise the complete STL analyzer, including component and oriented bounds.
function resolvePython(): string {
  if (process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON) {
    return process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON;
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "AgentSCAD",
      "extensions",
      "mesh-validator",
      "venv",
      "bin",
      "python",
    );
  }
  return "python3";
}

const python = resolvePython();
const available = spawnSync(python, ["-c", "import trimesh, numpy, scipy, rtree, networkx"]).status === 0;
if (!available) {
  console.warn("Skipping B002 Python regressions: install mesh-validator Python dependencies or set AGENTSCAD_MESH_VALIDATOR_PYTHON.");
}

(available ? describe : describe.skip)("B002 volume reporting regression", () => {
  test("reports volume and flags a degenerate hull as sub-volume", () => {
    const result = spawnSync(
      python,
      ["scripts/tests/test_degeneracy.py", "DegeneracyTests", "-v"],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("Ran 3 tests");
  });
});


(available ? test : test.skip)("B002 real STL results survive rotation and healthy neighboring components", () => {
  const script = `
import json, sys, tempfile
from pathlib import Path
import trimesh
sys.path.insert(0, str(Path.cwd() / "scripts"))
from validate_stl import validate_stl
sliver = trimesh.creation.box(extents=[40,30,0.0001])
rotated = sliver.copy()
rotated.apply_transform(trimesh.transformations.rotation_matrix(.71,[1,2,3]))
rotated.apply_translation([20,-14,6])
healthy = trimesh.creation.box(extents=[5,5,5])
healthy.apply_translation([80,0,0])
sheet = trimesh.creation.box(extents=[20,20,.2])
sheet.apply_transform(trimesh.transformations.rotation_matrix(.71,[1,2,3]))
meshes = [sliver, rotated, trimesh.util.concatenate([healthy,rotated]), healthy, sheet]
with tempfile.TemporaryDirectory() as tmp:
    results = []
    for i, mesh in enumerate(meshes):
        filename = str(Path(tmp)/f"{i}.stl")
        mesh.export(filename)
        results.append(validate_stl(filename))
    print(json.dumps(results))
`;
  const result = spawnSync(python, ["-c", script], { encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
  const fixtures = JSON.parse(result.stdout);
  for (const [i, status] of (["FAIL", "FAIL", "FAIL", "PASS", "PASS"] as const).entries()) {
    const fixture = fixtures[i];
    expect(fixture.error).toBeUndefined();
    expect(checkDegenerateGeometry(fixture.summary as RawMeshData).status).toBe(status);
  }
});
