# OpenSCAD Library Policy

AgentSCAD may use approved OpenSCAD libraries when the runtime reports them as available. The approved library catalog lives in `skills/scad-library-policy/manifest.json`; it records source repositories, pinned commits, detection files, include examples, and license gates.

## Managed Library Directory

The default managed library directory is outside the repository:

```bash
~/.agentscad/openscad-libraries
```

Install and check default-approved libraries:

```bash
bun run scad:libs:install
bun run scad:libs:check
```

Default installation currently includes BOSL2, Round-Anything, and MCAD.

GPL libraries such as NopSCADlib are not installed by default. Installing them requires an explicit opt-in:

```bash
bun run scad:libs:install:gpl
```

Generated SCAD may reference available libraries with `include` or `use`, but AgentSCAD does not copy third-party library source into generated SCAD.

Keep third-party library source out of this repository unless a human explicitly reviews and approves the licensing and distribution model.

## Runtime Boundary

AgentSCAD does not bundle or link OpenSCAD in the default application distribution. It invokes OpenSCAD as an external command-line renderer through `OPENSCAD_BIN` or the `openscad` executable available in the user's runtime environment.

Users and distributors who install, package, or redistribute OpenSCAD are responsible for complying with OpenSCAD's GPL license terms.
