---
name: scad-planning
description: Choose a CAD modeling approach from the user's request and the persisted evidence contract before writing OpenSCAD.
version: 1
when_to_use: A CAD request and evidence contract are ready for geometry generation.
when_not_to_use: The request still needs interpretation approval or the task is validation-only.
required_inputs: [user_request, request_evidence]
---

# SCAD Planning

The supplied generation plan is an evidence checkpoint, not an approved geometry design. Its features, dimensions, explicit constraints, assumptions, and acceptance criteria describe the request. Empty modeling and design fields mean no approach has been chosen yet.

Before writing code, decide how to construct the requested object. Keep that reasoning internal and return the artifact in the coding skill's required format.

1. Preserve explicit user constraints and required features. Treat suggested family parameters as editable defaults, not facts supplied by the user.
2. Decide whether the request calls for one printable body, multiple parts, an assembly, or a display model. Do not assume FDM printability or a single connected body for every request.
3. Choose a coordinate system, construction sequence, openings, mating clearances, and library modules appropriate to the object. Use the available library guidance; do not invent includes.
4. Apply printable feature and wall guidance only when the intended use supports printing. Expose uncertain dimensions as editable parameters rather than presenting them as verified product measurements.
5. Keep requested features and acceptance criteria visible in the resulting geometry. Never describe a feature as validated merely because code was generated.
6. If a requirement cannot be represented confidently, preserve the uncertainty in a comment or editable parameter instead of silently choosing a materially different artifact.
7. For a functional, independently manufacturable, or removable assembly, account for each required part instance, local frame, mating connection, specified motion, clearance, and assembly or removal path. Do not replace required instances with representative blocks or merge separate mating bodies. Display-only simplification applies only to optional detail and must preserve explicitly requested features.
8. For a retained or releasable interface, put a compact proposed interface table in SCAD comments. Identify each shaft, shoulder, receiving space and blocking surface by its part-local radial, axial and angular region in the service and release configurations. Check the entire requested motion envelope against those regions. A receiving space must accommodate every feature occupying it, and a slot must accommodate the relative sweep as well as the feature width. Derive clearance inequalities and a nonempty release interval before choosing an actuation distance. A claimed bridge must connect material within its own part. Revise a contradictory scheme before writing the final geometry. Label this table as proposed design arithmetic, with independent measurements still required.
9. When the request requires an independent release action, identify the surface blocking the unreleased route and the geometric change that clears it. Check that the release action itself remains possible while the retaining surfaces stay engaged, then that the remaining route reaches complete separation and reverses for assembly. Preserve each explicitly requested service and release experiment in the declaration. State unresolved accidental actuation, material, force and manufacturing conditions separately from the nominal rigid-body route.
