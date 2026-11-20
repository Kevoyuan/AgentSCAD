#!/usr/bin/env python3
"""Independent, standard-library certificate for the frozen axial hinge only.

Uses triangle projections and half-space bounds, not AgentSCAD's BVH. A positive
radial gap separates the complete moving mesh from the pin cylinder throughout
the vertical translation; a positive Z gap separates it from the fixed leaf.
This special-domain digital proof does not measure forces or manufacturing.
"""
import hashlib
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

EPS = 1e-5
BASE_PLANE_Z = 0.10001
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_mesh(path, expected_hash):
    data = path.read_bytes()
    require(sha(data) == expected_hash, "STL binding mismatch")
    count = struct.unpack_from("<I", data, 80)[0]
    require(0 < count <= 50000 and len(data) == 84 + count * 50, "Invalid STL table")
    triangles, edges = [], defaultdict(list)
    for index in range(count):
        values = struct.unpack_from("<9f", data, 96 + index * 50)
        require(all(math.isfinite(value) for value in values), "Non-finite STL")
        triangle = [tuple(values[i:i + 3]) for i in (0, 3, 6)]
        triangles.append(triangle)
        for a, b in zip(triangle, triangle[1:] + triangle[:1]):
            require(a != b, "Collapsed edge")
            edges[tuple(sorted((a, b)))].append(1 if a < b else -1)
    require(all(len(uses) == 2 and sum(uses) == 0 for uses in edges.values()), "Mesh is not a closed consistently oriented triangle surface")
    return triangles


def projected_radius(triangle):
    """Minimum XY distance to the ENTIRE projected triangle, not just vertices."""
    a, b, c = [vertex[:2] for vertex in triangle]
    cross = lambda p, q: p[0] * q[1] - p[1] * q[0]
    area = cross((b[0] - a[0], b[1] - a[1]), (c[0] - a[0], c[1] - a[1]))
    sides = [cross(p, q) for p, q in ((a, b), (b, c), (c, a))]
    if abs(area) > 1e-12 and (min(sides) >= -1e-12 or max(sides) <= 1e-12):
        return 0.0
    distances = []
    for p, q in ((a, b), (b, c), (c, a)):
        delta = (q[0] - p[0], q[1] - p[1])
        squared = delta[0] ** 2 + delta[1] ** 2
        t = min(1.0, max(0.0, -(p[0] * delta[0] + p[1] * delta[1]) / squared)) if squared else 0
        distances.append(math.hypot(p[0] + t * delta[0], p[1] + t * delta[1]))
    return min(distances)


def audit(root):
    protocol = json.loads((root / "protocol.json").read_text())
    folder = root / "explicit"
    manifest = json.loads((folder / "manifest.json").read_text())
    spec = json.loads((folder / "specification.json").read_text())
    source = (folder / "source.scad").read_bytes()
    require(sha(source) == manifest["sourceSha256"], "Source binding mismatch")
    fixture = source.split(b"END_AGENTSCAD_ASSEMBLY */\n", 1)[1]
    require(sha(fixture) == protocol["inputs"]["benchmarks/assembly/axial_hinge.scad"], "Not the frozen original fixture")
    reference_path = "scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json"
    reference = (root / "inputs" / reference_path).read_bytes()
    require(sha(reference) == protocol["inputs"][reference_path], "Frozen input binding mismatch")
    require(spec == json.loads(reference), "Not the frozen operation declaration")
    embedded = source.split(b"/* AGENTSCAD_ASSEMBLY_V1\n", 1)[1].split(b"\nEND_AGENTSCAD_ASSEMBLY */", 1)[0]
    require(json.loads(embedded) == spec, "Source declaration and exported specification differ")
    require(len(spec["instances"]) == 2 and spec["groundedInstanceId"] == "fixed-instance", "Unsupported inventory")
    require(all(instance["transform"] == IDENTITY for instance in spec["instances"]), "Certificate requires the frozen identity placements")
    parts = {part["id"]: part for part in manifest["parts"]}
    fixed = load_mesh(folder / "fixed.stl", parts["fixed"]["artifactSha256"])
    moving = load_mesh(folder / "moving.stl", parts["moving"]["artifactSha256"])
    pin = [triangle for triangle in fixed if max(v[2] for v in triangle) > BASE_PLANE_Z]
    require(bool(pin), "No pin surface above the fixed leaf")
    pin_radius = max(math.hypot(v[0], v[1]) for triangle in pin for v in triangle)
    moving_radius = min(projected_radius(triangle) for triangle in moving)
    moving_z = min(v[2] for triangle in moving for v in triangle)
    fixed_z = max(v[2] for triangle in fixed for v in triangle)
    require(moving_radius - pin_radius > EPS, "No certified radial separation from the pin")
    require(moving_z - BASE_PLANE_Z > EPS, "No certified axial separation from the fixed leaf")
    removal = manifest["declaredDisassembly"]["results"][0]["path"]["poses"]
    reverse_insertion = manifest["declaredAssembly"]["reversedEvaluation"]["results"][0]["path"]["poses"]
    for poses in (removal, reverse_insertion):
        require(len(poses) == 49, "Unexpected sampling coverage")
        for index, pose in enumerate(poses):
            expected = list(IDENTITY)
            expected[11] = index / 4
            require(len(pose) == 16 and max(abs(a - b) for a, b in zip(pose, expected)) < EPS, "Reported path does not follow the frozen complete vertical route")
    require(moving_z + 12 - fixed_z > EPS, "Terminal pose is not fully removed")
    return {"status": "PASS", "method": "closed-triangle-projection-and-half-space-separation/v1",
            "radialSeparationMm": moving_radius - pin_radius,
            "fixedLeafSeparationMm": moving_z - BASE_PLANE_Z,
            "terminalSeparationMm": moving_z + 12 - fixed_z,
            "removalSamplesReplayed": len(removal), "insertionSamplesReplayed": len(reverse_insertion),
            "arithmeticGuardMm": EPS,
            "coverage": "For these retained closed meshes and the frozen vertical rigid route, separation holds for all intermediate Z offsets in [0,12], in either direction. Float32 coordinates, double arithmetic with a declared guard; not a general robustness or geometry certificate.",
            "physical": "NOT_RUN", "manufacturingTolerance": "NOT_RUN"}


if __name__ == "__main__":
    try:
        print(json.dumps(audit(Path(sys.argv[1])), indent=2))
    except (ValueError, KeyError, IndexError, OSError, struct.error) as error:
        print(json.dumps({"status": "ERROR", "reason": str(error)}))
        sys.exit(2)
