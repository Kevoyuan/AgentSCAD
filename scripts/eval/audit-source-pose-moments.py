#!/usr/bin/env python3
"""Independent necessary pose checks on retained meshes, using standard Python.

Usage: python3 scripts/eval/audit-source-pose-moments.py protocol.json
The protocol freezes source and artifact hashes, expected row-major transforms,
and tolerances. A passing centroid/volume check never establishes surface identity.
"""
import hashlib
import json
import math
from pathlib import Path
import runpy
import struct
import sys


mesh_audit = runpy.run_path(str(Path(__file__).with_name("audit-retained-hinge-repair.py")))


def checked_bytes(artifact):
    data = Path(artifact["path"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != artifact["sha256"]:
        raise ValueError("Artifact hash differs from frozen protocol")
    return data


def measure(artifact):
    data = checked_bytes(artifact)
    topology = mesh_audit["inspect_mesh"](artifact["path"], [])
    count = struct.unpack_from("<I", data, 80)[0]
    triangles = []
    for index in range(count):
        values = struct.unpack_from("<9f", data, 96 + 50 * index)
        triangles.append([tuple(values[j:j + 3]) for j in (0, 3, 6)])
    vertices = [vertex for triangle in triangles for vertex in triangle]
    lower = [min(vertex[k] for vertex in vertices) for k in range(3)]
    upper = [max(vertex[k] for vertex in vertices) for k in range(3)]
    origin = [(a + b) / 2 for a, b in zip(lower, upper)]
    volumes, moments = [], [[], [], []]
    for triangle in triangles:
        a, b, c = [mesh_audit["subtract"](vertex, origin) for vertex in triangle]
        volume = mesh_audit["dot"](a, mesh_audit["cross"](b, c)) / 6
        volumes.append(volume)
        for k in range(3):
            moments[k].append(volume * (a[k] + b[k] + c[k]) / 4)
    signed_volume = math.fsum(volumes)
    if abs(signed_volume) < 1e-9:
        raise ValueError("Zero or numerically unobservable signed volume")
    centroid = [origin[k] + math.fsum(moments[k]) / signed_volume for k in range(3)]
    if not all(math.isfinite(value) for value in centroid):
        raise ValueError("Nonfinite volume moment")
    return {"sha256": topology["sha256"], "triangles": count,
            "surfaceComponents": len(topology["components"]),
            "signedVolumeMm3": signed_volume, "centroidMm": centroid,
            "minMm": lower, "maxMm": upper}


def transform_point(matrix, point):
    if len(matrix) != 16 or not all(math.isfinite(value) for value in matrix):
        raise ValueError("Expected finite 4x4 transform")
    if matrix[12:] != [0, 0, 0, 1]:
        raise ValueError("Expected affine row-major transform")
    rows = [matrix[k:k + 3] for k in (0, 4, 8)]
    for i in range(3):
        for j in range(3):
            if abs(mesh_audit["dot"](rows[i], rows[j]) - int(i == j)) > 1e-9:
                raise ValueError("Expected orthonormal rotation")
    if abs(mesh_audit["dot"](rows[0], mesh_audit["cross"](rows[1], rows[2])) - 1) > 1e-9:
        raise ValueError("Expected proper rotation")
    return [mesh_audit["dot"](rows[k], point) + matrix[4 * k + 3] for k in range(3)]


def audit(protocol):
    checked_bytes(protocol["source"])
    tolerance = protocol["centroidToleranceMm"]
    relative_volume_tolerance = protocol["relativeVolumeTolerance"]
    if not all(math.isfinite(value) and 0 < value <= 0.001
               for value in (tolerance, relative_volume_tolerance)):
        raise ValueError("Expected explicit positive bounded tolerances")
    local = {key: measure(artifact) for key, artifact in protocol["local"].items()}
    results = []
    for case in protocol["cases"]:
        rows = []
        if set(case["parts"]) != set(local) or set(case["transforms"]) != set(local):
            raise ValueError("Every local part needs a mesh and expected transform")
        for key, baseline in local.items():
            actual = measure(case["parts"][key])
            expected = transform_point(case["transforms"][key], baseline["centroidMm"])
            error = math.dist(expected, actual["centroidMm"])
            volume_error = abs(actual["signedVolumeMm3"] / baseline["signedVolumeMm3"] - 1)
            rows.append({"instanceId": key, "actual": actual, "expectedCentroidMm": expected,
                         "centroidErrorMm": error, "relativeSignedVolumeError": volume_error,
                         "status": "PASS" if error <= tolerance and volume_error <= relative_volume_tolerance else "FAIL"})
        results.append({"id": case["id"], "parts": rows,
                        "status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL"})
    if not results or not local:
        raise ValueError("Empty experiment")
    return {"method": "independent-volume-centroid-pose/v1", "local": local, "results": results,
            "status": "PASS" if all(row["status"] == "PASS" for row in results) else "FAIL",
            "surfaceCorrespondence": "NOT_RUN", "physical": "NOT_RUN",
            "coverage": "Necessary rigid-pose volume and centroid conditions on closed oriented Float32 meshes. Source-to-render association is caller-supplied provenance. Equal moments admit different surfaces and motions of symmetric bodies. No self-intersection, true axis, full shape, continuous trajectory, collision or physical certification."}


def main():
    protocol_bytes = Path(sys.argv[1]).read_bytes()
    try:
        report = audit(json.loads(protocol_bytes))
    except (AssertionError, ValueError, KeyError, OSError, struct.error, TypeError) as error:
        report = {"status": "ERROR", "reason": str(error) or type(error).__name__}
    report["protocolSha256"] = hashlib.sha256(protocol_bytes).hexdigest()
    report["scriptSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report["topologyScriptSha256"] = hashlib.sha256(Path(__file__).with_name("audit-retained-hinge-repair.py").read_bytes()).hexdigest()
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
