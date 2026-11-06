#!/usr/bin/env python3
"""Independent numeric replay using NumPy and SciPy, not an axis calibration.

Fixed replay tolerances are 1e-12 mm for rewrite residual agreement,
1e-9 mm for offset arithmetic, and 1e-7 degrees for angle arithmetic.
They only compare floating-point computations, not manufactured fit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
import scipy
from scipy.spatial.transform import Rotation


def vertices(file):
    raw = file.read_bytes()
    count = int.from_bytes(raw[80:84], "little")
    if len(raw) != 84 + count * 50 or count == 0:
        raise ValueError("Invalid binary STL table")
    dtype = np.dtype([("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")])
    points = np.frombuffer(raw, dtype=dtype, offset=84, count=count)["vertices"].reshape(-1, 3).astype(np.float64)
    if not np.isfinite(points).all():
        raise ValueError("Nonfinite STL vertices")
    return raw, points


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = args.directory
    report_bytes = (root / "report.json").read_bytes()
    report = json.loads(report_bytes)
    protocol_bytes = (root / "protocol.json").read_bytes()
    protocol = json.loads(protocol_bytes)
    if hashlib.sha256(protocol_bytes).hexdigest() != report["protocolSha256"]:
        raise ValueError("Protocol hash mismatch")
    source_hash = hashlib.sha256((root / "source.scad").read_bytes()).hexdigest()
    if source_hash != protocol["sourceSha256"] or source_hash != report["sourceSha256"]:
        raise ValueError("Source hash mismatch")
    expected_ids = {f"{source['id']}-{pose['id']}" for source in protocol["inputs"] for pose in protocol["poses"]}
    actual_ids = [item["id"] for item in report["results"]]
    if len(actual_ids) != len(expected_ids) or set(actual_ids) != expected_ids:
        raise ValueError("Missing, duplicate or extra reference cases")
    results = []
    for item in report["results"]:
        input_spec = next(x for x in protocol["inputs"] if item["id"].startswith(x["id"] + "-"))
        raw, original = vertices(root / f"input-{input_spec['id']}.stl")
        if hashlib.sha256(raw).hexdigest() != input_spec["sha256"]:
            raise ValueError("Original mesh hash mismatch")
        pose = item["pose"]
        if pose not in protocol["poses"]:
            raise ValueError("Pose is not in the frozen protocol")
        rotation = Rotation.from_euler("yz", [pose["tiltYdeg"], pose["rotateZdeg"]], degrees=True)
        translation = np.array(pose["translationMm"])
        raw, actual = vertices(root / f"{item['id']}.stl")
        if hashlib.sha256(raw).hexdigest() != item["meshSha256"]:
            raise ValueError("Posed mesh hash mismatch")
        expected = rotation.apply(original) + translation
        rewrite_error = float(np.linalg.norm(actual - expected, axis=1).max())
        rewrite_delta = abs(rewrite_error - item["maxRewriteRoundingMm"])
        axis = item["fit"].get("axis")
        result = {"id": item["id"], "rewriteResidualMm": rewrite_error, "rewriteAgreementDeltaMm": rewrite_delta,
                  "rewriteStatus": "PASS" if rewrite_delta <= 1e-12 else "FAIL"}
        if axis and item["deviation"]:
            direction = rotation.apply([0, 0, 1])
            measured = np.array([*axis["slope"], 1.0])
            measured /= np.linalg.norm(measured)
            point = np.array(axis["point"])
            expected_point = translation + direction * ((point[2] - translation[2]) / direction[2])
            offset = float(np.linalg.norm((point - expected_point)[:2]))
            angle = float(np.rad2deg(np.arctan2(np.linalg.norm(np.cross(measured, direction)), np.dot(measured, direction))))
            offset_delta = abs(offset - item["deviation"]["offsetMm"])
            angle_delta = abs(angle - item["deviation"]["angleDeg"])
            result.update({"offsetMm": offset, "angleDeg": angle, "offsetReplayDeltaMm": offset_delta,
                           "angleReplayDeltaDeg": angle_delta,
                           "arithmeticStatus": "PASS" if offset_delta <= 1e-9 and angle_delta <= 1e-7 else "FAIL"})
        else:
            result["arithmeticStatus"] = "NOT_RUN"
        results.append(result)
    output = {"status": "NOT_RUN", "scope": "Independent rigid-pose and reported-error arithmetic replay only. Axis feature identity and calibrated uncertainty were not independently measured.",
              "reportSha256": hashlib.sha256(report_bytes).hexdigest(), "auditSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "environment": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__}, "results": results}
    (root / "independent-audit.json").write_text(json.dumps(output, indent=2) + "\n")
    (root / "independent-audit.py").write_bytes(Path(__file__).read_bytes())
    print(json.dumps(output, indent=2))
    if any(x["rewriteStatus"] == "FAIL" or x["arithmeticStatus"] == "FAIL" for x in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
