#!/usr/bin/env python3
"""Regenerate the embedded declaration of the keyed slider-crank fixture.

The quarter-turn locks need dense rotation paths, which are data, not a
convention the checker may invent. This script writes those poses explicitly:

- each key turns 90 degrees about its own X axis in 5 degree steps, then
  withdraws +X sampled at 0.25 mm;
- each guide retainer turns 90 degrees about its own Y axis, then withdraws
  +Y sampled at 0.25 mm;
- the guide itself leaves along +Z after both retainers are out.

It also writes three negative variants next to the correct declaration:
straight key withdrawal, straight retainer pull, and guide removal before the
retainers are released.
"""
import json
import math
import re
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "benchmarks/assembly/slider_crank_shaft_keyed.scad"
STEP_DEG = 5.0
STEP_MM = 0.25
EXIT_MM = 30.0
LOCK_EXIT_MM = 5.0
GUIDE_EXIT_MM = 40.0
OUT_DIR = "scripts/eval/assembly-fixtures"

with open(PATH, encoding="utf-8") as handle:
    source = handle.read()

match = re.search(r"/\* AGENTSCAD_ASSEMBLY_V1(.*?)END_AGENTSCAD_ASSEMBLY", source, re.S)
if not match:
    raise SystemExit("no embedded declaration")
spec = json.loads(match.group(1))


def clean(value):
    """Avoid -0.0 in the file: it is valid JSON but reads as a sign error."""
    return value + 0.0


def rotation_x_about(point_y, point_z, degrees):
    """Pose of the key's own frame: rotate about X, keep its origin at (0, py, pz).

    The instance transform already places the part at that point, so the pose is
    R applied to the local frame plus that same translation -- not a rotation
    about a world point, which would move a part whose local origin is not zero.
    """
    radians = math.radians(degrees)
    c, s = math.cos(radians), math.sin(radians)
    return [clean(v) for v in [1, 0, 0, 0, 0, c, -s, point_y, 0, s, c, point_z, 0, 0, 0, 1]]


def rotation_y_about(point_x, point_y, point_z, degrees):
    """Pose of a guide retainer: rotate about its own Y axis at (px, py, pz)."""
    radians = math.radians(degrees)
    c, s = math.cos(radians), math.sin(radians)
    return [clean(v) for v in [c, 0, s, point_x, 0, 1, 0, point_y, -s, 0, c, point_z, 0, 0, 0, 1]]


def translate(matrix, dx, dy, dz):
    out = list(matrix)
    out[3] = clean(out[3] + dx)
    out[7] = clean(out[7] + dy)
    out[11] = clean(out[11] + dz)
    return out


def quarter_turn_path(point_y, point_z):
    poses = []
    angle = 0.0
    while angle >= -90.0 - 1e-9:
        poses.append(rotation_x_about(point_y, point_z, angle))
        angle -= STEP_DEG
    start = poses[-1]
    steps = int(round(EXIT_MM / STEP_MM))
    for index in range(1, steps + 1):
        poses.append(translate(start, index * STEP_MM, 0, 0))
    return poses


def straight_withdrawal(point_y, point_z):
    """The counter-example: pull the key out without turning it."""
    poses = []
    steps = int(round(EXIT_MM / STEP_MM))
    for index in range(0, steps + 1):
        poses.append([clean(v) for v in [1, 0, 0, index * STEP_MM, 0, 1, 0, point_y, 0, 0, 1, point_z, 0, 0, 0, 1]])
    return poses


def guide_lock_path(point_x, point_z):
    """Turn the retainer upright, then pull it out through the wall slot.

    The part's local frame is the locked pose (tab horizontal), so the first
    pose is the instance translation and the rotation runs 0 to -90 degrees.
    """
    poses = []
    angle = 0.0
    while angle >= -90.0 - 1e-9:
        poses.append(rotation_y_about(point_x, 9.4, point_z, angle))
        angle -= STEP_DEG
    start = poses[-1]
    steps = int(round(LOCK_EXIT_MM / STEP_MM))
    for index in range(1, steps + 1):
        poses.append(translate(start, 0, index * STEP_MM, 0))
    return poses


def guide_lock_straight_pull(point_x, point_z):
    """The counter-example: pull the locked retainer without turning it."""
    poses = []
    steps = int(round(LOCK_EXIT_MM / STEP_MM))
    for index in range(0, steps + 1):
        poses.append(rotation_y_about(point_x, 9.4, point_z, 0.0))
        poses[-1] = translate(poses[-1], 0, index * STEP_MM, 0)
    return poses


# The declaration already carries the guide and keys; add the retainer part,
# its two instances and their release connections if this is a fresh fixture.
if not any(part["id"] == "guide_lock" for part in spec["parts"]):
    spec["parts"].append({
        "id": "guide_lock", "name": "guide_lock", "selector": "guide_lock",
        "source": "generated", "material": None,
    })
for instance_id, x in (("guide_lock_right", 9.1), ("guide_lock_left", -9.1)):
    transform = [1, 0, 0, x, 0, 1, 0, 9.4, 0, 0, 1, 40, 0, 0, 0, 1]
    existing = next((instance for instance in spec["instances"] if instance["id"] == instance_id), None)
    if existing is None:
        spec["instances"].append({
            "id": instance_id, "partId": "guide_lock", "subassemblyId": None,
            "transform": transform,
        })
    else:
        existing["transform"] = transform
for instance_id in ("guide_lock_right", "guide_lock_left"):
    connection_id = f"{instance_id}_release"
    if not any(connection["id"] == connection_id for connection in spec["connections"]):
        spec["connections"].append({
            "id": connection_id, "type": "other", "a": "frame", "b": instance_id,
            "frameA": {"origin": [9.1 if instance_id.endswith("right") else -9.1, 9.4, 40], "direction": [0, 1, 0]},
            "frameB": {"origin": [0, 0, 0], "direction": [0, 1, 0]},
            "range": None, "pitchMm": None, "ratio": None, "allowedContact": [],
        })

# Declare which side of the main shaft joint carries the bore, so a contract
# can derive the fit requirement without the caller guessing the role.
for connection in spec["connections"]:
    if connection["id"] == "main_shaft":
        connection["boreInstanceId"] = "frame"

KEY_HOLES = {"eccentric_key": (5, 8), "main_key": (-11, 0)}
LOCK_POINTS = {"guide_lock_right": 9.1, "guide_lock_left": -9.1}


def operation(operation_id, instance_id, waypoints, tools=("hand",)):
    return {"id": operation_id, "action": "disassemble", "instanceId": instance_id,
            "tools": list(tools), "waypoints": waypoints}


spec["operations"] = [
    operation("release_guide_lock_right", "guide_lock_right", guide_lock_path(9.1, 40)),
    operation("release_guide_lock_left", "guide_lock_left", guide_lock_path(-9.1, 40)),
    operation("remove_guide", "guide_front", [
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, GUIDE_EXIT_MM, 0, 0, 0, 1],
    ]),
    operation("remove_main_key", "main_key", quarter_turn_path(*KEY_HOLES["main_key"])),
    operation("remove_1", "eccentric_key", quarter_turn_path(*KEY_HOLES["eccentric_key"])),
    operation("remove_2", "slider", [
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 36, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 20, 0, 0, 1, 36, 0, 0, 0, 1],
    ]),
    operation("remove_3", "rod", [
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 8, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 20, 0, 0, 1, 8, 0, 0, 0, 1],
    ]),
    operation("remove_4", "crank", [
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 28, 0, 0, 1, 0, 0, 0, 0, 1],
    ]),
]

spec["unknowns"] = [
    "Key lugs and guide-retainer tabs block withdrawal in the sampled poses; hand force, wear, tab strength, detent feel and gravity over a full turn are unverified.",
    "Main shaft axial blocking is sampled; bearing alignment and physical security are unverified.",
    "Guide retainer tabs bear on a 0.7 mm wall lip; the wall's local strength and wear are unverified.",
    "Guide angular play, full mechanism constraints and support are unverified.",
    "Material, process, tolerances, tool access and physical function are unverified.",
]
spec["assumptions"] = [
    "Manifest placement describes input angle 0 degrees only.",
    "Joint types describe intended relationships, not verified constraints.",
    "Each key lug is horizontal in the declared pose; unlocking is a 90 degree turn about the key axis.",
    "Each guide retainer is locked at 90 degrees; unlocking is a 90 degree turn about the retainer axis.",
]

block = json.dumps(spec, indent=2, ensure_ascii=False)
updated = source[: match.start(1)] + block + source[match.end(1):]
with open(PATH, "w", encoding="utf-8") as handle:
    handle.write(updated)


def variant(name, mutate):
    negative = json.loads(json.dumps(spec))
    mutate(negative)
    with open(f"{OUT_DIR}/{name}", "w", encoding="utf-8") as handle:
        json.dump(negative, handle, indent=2)


def straight_keys(document):
    for op in document["operations"]:
        if op["instanceId"] in KEY_HOLES:
            op["waypoints"] = straight_withdrawal(*KEY_HOLES[op["instanceId"]])


def guide_first(document):
    order = {op["instanceId"]: index for index, op in enumerate(document["operations"])}
    document["operations"].sort(key=lambda op: (order[op["instanceId"]] != order["guide_front"], order[op["instanceId"]]))


def straight_right_lock(document):
    for op in document["operations"]:
        if op["instanceId"] == "guide_lock_right":
            op["waypoints"] = guide_lock_straight_pull(9.1, 40)


def straight_eccentric_key(document):
    for op in document["operations"]:
        if op["instanceId"] == "eccentric_key":
            op["waypoints"] = straight_withdrawal(*KEY_HOLES["eccentric_key"])


variant("slider-crank-keyed-straight-withdrawal.json", straight_keys)
variant("slider-crank-keyed-eccentric-straight.json", straight_eccentric_key)
variant("slider-crank-keyed-guide-first.json", guide_first)
variant("slider-crank-keyed-lock-straight-pull.json", straight_right_lock)

print(json.dumps({op["id"]: len(op["waypoints"]) for op in spec["operations"]}, indent=2))
