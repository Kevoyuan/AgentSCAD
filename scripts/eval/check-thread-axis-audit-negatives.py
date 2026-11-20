#!/usr/bin/env python3
"""Inject invalid measurements/mesh poses into a copied reference experiment."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix="thread-axis-audit-negatives-", dir=".agentscad/experiments"))
    script = Path("scripts/eval/audit-thread-axis-reference.py").resolve()
    results = []
    for name in ["offset-reset", "vertex-shift", "missing-case"]:
        case = root / name
        shutil.copytree(args.directory, case)
        report_file = case / "report.json"
        report = json.loads(report_file.read_bytes())
        if name == "offset-reset":
            report["results"][0]["deviation"]["offsetMm"] = 0
        elif name == "vertex-shift":
            item = report["results"][0]
            mesh_file = case / f"{item['id']}.stl"
            data = bytearray(mesh_file.read_bytes())
            position = 84 + 12
            old = struct.unpack_from("<f", data, position)[0]
            struct.pack_into("<f", data, position, old + 0.1)
            mesh_file.write_bytes(data)
            # Update the hash so independent pose validation, rather than
            # hash validation alone, must detect this incorrect geometry.
            item["meshSha256"] = hashlib.sha256(data).hexdigest()
        else:
            report["results"].pop()
        report_file.write_text(json.dumps(report, indent=2) + "\n")
        outcome = subprocess.run([sys.executable, str(script), str(case)], capture_output=True, text=True)
        (case / "audit.stdout").write_text(outcome.stdout)
        (case / "audit.stderr").write_text(outcome.stderr)
        if outcome.returncode == 0:
            raise RuntimeError(f"Injected negative was accepted: {name}")
        if name != "missing-case":
            audit = json.loads((case / "independent-audit.json").read_bytes())
            key = "arithmeticStatus" if name == "offset-reset" else "rewriteStatus"
            if audit["results"][0][key] != "FAIL":
                raise RuntimeError(f"Wrong rejection layer for {name}")
        elif "Missing, duplicate or extra reference cases" not in outcome.stderr:
            raise RuntimeError("Missing case was rejected for the wrong reason")
        results.append({"case": name, "expectedRejection": "PASS", "exitCode": outcome.returncode})
    summary = {"status": "NOT_RUN", "scope": "Audit fault-detection checks only. No assembly or calibration verdict.",
               "sourceDirectory": str(args.directory), "results": results,
               "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "auditSha256": hashlib.sha256(script.read_bytes()).hexdigest()}
    (root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (root / "experiment.py").write_bytes(Path(__file__).read_bytes())
    print(json.dumps({"directory": str(root), **summary}, indent=2))


if __name__ == "__main__":
    main()
