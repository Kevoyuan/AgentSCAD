#!/usr/bin/env python3
"""Preserve falsified copies; require rejection by the intended independent layer."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile


def main():
    original=Path(sys.argv[1]).resolve()
    output=Path(tempfile.mkdtemp(prefix="joint-frame-audit-negatives-",dir=".agentscad/experiments")).resolve()
    baseline=json.loads((original/"report.json").read_text())
    rows=[]
    for name,expected in [("zero-offset","arithmetic"),("vertex-with-updated-hash","replay"),("wrong-material","station-role")]:
        folder=output/name
        shutil.copytree(original,folder)
        data=copy.deepcopy(baseline)
        if name=="zero-offset":
            data["results"][1]["frames"]["sides"][0]["offsetMm"]=0
        elif name=="wrong-material":
            side=data["results"][0]["frames"]["sides"][0]
            side["materialAtStations"][0]["state"]="INSIDE"
            data["results"][0]["measurement"][side["role"]]["measurement"]["stations"][0]["materialState"]="INSIDE"
        else:
            path=folder/"baseline-fixed.stl"
            mesh=bytearray(path.read_bytes())
            struct.pack_into("<f",mesh,96,struct.unpack_from("<f",mesh,96)[0]+.1)
            path.write_bytes(mesh)
            data["results"][0]["meshHashes"]["fixed"]=hashlib.sha256(mesh).hexdigest()
        (folder/"report.json").write_text(json.dumps(data,indent=2))
        run=subprocess.run([sys.executable,"scripts/eval/audit-joint-frame-consistency.py",str(folder)],capture_output=True,text=True,timeout=30)
        (folder/"stdout.txt").write_text(run.stdout)
        (folder/"stderr.txt").write_text(run.stderr)
        rows.append({"id":name,"exitCode":run.returncode,"expectedLayer":expected,"expectedRejectionObserved":run.returncode!=0 and expected in run.stderr})
    (output/"runner.py").write_bytes(Path(__file__).read_bytes())
    report={"status":"PASS" if all(row["expectedRejectionObserved"] for row in rows) else "FAIL","originalReportSha256":hashlib.sha256((original/"report.json").read_bytes()).hexdigest(),"scope":"Independent audit rejection controls only; not geometry function.","results":rows}
    (output/"report.json").write_text(json.dumps(report,indent=2))
    print(json.dumps({"directory":str(output),**report},indent=2))
    if report["status"]!="PASS":
        raise SystemExit(1)


if __name__=="__main__":
    main()
