# AgentSCAD Skill Resolver

Use this resolver to choose the smallest SCAD skill needed for a job. Keep the runtime a thin harness: route requests, preserve contracts, and let skills carry CAD reasoning.

## Routing

| Situation | Skill |
|---|---|
| Interpret or classify a request before generation | `skills/scad-intake/SKILL.md` |
| Choose a modeling approach from the persisted request evidence | `skills/scad-planning/SKILL.md` |
| Turn a persisted request-evidence contract into complete OpenSCAD | `skills/scad-coding/SKILL.md` |
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
- Model routing uses an explicitly configured provider/model first, then matching OpenRouter or DeepSeek routes, then MiMo when enabled. Text-only requests may fall back to `z-ai-web-dev-sdk`; visual requests may not. Known and unknown families both use LLM generation; legacy templates require the explicit demo-only `AGENTSCAD_TEMPLATE_FALLBACK=true` switch.

## Guardrails

- The current pipeline persists a versioned request-evidence contract, then loads `scad-planning` and `scad-coding` together for one model call. `scad-generation` serves the unplanned generation path. `scad-validation-review` is guidance for review requests and is not currently called by the job pipeline.
- The persisted contract records stated features, dimensions, assumptions, constraints, and acceptance criteria. Empty modeling fields do not authorize a default geometry strategy.
- Core model-stage skills declare `version`, `when_to_use`, `when_not_to_use`, and `required_inputs` in frontmatter. Keep `skills/manifest.json` in sync with every `SKILL.md`; the registry test enforces this.
- Generated artifacts record an `instruction_fingerprint` for the assembled system instruction bundle. It includes selected retrieval and available-library guidance, so it identifies the actual instructions used for that run rather than a single global skill release.
- `validation_targets` may carry explicit requirements such as `allow_multiple_components`, `expected_component_count`, and `manufacturing_mode`. Deterministic validators read these instead of assuming every request is a single FDM-printable solid. Unstated requests keep the strict single-body, FDM defaults.
- Each delivered build records an immutable `JobArtifactVersion` (SCAD hash, source, artifact copies, validation results, instruction fingerprint, model execution). Accept, reject, edit, and export events link to the version that was current when they happened, so acceptance never silently transfers to a later build.

- Prefer adding or refining skills/docs over widening orchestration code.
- Prefer approved OpenSCAD libraries when the runtime reports them available.
- Treat `skills/scad-library-policy/manifest.json` as the source of truth for approved OpenSCAD libraries, license gates, pinned install commits, detection files, and include examples.
- Keep managed OpenSCAD libraries outside the repo by default at `~/.agentscad/openscad-libraries`.
- Do not install GPL libraries by default; GPL libraries require explicit opt-in and preserved license notices.
- Never copy third-party library source into generated SCAD or this repository without explicit human licensing review.
- Never rename state strings, step strings, artifact filenames, or validation fields casually; the UI and job recovery depend on them.
- Treat learned patterns as optional context, not hard constraints.
- Do not solve novel CAD quality by hardcoding every product. Use skills for design policy and tools for artifact parsing, validation, render feedback, and repair loops.
