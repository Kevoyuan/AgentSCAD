# Third-Party Notices

AgentSCAD is MIT licensed. The following reviewed third-party components have additional notice or distribution obligations.

## Weak Copyleft Components

| Component | License | Use | Compliance note |
| --- | --- | --- | --- |
| MCAD | LGPL-2.1 | Optional/default managed OpenSCAD library for units and gears | Preserve upstream license files when installing or distributing the managed OpenSCAD library bundle. |
| sharp libvips packages (`@img/sharp-libvips-*`) | LGPL-3.0-or-later | Prebuilt libvips binary dependency used by `sharp` | Preserve license notices when distributing packaged builds, containers, or offline bundles. Do not prevent replacement of the LGPL library. |

## GPL Policy

GPL and AGPL libraries must not be linked into AgentSCAD or included in the
default managed OpenSCAD library install. A reviewed, separately executed GPL
program may accompany AgentSCAD when its license, integrity data, and
corresponding source are supplied and the programs communicate only through a
command-line process boundary.

NopSCADlib is cataloged as an explicit opt-in GPL-3.0 OpenSCAD library. It must remain excluded from default installs and product bundles unless a human approves the distribution model and preserves the upstream license notices.

## Separately Executed Runtime Tools

### OpenSCAD WebAssembly Node CLI

Vercel deployments use the official, unmodified OpenSCAD WebAssembly Node CLI
as a child process. AgentSCAD sends OpenSCAD source through standard input and
receives an STL through standard output. The programs do not link, import one
another as libraries, or exchange internal data structures. Native deployments
continue to support an external `openscad` executable through `OPENSCAD_BIN`.

| Field | Reviewed value |
| --- | --- |
| Component | OpenSCAD WebAssembly Node CLI |
| Version | 2026.01.12 (`git 4f3ef234`) |
| License | GPL-2.0-or-later with OpenSCAD's CGAL linking exception |
| Official binary | `https://files.openscad.org/snapshots/OpenSCAD-2026.01.12-WebAssembly-node.zip` |
| Archive SHA-256 | `44dd0e51a9ac1d64f356ad731da329a7414a1a90af2dad9f85e42735ce510376` |
| Extracted runtime SHA-256 | `29ce0da7a06d1ba5324ee832a0c9749d4f4404d08f9db72e625664f1d52a2011` |
| Corresponding OpenSCAD source | `https://github.com/openscad/openscad/tree/4f3ef2340db00a8cee2e9cdefe87dae5686b41f6` |
| WASM build-system source | `https://github.com/openscad/openscad-wasm/tree/ac5cf9b129bdb243fef3862883bd5d64e54fffcb` |

The build downloads the official archive, verifies both archive and runtime
hashes, and places the complete upstream `COPYING` file beside the runtime.
The runtime is not an npm library and is never imported into AgentSCAD.

Anyone redistributing a packaged build must keep `.openscad-runtime/COPYING`,
this notice, and access to the corresponding source listed above. AgentSCAD's
own source remains under MIT; OpenSCAD remains under its upstream GPL terms.
