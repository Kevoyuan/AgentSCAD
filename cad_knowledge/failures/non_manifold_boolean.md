# Non-Manifold Boolean Operations

## Symptom
OpenSCAD renders the part but mesh validation reports non-manifold geometry (R003 failure). The STL contains holes, self-intersections, or degenerate triangles.

## Common Causes

1. **Coincident faces.** Two solids share exactly the same surface plane. OpenSCAD can't determine inside/outside at the boundary. Fix: overlap solids by `_merge_tol` (0.2 mm).
2. **Zero-thickness geometry.** A `difference()` creates an infinitely thin wall where two subtracted volumes meet. Fix: avoid subtracting volumes that touch each other inside the part.
3. **Degenerate triangles.** Extremely narrow faces from minkowski sums with tiny radii. Fix: use `hull()` instead of `minkowski()` for simple roundings, or increase `$fn`.
4. **Non-closed polyhedron.** Custom polyhedron faces don't form a closed solid. Fix: verify all edges are shared by exactly 2 faces.

## Repair Strategy

1. Identify the non-manifold location from the validation report
2. Add `_merge_tol` overlaps between unioned solids
3. Extend subtracted volumes past part boundaries
4. Replace problematic geometry patterns: `minkowski` → `hull`, coplanar faces → offset by 0.2 mm

## Prevention

- Always use `_merge_tol = 0.2` for boolean union overlaps
- Extend subtracted cylinders/cubes past part surfaces by ≥ 0.5 mm
- Prefer `rounded_box()` and `cylinder_boss()` from agentscad_std.scad
- Never position two cubes/cylinders with exact face contact inside a `union()`
