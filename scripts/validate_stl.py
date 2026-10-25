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
    internal ribs). Straight planar sheet gauge is reported separately
    from wall/feature width; sheet suitability still requires review.
    For production use, consider dedicated tools like
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
        component_count = len(components)
    except Exception as e:
        return make_error_result(f"Component analysis failed: {e}")

    # ─── Euler characteristic ─────────────────────────────────────────────
    try:
        # mesh.edges contains three directed edges per triangle, not unique edges.
        # Euler characteristic is additive: chi = 2*C - 2*sum(genus).
        euler = len(mesh.vertices) - len(mesh.edges_unique) + len(mesh.faces)
        genus = (2 * component_count - euler) // 2 if mesh.is_watertight else 0
    except Exception as e:
        return make_error_result(f"Topology analysis failed: {e}")

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
        "skipped": sum(1 for r in rules if r["status"] == "skip"),
        "errors": sum(1 for r in rules if r["status"] == "error"),
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


def planar_sheet_axis(mesh):
    """Conservatively recognize a thin, straight extrusion, including rotated washers.

    This is a geometry classification, not proof of printability or load capacity.
    Require a closed volume, two vertex planes, and only axial/perpendicular
    face normals. Bevels, bent sheets, and hollow shells remain unclassified.
    """
    import numpy as np

    if not mesh.is_volume:
        return None
    try:
        box = mesh.bounding_box_oriented
        extents = box.primitive.extents
        order = np.argsort(extents)
        thickness = float(extents[order[0]])
        if thickness <= 0 or thickness > float(extents[order[1]]) * 0.1:
            return None
        axis = box.primitive.transform[:3, order[0]]
        projected = mesh.vertices @ axis
        tolerance = max(1e-6, thickness * 1e-4)
        on_caps = ((abs(projected - projected.min()) < tolerance)
                   | (abs(projected - projected.max()) < tolerance))
        alignment = abs(mesh.face_normals @ axis)
        if np.all(on_caps) and np.all((alignment < 1e-4) | (alignment > 1 - 1e-4)):
            return axis, thickness
    except Exception:
        # Classification is optional; uncertainty must not relax the wall check.
        pass
    return None


def check_wall_thickness(mesh, min_wall: float) -> dict:
    """Sample local material thickness; distinguish sheet gauge from wall width.

    Face-normal rays estimate local thickness, not manufacturing suitability.
    At most 2000 deterministic face samples are used. Small unsampled features,
    curved walls, print orientation, nozzle/layer settings, and strength still
    need review. Only a confirmed straight thin extrusion gets sheet treatment;
    narrow in-plane features retain the normal wall threshold.
    """
    import numpy as np

    def result(status, message, **details):
        return {
            "id": "R001", "name": "Minimum Wall Thickness",
            "status": status, "message": message,
            "details": {"threshold": min_wall, "unit": "mm", **details},
        }

    if not mesh.is_volume:
        return result("skip", "Skipped — thickness requires a watertight, consistently oriented volume",
                      minThickness=None, method="unavailable")

    try:
        n_samples = min(2000, len(mesh.faces))
        face_indices = np.linspace(0, len(mesh.faces) - 1, n_samples, dtype=int)
        points = mesh.triangles_center[face_indices]
        normals = mesh.face_normals[face_indices]
        # Start on the surface and exclude only numerical self-hits. The old
        # 0.3 mm cutoff hid very thin walls; the 0.01 mm offset inflated results.
        epsilon = max(1e-8, float(mesh.scale) * 1e-9)
        locations, index_ray, _ = mesh.ray.intersects_location(
            points, -normals, multiple_hits=True
        )
        sheet = planar_sheet_axis(mesh)
        thicknesses, wall_widths, sheet_gauges = [], [], []
        for i in range(n_samples):
            hits = locations[index_ray == i]
            distances = (hits - points[i]) @ (-normals[i])
            valid = distances[distances > epsilon]
            if len(valid) == 0:
                continue
            thickness = float(np.min(valid))
            thicknesses.append(thickness)
            if (sheet is not None and abs(float(normals[i] @ sheet[0])) > 1 - 1e-4
                    and abs(thickness - sheet[1]) < max(1e-6, sheet[1] * 1e-4)):
                sheet_gauges.append(thickness)
            else:
                wall_widths.append(thickness)

        if not thicknesses:
            return result("error", "Thickness measurement unavailable — no opposing surface intersections",
                          minThickness=None, method="ray_casting")

        minimum = float(np.min(thicknesses))
        average = float(np.mean(thicknesses))
        wall_minimum = min(wall_widths) if wall_widths else None
        sheet_minimum = min(sheet_gauges) if sheet_gauges else None
        missing = n_samples - len(thicknesses)
        # Compare with a tiny numerical tolerance, not a manufacturing allowance.
        below = lambda value: value is not None and value < min_wall - epsilon
        if below(wall_minimum):
            status = "fail"
            message = f"Min local wall/feature width: {wall_minimum:.2f}mm is below threshold {min_wall}mm"
        elif below(sheet_minimum):
            status = "warn"
            message = (f"Planar sheet material thickness: {sheet_minimum:.2f}mm; "
                       f"the {min_wall}mm wall-width default does not determine sheet suitability. "
                       "Review print orientation, layer height, material and load; preserve the requested gauge.")
        elif missing:
            status = "warn"
            message = f"Thickness sampling incomplete: {missing}/{n_samples} rays had no opposing hit"
        elif minimum < min_wall * 1.25:
            status = "warn"
            message = f"Min sampled material thickness: {minimum:.2f}mm is close to threshold {min_wall}mm"
        else:
            status = "pass"
            message = f"Min sampled material thickness: {minimum:.2f}mm (threshold: {min_wall}mm)"

        return result(status, message, minThickness=round(minimum, 4),
                      avgThickness=round(average, 4),
                      minWallWidth=round(wall_minimum, 4) if wall_minimum is not None else None,
                      sheetThickness=round(sheet_minimum, 4) if sheet_minimum is not None else None,
                      geometryClass="planar_sheet" if sheet is not None else "unclassified_solid",
                      method="ray_casting", samplesUsed=len(thicknesses), samplesMissing=missing)
    except Exception as e:
        return result("error", f"Wall thickness measurement failed: {e}",
                      minThickness=None, method="unavailable", error=str(e))


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
    n_edges = int(len(mesh.edges_unique))

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
