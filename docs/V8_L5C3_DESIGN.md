# L5c-3 design note: V8 with eight independent throws and closed cylinder bores

Status: **implemented as `bench/v8/tasks/v8-bored-8.json` (contract v6)**. This note records
why the L5c-1 carrier cannot grow closed cylinder bores, the measured negative result that
forced the mechanism change, and the shipped contract-v6 layout. Deviations from the first
draft: the crank uses main journals **between** the throw webs instead of a continuous
shaft (a continuous shaft passes through the rod planes and collided with a rod body);
bore rays are cast at slider centre + 2 mm (the exact bore start plane is a grazing,
coplanar case); bore gap band is 0.15–0.6 mm and head gap band 1.5–6.0 mm; head clearance
is scored by the minimum sampled gap (retracted pistons legitimately have larger gaps).

## 1. Why the current task cannot close the bores

L5c-1 (`bench/v8` task 2, contract v5) has four shared crankpins with two rods per pin
and sliders at `station ± 3 mm`. A full circular bore around a slider therefore has a
lateral y radius of 12 mm while the neighbouring rod plane is only 2–10 mm away. Two
layouts were tested in `2026-11-21 · Negative result: full circular cylinder guide tubes`
and both were rejected by the sampled collision check (680/765 and 685/765 separated,
`frame/crank` then `frame/rod*` intersections). A full bore needs a mechanism where each
slider owns its own y band wide enough for the bore wall.

## 2. Mechanism contract v6 (proposed)

New task `v8-bored-8` in `bench/v8`, added alongside the two existing tasks (no existing
threshold changes):

- 8 independent throws at `y_k = -91 + 26*k` for k = 0..7 (spacing 26 mm, so adjacent
  bore tubes with outer radius 12 mm keep a 2 mm gap);
- banks alternate by instance: even k on the `+45°` bank, odd k on the `-45°` bank;
- phases: `[0, 90, 180, 270, 45, 135, 225, 315]` degrees (deterministic phase schedule
  for measurement attribution, not a claimed firing order);
- crank radius 8 mm, rod length 28 mm, slider tolerance 0.1 mm, five angles
  0/90/180/270/360°;
- 18 instances: frame, crank, 8 rods, 8 sliders.

Crank: one main shaft along y (`r = 2 mm`, `y = ±98`), one r2 pin per throw (length 6),
two r2.5 web hulls per throw at `y_k ± 4`, all unioned into one connected crank.

Block (one connected frame):

- base plate `[32, 210, 3]` at `z = -20`;
- 8 bores along the bank axes: outer r12 from bank radius 20 to 46, inner r10.1 removed
  from 19 to 45, leaving a **1 mm head cap** at the outboard end; inner clearance over the
  9.75 mm slider is 0.35 mm radially;
- one head rail per bank at bank radius 45–47, 14 mm lateral half-width, spanning y ±100,
  tying all four bore caps of that bank;
- two main-bearing plates at `y = ±98` with a journal bore of r2.2 around the shaft, a
  top rail tying them (z 21–23) and the base plate, and four outboard columns
  (`x = ±42`, `y = ±96`) with bottom arms into the base plate.

## 3. Scored measurements (all bench-side, no new production code)

| Requirement | Measurement | Band |
|---|---|---|
| `distinct-exported-parts` | 18 distinct part hashes | 18 |
| `part-connectivity` | exact STL edge connectivity of the crank | PASS |
| `frame-connectivity` | exact STL edge connectivity of the block | PASS |
| `bearing-fit` | shared cylindrical-section fit at y = ±98: plate bore r2.2 vs journal r2 | 0.2–0.6 mm diametral, axis offset ≤0.3 mm |
| `bore-fit` | `measureRevoluteFit` per cylinder: block bore inner r10.1 vs slider r9.75 at the slider centre radial station | 0.4–1.0 mm diametral, axis offset ≤0.5 mm |
| `head-clearance` | for each angle, slider maximum bank-radius against the nearest cap/rail face in the lateral window | 3.0–6.0 mm, all 40 samples |
| `rigid-motion` / `source-motion` | measured slider centres against the per-instance closure formula | 0.1 mm |
| collision (not a requirement) | 153 instance pairs per angle, 765 total | separated |

The scorer needs one extension: `contract.instances: [{ yMm, bankDeg, phaseDeg } × 8]`
selects the per-instance formula; when absent the existing four-station shared-pin
formula is retained unchanged. `expectedV8Center` gains an instance-index entry point;
the old call sites keep their behaviour.

## 4. Adversarial cases

- `adversarial-no-bores`: block without bores/rails (still connected via base, plates and
  top rail) → only `bore-fit` and `head-clearance` NOT_RUN;
- `adversarial-oversized-bore`: inner r10.6 → only `bore-fit` FAIL;
- `adversarial-cap-too-close`: head cap inner face at bank radius 42 → sampled
  `head-clearance` 1.9 mm, only that layer FAIL while collisions stay separated;
- `adversarial-disconnected-crank`: remove one main-shaft segment → only
  `part-connectivity` FAIL;
- `reference`: all of the above PASS.

## 5. Validation plan and cost

1. Reference geometry: single-submission scorer iterations (~3–5 min each) until
   collisions are separated. Bores use `$fn = 48` and are built as two boolean
   differences to keep render cost bounded.
2. Task/self-check: add the task, five submissions; v8 family self-check expected
   ~50–70 minutes on an idle host because the block is heavier than contract v5.
3. Full `bench:all` gate rerun (current gate already takes ~2–3 hours under the observed
   host load); records updated in the same change.
4. Do not weaken any existing v8 task, threshold or adversary. The v6 task is additive.

## 6. Boundaries

- Closed bores and a head cap are not a cylinder head with valves, ports, camshafts or a
  firing order; no combustion, thermal, lubrication, load or wear claim.
- Phase schedule is a deterministic bench contract for measurement attribution, not an
  engine firing-order claim.
- Bore-fit and head-clearance are sampled mesh measurements, not calibrated metrology or
  manufacturing tolerance.
- The reference is researcher-authored fixture geometry; autonomous model generation of
  this task is not measured by it.
- A physical/manufactured V8 remains NOT_RUN and is outside this rung.
