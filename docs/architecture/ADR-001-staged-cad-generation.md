# ADR-001: Checkpointed Plan–Code–Validate CAD Generation

- Status: Accepted
- Date: 2026-08-13

## Context

AgentSCAD previously asked one model response to interpret geometry, produce planning metadata, define validation targets, emit parameter metadata, and write complete OpenSCAD. Large prompts and outputs made generation slow, and a request timeout discarded useful planning work.

Multi-Agent-CAD demonstrates a staged contract between specification, geometry planning, coding, and QA. AgentSCAD already has deterministic intake, OpenSCAD rendering, validation, and repair, so adopting a separate graph runtime would duplicate the existing state machine and increase operational complexity.

## Decision

Keep the modular-monolith pipeline and introduce a persisted, fingerprinted generation-plan checkpoint between intake and code generation:

1. Build a compact generation plan deterministically from approved request intelligence and the editable parameter schema.
2. Persist the plan before the model coding request.
3. Give the coding model only the approved plan, relevant library guidance, retrieved examples, and editable parameters; require only a complete SCAD artifact in response.
4. Reuse the checkpoint after a timeout only when its fingerprint matches the request, approved interpretation, family, and parameter values.
5. Continue using deterministic compile/render/validation evidence and the existing compact validation-driven repair controller.

## Consequences

- Coding prompts and outputs are smaller and stage responsibilities are observable.
- Timed-out coding can resume without repeating planning.
- Stale plans are rejected when user inputs change.
- No new database table, orchestration service, or sequential planner-model call is required.
- The deterministic plan is intentionally conservative; future model-based architecture planning can be added behind a bounded stage without changing the persisted contract.
