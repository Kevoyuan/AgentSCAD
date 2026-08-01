# AgentSCAD Skill Resolver

Use this resolver to choose the smallest SCAD skill needed for a job. Keep the runtime a thin harness: route requests, preserve contracts, and let skills carry CAD reasoning.

## Routing

| Situation | Skill |
|---|---|
| Interpret or classify a request before generation | `skills/scad-intake/SKILL.md` |
| Generate a new CAD artifact from a user request | `skills/scad-generation/SKILL.md` |
| Repair invalid or failed OpenSCAD while preserving intent | `skills/scad-repair/SKILL.md` |
| Review validation output, logs, previews, or artifacts | `skills/scad-validation-review/SKILL.md` |
| Explain or modify SCAD conversationally | `skills/scad-chat/SKILL.md` |
| Compare rendered preview to design intent | `skills/scad-visual-validate/SKILL.md` |
| Decide when OpenSCAD libraries may be used | `skills/scad-library-policy/SKILL.md` |
| Use BOSL2 helpers in generated OpenSCAD | `skills/scad-library-bosl2/SKILL.md` |
| Use NopSCADlib helpers in generated OpenSCAD | `skills/scad-library-nopscadlib/SKILL.md` |
| Use Round-Anything helpers in generated OpenSCAD | `skills/scad-library-round-anything/SKILL.md` |
| Use MCAD helpers in generated OpenSCAD | `skills/scad-library-mcad/SKILL.md` |
| Use threads.scad or threadlib helpers in generated OpenSCAD | `skills/scad-library-threads/SKILL.md` |
| Improve generation from user edits | `skills/scad-improvement/SKILL.md` |
| Work on the codebase or docs safely | `skills/developer-workflow/SKILL.md` |

## Runtime Contracts

Do not change these contracts from skill content:

- SSE frames are emitted as `data: ${JSON.stringify(payload)}\n\n`.
- Job state strings include `NEW`, `SCAD_GENERATED`, `RENDERED`, `VALIDATED`, `DELIVERED`, `DEBUGGING`, `REPAIRING`, `VALIDATION_FAILED`, `GEOMETRY_FAILED`, `RENDER_FAILED`, `HUMAN_REVIEW`, and `CANCELLED`.
- Process step strings include `starting`, `analyzing_intent_llm`, `intent_analysis_degraded`, `intent_analyzed`, `intent_clarification_required`, `generating_llm`, `generating_mock`, `scad_generated`, `rendering`, `render_failed`, `rendered`, `validating`, `validation_failed`, `validated`, `repairing`, `repair_rendering`, `repair_render_failed`, `repair_partial`, `repair_success`, `repair_error`, `delivering`, `delivered`, and `error`.
- Manual SCAD apply also uses `scad_applied` before the same render/validate/deliver steps.
- Artifact paths are public URLs rooted at `/artifacts/{jobId}/`: `model.scad`, `model.stl`, `preview.png`, and optional `report`.
- `validationResults` is an array of objects with `rule_id`, `rule_name`, `level`, `passed`, `is_critical`, and `message`, plus optional `status` (`PASS|WARN|FAIL|SKIP|ERROR|NOT_RUN`). Unexecuted or unavailable checks are never counted as passed.
- SCAD generation remains JSON-compatible with `summary`, `parameters`, and `scad_source`, but `scad_source` is the source of truth.
- Editable numeric parameters must exist as top-level OpenSCAD assignments before geometry. Deterministic tools may parse them into `ParameterDef[]`.
- Each parameter object keeps `key`, `label`, `kind`, `unit`, `value`, `min`, `max`, `step`, `source`, `editable`, `description`, and `group`.
- Rendering uses native OpenSCAD or the isolated official WASM CLI to produce STL; serverless preview code projects the STL to PNG.
- Mesh validation uses Python/trimesh when available. When it is unavailable, affected mesh rules are `SKIP`; unavailable checks are never mocked as passing.
- Model routing uses an explicitly configured provider/model first, then matching OpenRouter or DeepSeek routes, then MiMo when enabled. Text-only requests may fall back to `z-ai-web-dev-sdk`; visual requests may not. After generation failure, only supported known part families may use template generation.

## Guardrails

- Prefer adding or refining skills/docs over widening orchestration code.
- Prefer approved OpenSCAD libraries when the runtime reports them available.
- Treat `skills/scad-library-policy/manifest.json` as the source of truth for approved OpenSCAD libraries, license gates, pinned install commits, detection files, and include examples.
- Keep managed OpenSCAD libraries outside the repo by default at `~/.agentscad/openscad-libraries`.
- Do not install GPL libraries by default; GPL libraries require explicit opt-in and preserved license notices.
- Never copy third-party library source into generated SCAD or this repository without explicit human licensing review.
- Never rename state strings, step strings, artifact filenames, or validation fields casually; the UI and job recovery depend on them.
- Treat learned patterns as optional context, not hard constraints.
- Do not solve novel CAD quality by hardcoding every product. Use skills for design policy and tools for artifact parsing, validation, render feedback, and repair loops.
