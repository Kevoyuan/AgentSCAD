import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { checkHoleCount } from "../hole-check";
import type { RawMeshData } from "../validation-types";

const python = process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON || "python3";
const available = spawnSync(python, ["-c", "import trimesh, numpy, scipy, networkx" ]).status === 0;
if (!available) console.warn("Skipping H001 STL regressions: install trimesh/numpy/scipy/networkx or set AGENTSCAD_MESH_VALIDATOR_PYTHON.");

// Build the exposed faces of a voxel plate, with known omitted cells as holes.
// No boolean engine or LLM is needed; STL loading still exercises vertex welding.
const fixtureScript = `
import json, sys, tempfile
from pathlib import Path
import trimesh
sys.path.insert(0, str(Path.cwd() / "scripts"))
from validate_stl import validate_stl
holes = {(1,1), (1,5), (5,1), (5,5)}
def plate(count):
    omitted = set(sorted(holes)[:count])
    cells = {(x,y,0) for x in range(7) for y in range(7) if (x,y) not in omitted}
    vertices, faces = [], []
    for x,y,z in cells:
        cube = trimesh.creation.box()
        cube.apply_translation([x,y,z])
        for face, normal in zip(cube.faces, cube.face_normals):
            neighbor = tuple(int(a+b) for a,b in zip((x,y,z), normal))
            if neighbor not in cells:
                start = len(vertices)
                vertices.extend(cube.vertices[face].tolist())
                faces.append([start,start+1,start+2])
    return trimesh.Trimesh(vertices=vertices, faces=faces)
box = trimesh.creation.box(extents=[40,30,5])
floating = trimesh.creation.box()
floating.apply_translation([20,20,20])
open_mesh = box.copy()
open_mesh.update_faces(list(range(len(box.faces)-1)))
meshes = {"solid": box, "one": plate(1), "four": plate(4),
          "two_solids": trimesh.util.concatenate([box, floating]),
          "four_and_solid": trimesh.util.concatenate([plate(4), floating]),
          "open": open_mesh}
with tempfile.TemporaryDirectory() as tmp:
    results = {}
    for name, mesh in meshes.items():
        filename = str(Path(tmp) / (name + ".stl"))
        mesh.export(filename)
        results[name] = validate_stl(filename)
    print(json.dumps(results))
`;

(available ? describe : describe.skip)("H001 real STL topology regressions", () => {
  test("counts unique edges and total genus across components, rejecting missing holes", () => {
    const result = spawnSync(python, ["-c", fixtureScript], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const fixtures = JSON.parse(result.stdout);
    for (const [name, holes, components] of [
      ["solid", 0, 1], ["one", 1, 1], ["four", 4, 1],
      ["two_solids", 0, 2], ["four_and_solid", 4, 2],
    ] as const) {
      const output = fixtures[name];
      expect(output.error).toBeUndefined();
      expect(output.summary.genus, name).toBe(holes);
      expect(output.summary.componentCount, name).toBe(components);
      const details = output.rules.find((r: { id: string }) => r.id === "R003").details;
      expect(details.vertices - details.edges + details.faces, name).toBe(2 * components - 2 * holes);
      const data: RawMeshData = { ...details, ...output.summary, bbox: output.summary.boundingBox };
      expect(checkHoleCount(data, holes).status, name).toBe("PASS");
      if (holes < 4) {
        const check = checkHoleCount(data, 4);
        expect(check.status, name).toBe("FAIL");
        expect(check.passed).toBe(false);
        expect(check.is_critical).toBe(true);
      }
    }
    const open = fixtures.open;
    const details = open.rules.find((r: { id: string }) => r.id === "R003").details;
    expect(checkHoleCount({ ...details, ...open.summary }, 4).status).toBe("SKIP");
  });
});
