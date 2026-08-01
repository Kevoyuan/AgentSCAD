# AgentSCAD Memory

AgentSCAD has several persisted data layers, but only some of them should currently be called reliable product memory.

## Current Memory Layers

| Layer | Current source | Reliability boundary |
|---|---|---|
| Job/working state | Prisma `Job` records | Current request, state, parameters, SCAD, artifact paths, validation results, and logs. |
| Edit history | Prisma `JobVersion` records | Field-level history for parameter, source, and note edits. This is history, not automatically a quality label. |
| Artifact history | Local `public/artifacts/{jobId}/` or durable Blob storage | SCAD/STL/PNG availability. Artifact existence does not prove semantic correctness or user acceptance. |
| Static skill knowledge | `skills/`, `cad_knowledge/`, `openscad_lib/` | Reviewed prompt contracts, examples, patterns, library policy, and deterministic library documentation. |
| Learned observations | `skills/scad-generation/learned-observations.jsonl` | Experimental local prompt context; see the warnings below. |

## Experimental Learned Observations

`src/lib/improvement-analyzer.ts` can append parameter drift, feature gap, validation failure, and SCAD-edit observations to one repository-local JSONL file. `src/lib/skill-resolver.ts` may then inject family-matched observations into generation prompts.

This path is **not yet a trustworthy continuous-learning system**:

- observations are global to the local checkout and are not scoped by browser session, project, owner, provider, model, or skill version;
- serverless writes are intentionally disabled because no private durable observation store is configured;
- `DELIVERED` currently means that artifacts became available, not that the user accepted the design;
- generated defaults, repair outcomes, and validation failures can be recorded without a confirmed semantic success label;
- family matching is coarse, so unrelated design intent can contaminate later prompts;
- prompt injection is now off by default; production cannot enable it, and local development requires the explicit `AGENTSCAD_MEMORY_PROMPT_ENABLED=true` escape hatch. There is still no author-facing observation inspection/quarantine/rollback workflow;
- sanitizing short text for common prompt-injection phrases reduces one risk but does not establish provenance or correctness.

For those reasons, learned observations must not be presented as “each iteration makes the system smarter,” and delivery/repair rates must not be treated as user satisfaction. Deterministic rendering and validation remain authoritative for measurable geometry facts; human acceptance remains separate.

## Safe Target Contract

The corrective design is outcome-first:

1. Keep learned prompt memory disabled by default; do not enable the local experimental switch for quality claims until inspection/quarantine/rollback exists.
2. Store immutable run context: request/brief revision, model/provider, prompt/skill/retrieval versions, artifacts, and validation evidence.
3. Record explicit outcome events such as user acceptance, rejection, or a user-authored edit separately from pipeline states.
4. Scope observations to the relevant project/intent/family and retain provenance.
5. Promote a pattern only after enough independent, accepted examples; support quarantine and rollback.
6. Never allow memory to override OpenSCAD compilation or deterministic validation results.

Pipeline validation and delivery no longer write learned observations. Until the outcome contract is implemented, use job history and artifacts for debugging, static skills for reviewed knowledge, and the existing JSONL path only as quarantined experimental local data.
