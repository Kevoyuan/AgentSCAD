---
name: scad-library-policy
description: This skill should be used when deciding whether generated OpenSCAD may include external libraries, validating SCAD include or use statements, checking installed OpenSCAD libraries, or managing approved library policy for BOSL2, NopSCADlib, Round-Anything, MCAD, threads.scad, and threadlib.
triggers:
  - library policy
  - validate scad include
  - openscad libraries
  - approved cad libraries
---

# SCAD Library Policy Skill

Use this skill when deciding whether generated OpenSCAD may include external libraries.

## Purpose

AgentSCAD should use reusable CAD libraries as infrastructure, not hardcode product-family geometry in TypeScript.

## Approved Behavior

- Prefer approved OpenSCAD libraries when the runtime prompt says they are available.
- Use libraries to improve general CAD quality: rounded boxes, fillets, chamfers, anchors, transforms, arrays, threads, gears, fasteners, text, and mechanical primitives.
- Keep all user-editable dimensions as top-level numeric OpenSCAD assignments.
- Keep output exportable by the configured OpenSCAD renderer.
- Use portable built-in OpenSCAD primitives when no library is available.

## Runtime Contract

- The harness reports available libraries before generation.
- The model must not invent include paths.
- The renderer controls the library search path with `OPENSCADPATH`.
- The repository must not copy third-party library source code unless a human explicitly reviews licensing and approves vendoring.

## Preferred Libraries

- BOSL2 for modern rounded solids, transforms, attachments, anchors, arrays, and mechanical utilities.
- NopSCADlib for electronics enclosures, real-world vitamins, assemblies, boards, fans, fasteners, and printer/electronics hardware.
- Round-Anything for rounded sketch profiles, controlled fillets, rounded plates, brackets, tabs, and consumer-product-style softened extrusions.
- MCAD for established OpenSCAD mechanical primitives, especially involute gears.
- threads.scad or threadlib for printable threaded connectors, taps, bolts, nuts, and threaded holes.

## Library Skill Prompting

- Load the matching detailed library skill only when the runtime resolver confirms the library is available.
- Include the exact `include` or `use` statement discovered by the runtime resolver; do not substitute a guessed path.
- Prefer the narrowest library import needed for the job. For example, prefer `use <MCAD/involute_gears.scad>` over broad MCAD includes when generating a gear.
- Use one thread library per artifact. Do not mix `threads.scad` and `threadlib` in the same generated model.

## Hard Rules

- Do not copy BOSL, BOSL2, MCAD, CADAM, or any third-party source code into generated SCAD or the repository.
- Do not encode product-family geometry in TypeScript to fake quality.
- Do not move deterministic validation, rendering, file IO, or database writes into prompts.
- Do not use unavailable libraries.

## Output Guidance

When libraries are available, generated SCAD may start with lines like:

```openscad
include <BOSL2/std.scad>
```

Only use include statements listed by the runtime prompt.

## Scripts

Use deterministic scripts when checking a workstation or generated artifact:

- `scripts/check_scad_libraries.py`: inspect OpenSCAD library search paths and report which approved libraries are installed.
- `scripts/install_scad_libraries.py`: install approved app-managed OpenSCAD libraries into `~/.agentscad/openscad-libraries`; defaults exclude GPL libraries.
- `scripts/validate_scad_includes.py <file.scad>`: fail if a generated SCAD file uses unavailable or unapproved library include/use statements.

## License Gate

- Install permissive or weak-copyleft libraries by default only when the manifest marks `default_install: true`.
- Require explicit `--include-gpl` for GPL libraries such as NopSCADlib.
- Preserve each upstream repository's license files in the managed library directory.
- Keep GPL libraries out of default app bundles unless a human explicitly approves the distribution model.
