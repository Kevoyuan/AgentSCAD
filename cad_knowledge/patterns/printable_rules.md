# FDM Printable Design Rules

## Minimum Feature Sizes

| Feature | Minimum | Recommended |
|---|---|---|
| Wall thickness | 1.2 mm | 2.0 mm |
| Decorative rib/relief width | 1.2 mm | 1.6 mm |
| Hole diameter (through) | 2.0 mm | 3.0 mm |
| Hole diameter (blind) | 3.0 mm | 4.0 mm |
| Boss/post diameter | 3.0 mm | 5.0 mm |
| Text feature height/depth | 0.5 mm | 1.0 mm |
| Gap/clearance between parts | 0.2 mm | 0.4 mm |

## Overhangs and Bridges

- Maximum unsupported overhang: 45° from vertical
- Maximum bridge span: 20 mm (without supports)
- Avoid horizontal holes (they require supports)
- Orient parts to minimize overhangs

## Boolean Operations

- Always overlap unioned solids by `_merge_tol` (0.2 mm) — never rely on coplanar faces
- Avoid coincident faces in `difference()` — extend subtracted geometry past surfaces by ≥ 0.5 mm
- Prefer `hull()` over complex boolean chains for organic shapes

## Print Orientation

- Place the largest flat face on the build plate (Z=0)
- Orient holes vertically when possible
- Avoid knife edges contacting the build plate — they won't adhere

## Common Failure Modes

1. **Non-manifold mesh**: caused by coincident faces, zero-thickness geometry, or unclosed solids
2. **Floating parts**: disconnected components that would print in mid-air
3. **Missing features**: holes or cutouts that don't fully penetrate
4. **Wall too thin**: features below nozzle width that won't print
