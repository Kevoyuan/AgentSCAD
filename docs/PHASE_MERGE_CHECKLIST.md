# Phase merge checklist

Status as of 2026-11-19, after the twelve-family gate refresh.

## Branch state

| Item | Value |
|---|---|
| Working tree | clean |
| Current branch | `continue/local-assembly-2026-11-18` |
| HEAD | `19c1fa4` (`feat(bench): add product joint-frame layer`) |
| `main` | `2addffd` |
| Commits ahead of `main` | 158 |
| Diff | 446 files, about 78k insertions |

## Verification

| Check | Result |
|---|---|
| Unit suite | 1193 PASS / 3 SKIP / 0 FAIL (184 files) |
| Native OpenSCAD suite | 67 PASS / 1 SKIP / 0 FAIL (1204.26 s, 68 tests, 14 files) |
| Twelve-family gate | 87 cases, `overall: PASS`, about 69.4 minutes |
| Product family | reference 7/7; 1 reference / 4 adversarial |
| Hidden product dev | 1/1 PASS, 7/7 layers; `independentHiddenEvaluation=NOT_RUN` |

## What this merge would include

- Twelve public bench families and their self-checks.
- Hidden-set split for all twelve families (development copies only).
- Product-path A08 family: identity, topology, reconstruction, assembly path, disassembly path, eccentric fit and joint frames.
- Planetary, three-planet, shared-pin V8 carrier, threaded fasteners and the earlier slider/gear/twin/vtwin/declaration families.
- Evidence logs and the updated native baseline.

## What it does not include

- A connected-crankshaft V8. The current v8 family has four shared pins, no main shaft; connected-crank candidates remain rejected by collision sampling.
- Full A001 contract-gate pass for the guided six-part source. A confirmed contract alone does not promote unmeasured layers.
- Independent hidden evaluation or fresh external model sampling. Hidden copies are `independent: false`.
- Physical function, manufacturing, torque, preload, wear or user acceptance.

## Recommended merge

After explicit approval:

```bash
git switch main
git merge --no-ff continue/local-assembly-2026-11-18
```

Use `--no-ff` to preserve the 158-commit phase boundary and the evidence history. Do not squash: the bench/evidence commits are the audit trail. Re-run `bun run test` and the twelve-family gate on the merged `main` before publishing.

## Open decisions

- Merge as a single phase, or split the product-path/bench work into a smaller review branch first.
- Whether the connected-V8 and A001 gaps must block this phase merge. They are known limitations, not regressions.
