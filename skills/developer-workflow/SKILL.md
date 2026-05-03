---
name: developer-workflow
description: Work safely on the AgentSCAD codebase, especially skill/docs changes around the CAD pipeline. Use when editing AgentSCAD skills, docs, resolver guidance, or orchestration-adjacent notes while preserving runtime contracts and avoiding unrelated code changes.
triggers:
  - work on codebase
  - edit skills
  - update resolver
  - developer workflow
---

# AgentSCAD Developer Workflow

Use this workflow for codebase work that touches AgentSCAD skills or documentation.

## First Read

1. Inspect `git status --short`.
2. Read the relevant skill or doc before editing.
3. If runtime behavior matters, read the route or helper that owns the contract, but do not edit it unless explicitly requested.

## Protected Contracts

Preserve these exactly unless the user explicitly requests a coordinated runtime change:

- SSE data frames: `data: ${JSON.stringify(payload)}\n\n`.
- State strings: `NEW`, `SCAD_GENERATED`, `RENDERED`, `VALIDATED`, `DELIVERED`, `DEBUGGING`, `REPAIRING`, `VALIDATION_FAILED`, `GEOMETRY_FAILED`, `RENDER_FAILED`, `HUMAN_REVIEW`, `CANCELLED`.
- Step strings: `starting`, `generating_llm`, `generating_mock`, `scad_generated`, `scad_applied`, `rendering`, `render_failed`, `rendered`, `validating`, `validation_failed`, `validated`, `delivering`, `delivered`.
- Artifact paths: `/artifacts/{jobId}/model.scad`, `/artifacts/{jobId}/model.stl`, `/artifacts/{jobId}/preview.png`, optional `/artifacts/{jobId}/report`.
- Generation JSON: `summary`, `parameters`, `scad_source`.
- Parameter fields: `key`, `label`, `kind`, `unit`, `value`, `min`, `max`, `step`, `source`, `editable`, `description`, `group`.
- Validation fields: `rule_id`, `rule_name`, `level`, `passed`, `is_critical`, `message`.
- Provider fallback: MiMo when configured, then ZAI SDK, then template generation.
- Rendering and validation: OpenSCAD CLI renders artifacts; Python/trimesh validates STL with mock fallback.
- Keep deterministic behavior in TypeScript/Python tools, not prompts.

## Skill Writing

- Keep `SKILL.md` concise and task-oriented.
- Include YAML frontmatter with `name` and `description`.
- Put trigger guidance in the description.
- Prefer imperative workflow instructions over broad background.
- Do not duplicate large source snippets when a short contract summary is enough.

## Editing Rules

- Do not revert other people's edits.
- Keep changes scoped to requested files.
- Avoid touching `src/`, package files, Prisma files, or existing CAD skills unless explicitly authorized.
- Use deterministic tests and wrapper tools instead of guessing about runtime behavior.
- After edits, verify with `git diff --stat` and inspect the changed files.
