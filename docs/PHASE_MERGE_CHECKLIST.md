# Phase merge checklist

Status as of 2026-11-19, after the 90-case gate, the serial native suite and the threaded exit task.

## Branch state

| Item | Value |
|---|---|
| Working tree | clean |
| Current branch | `continue/local-assembly-2026-11-18` |
| HEAD | `8417be8` (`docs: refresh gate with threaded exit`) |
| `main` | `2addffd` |
| Merge base | `891f802` |
| Commits ahead of `main` | 170 |
| Commits behind `main` | **35** |
| Diff | 446 files, about 78k insertions |

The branch is **not** a simple fast-forward of `main`: both sides have 35 and 170 commits since `891f802`.

## Verification

| Check | Result |
|---|---|
| Unit suite | 1193 PASS / 3 SKIP / 0 FAIL (184 files) |
| Native OpenSCAD suite | **68 PASS / 1 SKIP / 0 FAIL** (1379.43 s, 69 tests, 15 files, serial) |
| Twelve-family gate | **90 cases**, `overall: PASS`, about 118.6 minutes |
| Product family | 6 cases, reference 7/7, gate row **25/42** |
| Thread family | 6 cases, 2 references / 4 adversarial, gate row **13/20** |
| Public bench task prompts | 19/19 in English |
| New logs, prompts, commit messages | English |

## Dry-run merge result

A non-destructive merge was run in a temporary worktree from `main`, then aborted. **It does not merge cleanly.**

- Result: `CONFLICT (content)`, automatic merge failed.
- **30 conflicted paths**, including:
  - `.gitignore`, `AGENTS.md`, `CHANGELOG.md`, `package.json`
  - `bench/README.md`, `bench/assembly/*`, `bench/layers.ts`, `bench/ladder-*.ts`
  - `docs/ASSEMBLY_EVIDENCE_LOG.md`
  - `src/lib/assembly/fit-measurement.ts`, `prepare-assembly.ts`, `prepare-assembly.test.ts`, `repair-findings.test.ts`, `rigid-pose-path.ts`
  - `src/lib/requirements/contract-bridge.test.ts`
  - `src/lib/tools/__tests__/slider-crank.openscad.test.ts`
  - `src/app/api/jobs/[id]/assembly/evidence/route.ts`
  - `src/components/cad/workspace/AssemblyDetails.tsx`
  - `src/lib/i18n/zh-CN.json`

The conflict list is saved at `/tmp/merge-conflicts.txt` for this session; it is not a repository artifact.

## Merge strategy

Do **not** merge this branch into `main` directly. The 35 main-only commits and 170 branch-only commits overlap in product assembly code, bench documentation and tests.

Recommended path:

```bash
# 1. integrate main into the phase branch first
git switch continue/local-assembly-2026-11-18
git merge main            # resolve the 30 conflicts here

# 2. re-run the evidence gate on the integrated branch
bun run test
bun run test:openscad
bun run bench:all

# 3. after green, merge the phase into main
git switch main
git merge --no-ff continue/local-assembly-2026-11-18
```

Alternative: rebase the 170 branch commits onto `main`; that preserves a linear history but rewrites every commit and will require repeated conflict resolution. It is not recommended for an evidence branch.

## What this merge would include

- Twelve public bench families and their self-checks, now 90 cases.
- Hidden-set split for all twelve families (development copies only).
- Product-path A08 family: identity, topology, reconstruction, assembly path, disassembly path, eccentric fit and joint frames.
- Planetary, three-planet, shared-pin V8 carrier, threaded fastener geometry/exit and the earlier slider/gear/twin/vtwin/declaration families.
- English task prompts, new logs and family documentation; serial native suite including the A001 regression.

## What it does not include

- A connected-crankshaft V8. The current v8 family has four shared pins, no main shaft.
- Full A001 contract-gate pass for a multi-joint source. The confirmed-contract regression remains NOT_RUN by design.
- Independent hidden evaluation or fresh external model sampling. Hidden copies are `independent: false`.
- Physical function, manufacturing, torque, preload, wear or user acceptance.

## Open decision

Choose the integration path:

1. **Merge `main` into the phase branch, resolve conflicts, re-run all evidence, then merge the phase into `main`** (recommended).
2. Rebase the phase branch onto `main` and resolve conflicts per commit (rewrites 170 commits).
3. Open a review branch/PR where the merge conflicts are resolved and reviewed.

No merge has been executed; `main` remains at `2addffd`.
