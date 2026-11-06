#!/usr/bin/env python3
"""Independent CGAL intersection of retained parts at explicit rigid poses.

This reads embedded JSON itself and uses NumPy Rodrigues rotations, without
importing the TypeScript collision or transform implementation. Empty volume
does not distinguish contact from separation, nor prove a continuous path.
"""
import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


def digest(data):
    return hashlib.sha256(data).hexdigest()


def intersection(out, name, body):
    source = out / (name + ".scad")
    target = out / (name + ".stl")
    source.write_text("intersection() {\n" + body + "\n}\n")
    command = ["openscad", "--export-format", "binstl", "-o", str(target), str(source)]
    run = subprocess.run(command, capture_output=True, text=True, timeout=120)
    (out / (name + "-stdout.txt")).write_text(run.stdout)
    (out / (name + "-stderr.txt")).write_text(run.stderr)
    base = {"command": command, "exitCode": run.returncode}
    if not target.exists():
        if "Current top level object is empty." in run.stderr and run.returncode in (0, 1):
            return dict(base, status="EMPTY", volumeMm3=0)
        return dict(base, status="ERROR", reason="No STL, without recognized empty-object diagnostic")
    data = target.read_bytes()
    if len(data) < 84:
        return dict(base, status="ERROR", reason="Truncated binary STL")
    count = struct.unpack_from("<I", data, 80)[0]
    if count == 0 or len(data) != 84 + 50 * count:
        return dict(base, status="ERROR", reason="Invalid binary STL record count")
    volume = 0.0
    for index in range(count):
        vertices = np.array(struct.unpack_from("<9f", data, 84 + 50 * index + 12)).reshape(3, 3)
        volume += float(vertices[0] @ np.cross(vertices[1], vertices[2])) / 6
    return dict(base, status="POSITIVE_VOLUME" if abs(volume) > 1e-9 else "ZERO_VOLUME",
                volumeMm3=abs(volume), signedVolumeMm3=volume, triangles=count, stlSha256=digest(data))


def main():
    protocol_path = Path(sys.argv[1]).resolve()
    protocol = json.loads(protocol_path.read_text())
    out = Path(tempfile.mkdtemp(prefix="intersection-audit-", dir=".agentscad/experiments")).resolve()
    shutil.copy2(protocol_path, out / "protocol.json")
    shutil.copy2(__file__, out / "audit-assembly-intersections.py")
    controls = []
    for name, x, expected in [("separated", 2, "EMPTY"), ("touching", 1, "ZERO_VOLUME"), ("overlap", .5, "POSITIVE_VOLUME")]:
        result = intersection(out, name, f"cube(1); translate([{x},0,0]) cube(1);")
        result.update(id=name, expected=expected, passed=result["status"] == expected)
        if name == "overlap":
            result["passed"] &= abs(result.get("volumeMm3", -1) - .5) < 1e-7
        controls.append(result)
    rows = []
    if all(control["passed"] for control in controls):
        for case in protocol["cases"]:
            source_path = Path(case["source"]).resolve()
            source = source_path.read_bytes()
            if digest(source) != case["sourceSha256"]:
                raise ValueError("Source fingerprint mismatch: " + case["id"])
            embedded = re.search(r"/\*\s*AGENTSCAD_ASSEMBLY_V1\s*(.*?)\s*END_AGENTSCAD_ASSEMBLY\s*\*/", source.decode(), re.S)
            if not embedded:
                raise ValueError("Missing embedded JSON")
            spec = json.loads(embedded.group(1))
            joint = next(item for item in spec["connections"] if item["id"] == case["connectionId"])
            instances = {item["id"]: item for item in spec["instances"]}
            a = np.array(instances[joint["a"]]["transform"], dtype=float).reshape(4, 4)
            axis = a[:3, :3] @ np.array(joint["frameA"]["direction"], dtype=float)
            axis /= np.linalg.norm(axis)
            origin = (a @ np.array(joint["frameA"]["origin"] + [1.0]))[:3]
            x, y, z = axis
            skew = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
            angle = math.radians(case["angleDeg"])
            rotation = np.eye(3) + math.sin(angle) * skew + (1 - math.cos(angle)) * (skew @ skew)
            world = np.eye(4)
            world[:3, :3] = rotation
            world[:3, 3] = origin - rotation @ origin
            body = []
            meshes = {}
            for identity in (joint["a"], joint["b"]):
                entry = instances[identity]
                mesh = Path(case["meshes"][entry["partId"]]["path"]).resolve()
                data = mesh.read_bytes()
                if digest(data) != case["meshes"][entry["partId"]]["sha256"]:
                    raise ValueError("Mesh fingerprint mismatch")
                copy = out / (case["id"] + "-" + entry["partId"] + ".stl")
                copy.write_bytes(data)
                transform = np.array(entry["transform"], dtype=float).reshape(4, 4)
                if identity == joint["b"]:
                    transform = world @ transform
                body.append("multmatrix(" + json.dumps(transform.tolist()) + ") import(" + json.dumps(str(copy)) + ");")
                meshes[entry["partId"]] = {"sha256": digest(data), "transform": transform.tolist()}
            result = intersection(out, case["id"], "\n".join(body))
            result.update(id=case["id"], angleDeg=case["angleDeg"], sourceSha256=digest(source),
                          declaredWorldAxis={"origin": origin.tolist(), "direction": axis.tolist()}, meshes=meshes)
            (out / (case["id"] + "-source.scad")).write_bytes(source)
            rows.append(result)
    version = subprocess.run(["openscad", "--version"], capture_output=True, text=True, timeout=10)
    report = {"status": "PASS" if all(c["passed"] for c in controls) and len(rows) == len(protocol["cases"]) and all(r["status"] != "ERROR" for r in rows) else "ERROR",
              "meaning": "Audit execution only. Read each EMPTY/POSITIVE_VOLUME result; no assembly or function pass.",
              "protocolSha256": digest(protocol_path.read_bytes()), "scriptSha256": digest(Path(__file__).read_bytes()),
              "numpyVersion": np.__version__, "openscadVersion": (version.stdout + version.stderr).strip(),
              "controls": controls, "cases": rows,
              "limitations": ["Native CGAL Boolean of retained triangle meshes, not independent physical measurement.",
                              "EMPTY can mean separation or zero-volume contact; it cannot distinguish them.",
                              "Only listed declared poses and selected joint pair; no feature-axis calibration, continuous sweep, other-pair or retention proof."]}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"directory": str(out), "status": report["status"], "controls": [{"id": c["id"], "passed": c["passed"]} for c in controls], "cases": [{k: r.get(k) for k in ("id", "status", "volumeMm3", "angleDeg")} for r in rows]}, indent=2))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
