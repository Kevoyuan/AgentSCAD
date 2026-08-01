# AgentSCAD Evaluation and Benchmarking

AgentSCAD uses tagged evidence instead of inferred booleans:

```ts
type EvidenceStatus = "PASS" | "FAIL" | "SKIP" | "ERROR" | "NOT_RUN";
```

A fact can be `PASS` only when the named tool actually ran and attached its observed value. Missing required evidence fails the case gate without being rewritten into a fake pass.

## Current Commands

| Command | Current behavior |
|---|---|
| `bun run cad:eval:fast` | Runs the five simple offline dev fixtures. It exercises fixture parsing, part-family detection, schema loading, and retrieval only. |
| `bun run cad:eval` | Runs dev fixtures plus frozen regression cases. It exits nonzero while any frozen requirement is `FAIL`, `ERROR`, `SKIP`, or `NOT_RUN`. |
| `bun run cad:eval:case <id>` | Runs one case and prints its expected contract, observed evidence, retrieval, artifact statuses, baseline status, timings, and usage. |
| `bun run cad:eval:report` | Parses the canonical JSON evidence in `benchmark-results.txt` and preserves the previous gate exit status. It never converts missing evidence into zero or pass. |
| `bun run cad:eval:render` | Runs one fixed real OpenSCAD WASM fixture, validates the binary STL, measures its bounding box, checks the PNG artifact, and writes `benchmark-render-results.json`. It makes zero model calls. |
| `bun run test:wasm` | Runs real checksum-pinned OpenSCAD WASM integration checks. |
| `OPENSCAD_BIN=openscad bun run test:openscad` | Runs the configured native OpenSCAD integration checks. |

`--model` is rejected by the offline runner because it would imply a model comparison while making no model call. An explicit online evaluator will be added separately.

## Planetary-Engine Frozen Case

```bash
bun run cad:eval:case planetary-engine-ambiguity
```

The checked-in case requires the product intake to return `AMBIGUOUS`, expose both of these interpretations, and ask the exact high-information question:

- science-fiction planetary propulsion megastructure;
- planetary-gear motor/reduction mechanism;
- `你指的是行星推进用的科幻巨型发动机，还是行星齿轮电机/减速机构？`

It forbids silently assuming printability, cutaway style, tower count, or Functional/Concept mode.

The command currently exits `0` with `intent_ambiguity=PASS`. It invokes the same deterministic `analyzeCadRequest()` implementation used by the real job pipeline, then compares its observed status, ordered interpretations, clarification question, and assumptions with the frozen contract. Expected fixture values and observed product output remain separate in the report.

## Evidence Boundary

Offline evaluation currently records real evidence for:

- fixture parsing and fixture SHA-256;
- the observed part-family result;
- schema loading and parameter count;
- exact names returned by local retrieval;
- request-intelligence status, interpretations, clarification question, and assumptions when a fixture defines that contract;
- per-stage and total harness timing.

Offline evaluation records the following as `NOT_RUN`:

- model generation, token use, and quality;
- SCAD compilation;
- STL/mesh validity;
- measured bounding boxes;
- rendered views and visual fidelity;
- baseline diffs without a matching stored baseline.

The report includes evaluator schema, commit, runtime/platform profile, fixture provenance, case/evidence status counts, timings, artifact status, model-call count, and cost. It intentionally excludes machine hostname and provider secrets.

## Real Render Benchmark

```bash
bun run cad:eval:render
```

This is the bounded, deterministic CAD backend gate. It compiles a fixed parametric washer with the checksum-pinned WASM runtime, parses the actual binary STL triangle table, verifies finite vertices, measures a `20 × 20 × 2 mm` bounding box with an explicit `0.25 mm` per-axis tolerance, and checks the PNG signature. The JSON report contains artifact hashes, byte sizes, runtime provenance, timing, and zero LLM calls/tokens/cost.

The command deliberately reports `manifold_mesh=NOT_RUN` and `visual_fidelity=NOT_RUN`: finite STL structure is not a watertightness proof, and an existing preview is not evidence of semantic similarity. Use mesh-validator integration and a separately declared online visual evaluation for those claims.

## Interpreting Gates

1. `PASS` means every required fact for that case passed.
2. A required `NOT_RUN`, `SKIP`, `ERROR`, or `FAIL` makes the command exit nonzero.
3. Informational geometry facts may remain `NOT_RUN` in offline fixtures without failing those dev fixtures.
4. A model, OpenSCAD backend, or visual evaluator may be compared only in a mode that really invokes it and retains artifact evidence.
5. Never use offline harness results as compile, mesh, bbox, manufacturing, semantic-fidelity, or model-quality percentages.

## Evaluation Layers

- deterministic intelligence/retrieval fixtures under 10 seconds: implemented by `cad:eval:*`;
- one real OpenSCAD WASM case under 2 minutes: implemented by `cad:eval:render`;
- explicit online generation/evaluation with provider/model, prompts and skills, SCAD/STL/views, validation evidence, baseline diff, stage timings, calls/tokens, and cost: still intentionally separate and not implied by either offline command.
