import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import os from "os";
import path from "path";

// The degenerate-geometry analyzer only needs trimesh + numpy (not scipy /
// rtree / networkx / openscad), so it can run with the managed venv even when
// the full mesh-validator dependency set is not installed.
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
const available = spawnSync(python, ["-c", "import trimesh, numpy"]).status === 0;
if (!available) {
  console.warn("Skipping B002 Python regressions: install trimesh/numpy or set AGENTSCAD_MESH_VALIDATOR_PYTHON.");
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
