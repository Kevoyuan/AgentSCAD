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

## OpenSCAD Website Listing

AgentSCAD is not itself an OpenSCAD `include` or `use` library. If requesting a
listing on <https://openscad.org/libraries.html>, describe AgentSCAD as related
OpenSCAD tooling unless the OpenSCAD website maintainers explicitly ask for a
normal library entry.

Use [`docs/OPENSCAD_WEBSITE_LISTING.md`](./OPENSCAD_WEBSITE_LISTING.md) for the
issue response, upstream issue draft, and PR checklist.

## Runtime Boundary

Local native rendering invokes OpenSCAD as an external command-line renderer
through `OPENSCAD_BIN` or `openscad`. Vercel deployments instead carry the
official, unmodified OpenSCAD WebAssembly Node CLI and execute it as a separate
child process. AgentSCAD does not import or link the GPL runtime.

The build verifies the official archive and extracted runtime checksums and
places the upstream `COPYING` file beside the executable. The exact version,
source commits, hashes, and redistribution requirements are documented in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Distributors of packaged
builds must preserve those materials and comply with OpenSCAD's GPL terms.
