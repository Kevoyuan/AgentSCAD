# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operational Safety Checks

- BEFORE executing any command, ALWAYS confirm the working directory (`pwd`) and list the project root context. Verify git remotes (`git remote -v`) are correct before pushing.

## Core Instructions

- Whenever asked to perform a common development task (commit, deploy, test, run, retro, document release, investigate), follow this order:
  1. List skill directories in `~/.claude/skills/` and `.claude/skills/`.
  2. If a matching skill exists, read its SKILL.md and execute it.
  3. Only if no skill matches, fall back to a generic approach.
  4. Record the result so you learn for next time.

## Commands

| Task | Command |
|---|---|
| Dev | `bun run dev` |
| Dev compatibility alias | `bun run dev:all` (currently the same Next.js process) |
| Build for production | `bun run build` |
| Start production server | `bun run start` |
| Author preflight | `bun run doctor` |
| Lint | `bun run lint` |
| Test | `bun run test` |
| Test OpenSCAD WASM runtime | `bun run test:wasm` |
| Audit dependency licenses | `bun run license:audit` |
| Check OpenSCAD libraries | `bun run scad:libs:check` |
| Install default OpenSCAD libraries | `bun run scad:libs:install` |
| Install GPL OpenSCAD libraries explicitly | `bun run scad:libs:install:gpl` |
| Sync DB schema to SQLite | `bun run db:push` |
| Generate Prisma client | `bun run db:generate` |
| Run DB migrations | `bun run db:migrate` |
| Reset DB | `bun run db:reset` |
| Run offline CAD harness fixtures | `bun run cad:eval` |
| Run simple offline fixtures | `bun run cad:eval:fast` |
| Run one evidence case | `bun run cad:eval:case <id>` |
| Parse last harness report as JSON | `bun run cad:eval:report` |
| Run real deterministic WASM render benchmark | `bun run cad:eval:render` |

Tests use Bun's built-in test runner. Run `bun run test` before handing off CAD pipeline or skill resolver changes.

The offline evaluator uses `PASS|FAIL|SKIP|ERROR|NOT_RUN` evidence and never marks unexecuted geometry facts as passing. It does not call an LLM or OpenSCAD; treat it as intent/schema/retrieval evidence, not compile, mesh, bbox, semantic-quality, or model-comparison evidence. `cad:eval:render` is a separate real WASM compile/STL/bbox/PNG gate and still does not imply manifold, visual, or model quality. `cad:eval` includes frozen regressions; `cad:eval:fast` is the smallest offline smoke suite.

## Git Workflow

When committing changes, follow this workflow without skipping any step:

1. Categorize all changed files into logical groups (e.g., deps, refactoring, bug fixes, feature work, docs).
2. Present the commit plan to the user for approval.
3. Run `bun run lint && bun run test` on the changed files.
4. Only after the user approves the plan and tests pass, execute the commits one by one with descriptive messages.

## Architecture

**AgentSCAD** is a local-first, open-source parametric CAD web app. It has no account system. Users configure their own model provider/API key, submit natural-language descriptions, and receive editable OpenSCAD plus rendered STL/PNG artifacts and validation evidence. Local development stores jobs in SQLite, artifacts on the local filesystem, and custom provider settings in `.agentscad/providers.json`.

OpenSCAD is the core CAD execution engine. Local development can use the native CLI; serverless and explicit `AGENTSCAD_OPENSCAD_BACKEND=wasm` runs use the checksum-pinned official OpenSCAD WASM CLI. LLMs handle request interpretation, SCAD generation, repair, chat, and optional visual review. Deterministic code remains authoritative for compiling/rendering geometry and checking measurable mesh/manufacturing facts.

### Core Pipeline

`src/app/api/jobs/[id]/process/route.ts` is a thin HTTP/SSE adapter. It validates the job exists, checks the state is processable, emits raw SSE frames, and calls `executeCadJob`.

`src/lib/pipeline/execute-cad-job.ts` owns the current runtime state machine:

1. **INTAKE** — analyze the deterministic intent index first; index-unknown requests get one bounded model intake whose untrusted JSON is validated. Any supported ambiguity is persisted and moves to `HUMAN_REVIEW`; the UI records the user's selected meaning before continuing.
2. **GENERATE** — the selected/configured LLM generates structured CAD intent and complete OpenSCAD. The current fallback is template generation for four known families (spur_gear, device_stand, electronics_enclosure, phone_case).
3. **RENDER** — native OpenSCAD or the isolated WASM child process renders SCAD to STL; the serverless preview path projects the STL to PNG.
4. **VALIDATE** — deterministic rules inspect compile/render evidence, dimensions, connectivity, holes, wall thickness, and mesh facts. Visual review is a separate user-triggered VLM path.
5. **DELIVER** — SCAD, STL, PNG, parameters, and validation reports are available. `DELIVERED` does not prove that the artifact matches the user's intent or that the user accepted it.

Each step emits SSE events to the requesting frontend. The broader workspace refreshes job data through polling; there is no separate WebSocket service in the current repository.

### Thin Harness, Fat Skills Rules

- Keep CAD reasoning, repair strategy, validation interpretation, and manufacturing judgment in `skills/`.
- Keep deterministic work in code: OpenSCAD rendering, Python/trimesh validation, Prisma writes, artifact paths, SCAD sanitization, SSE formatting, polling adapters, file IO, and tests.
- Preserve runtime contracts unless a migration explicitly updates the frontend and tests: SSE `data: ${JSON.stringify(payload)}\n\n`, existing state strings, existing step strings, `/artifacts/{jobId}/model.stl`, `/artifacts/{jobId}/preview.png`, and the legacy `validationResults` fields `rule_id`, `rule_name`, `level`, `passed`, `is_critical`, `message`. Results may add explicit `status` (`PASS|WARN|FAIL|SKIP|ERROR|NOT_RUN`); skipped/unavailable checks must not be counted as passed.
- Preserve model routing behavior: an explicitly configured provider/model first, then built-in OpenRouter/DeepSeek/MiMo routing where applicable, then `z-ai-web-dev-sdk`; template generation remains the pipeline fallback when model generation fails.
- Prefer wrappers and adapters over route rewrites. The process route should become thinner gradually, only after behavior-preserving tools are proven.
- Prefer artifact-first CAD architecture: generate or repair complete OpenSCAD, then let deterministic tools parse parameters from top-level SCAD assignments. Do not make hidden JSON-only parameters the source of truth.
- Improve CAD quality through general library support, render feedback, and repair loops rather than hardcoded product-family geometry.
- Do not copy third-party CAD app or library source code into this repository without explicit licensing review.
- Keep approved OpenSCAD library policy in `skills/scad-library-policy/manifest.json`, not hardcoded route logic.
- Managed OpenSCAD libraries live outside the repo at `~/.agentscad/openscad-libraries` by default. `AGENTSCAD_OPENSCAD_LIBRARY_DIR` overrides it; legacy `CADCAD_OPENSCAD_LIBRARY_DIR` is still accepted.
- Use `OPENSCAD_LIBRARY_PATHS`/`OPENSCADPATH` only for additional reviewed local OpenSCAD library parent directories.
- Default library installation must not include GPL libraries. NopSCADlib requires explicit opt-in through `bun run scad:libs:install:gpl`.
- Keep `src/app/api/jobs/[id]/process/route.ts` as a thin HTTP/SSE adapter. Put CAD job state-machine work in `src/lib/pipeline/execute-cad-job.ts` or lower-level tools.

### API Layer

Next.js Route Handlers under `src/app/api/`:
- `jobs/` — CRUD, batch operations, pipeline processing, SCAD editing, versioning
- `chat/` — LLM chat with SSE streaming
- `models/` — configured models plus 50 recommendations across 21 provider presets
- `providers/` — provider configuration, encrypted browser-session storage on Vercel, and connection testing
- `health/` — health check

### Frontend

`src/components/cad/workspace/MainWorkspace.tsx` is the central UI — a 3-panel IDE-like layout:
- **Left**: Job list with drag-and-drop reordering
- **Center**: 3D viewer (Three.js/R3F) + pipeline status
- **Right**: 6-tab inspector (SPEC, PARAMETERS, ASSIST, VALIDATION, HISTORY, CODE)

Key client files:
- `src/components/cad/api.ts` — client-side API functions + SSE streaming helpers
- `src/components/cad/types.tsx` — job types, state colors, pipeline step definitions

### Persistence and Realtime

- Prisma ORM uses SQLite locally (`DATABASE_URL`, default `db/dev.db`). The current canonical schema has `Job` and `JobVersion` models.
- Rendered artifacts use local files in normal local development and Vercel Blob in serverless deployments.
- Browser requests receive an opaque HttpOnly job-session cookie for isolation. This is not an account or user-management system.
- Active process progress uses SSE; workspace list refresh uses polling. No standalone WebSocket or mini-service runtime exists in the current tree.

### LLM Integration

- `src/lib/mimo.ts` — Xiaomi MiMo API client (OpenAI-compatible format)
- `src/lib/openrouter.ts` — OpenRouter API client (defaults to GPT-5.6 Sol)
- `src/lib/provider-catalog.ts` — source of truth for provider presets and recommended model metadata
- `src/lib/tools/model-router.ts` — Routes requests to MiMo, OpenRouter, DeepSeek, or fallback
- User-configured OpenAI-compatible providers are the primary product path; environment presets and `z-ai-web-dev-sdk` provide compatibility/fallback paths.

### OpenSCAD Library Bundle

- `skills/scad-library-policy/manifest.json` is the source of truth for approved libraries, pinned commits, detection files, include examples, and license gates.
- `skills/scad-library-policy/scripts/install_scad_libraries.py` installs the managed local bundle.
- `skills/scad-library-policy/scripts/check_scad_libraries.py` reports what OpenSCAD can currently resolve.
- `skills/scad-library-policy/scripts/validate_scad_includes.py` validates generated `include`/`use` statements against approved and available libraries.
- `src/lib/tools/scad-library-resolver.ts` reads the manifest and runtime paths, then injects only available library skill guidance into generation prompts.

### v2.0 Module Structure

**Content directories** (repo root, not source code):
- `cad_knowledge/examples/` — reference SCAD files injected into generation prompts via keyword retrieval
- `cad_knowledge/patterns/` — design pattern docs (hole patterns, brackets, enclosures, printable rules)
- `cad_knowledge/failures/` — common failure mode docs for repair guidance
- `openscad_lib/agentscad_std.scad` — standard library (11 modules), pure OpenSCAD with optional BOSL2
- `openscad_lib/README.md` — module reference, doubles as LLM prompt injection content

**Source directories** (`src/lib/`, compiled TypeScript):
- `src/lib/retrieval/example-retriever.ts` — keyword-based local example retrieval (zero-token)
- `src/lib/validation/validation-types.ts` — `ValidationCheck`, `ValidationReport`, `RawMeshData` interfaces
- `src/lib/validation/report.ts` — `computeReport()` factory for structured validation reports
- `src/lib/validation/compile-check.ts` — C001: OpenSCAD compile success/error detection
- `src/lib/validation/bbox-check.ts` — B001: bounding box match vs validation_targets
- `src/lib/validation/component-check.ts` — C002: floating/disconnected part detection
- `src/lib/validation/hole-check.ts` — H001: through-hole count via Euler characteristic
- `src/lib/repair/repair-controller.ts` — validation-driven LLM repair orchestrator
- `src/lib/repair/visual-repair-controller.ts` — user-triggered VLM visual repair

## Key Config

- **Runtime**: Bun (primary), Node.js as fallback
- **Path alias**: `@/*` maps to `./src/*`
- **Build**: standalone Next.js output (`next.config.ts`)
- **Styling**: Tailwind CSS v4 + Shadcn UI (new-york style, CSS variable theming, lucide icons)
- **ESLint**: nearly all rules disabled (flat config in `eslint.config.mjs`)
- **CAD runtime**: native OpenSCAD must be installed for local native rendering; Vercel/AWS Lambda and explicit `AGENTSCAD_OPENSCAD_BACKEND=wasm` builds use the checksum-pinned official WASM runtime

## Env Variables

Copy `.env.example` to `.env`. `DATABASE_URL` is required and already defaults to local SQLite. Provider variables are optional at process startup because users can add their own provider in **Settings → Providers**; full LLM-backed CAD quality requires at least one working provider/key. Template generation without a key is diagnostic fallback behavior, not the main quality path.

OpenSCAD library env:

- `AGENTSCAD_OPENSCAD_LIBRARY_DIR` overrides the managed library directory; `CADCAD_OPENSCAD_LIBRARY_DIR` is legacy compatibility.
- `OPENSCAD_LIBRARY_PATHS` adds extra reviewed library parent paths.
- `OPENSCADPATH` is passed through to OpenSCAD and augmented by the resolver.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "wtf", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health

## Health Stack

- typecheck: bunx tsc --noEmit
- lint: bunx eslint .
- test: bun test
- deadcode: (not installed)
- shell: (not installed)
