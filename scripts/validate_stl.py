#!/usr/bin/env python3
"""
STL Mesh Validation Script for AgentSCAD

Performs deterministic mesh analysis on STL files using trimesh.
Outputs JSON to stdout in a format that the TypeScript wrapper transforms
into the frontend's expected ValidationResult[] format.

Rules:
  R001 - Minimum Wall Thickness (approximate, via ray casting / proximity)
  R002 - Maximum Dimensions (bounding box check)
  R003 - Manifold Geometry (watertight, volume, degenerate faces)

Limitations:
  - Wall thickness estimation is approximate. Trimesh does not have a
    built-in wall thickness analyzer. We use ray casting from surface
    points inward to estimate minimum wall thickness. This works well
    for convex and simple concave shapes but may overestimate thickness
    for complex internal geometries (e.g., lattice structures, thin
    internal ribs). For production use, consider dedicated tools like
    Materialise Magics or Netfabb.
  - The script assumes units are millimeters. OpenSCAD exports STL in mm.

Usage:
  python3 scripts/validate_stl.py <stl_file_path> [--max-dim 300] [--min-wall 1.2]
"""

import json
import os
import sys
import traceback

def make_error_result(message: str) -> dict:
    """Return a JSON error object that the TypeScript wrapper can detect."""
    return {
        "error": True,
        "message": message,
        "rules": [],
        "summary": {
            "total": 0,
            "passed": 0,
            "warnings": 0,
            "failures": 0,
            "boundingBox": None,
        },
    }


def validate_stl(stl_path: str, max_dim: float = 300.0, min_wall: float = 1.2) -> dict:
    """
    Validate an STL file and return analysis results.

    Args:
        stl_path: Path to the STL file.
        max_dim: Maximum allowed dimension per axis in mm (default 300).
        min_wall: Minimum acceptable wall thickness in mm (default 1.2).

    Returns:
        dict with "rules" array and "summary" dict.
    """
    try:
        import trimesh
        import numpy as np
    except ImportError as e:
        return make_error_result(
            f"Python dependencies missing: {e}. "
            "Install with: pip install trimesh numpy"
        )

    if not os.path.isfile(stl_path):
        return make_error_result(f"STL file not found: {stl_path}")

    try:
        mesh = trimesh.load(stl_path, force="mesh")
    except Exception as e:
        return make_error_result(f"Failed to load STL file: {e}")

    if mesh is None or len(mesh.faces) == 0:
        return make_error_result("STL file contains no geometry (empty mesh)")

    rules = []

    # ─── R001: Wall Thickness ────────────────────────────────────────────
    r001 = check_wall_thickness(mesh, min_wall)
    rules.append(r001)

    # ─── R002: Maximum Dimensions ────────────────────────────────────────
    r002 = check_max_dimensions(mesh, max_dim)
    rules.append(r002)

    # ─── R003: Manifold Geometry ─────────────────────────────────────────
    r003 = check_manifold(mesh)
    rules.append(r003)

    # ─── Component count ─────────────────────────────────────────────────
    try:
        components = mesh.split(only_watertight=False)
        component_count = len(components) if components else 1
    except Exception:
        component_count = 1

    # ─── Euler characteristic ─────────────────────────────────────────────
    try:
        euler = len(mesh.vertices) - len(mesh.edges) + len(mesh.faces)
        genus = (2 - euler) // 2 if mesh.is_watertight else 0
    except Exception:
        euler = 0
        genus = 0

    # ─── Summary ─────────────────────────────────────────────────────────
    bb = mesh.bounding_box.extents
    passed = sum(1 for r in rules if r["status"] == "pass")
    warnings = sum(1 for r in rules if r["status"] == "warn")
    failures = sum(1 for r in rules if r["status"] == "fail")

    summary = {
        "total": len(rules),
        "passed": passed,
        "warnings": warnings,
        "failures": failures,
        "boundingBox": {
            "length": round(float(bb[0]), 2),
            "width": round(float(bb[1]), 2),
            "height": round(float(bb[2]), 2),
            "unit": "mm",
        },
    }

    summary["componentCount"] = component_count
    summary["eulerCharacteristic"] = euler
    summary["genus"] = genus

    return {"rules": rules, "summary": summary}


def check_wall_thickness(mesh, min_wall: float) -> dict:
    """
    Estimate minimum wall thickness using ray casting.

    Strategy:
      1. Sample points on the mesh surface (up to 2000 for performance).
      2. Cast rays inward (along inverted normals) from each surface point.
      3. The distance from the surface point to the nearest opposite
         surface intersection approximates the local wall thickness.
      4. Report the minimum and average thickness found.

    Limitations:
      - Only detects walls accessible via straight-line ray from the
        exterior surface. Internal channels or complex undercuts may
        not be measured accurately.
      - For non-watertight meshes, ray casting may miss intersections,
        leading to overestimated thickness values.
      - Sampling is stochastic; very thin features smaller than the
        sampling density may be missed.
    """
    import numpy as np

    try:
        # Sample surface points and their normals
        n_samples = min(2000, len(mesh.faces))
        face_indices = np.random.choice(len(mesh.faces), size=n_samples, replace=False)
        points = mesh.triangles_center[face_indices]
        normals = mesh.face_normals[face_indices]

        # Cast rays inward from surface points
        ray_origins = points + normals * 0.01  # offset slightly outward to avoid self-intersection
        ray_directions = -normals  # point inward

        locations, index_ray, index_tri = mesh.ray.intersects_location(
            ray_origins, ray_directions, multiple_hits=True
        )

        thicknesses = []
        for i in range(n_samples):
            # Find all intersections for this ray
            mask = index_ray == i
            hit_points = locations[mask]
            if len(hit_points) == 0:
                continue
            # Distance from ray origin to each hit
            dists = np.linalg.norm(hit_points - ray_origins[i], axis=1)
            # The nearest hit after the offset is the opposite wall
            valid_dists = dists[dists > 0.3]  # filter out near-zero hits (self-intersection and grazing rays)
            if len(valid_dists) > 0:
                thicknesses.append(float(np.min(valid_dists)))

        if len(thicknesses) == 0:
            # Fallback: use a heuristic based on bounding box and volume
            bb = mesh.bounding_box.extents
            min_dim = float(np.min(bb))
            # Estimate: for a solid object, minimum wall ~ min_dim / 10
            estimated_thickness = min_dim / 10.0
            return {
                "id": "R001",
                "name": "Minimum Wall Thickness",
                "status": "warn",
                "message": (
                    f"Wall thickness could not be measured directly "
                    f"(estimated ~{estimated_thickness:.1f}mm, threshold: {min_wall}mm). "
                    f"Mesh may not be watertight."
                ),
                "details": {
                    "minThickness": round(estimated_thickness, 2),
                    "threshold": min_wall,
                    "unit": "mm",
                    "method": "estimated",
                },
            }

        min_thickness = float(np.min(thicknesses))
        avg_thickness = float(np.mean(thicknesses))

        if min_thickness < min_wall:
            status = "fail"
            message = (
                f"Min wall: {min_thickness:.2f}mm is below threshold {min_wall}mm "
                f"(avg: {avg_thickness:.2f}mm)"
            )
        elif min_thickness < min_wall * 1.25:
            status = "warn"
            message = (
                f"Min wall: {min_thickness:.2f}mm is close to threshold {min_wall}mm "
                f"(avg: {avg_thickness:.2f}mm)"
            )
        else:
            status = "pass"
            message = (
                f"Min wall: {min_thickness:.2f}mm (threshold: {min_wall}mm, "
                f"avg: {avg_thickness:.2f}mm)"
            )

        return {
            "id": "R001",
            "name": "Minimum Wall Thickness",
            "status": status,
            "message": message,
            "details": {
                "minThickness": round(min_thickness, 2),
                "avgThickness": round(avg_thickness, 2),
                "threshold": min_wall,
                "unit": "mm",
                "method": "ray_casting",
                "samplesUsed": len(thicknesses),
            },
        }

    except Exception as e:
        return {
            "id": "R001",
            "name": "Minimum Wall Thickness",
            "status": "warn",
            "message": f"Wall thickness check failed: {e}",
            "details": {
                "minThickness": None,
                "threshold": min_wall,
                "unit": "mm",
                "error": str(e),
            },
        }


def check_max_dimensions(mesh, max_dim: float) -> dict:
    """Check that all bounding box axes are within the maximum dimension limit."""
    bb = mesh.bounding_box.extents
    rounded_dims = [round(float(d), 2) for d in bb]
    max_actual = max(rounded_dims)
    label = f"{rounded_dims[0]}x{rounded_dims[1]}x{rounded_dims[2]}mm"

    if max_actual > max_dim:
        status = "fail"
        message = f"Dimension {label} exceeds max {max_dim}mm on one or more axes"
    elif max_actual > max_dim * 0.9:
        status = "warn"
        message = f"Dimension {label} is close to max {max_dim}mm limit"
    else:
        status = "pass"
        message = f"Within bounds: {label}"

    return {
        "id": "R002",
        "name": "Maximum Dimensions",
        "status": status,
        "message": message,
        "details": {
            "dimensions": rounded_dims,
            "maxAllowed": max_dim,
            "unit": "mm",
        },
    }


def check_manifold(mesh) -> dict:
    """
    Check mesh manifold properties:
      - Watertight (no boundary edges)
      - Is a volume (enclosed solid)
      - No degenerate (zero-area) faces
      - Reports vertex/face/edge counts
    """
    import numpy as np

    is_watertight = bool(mesh.is_watertight)
    is_volume = bool(mesh.is_volume)

    # Check for degenerate faces (zero area)
    face_areas = mesh.area_faces
    degenerate_count = int(np.sum(face_areas < 1e-10))

    n_vertices = int(len(mesh.vertices))
    n_faces = int(len(mesh.faces))
    n_edges = int(len(mesh.edges))

    issues = []
    if not is_watertight:
        issues.append("not watertight")
    if not is_volume:
        issues.append("not a solid volume")
    if degenerate_count > 0:
        issues.append(f"{degenerate_count} degenerate face(s)")

    if is_watertight and is_volume and degenerate_count == 0:
        status = "pass"
        message = f"Watertight mesh, {n_faces} faces"
    elif is_watertight and is_volume:
        status = "warn"
        message = f"Mesh is watertight but has {degenerate_count} degenerate face(s), {n_faces} total"
    elif is_watertight:
        status = "warn"
        message = f"Watertight but not a solid volume, {n_faces} faces"
    else:
        status = "fail"
        message = f"Mesh has issues: {', '.join(issues)} ({n_faces} faces)"

    return {
        "id": "R003",
        "name": "Manifold Geometry",
        "status": status,
        "message": message,
        "details": {
            "isWatertight": is_watertight,
            "isVolume": is_volume,
            "degenerateFaces": degenerate_count,
            "vertices": n_vertices,
            "faces": n_faces,
            "edges": n_edges,
        },
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps(make_error_result("Usage: validate_stl.py <stl_file> [--max-dim N] [--min-wall N]")))
        sys.exit(1)

    stl_path = sys.argv[1]
    max_dim = 300.0
    min_wall = 1.2

    # Parse optional arguments
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--max-dim" and i + 1 < len(sys.argv):
            try:
                max_dim = float(sys.argv[i + 1])
            except ValueError:
                pass
            i += 2
        elif sys.argv[i] == "--min-wall" and i + 1 < len(sys.argv):
            try:
                min_wall = float(sys.argv[i + 1])
            except ValueError:
                pass
            i += 2
        else:
            i += 1

    try:
        result = validate_stl(stl_path, max_dim=max_dim, min_wall=min_wall)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps(make_error_result(f"Unexpected error: {e}\n{traceback.format_exc()}")))
        sys.exit(1)


if __name__ == "__main__":
    main()
