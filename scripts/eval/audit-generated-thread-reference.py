#!/usr/bin/env python3
"""Independent NumPy/SciPy reference-mesh audit.

Before execution, fix vertex-to-analytic-sample tolerance at 1e-6 mm and
triangle cross-product degeneracy threshold at 1e-12 mm^2. These are digital
mesh-replay checks, not calibrated functional tolerances. Self-intersection
between triangle interiors is not tested.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
import scipy
from scipy.spatial import cKDTree


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = args.directory
    report_bytes = (root / "report.json").read_bytes()
    report = json.loads(report_bytes)
    protocol_bytes = (root / "protocol.json").read_bytes()
    if hashlib.sha256(protocol_bytes).hexdigest() != report["protocolSha256"]:
        raise ValueError("Protocol hash mismatch")
    protocol = json.loads(protocol_bytes)
    expected_ids = {f"angular-{a}-axial-{z}-phase-{p}" for a in protocol["angularMultipliers"] for z in protocol["layersPerMm"] for p in protocol["phaseDeg"]}
    if len(report["meshes"]) != len(expected_ids) or {m["id"] for m in report["meshes"]} != expected_ids:
        raise ValueError("Missing or extra reference meshes")
    expected_attempts = {(mesh, tuple(stations)) for mesh in expected_ids for stations in protocol["stationsMm"]}
    actual_attempts = [(r["id"], tuple(r["stationsMm"])) for r in report["results"]]
    if len(actual_attempts) != len(expected_attempts) or set(actual_attempts) != expected_attempts:
        raise ValueError("Missing, duplicate or extra measurement attempts")
    geometry = protocol["geometry"]
    dtype = np.dtype([("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")])
    results = []
    for mesh in report["meshes"]:
        raw = (root / f"{mesh['id']}.stl").read_bytes()
        if hashlib.sha256(raw).hexdigest() != mesh["meshSha256"]:
            raise ValueError("Mesh hash mismatch")
        count = int.from_bytes(raw[80:84], "little")
        if len(raw) != 84 + 50 * count:
            raise ValueError("Invalid binary STL table")
        triangles = np.frombuffer(raw, dtype=dtype, offset=84, count=count)["vertices"].astype(np.float64)
        if not np.isfinite(triangles).all():
            raise ValueError("Nonfinite triangle coordinates")
        points, inverse = np.unique(triangles.reshape(-1, 3), axis=0, return_inverse=True)
        faces = inverse.reshape(-1, 3)
        edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
        ordered = np.sort(edges, axis=1)
        _, groups, incidences = np.unique(ordered, axis=0, return_inverse=True, return_counts=True)
        directed_balance = np.bincount(groups, weights=np.where(edges[:, 0] < edges[:, 1], 1, -1))
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        degenerate = int((np.linalg.norm(normals, axis=1) <= 1e-12).sum())
        volume = float(np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum() / 6)
        n = 20 * mesh["angular"]
        layers = int(np.ceil(geometry["heightMm"] * mesh["axial"]))
        theta = np.arange(n) * 360 / n
        minor, major = geometry["minorRadiusMm"], geometry["majorRadiusMm"]
        radius = np.where(theta <= 90, minor,
                          np.where(theta < 108, minor + (major - minor) * (theta - 90) / 18,
                                   np.where(theta <= 342, major, major - (major - minor) * (theta - 342) / 18)))
        expected = []
        for z in np.linspace(0, geometry["heightMm"], layers + 1):
            angle = np.deg2rad(theta + mesh["phase"] + 360 * z / geometry["pitchMm"])
            for r in [radius, np.full(n, geometry["outerRadiusMm"])]:
                expected.append(np.column_stack([geometry["centerMm"][0] + r * np.cos(angle), geometry["centerMm"][1] + r * np.sin(angle), np.full(n, z)]))
        expected = np.concatenate(expected)
        # Check both directions, preventing missing or extra sampled vertices.
        max_delta = float(max(cKDTree(expected).query(points)[0].max(), cKDTree(points).query(expected)[0].max()))
        closed = bool((incidences == 2).all() and (directed_balance == 0).all() and degenerate == 0 and volume > 0)
        results.append({"id": mesh["id"], "triangles": count, "uniqueVertices": len(points),
                        "badEdgeIncidences": int((incidences != 2).sum()), "badDirectedBalances": int((directed_balance != 0).sum()),
                        "degenerateTriangles": degenerate, "signedVolumeMm3": volume, "maxAnalyticVertexDeltaMm": max_delta,
                        "topologyStatus": "PASS" if closed else "FAIL", "analyticSampleStatus": "PASS" if max_delta <= 1e-6 else "FAIL"})
    output = {"status": "NOT_RUN", "scope": "Closed edge-manifold topology, winding and analytic sample agreement only. Self-intersection, mesh feature axis truth and calibrated functional uncertainty remain unverified.",
              "reportSha256": hashlib.sha256(report_bytes).hexdigest(), "auditSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "environment": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__}, "results": results}
    (root / "independent-mesh-audit.json").write_text(json.dumps(output, indent=2) + "\n")
    (root / "independent-mesh-audit.py").write_bytes(Path(__file__).read_bytes())
    print(json.dumps(output, indent=2))
    if any(r["topologyStatus"] == "FAIL" or r["analyticSampleStatus"] == "FAIL" for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
