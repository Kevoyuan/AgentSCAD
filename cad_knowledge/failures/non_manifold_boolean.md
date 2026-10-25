# Non-Manifold Boolean Operations

## Symptom

R003 reports a non-watertight mesh, degenerate faces, or a surface that does not enclose a valid volume. Locate the actual defect before changing dimensions.

## Causes to Investigate

1. **Edge/point-only connection.** Bodies touching only along an edge or at a point can produce a non-manifold boundary. Provide finite-area contact or a deliberate volume overlap if one solid is intended.
2. **Zero-thickness remnant.** A cut can leave a sheet or knife edge with no solid thickness. Inspect the resulting geometry; touching cutters do not by themselves prove this defect.
3. **Degenerate geometry.** Zero-size primitives, collapsed profiles and insufficient non-coplanar points in a 3D `hull()` can fail. Use valid 3D inputs; changing `$fn` is not a universal remedy.
4. **Invalid polyhedron.** Check face winding, boundary edges, non-manifold vertices, duplicate/zero-area faces and self-intersections.

## Coplanarity Is Not a Diagnosis

CGAL boolean operations can correctly merge solids sharing a full planar face. A through-cutter ending exactly at the two plate surfaces can produce the same volume and triangulation as an extended cutter. Do not claim that OpenSCAD cannot determine inside/outside merely because faces are coplanar. Preview artifacts are not proof that the rendered STL is invalid.

A `_merge_tol` overlap or cutter extension can be useful when computed coordinates or parameter changes introduce a real gap or leave material uncut. It is a modeling allowance, not a requirement for every valid boolean. Do not shift mating surfaces or nominal dimensions without evidence.

## Repair Strategy

1. Read the compile log and inspect the exported mesh, not just the preview.
2. Distinguish a gap, edge/point contact, zero-thickness remnant, self-intersection, and a valid face union.
3. Repair the identified defect with the smallest change that preserves dimensions and intent.
4. Render and recheck topology, dimensions and required features. A manifold result alone does not prove fit.

Executable counterexamples live in `scripts/tests/test_manufacturing_geometry.py`: a full-face union and flush versus extended through-hole cutters.
