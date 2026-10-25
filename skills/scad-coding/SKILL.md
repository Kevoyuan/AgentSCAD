---
name: scad-coding
description: Plan geometry from a persisted request-evidence contract and write valid editable OpenSCAD.
version: 1
when_to_use: A CAD request and request-evidence contract are ready for complete OpenSCAD generation.
when_not_to_use: Intake is ambiguous, or the task is to repair an existing artifact.
required_inputs: [user_request, request_evidence, editable_parameters]
---

# OpenSCAD Coding Agent

You receive a persisted request-evidence contract. Apply the SCAD planning guidance to choose the geometry, then implement the user's request faithfully. Empty `modeling_plan` and `design_rationale` fields mean that no geometry strategy has been selected yet.

## Output

Return exactly one `scad` fenced code block containing the complete artifact. Do not return JSON or prose.

## Artifact contract

- Put all user-editable numeric parameters at the top level before modules or geometry.
- Use descriptive `snake_case` names and never use OpenSCAD reserved words.
- Put all geometry in `module generated_part()`, then call `generated_part();` exactly once.
- Choose a single body, multiple parts, or an assembly according to the user's request and intended use. Printable solids must be manifold.
- CGAL can union solids sharing a full face and subtract cutters ending flush with a surface. Coplanarity alone is not a defect. Avoid connections only along an edge or point, zero-thickness remnants, and degenerate solids. Use a small `_merge_tol` overlap or cutter extension when useful for parameter robustness; preserve specified dimensions and mating surfaces.
- The 1.2 mm FDM default applies to wall/feature width; a planar sheet or washer gauge is a separate design dimension. Preserve an explicitly requested thin gauge, and report the need to review orientation, layer height, material and load. Do not thicken a sheet to silence R001 WARN. Narrow in-plane webs and enclosure walls still require wall-width checks. Prefer 1.6 mm detail width and 2.0 mm structural walls when the request allows it.
- For circular mating bores of every diameter (including below 3 mm), use `fit_hole(d, h, center=true, diametral_tolerance=0.02)` from agentscad_std.scad or equivalent local geometry. It uses at least 24 segments, increases resolution to bound polygon oversize, and compensates `d / cos(180/n)` so the minimum clear diameter equals `d`. Keep a local `$fn`; a coarse global `$fn` must not control fitting surfaces. If the library is unavailable, choose `n = max(24, 4*ceil(180/acos(d/(d+0.02))/4))` and subtract `cylinder(d=d/cos(180/n), h=h, center=true, $fn=n)`. Add any requested manufacturing clearance to `d` separately; polygon compensation is not printer shrinkage compensation. Preserve intentional polygon sockets. H001 counts topology only and does not certify diameter or fit.
- Prefer available reviewed library modules when they fit. Never invent include paths or copy library source.
- Add all required holes, openings, clearances, buttons, ports, ribs, mounts, and other planned features.
- Keep the OpenSCAD artifact as the source of truth: every editable parameter must be a literal top-level assignment.
- Use millimeters unless the generation plan explicitly says otherwise.
- The result must compile without warnings caused by undefined variables, invalid syntax, or missing modules.

## Standard Library Coordinate Contract

`screw_hole` and `bolt_pattern_rect` default to `center=true` for compatibility.
Pass `center=false` to cut through a plate starting at z=0; `h` / `thickness`
then denotes the full positive-z depth. A bolt pattern without children produces
four round cutters; supplied children override their shape. Keep cutter and body
coordinate frames consistent. For `enclosure_box`, `height` is usable internal
height and `wall` is both the nominal side and bottom thickness.
