# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|---|---|
| Dev (app only) | `bun run dev` |
| Dev (everything: app + WS service + DB) | `bun run dev:all` |
| Build for production | `bun run build` |
| Start production server | `bun run start` |
| Lint | `bun run lint` |
| Test | `bun run test` |
| Audit dependency licenses | `bun run license:audit` |
| Check OpenSCAD libraries | `bun run scad:libs:check` |
| Install default OpenSCAD libraries | `bun run scad:libs:install` |
| Install GPL OpenSCAD libraries explicitly | `bun run scad:libs:install:gpl` |
| Sync DB schema to SQLite | `bun run db:push` |
| Generate Prisma client | `bun run db:generate` |
| Run DB migrations | `bun run db:migrate` |
| Reset DB | `bun run db:reset` |
| Eval all benchmarks | `bun run cad:eval` |
| Eval simple cases only | `bun run cad:eval:fast` |
| Eval report as JSON | `bun run cad:eval:report` |

Tests use Bun's built-in test runner. Run `bun run test` before handing off CAD pipeline or skill resolver changes.

## Architecture

**AgentSCAD** is an AI-powered CAD job management platform. Users submit natural-language descriptions; an LLM pipeline generates parametric OpenSCAD code, renders it via OpenSCAD CLI, and validates the geometry.

### Core Pipeline

`src/app/api/jobs/[id]/process/route.ts` is a thin HTTP/SSE adapter. It validates the job exists, checks the state is processable, emits raw SSE frames, and calls `executeCadJob`.

`src/lib/pipeline/execute-cad-job.ts` owns the current runtime state machine:

1. **INTAKE** — parse the user's request
2. **GENERATE** — LLM generates OpenSCAD code (falls back to template-based mock code). Auto-detects part family (spur_gear, device_stand, electronics_enclosure, phone_case).
3. **RENDER** — OpenSCAD CLI renders .scad to STL + PNG
4. **VALIDATE** — rules engine checks wall thickness, dimensions, manifold geometry
5. **DELIVER** — artifacts ready (SCAD source, STL, PNG, parameters, validation report)

Each step emits SSE events to the frontend and broadcasts via WebSocket.

### Thin Harness, Fat Skills Rules

- Keep CAD reasoning, repair strategy, validation interpretation, and manufacturing judgment in `skills/`.
- Keep deterministic work in code: OpenSCAD rendering, Python/trimesh validation, Prisma writes, artifact paths, SCAD sanitization, SSE formatting, Socket.IO broadcasts, file IO, and tests.
- Preserve runtime contracts unless a migration explicitly updates the frontend and tests: SSE `data: ${JSON.stringify(payload)}\n\n`, existing state strings, existing step strings, `/artifacts/{jobId}/model.stl`, `/artifacts/{jobId}/preview.png`, and `validationResults` objects with `rule_id`, `rule_name`, `level`, `passed`, `is_critical`, `message`.
- Preserve model fallback behavior: MiMo when configured, otherwise `z-ai-web-dev-sdk`, and template generation when generation fails.
- Prefer wrappers and adapters over route rewrites. The process route should become thinner gradually, only after behavior-preserving tools are proven.
- Prefer artifact-first CAD architecture: generate or repair complete OpenSCAD, then let deterministic tools parse parameters from top-level SCAD assignments. Do not make hidden JSON-only parameters the source of truth.
- Improve CAD quality through general library support, render feedback, and repair loops rather than hardcoded product-family geometry.
- Do not copy third-party CAD app or library source code into this repository without explicit licensing review.
- Keep approved OpenSCAD library policy in `skills/scad-library-policy/manifest.json`, not hardcoded route logic.
- Managed OpenSCAD libraries live outside the repo at `~/.cadcad/openscad-libraries` by default. `CADCAD_OPENSCAD_LIBRARY_DIR` may override this location.
- Use `OPENSCAD_LIBRARY_PATHS`/`OPENSCADPATH` only for additional reviewed local OpenSCAD library parent directories.
- Default library installation must not include GPL libraries. NopSCADlib requires explicit opt-in through `bun run scad:libs:install:gpl`.
- Keep `src/app/api/jobs/[id]/process/route.ts` as a thin HTTP/SSE adapter. Put CAD job state-machine work in `src/lib/pipeline/execute-cad-job.ts` or lower-level tools.

### API Layer

Next.js Route Handlers under `src/app/api/`:
- `jobs/` — CRUD, batch operations, pipeline processing, SCAD editing, versioning
- `chat/` — LLM chat with SSE streaming
- `models/` — 30+ model definitions from 8 providers (including OpenRouter)
- `health/` — health check

### Frontend

`src/components/cad/workspace/MainWorkspace.tsx` (~1700 lines) is the central UI — a 3-panel IDE-like layout:
- **Left**: Job list with drag-and-drop reordering
- **Center**: 3D viewer (Three.js/R3F) + pipeline status
- **Right**: 6-tab inspector (SPEC, PARAMETERS, ASSIST, VALIDATION, HISTORY, CODE)

Key client files:
- `src/components/cad/api.ts` — client-side API functions + SSE streaming helpers
- `src/components/cad/types.tsx` — job types, state colors, pipeline step definitions

### Database

Prisma ORM with SQLite (`db/custom.db`). Two models: `Job` (18 fields) and `JobVersion` (field-level audit trail).

### Mini-Services

- `mini-services/ws-service/` — standalone Socket.IO server on port 3003 for real-time job update broadcasts
- `mini-services/next-dev/` — dev wrapper that auto-restarts Next.js on crash

### LLM Integration

- `src/lib/mimo.ts` — Xiaomi MiMo API client (OpenAI-compatible format)
- `src/lib/openrouter.ts` — OpenRouter API client (routes to GPT-5.5 and other models)
- `src/lib/tools/model-router.ts` — Routes requests to MiMo, OpenRouter, DeepSeek, or fallback
- Primary LLM provider, with `z-ai-web-dev-sdk` as fallback

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
- **Required external tool**: OpenSCAD must be installed and in PATH for the rendering pipeline

## Env Variables

Copy `.env.example` to `.env`. Required: `DATABASE_URL` (SQLite path), `MIMO_BASE_URL`, `MIMO_MODEL`, `MIMO_API_KEY`. Optional: `OPENROUTER_API_KEY` for OpenRouter models, `DEEPSEEK_API_KEY` for DeepSeek.

OpenSCAD library env:

- `CADCAD_OPENSCAD_LIBRARY_DIR` overrides the managed library directory.
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
