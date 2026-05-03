# AgentSCAD Memory

AgentSCAD uses explicit product memory instead of opaque chat history.

## Memory at a Glance

- **Working memory**: current job state, request, parameters, SCAD source, artifacts, validation results, and logs.
- **Episodic memory**: field-level `JobVersion` history for parameter, source, and note edits.
- **Artifact memory**: generated `model.scad`, `model.stl`, `preview.png`, and reports under `public/artifacts/{jobId}/`.
- **Skill memory**: Markdown CAD skills, schemas, library policy, and in-process skill/schema caches.
- **Learned memory**: structured numerical observations extracted from user edits, validation failures, and repair outcomes. Pipeline-triggered writes, append-only JSONL, prompt injection defense on user content.

Learned memory is used as prompt-time guidance, not as an override for rendering or validation.

## v3.0 Improvements

Observations are structured numerical data, stored in append-only JSONL for data safety, and written automatically by the pipeline on job completion and validation events.

Source trust levels (`user_edit > repair_success > validation_pattern`) give higher confidence to user-driven changes. Prompt injection defense sanitizes user-sourced SCAD content before it enters the generation prompt.

Quality metrics such as delivery rate and repair rate close the feedback loop: the system knows not just what users change, but whether those changes lead to successful deliveries.
