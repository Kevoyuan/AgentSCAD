# Bracket Design Patterns

## L-Bracket Pattern

The most common bracket. Two perpendicular faces with optional ribs.

Key parameters:
- `width`: horizontal base extent
- `height`: vertical face extent
- `depth`: bracket depth along the axis
- `thickness`: uniform wall thickness
- `rib_count`: number of triangular support ribs (0 = no ribs)

Ribs must connect to the base and vertical face over a finite area. Full-face contact can union correctly; `_merge_tol` (0.2 mm) overlap is an optional robustness allowance.

## Mounting Bracket Pattern

Flat plate with holes for mounting. Can include stiffening ribs.

Important: mounting holes must have sufficient edge distance. Minimum 2x hole diameter from any edge.

## U-Bracket / Clevis Pattern

Two parallel arms with aligned holes for a pin or bolt. Used for hinge joints.

Ensure both arms are identical and holes are perfectly aligned (same Y, Z coordinates).

## Ribbed Bracket Pattern

Any bracket with triangular ribs for structural reinforcement.

Rules:
- Rib thickness ≥ wall thickness × 0.8
- Ribs should extend at least 60% of the face height
- Ribs must meet both faces over a finite area; use `_merge_tol` only when needed to preserve connectivity under parameter edits
- Maximum rib spacing: ~10x wall thickness

## Design Rules

- Minimum wall thickness for structural brackets: 2.0 mm (FDM)
- Rib root thickness: ≥ 0.8 × wall thickness
- Rib count: depth / (8 × thickness) rounded down
- Preview: use `color()` to visually distinguish faces, ribs, and holes
