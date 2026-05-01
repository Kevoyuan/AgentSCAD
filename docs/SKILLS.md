# AgentSCAD Skills

The CAD skills are the "fat" CAD judgment layer. The TypeScript/Python harness loads them as prompt contracts, then keeps rendering, validation, storage, and streaming in deterministic code.

## CAD Skill Map

| Skill | Role in the CAD pipeline | Paired deterministic code |
|---|---|---|
| `skills/scad-generation/` | Generates strict JSON with `summary`, compatibility parameter metadata, and complete `scad_source`. It owns CAD intent, printable defaults, top-level editable assignments, and artifact-first modeling rules. | `src/lib/harness/`, `src/lib/skill-resolver.ts`, `src/lib/pipeline/execute-cad-job.ts`, `src/lib/tools/scad-parameter-extractor.ts` |
| `skills/scad-repair/` | Repairs broken or failed OpenSCAD using structured validation feedback and CAD intent. Returns repaired SCAD plus risk/summary payload. Used by the auto-repair pipeline and manual repair route. | `src/lib/repair/repair-controller.ts`, `src/app/api/jobs/[id]/repair/route.ts`, `src/lib/tools/scad-renderer.ts` |
| `skills/scad-validation-review/` | Reviews render logs, artifacts, and validation results to decide whether a job can proceed, needs repair, or needs human review. | `src/lib/pipeline/execute-cad-job.ts`, `src/lib/tools/validation-tool.ts`, `scripts/validate_stl.py` |
| `skills/scad-visual-validate/` | Compares rendered previews against the user request to catch visible intent failures that mesh checks cannot see. | `src/lib/visual-validator.ts`, preview artifacts under `public/artifacts/{jobId}/` |
| `skills/scad-chat/` | Provides conversational CAD help, SCAD explanations, parameter advice, and user-facing SCAD patches outside the main generation pipeline. | `src/app/api/chat/route.ts`, CAD chat UI components under `src/components/cad/` |
| `skills/scad-improvement/` | Documents the feedback loop that learns from user edits, parameter drift, SCAD patches, validation failures, and repair outcomes. Uses structured observations and append-only JSONL for data safety. | `src/lib/improvement-analyzer.ts`, `src/lib/version-tracker.ts`, `skills/scad-generation/learned-observations.jsonl` |
| `skills/scad-library-policy/` | Decides which external OpenSCAD libraries may be used, enforces license gates, validates includes, and manages the approved library manifest. | `src/lib/tools/scad-library-resolver.ts`, `skills/scad-library-policy/scripts/*.py`, `skills/scad-library-policy/manifest.json` |
| `skills/scad-library-bosl2/` | Guidance for BOSL2-assisted rounded solids, chamfers, anchors, transforms, arrays, and higher-quality parametric geometry. | Runtime library resolver supplies exact `include <BOSL2/std.scad>` availability and renderer `OPENSCADPATH` |
| `skills/scad-library-round-anything/` | Guidance for Round-Anything sketch profiles, rounded extrusions, tabs, brackets, shells, and softened consumer-style parts. | Runtime library resolver supplies exact `use <Round-Anything/polyround.scad>` or equivalent availability |
| `skills/scad-library-mcad/` | Guidance for MCAD mechanical primitives, especially involute gears and established OpenSCAD mechanical helpers. | Runtime library resolver supplies exact MCAD include/use paths |
| `skills/scad-library-nopscadlib/` | Guidance for NopSCADlib electronics enclosures, vitamins, fans, boards, fasteners, and assembly-aware hardware. GPL-gated by policy. | Library installer/checker scripts and manifest license gates |
| `skills/scad-library-threads/` | Guidance for `threads.scad` or `threadlib` when generated parts need printable threaded holes, bolts, caps, or adapters. | Runtime library resolver ensures only one available thread library is used per artifact |

## Skill Boundary

Skills describe how the model should reason about CAD generation, repair, validation, manufacturing review, and library usage.

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
