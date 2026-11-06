#!/usr/bin/env python3
"""Independent NumPy replay/arithmetic/analytic station-role audit, not axis fitting."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import numpy as np


def vertices(data):
    n = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84+50*n:
        raise ValueError("Invalid binary STL")
    xyz=np.array([struct.unpack_from("<9f", data, 84+50*i+12) for i in range(n)]).reshape(-1, 3)
    if not np.all(np.isfinite(xyz)):
        raise ValueError("Nonfinite vertex")
    return xyz


def compare(a, b):
    da = np.array(a["direction"], float)
    db = np.array(b["direction"], float)
    if not np.all(np.isfinite(np.r_[da,db,a["point"],b["point"]])) or min(np.linalg.norm(da),np.linalg.norm(db))<=0:
        raise ValueError("Invalid axis data")
    da /= np.linalg.norm(da)
    db /= np.linalg.norm(db)
    offset = np.linalg.norm(np.cross(np.array(b["point"])-a["point"], da))
    angle = math.degrees(math.atan2(np.linalg.norm(np.cross(da, db)), abs(da @ db)))
    return float(offset), angle


def main():
    root = Path(sys.argv[1])
    data = json.loads((root/"report.json").read_text())
    protocol_bytes = (root/"protocol.json").read_bytes()
    protocol = json.loads(protocol_bytes)
    if hashlib.sha256(protocol_bytes).hexdigest() != data["protocolSha256"]:
        raise ValueError("Protocol fingerprint mismatch")
    if [row["probe"] for row in data["results"]] != protocol["cases"]:
        raise ValueError("Protocol coverage mismatch")
    results = []
    for row in data["results"]:
        case = row["probe"]
        if row["frames"]["limits"] != protocol["digitalLimits"]:
            raise ValueError("Digital limits changed")
        a = math.radians(case["tiltYdeg"])
        rotation = np.array([[math.cos(a),0,math.sin(a)],[0,1,0],[-math.sin(a),0,math.cos(a)]])
        shift = np.array([case["shiftXmm"],0,0])
        transformed_error = 0
        for part in ("fixed", "moving"):
            source = vertices((root/f"base-{part}.stl").read_bytes())
            output_bytes = (root/f"{case['id']}-{part}.stl").read_bytes()
            if hashlib.sha256(output_bytes).hexdigest() != row["meshHashes"][part]:
                raise ValueError("Mesh fingerprint mismatch")
            expected = source @ rotation.T + shift
            actual = vertices(output_bytes)
            error = float(np.max(np.abs(expected-actual)))
            transformed_error = max(transformed_error, error)
            if error > protocol["arithmeticReplayTolerance"]["transformedVerticesMm"]:
                raise ValueError("Transformed vertices disagree with independent replay")
            # Independently check the base vertex sample domain, not triangles
            # between samples or self-intersection.
            radii = np.linalg.norm(source[:, :2], axis=1)
            permitted = [0,3] if part == "fixed" else [3.2,5]
            radius_error = np.min(np.abs(radii[:, None]-permitted), axis=1)
            ends = [-1,11] if part == "fixed" else [0,10]
            if np.max(radius_error)>1e-6 or np.max(np.min(np.abs(source[:,2,None]-ends),axis=1))>1e-6:
                raise ValueError("Base samples do not describe the declared construction domain")
        arithmetic_error = [0.0, 0.0]
        reference_errors = []
        stations_checked = 0
        for side in row["frames"]["sides"]:
            offset, angle = compare(side["declaredAxis"], side["measuredAxis"])
            arithmetic_error[0] = max(arithmetic_error[0], abs(offset-side["offsetMm"]))
            arithmetic_error[1] = max(arithmetic_error[1], abs(angle-side["angleDeg"]))
            instance = next(item for item in row["spec"]["instances"] if item["id"] == side["instanceId"])
            world = np.array(instance["transform"]).reshape(4,4)
            expected_world=np.array([[0,-1,0,10],[1,0,0,20],[0,0,1,30],[0,0,0,1]]) if case["worldQuarterTurn"] else np.eye(4)
            if not np.array_equal(world,expected_world):
                raise ValueError("Instance pose differs from the frozen protocol")
            expected_role="bore" if instance["partId"]=="moving" else "shaft"
            if side["role"]!=expected_role:
                raise ValueError("Role differs from the construction domain")
            reference = {"point":(world @ np.r_[shift,1])[:3].tolist(), "direction":(world[:3,:3] @ rotation[:,2]).tolist()}
            reference_errors.append(dict(zip(("offsetMm","angleDeg"), compare(reference, side["measuredAxis"]))))
            feature = row["measurement"][side["role"]]["measurement"]
            if len(feature["stations"]) != len(side["materialAtStations"]):
                raise ValueError("Station-role coverage mismatch")
            for station, recorded in zip(feature["stations"], side["materialAtStations"]):
                # This frozen protocol has local frame origin 0 and direction Z.
                local = np.array([*station["center"], station["offsetMm"]])
                construction = rotation.T @ (local-shift)
                radius = np.linalg.norm(construction[:2])
                if side["role"] == "bore":
                    valid = 0 < construction[2] < 10 and radius < 3.2*math.cos(math.pi/64)
                    expected_state = "OUTSIDE"
                else:
                    valid = -1 < construction[2] < 11 and radius < 3*math.cos(math.pi/64)
                    expected_state = "INSIDE"
                if not valid or station["materialState"] != expected_state or recorded["state"] != expected_state or recorded["offsetMm"] != station["offsetMm"]:
                    raise ValueError("Independent analytic station-role verification failed")
                stations_checked += 1
        sides = row["frames"]["sides"]
        if len(sides) != 2:
            raise ValueError("Two measured feature axes required for this audit")
        pair = compare(sides[0]["measuredAxis"], sides[1]["measuredAxis"])
        arithmetic_error[0] = max(arithmetic_error[0], abs(pair[0]-row["frames"]["measuredPair"]["offsetMm"]))
        arithmetic_error[1] = max(arithmetic_error[1], abs(pair[1]-row["frames"]["measuredPair"]["angleDeg"]))
        if arithmetic_error[0]>1e-8 or arithmetic_error[1]>1e-8:
            raise ValueError("Reported axis comparison arithmetic disagrees")
        if row["frames"]["status"] != case["expected"]:
            raise ValueError("Frozen protocol verdict differs")
        results.append({"id":case["id"],"status":"PASS","vertexReplayMaxMm":transformed_error,"arithmeticError":arithmetic_error,"referenceAxisErrors":reference_errors,"analyticStationRolesChecked":stations_checked})
    report={"status":"PASS","scope":"Independent vertex replay, reported-axis arithmetic and analytic roles on the frozen synthetic domain. No independent axis extraction, surface self-intersection, general uncertainty bound or physical function.","reportSha256":hashlib.sha256((root/"report.json").read_bytes()).hexdigest(),"scriptSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),"numpyVersion":np.__version__,"results":results}
    (root/"independent-audit.json").write_text(json.dumps(report,indent=2))
    (root/"audit-joint-frame-consistency.py").write_bytes(Path(__file__).read_bytes())
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    main()
