# AgentSCAD Skills

The CAD skills are Markdown prompt contracts and reference material, not separately running autonomous agents. The TypeScript/Python harness loads the skills that are wired into a runtime path, while rendering, validation, storage, and streaming stay in deterministic code.

## CAD Skill Map

| Skill | Runtime status | Role and boundary | Paired code |
|---|---|---|---|
| `skills/scad-intake/` | Active for index-unknown requests | Produces bounded `MATCHED`, `AMBIGUOUS`, or `UNKNOWN` request intelligence before generation. Runtime code validates the model JSON and never treats malformed output as understanding. | `src/lib/intake/`, `src/lib/pipeline/execute-cad-job.ts` |
| `skills/scad-generation/` | Active | Main generation prompt contract for complete `scad_source` plus compatibility metadata. It receives evidence-matched local retrieval and bounded library guidance. Experimental learned context is off by default and unavailable in production. | `src/lib/harness/`, `src/lib/skill-resolver.ts`, `src/lib/pipeline/execute-cad-job.ts` |
| `skills/scad-repair/` | Active | Repairs SCAD using structured validation feedback and CAD intent. Used by automatic and manual repair paths. | `src/lib/repair/repair-controller.ts`, `src/app/api/jobs/[id]/repair/route.ts` |
| `skills/scad-visual-validate/` | Active, user-triggered | Compares previews with the request for the Visual Repair flow. It is not part of the default job pipeline, and its judgment is model evidence rather than deterministic geometry proof. | `src/lib/visual-validator.ts`, `src/app/api/jobs/[id]/visual-repair/route.ts` |
| `skills/scad-chat/` | Active | Conversational CAD/SCAD assistance outside the main generation path. | `src/app/api/chat/route.ts`, CAD chat UI under `src/components/cad/` |
| `skills/scad-validation-review/` | Reference only | Describes a model-based review policy, but the current pipeline does not load this skill. Delivery decisions currently come from TypeScript validation/repair orchestration. | `src/lib/pipeline/execute-cad-job.ts`, `src/lib/tools/validation-tool.ts` |
| `skills/scad-improvement/` | Reference only | Documents an intended feedback loop, but neither this skill nor automatic learned-observation writes run in the current job pipeline. Learned prompt injection is experimental, opt-in locally, and disabled in production. | `src/lib/improvement-analyzer.ts`, `skills/scad-generation/learned-observations.jsonl` |
| `skills/scad-library-policy/` | Active policy/tooling | Source of truth for approved libraries, pinned revisions, availability detection, include examples, and license gates. | `src/lib/tools/scad-library-resolver.ts`, policy scripts and manifest |
| `skills/scad-library-bosl2/` | Conditional | Injected only when the resolver confirms an approved BOSL2 installation. | Library resolver and renderer `OPENSCADPATH` |
| `skills/scad-library-round-anything/` | Conditional | Injected only when the approved Round-Anything library is resolvable. | Library resolver and renderer `OPENSCADPATH` |
| `skills/scad-library-mcad/` | Conditional | Injected only when the approved MCAD library is resolvable. | Library resolver and renderer `OPENSCADPATH` |
| `skills/scad-library-nopscadlib/` | Conditional, GPL opt-in | Available only after explicit GPL installation and resolver confirmation. | Library installer/checker and manifest license gates |
| `skills/scad-library-threads/` | Conditional | Injected only for an approved, resolvable thread library. | Library resolver and renderer `OPENSCADPATH` |

## Skill Boundary

Skills describe how a model should reason about CAD generation, repair, visual review, and library usage. A skill affects behavior only when a code path explicitly loads or injects it.

Code owns:

- OpenSCAD rendering.
- Artifact paths.
- Prisma writes.
- SCAD sanitization.
- SSE framing.
- File IO.
- Python/trimesh validation.
- Tests.

This split keeps CAD behavior editable while making runtime side effects explicit and testable.

## Current Gaps

- Intake has a deterministic index plus a bounded LLM fallback for previously unknown requests. Both deterministic and validated model-derived ambiguity use the same persisted user-approval gate. It does not yet expose a complete editable design-brief/constraint editor.
- Retrieval is keyword-based and has no benchmarked relevance score or trace in the normal UI. Unmatched requests now return no example/pattern instead of filesystem-order fallback.
- Learned observations are disabled by default and in production. The local opt-in still lacks an author-facing inspection or rollback control; see [Memory](./MEMORY.md).
- The visual reviewer is not an independent guarantee of semantic correctness. It now receives only the request and rendered pixels, not SCAD or generation rationale, and a repaired preview is evaluated again. Model judgment still remains explicitly separate from deterministic geometry evidence and user acceptance.
- Adding a directory under `skills/` does not activate it. Tests should assert every intended load site and fallback.
