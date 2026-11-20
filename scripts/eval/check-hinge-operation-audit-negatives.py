#!/usr/bin/env python3
"""Two falsification controls for the independent frozen-hinge certificate."""
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
archive = Path(tempfile.mkdtemp(prefix="hinge-operation-audit-negatives-", dir=root.parent))
tools = []
for source in (Path(__file__), Path(__file__).with_name("audit-hinge-operations.py")):
    data = source.read_bytes()
    (archive / source.name).write_bytes(data)
    tools.append({"file": source.name, "sha256": hashlib.sha256(data).hexdigest()})
(archive / "tools.json").write_text(json.dumps(tools, indent=2))
results = []
for case, expected in [("translated-mesh", "No certified radial separation"), ("altered-path", "does not follow the frozen complete vertical route")]:
    folder = archive / case
    shutil.copytree(root / "explicit", folder / "explicit")
    shutil.copytree(root / "inputs", folder / "inputs")
    shutil.copy2(root / "protocol.json", folder / "protocol.json")
    path = folder / "explicit" / "manifest.json"
    manifest = json.loads(path.read_text())
    if case == "translated-mesh":
        mesh_path = folder / "explicit" / "moving.stl"
        data = bytearray(mesh_path.read_bytes())
        for triangle in range(struct.unpack_from("<I", data, 80)[0]):
            for vertex in range(3):
                offset = 96 + triangle * 50 + vertex * 12
                struct.pack_into("<f", data, offset, struct.unpack_from("<f", data, offset)[0] + 3.2)
        mesh_path.write_bytes(data)
        for part in manifest["parts"]:
            if part["id"] == "moving":
                part["artifactSha256"] = hashlib.sha256(data).hexdigest()
    else:
        manifest["declaredAssembly"]["reversedEvaluation"]["results"][0]["path"]["poses"][20][3] = 0.5
    path.write_text(json.dumps(manifest, indent=2))
    run = subprocess.run([sys.executable, str(Path(__file__).with_name("audit-hinge-operations.py")), str(folder)], capture_output=True, text=True)
    (folder / "audit.stdout").write_text(run.stdout)
    (folder / "audit.stderr").write_text(run.stderr)
    matched = run.returncode == 2 and expected in run.stdout
    results.append({"case": case, "expectedReason": expected, "exitCode": run.returncode, "matched": matched})
report = {"status": "PASS" if all(result["matched"] for result in results) else "FAIL", "results": results,
          "scope": "PASS means two corrupted references were refused for the expected geometric/path reason, not merely a hash mismatch. No physical test."}
(archive / "report.json").write_text(json.dumps(report, indent=2))
print(json.dumps({"archive": str(archive), **report}, indent=2))
sys.exit(0 if report["status"] == "PASS" else 1)
