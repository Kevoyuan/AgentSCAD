#!/usr/bin/env python3
"""Independent exact-edge accounting of retained binary STL files; no repair."""
import collections
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile


def main():
    directory = Path(sys.argv[1])
    paths = sorted(directory.glob("*.stl"))
    if not paths:
        raise ValueError("No retained STL inputs")
    out = Path(tempfile.mkdtemp(prefix="assembly-topology-", dir=".agentscad/experiments"))
    rows = []
    for path in paths:
        data = path.read_bytes()
        if len(data) < 84:
            raise ValueError("Invalid STL header")
        count = struct.unpack_from("<I", data, 80)[0]
        if len(data) != 84+50*count or not count:
            raise ValueError("Invalid STL triangle table")
        edges = collections.Counter()
        orientation = collections.Counter()
        degenerate = 0
        for i in range(count):
            xyz = struct.unpack_from("<9f", data, 84+50*i+12)
            if not all(math.isfinite(value) for value in xyz):
                raise ValueError("Nonfinite coordinate")
            vertices = [tuple(xyz[j:j+3]) for j in (0, 3, 6)]
            a, b, c = vertices
            u = tuple(b[k]-a[k] for k in range(3))
            v = tuple(c[k]-a[k] for k in range(3))
            cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
            degenerate += sum(value*value for value in cross) == 0
            for j in range(3):
                first, second = vertices[j], vertices[(j+1)%3]
                edge = tuple(sorted((first, second)))
                edges[edge] += 1
                orientation[edge] += 1 if first < second else -1
        violations = [(edge, incidences, orientation[edge]) for edge, incidences in edges.items() if incidences != 2 or orientation[edge] != 0]
        rows.append({"file":str(path), "sha256":hashlib.sha256(data).hexdigest(), "triangles":count,
                     "zeroAreaTriangles":degenerate, "edgeIncidenceHistogram":dict(collections.Counter(edges.values())),
                     "invalidOrientedEdges":len(violations), "violationExamples":violations[:3],
                     "status":"FAIL" if degenerate or violations else "PASS"})
    report = {"status":"PASS", "meaning":"Audit execution only; per-mesh PASS covers exact finite nondegenerate edge accounting, not self-intersection or solid validity.",
              "inputDirectory":str(directory), "scriptSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "pythonVersion":sys.version, "results":rows}
    (out/"report.json").write_text(json.dumps(report,indent=2))
    (out/"audit-assembly-topology.py").write_bytes(Path(__file__).read_bytes())
    print(json.dumps({"directory":str(out),"meshes":len(rows),"failedMeshes":[{k:row[k] for k in ("file","zeroAreaTriangles","invalidOrientedEdges")} for row in rows if row["status"]=="FAIL"]},indent=2))


if __name__ == "__main__":
    main()
