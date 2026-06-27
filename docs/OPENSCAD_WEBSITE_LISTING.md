# OpenSCAD Website Listing

Issue: [Kevoyuan/AgentSCAD#6](https://github.com/Kevoyuan/AgentSCAD/issues/6)

OpenSCAD's website has a curated libraries page at
<https://openscad.org/libraries.html>. Changes are made in the
`openscad/openscad.github.com` repository, usually by opening an issue or pull
request against `libraries.html`.

## Listing Position

AgentSCAD is an AI CAD job manager that generates OpenSCAD source and invokes
OpenSCAD as an external renderer. It is not itself an OpenSCAD include/use
library.

For the OpenSCAD website, prefer one of these positions:

- Ask maintainers whether AgentSCAD belongs on a website section for AI tools,
  coupled software, or related OpenSCAD projects.
- Do not request a normal library listing unless the maintainers explicitly want
  application-like projects listed on `libraries.html`.
- If a listing is accepted, describe AgentSCAD as tooling around OpenSCAD, not as
  a reusable SCAD module library.

## License Position

AgentSCAD is MIT licensed. The default application does not vendor OpenSCAD or
GPL OpenSCAD libraries.

The app may use external OpenSCAD libraries only through the reviewed manifest at
`skills/scad-library-policy/manifest.json`.

- Default managed installs include permissive or reviewed weak-copyleft
  libraries only.
- GPL libraries, currently NopSCADlib, require explicit opt-in with
  `bun run scad:libs:install:gpl`.
- Third-party OpenSCAD library source stays outside this repository by default in
  `~/.agentscad/openscad-libraries`.
- OpenSCAD itself is invoked as an external command-line program through
  `openscad` or `OPENSCAD_BIN`; it is not bundled in the default app
  distribution.

Keep the detailed compliance notes in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
[`docs/OPENSCAD_LIBRARIES.md`](./OPENSCAD_LIBRARIES.md).

## Reply For AgentSCAD Issue #6

```markdown
Thanks for the pointer. We have handled the library/license side in the repo:

- AgentSCAD is MIT licensed.
- OpenSCAD is treated as an external runtime tool and is not bundled in the default app distribution.
- Approved OpenSCAD libraries are tracked in `skills/scad-library-policy/manifest.json`.
- Default library install excludes GPL libraries.
- NopSCADlib is cataloged but requires explicit opt-in via `bun run scad:libs:install:gpl`.
- License notes are documented in `THIRD_PARTY_NOTICES.md` and `docs/OPENSCAD_LIBRARIES.md`.

For the OpenSCAD website, AgentSCAD is not itself an OpenSCAD `include`/`use` library, so I will not claim it as a normal library entry. The best upstream request is to ask `openscad/openscad.github.com` whether AI/coupled OpenSCAD tools should be listed on the website, or whether they prefer a separate section from `libraries.html`.
```

## Upstream Issue Draft

```markdown
Title: Listing AgentSCAD as related OpenSCAD AI tooling?

AgentSCAD is an MIT-licensed AI CAD job manager that generates OpenSCAD source,
invokes OpenSCAD as an external renderer, and stores generated SCAD/STL/PNG
artifacts.

Repository: https://github.com/Kevoyuan/AgentSCAD
License: MIT

It is not a reusable OpenSCAD `include`/`use` library, so I am not sure whether
it belongs on `libraries.html`. Would maintainers prefer a listing for AI tools,
coupled software, or related OpenSCAD projects somewhere on the website?

License/compliance notes:
- AgentSCAD does not bundle OpenSCAD in the default distribution.
- Third-party OpenSCAD libraries are managed outside the repository.
- GPL OpenSCAD libraries are excluded from the default install and require
  explicit opt-in.
```

## Pull Request Checklist

If maintainers ask for a PR:

- Fork <https://github.com/openscad/openscad.github.com>.
- Edit only the page/section the maintainers requested.
- Use `AgentSCAD` as the name.
- Link the library/tool URL to <https://github.com/Kevoyuan/AgentSCAD>.
- Use `License: MIT` and link to <https://spdx.org/licenses/MIT.html>.
- Avoid implying that AgentSCAD source is an OpenSCAD library or that it bundles
  OpenSCAD.
