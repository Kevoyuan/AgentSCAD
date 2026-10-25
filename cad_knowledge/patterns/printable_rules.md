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

- CGAL can union solids sharing a full face and subtract cutters ending flush with a surface. Coplanarity alone is not a defect. Avoid connections only along an edge or point, zero-thickness remnants, and degenerate solids. Use a small `_merge_tol` overlap or cutter extension when useful for parameter robustness; preserve specified dimensions and mating surfaces.
- Prefer `hull()` over complex boolean chains for organic shapes

## Print Orientation

- Place the largest flat face on the build plate (Z=0)
- Orient holes vertically when possible
- Avoid knife edges contacting the build plate — they won't adhere

## Common Failure Modes

1. **Non-manifold mesh**: may result from edge/point-only connections, zero-thickness remnants, degenerate geometry, or unclosed solids; coplanarity alone is not a cause
2. **Floating parts**: disconnected components that would print in mid-air
3. **Missing features**: holes or cutouts that don't fully penetrate
4. **Wall too thin**: features below nozzle width that won't print

## Sheet Gauge and Circular Fits

The 1.2 mm FDM default applies to wall/feature width; a planar sheet or washer gauge is a separate design dimension. Preserve an explicitly requested thin gauge, and report the need to review orientation, layer height, material and load. Do not thicken a sheet to silence R001 WARN. Narrow in-plane webs and enclosure walls still require wall-width checks.

For circular mating bores of every diameter (including below 3 mm), use `fit_hole(d, h, center=true, diametral_tolerance=0.02)` from agentscad_std.scad or equivalent local geometry. It uses at least 24 segments, increases resolution to bound polygon oversize, and compensates `d / cos(180/n)` so the minimum clear diameter equals `d`. Keep a local `$fn`; a coarse global `$fn` must not control fitting surfaces. If the library is unavailable, choose `n = max(24, 4*ceil(180/acos(d/(d+0.02))/4))` and subtract `cylinder(d=d/cos(180/n), h=h, center=true, $fn=n)`. Add any requested manufacturing clearance to `d` separately; polygon compensation is not printer shrinkage compensation. Preserve intentional polygon sockets. H001 counts topology only and does not certify diameter or fit.
