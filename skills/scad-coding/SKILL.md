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
<!-- ASSEMBLY_CONTRACT_GUIDANCE_START -->
- For an explicitly functional, independently manufacturable, or removable assembly, preserve every required part instance, connection, motion, fitting surface, and requested dimension. Use distinct named part modules with identifiable local frames and compose them within `generated_part()`. Never fuse separate mating bodies or replace required repeated instances with representative blocks merely to make the model connected or fit the compile budget.
- For such an assembly, add the versioned `/* AGENTSCAD_ASSEMBLY_V1` JSON comment contract described below, plus a top-level `agentscad_part = "all";` selector. `generated_part()` must draw the complete assembly for `"all"` and exactly the corresponding part definition in its local frame for each declared selector. Never apply instance assembly transforms to a standalone part export. A valid selector or JSON is a declaration, not proof of part identity or fit.
- Preserve specified mating axes, clearances, motion limits, and assembly or removal paths. Keep missing conditions explicit rather than claim an unknown fit or manufacturing process is verified. Drive actual geometry from movement controls; an animation, parameter, or function alone does not prove motion, collision clearance, assembly, or physical function.

Assembly comment contract: start with `/* AGENTSCAD_ASSEMBLY_V1`, then one valid JSON object, then `END_AGENTSCAD_ASSEMBLY */`. No other keys are allowed. Use this structure (empty arrays and nulls are appropriate when details are unknown):
```
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed",
 "parts":[{"id":"base","name":"Base","selector":"base","source":"generated","material":null}],
 "instances":[{"id":"base1","partId":"base","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],
 "subassemblies":[],"connections":[],"groundedInstanceId":"base1","motions":[],"operations":[],"manufacturing":null,"assumptions":[],"unknowns":[]}
```
Transforms are row-major, right-handed local-to-assembly rigid poses. A subassembly is `{ "id", "name", "parentId" }`. Each connection is `{ "id", "type", "a", "b", "frameA", "frameB", "range", "pitchMm", "ratio", "allowedContact" }`: type is `fixed`, `revolute`, `prismatic`, `screw`, `gear`, or `other`; frames are null or `{ "origin": [x,y,z], "direction": [x,y,z] }` in the corresponding local frame; range is null or `{ "min", "max", "unit": "deg"|"mm" }`; unknown pitch and ratio are null; allowedContact is an array of strings. A motion is `{ "id", "inputConnectionId", "range" }`. An operation is `{ "id", "action": "assemble"|"disassemble", "instanceId", "waypoints": [16-number rigid transforms], "tools": [] }`. Manufacturing is null or `{ "process", "material", "machine", "notes" }`: the first three fields are nullable strings and `notes` is an array of strings. Every referenced ID must exist and each part selector must be unique. Never fabricate specified dimensions, contact surfaces, or manufacturing assumptions; list missing conditions in `unknowns`.

For a revolute bore-and-shaft connection whose bore side is known, add optional `boreInstanceId` containing the actual instance ID stored in `a` or `b`. For example, if `a` is `"base1"` and the base carries the bore, use `"boreInstanceId":"base1"`, never the literal `"a"`. Omit it if unknown; it is not nullable. Declaring this role allows fit and hinge checks but does not prove geometry or fit.

When a specific cylindrical mating region is known, a connection may propose `fitStationsMm` with 2–16 strictly increasing finite sample offsets in millimetres along `frameA`, measured from `frameA.origin`. These are neither world Z coordinates nor frameB offsets. Use the actual mating region, including every explicitly required section; never pick favourable sections to conceal a defective interface. Caller-specified measurement stations take precedence. The report records the selected stations and their source. Only those planes are measured, with no full bearing-length, continuous tolerance or physical claim. Without this field the legacy whole-part-overlap sampling remains. Preserve existing station declarations and their frameA during geometry repair.

Translations in the row-major transform belong at indices 3, 7 and 11. For a +12 mm Z translation use `[1,0,0,0,0,1,0,0,0,0,1,12,0,0,0,1]`. The last row must remain `[0,0,0,1]`; writing displacement there is invalid.

When source-driven pose verification is requested, keep manufacturing selectors in local coordinates with `agentscad_pose=false`. With an explicit `agentscad_pose=true` view, provide a distinct selector for each instance that returns its complete geometry at the actual source-driven assembly pose. Repeated instances need individually addressable pose selectors. Preserve the normal manufacturing export. The verification caller must supply input parameter bindings and independent expected rigid poses. A pose flag alone supplies no kinematic evidence, and a rotationally symmetric surface may not reveal joint phase.

Optional top-level `translationProbes` records geometric experiments as `{ "id", "instanceId", "startTransform": [16-number rigid world pose], "translationMm": [x,y,z], "samples": 2..65, "expected": "blocked"|"clear" }` (at most 64). The displacement is world-space, nonzero; every other instance remains at its declared pose and is an obstacle. Each probe moves only one non-grounded instance, so do not use this for a coupled moving group. Declare service and release experiments separately when their conditions are known; the verifier checks listed poses, not the completeness of the service envelope. These experiments do not satisfy holding-force requirements or establish accidental-release resistance. Existing probes must remain unchanged during geometry repair. Keep full assembly/removal routes in `operations`; a clear probe is not a complete removal route. Omit probes when their conditions are unknown.

For a known ideal screw path, an operation may use `waypoints: []` and `screwTrajectory: {axis:{origin:[x,y,z],direction:[x,y,z]},hand:"right"|"left",leadMm:number,startAngleDeg:number,endAngleDeg:number}`. The axis is world-space, the instance pose is the start, angles are degrees, and the positive lead is millimetres per revolution. Positive right-hand rotation advances along the axis, left-hand against it. A declaration alone does not prove engagement, continuous clearance, or physical functionality.

For a known sequential rigid release route, prefer `waypoints: []` plus `rigidTrajectory` over hand-calculating many matrices. Example removal: `{"id":"remove_rotor","action":"disassemble","instanceId":"rotor1","waypoints":[],"tools":[],"rigidTrajectory":{"traversal":"forward","stages":[{"type":"rotate","axis":{"origin":[0,0,0],"direction":[0,0,1]},"angleDeg":90},{"type":"translate","deltaMm":[0,0,12]}]}}`. Stages always describe removal FROM the instance's declared assembled pose. For the matching insertion, use `action:"assemble"`, `traversal:"reverse"` and the same forward-removal stages: this explicitly starts at their external endpoint and follows their exact reverse. Each axis/translation is world-space; angles obey the right-hand rule and retain complete turns. At most 32 nonzero stages; do not combine this with nonempty waypoints or screwTrajectory. The deterministic adapter expands stage order using the existing pose budgets, without correcting old matrices. Geometry, complete separation and collisions still have to pass. This format does not infer a release mechanism, couple SCAD controls, or prove continuous/physical feasibility; sequential stages are not a simultaneous screw motion.
<!-- ASSEMBLY_CONTRACT_GUIDANCE_END -->
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


## Preserve functional voids and rigid assembly access

- Check a proposed connecting rib or bridge in the part's local coordinates. It must overlap the actual material of both features by positive volume. A bounding-box overlap or a comment naming a bridge supplies no geometry evidence.
- When adding material near a mating bore, inspect the final Boolean order. A bridge unioned after a local bore subtraction can fill the bore again. Apply the required bore cutter to the complete relevant union, and preserve the opening throughout the intended engagement interval. Two clear end sections leave the middle unverified.
- Check the assembled pose for penetration before refining a path. Denser waypoints cannot repair an intersecting starting assembly.
- Evaluate an added retaining shoulder together with the intended assembly and removal routes. A permanent shoulder wider than a rigid bore blocks axial passage. A compliant or releasable solution needs an explicit mechanism and conditions. Keep unavailable force, deformation and manufacturing evidence in the unknowns.
- When retention and removability are both required, distinguish the in-service configuration from the release configuration. A reversible geometric interlock may require an intentional release orientation outside the operating interval, followed by withdrawal. Model the complete release route and explain how unintended unlocking is prevented or remains unresolved. A sampled geometric stop establishes neither holding force nor resistance to wear, fracture or accidental release.
- For straight rigid translation, the current declaration checker accepts two world-space endpoints and samples between them. Additional intermediate poses must satisfy the stated spacing bounds. Use explicit dense poses for rotations or multi-stage routes, keeping all required instance and operation identities.
