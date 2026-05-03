**English** | [中文](./README_CN.md)

# AgentSCAD

![CI](https://github.com/Kevoyuan/AgentSCAD/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![OpenSCAD](https://img.shields.io/badge/OpenSCAD-required-blue)
![Status](https://img.shields.io/badge/status-active-green)

AgentSCAD is a full-stack AI CAD workspace that turns natural-language part requests into editable OpenSCAD, rendered STL/PNG artifacts, and validation-backed job workflows.

It uses a **progressive pipeline**: one LLM call generates structured CAD intent and library-backed OpenSCAD by default. Expensive steps, such as LLM repair and VLM visual validation, run only on failure or on user request.

![AgentSCAD system overview](./docs/images/agentscad_overview.png)

## Demo Flow

![Create a CAD job from natural language, reusable case memory, model selection, and manufacturing constraints.](./docs/images/spec.png)

![AgentSCAD's generation and repair agents work together to deliver validated CAD artifacts.](./docs/images/repair.png)

![Delivered CAD artifacts remain inspectable with preview, STL readiness, SCAD source, and validation status.](./docs/images/Example.png)

## For Reviewers / 60-Second Overview

- AgentSCAD turns natural-language CAD requests into parametric `model.scad`, rendered `model.stl`, `preview.png`, validation results, and persistent job history.
- It is more than a text-to-code demo: the app stores jobs, extracts editable parameters, renders through OpenSCAD, validates mesh/manufacturing constraints, and attempts repair only when validation fails.
- Without API keys, reviewers can open the workspace UI, initialize SQLite, inspect local artifacts, edit SCAD/parameters, and run deterministic rendering/validation if OpenSCAD is available.
- Provider keys enable full LLM-backed generation, automatic repair, chat help, and user-triggered visual repair.
- Expected artifacts live under `public/artifacts/{jobId}/` and are exposed in the workspace as SCAD source, STL readiness, PNG preview, validation status, and version history.
- Start code review in `src/lib/pipeline/execute-cad-job.ts`, `src/lib/tools/`, `src/components/cad/`, `src/app/api/`, `prisma/schema.prisma`, and `skills/`.

## Quick Start

### Option A: Docker Compose

Docker Compose is the easiest way to bring up the production-built web app and SQLite-backed workspace:

```bash
cp .env.example .env
mkdir -p db public/artifacts
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

Docker notes:

- `docker-compose.yml` initializes the Prisma SQLite schema before starting the app.
- The Docker image does **not** bundle OpenSCAD. This keeps the GPL runtime boundary clear, but it means render/export flows need an `openscad` executable available inside the container or a custom image that installs it.
- Without OpenSCAD inside the container, Docker is still useful for reviewing the UI, persistence, job workflow, and API surface, but deterministic rendering will fail until OpenSCAD is configured.

### Option B: Local Development

Requirements: Node.js 20 or 22 LTS, Bun, and OpenSCAD in your PATH.

Install OpenSCAD from <https://openscad.org/downloads.html>, then confirm `openscad` is available in your terminal.

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
mkdir -p db
touch db/dev.db
bun run db:push
bun run dev:all
```

Open [http://localhost:3000](http://localhost:3000).

`bun run dev:all` currently starts the local Next.js app/API on port 3000. Bun is the tested package manager because this repo commits `bun.lock`, runs tests with `bun test`, and starts the production standalone server with Bun.

<details>
<summary>Windows PowerShell setup</summary>

```powershell
bun install --frozen-lockfile
if (!(Test-Path .env)) { Copy-Item .env.example .env }
New-Item -ItemType Directory -Force db
if (!(Test-Path db/dev.db)) { New-Item -ItemType File db/dev.db }
bun run db:push
bun run dev:all
```

</details>

### npm Fallback

npm can run the development app, but Bun remains required for the test script:

```bash
npm install
npm run db:push
npm run dev:all
```

If you use npm, avoid committing the generated `package-lock.json` unless the project intentionally switches package managers.

## First-Run Walkthrough

1. Start the app with Docker Compose or `bun run dev:all`.
2. Open [http://localhost:3000](http://localhost:3000).
3. Create a new job with:

```text
Create a wall-mountable phone holder with rounded corners and two screw holes.
```

4. Pick a configured model provider, or use the built-in fallback/template path if you are evaluating the UI and pipeline shape.
5. Inspect the preview, STL readiness, SCAD source, validation report, and editable parameters.
6. Change a parameter such as wall thickness or screw-hole diameter, re-render, then export the STL.

## Expected Result

After creating and processing a job, you should see:

- generated `model.scad`
- rendered `model.stl`
- rendered `preview.png`
- validation status and report
- editable parameters extracted from top-level SCAD assignments
- job history / version information
- available repair, visual repair, re-render, or export actions when the job state supports them

Without API keys, you can still inspect the UI, initialize the database, edit SCAD/parameters, inspect existing local artifacts, and run deterministic rendering/validation when OpenSCAD is available. If model generation fails or no provider is available, the pipeline falls back to template-style parametric generation for supported part families rather than claiming full LLM quality.

## What Works Without API Keys?

### Works without API keys

- open the workspace UI
- initialize SQLite with Prisma
- inspect existing/local artifacts
- edit SCAD and extracted parameters
- run OpenSCAD rendering if OpenSCAD is installed and reachable through `OPENSCAD_BIN` or `openscad`
- run deterministic mesh/manufacturing validation after an STL exists
- use fallback/template CAD generation paths when LLM calls are unavailable

### Requires provider keys

- full LLM-backed CAD generation quality
- automatic LLM repair after validation failure
- chat help beyond local fallback responses
- user-triggered visual repair / VLM review with a vision-capable configured model

Visual validation is skipped in the normal pipeline unless explicitly requested. If the visual provider is missing or unavailable, AgentSCAD treats that as uncertainty rather than a blocking pass.

## Try This Sample Job

```text
Create a wall-mountable phone holder with rounded corners and two screw holes.
```

Expected artifacts:

- `model.scad`
- `model.stl`
- `preview.png`
- validation report
- editable parameters

Known limitation: without provider keys, generated geometry may come from the template fallback path. That is useful for evaluating the workflow, artifacts, and deterministic checks, but not a substitute for reviewing model-backed CAD generation quality.

## Features

- **Artifact-first CAD generation**: OpenSCAD source is the source of truth; model-provided parameter JSON is compatibility metadata and fallback.
- **CAD generation and repair agents**: a generation agent creates OpenSCAD artifacts, while a repair agent fixes failed geometry, validation blockers, and human-review edits.
- **Validation-driven workflow**: AgentSCAD keeps generated STL, preview, and SCAD available for inspection, then routes failed jobs into repair or human review.
- **Cost-aware defaults**: one generation call on the happy path, one repair attempt only on failure, and visual repair only when the user triggers it.
- **Live workspace updates**: Server-Sent Events stream active generation progress, and the job workspace refreshes automatically.
- **Parametric editing**: users can tweak extracted CAD parameters such as wall thickness, hole diameter, or gear teeth within schema constraints.
- **Persistent job/version/artifact workflow**: job state, field-level edits, generated artifacts, and reports survive refreshes.
- **Managed OpenSCAD libraries**: approved libraries such as BOSL2, Round-Anything, and MCAD can be installed into a local managed bundle with license gates.
- **Multi-provider LLM support**: generation can route through OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Zhipu, Qwen, Mistral, and other configured providers.

## Architecture in 30 Seconds

```text
User request
  -> CAD intent + OpenSCAD generation
  -> OpenSCAD render
  -> deterministic validation
  -> artifact delivery

Failure path:
validation feedback
  -> one repair attempt
  -> re-render
  -> deliver or human review

Visual path:
user sees preview
  -> clicks Visual Repair
  -> VLM feedback
  -> targeted SCAD fix
```

## For Portfolio Reviewers

Key areas:

- Full-stack workspace: `src/app`, `src/components/cad`
- CAD generation pipeline: `src/lib/pipeline`
- OpenSCAD rendering and validation tools: `src/lib/tools`, `scripts/validate_stl.py`
- Job/version persistence: `prisma/schema.prisma`
- Skill system: `skills/`
- API/SSE routes: `src/app/api`

## Configuration

Model providers are optional for local exploration and required for full AI-assisted generation/repair quality. Start by copying `.env.example` to `.env`, then add the providers you want to use.

Common variables:

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | SQLite database path used by Prisma. Defaults to `file:../db/dev.db` in `.env.example`. |
| `OPENSCAD_BIN` | Optional | Path to the external OpenSCAD CLI. Defaults to `openscad`. |
| `MIMO_API_KEY` | Optional | Enables MiMo generation fallback and MiMo-backed visual validation where supported. |
| `OPENROUTER_API_KEY` | Optional | Enables OpenRouter model routing. |
| `DEEPSEEK_API_KEY` | Optional | Enables DeepSeek model routing. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DASHSCOPE_API_KEY`, etc. | Optional | Enable additional configured providers. |
| `AGENTSCAD_OPENSCAD_LIBRARY_DIR` | Optional | Overrides the managed OpenSCAD library directory. |
| `OPENSCAD_LIBRARY_PATHS` | Optional | Adds extra local OpenSCAD library search paths. |
| `CRON_SECRET` | Production | Protects the cron endpoint in production. |
| `API_SECRET` | Production | Protects job/chat API routes in production. |

Optional approved OpenSCAD library setup:

```bash
bun run scad:libs:install
bun run scad:libs:check
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `openscad` not found | OpenSCAD is not installed or not in PATH | Install OpenSCAD and set `OPENSCAD_BIN` if the executable is not named `openscad` |
| Prisma/database error | SQLite DB or schema is not initialized | Run `mkdir -p db`, `touch db/dev.db`, then `bun run db:push` |
| No AI generation | Provider keys are missing or provider calls failed | Add at least one model provider key to `.env`; fallback/template generation may still run for supported shapes |
| Visual repair unavailable | The selected job model does not support vision, or visual provider credentials are missing | Switch to a vision-capable configured model and add the needed provider key |
| Visual validation skipped | Normal pipeline disables visual checks until the user requests visual repair | Treat skipped visual checks as uncertainty, then use Visual Repair when provider support is configured |
| Docker port conflict | Port 3000 is already in use | Stop the existing process or change the Compose port mapping |
| Docker rendering fails | The Docker image does not bundle OpenSCAD | Install OpenSCAD in a custom image or use local development with OpenSCAD installed |
| Bun command missing | Bun is not installed | Install Bun, or use the documented npm fallback for development only |
| Windows shell commands fail | Bash commands were pasted into PowerShell | Use the Windows PowerShell setup block above |

## OpenSCAD Runtime Boundary

AgentSCAD does not bundle or link OpenSCAD in the default application distribution.

OpenSCAD is invoked as an external command-line renderer through `OPENSCAD_BIN` or the `openscad` executable available in the user's runtime environment.

Users and distributors who install, package, or redistribute OpenSCAD are responsible for complying with OpenSCAD's GPL license terms.

## Why AgentSCAD?

Most text-to-CAD demos stop at code generation. AgentSCAD treats CAD as an artifact pipeline with cost-aware defaults:

1. **One LLM call** generates structured CAD intent, modeling plan, validation targets, and library-backed OpenSCAD.
2. Extract editable parameters from top-level SCAD assignments.
3. Render STL and preview images with deterministic OpenSCAD CLI.
4. **Local deterministic validation**: compile check, mesh manifold, bounding box, component count, hole count via Euler characteristic.
5. **Repair on failure only**: if validation fails, one automatic LLM repair with validation feedback.
6. **Visual repair on user request**: VLM-based visual inspection only when the user clicks "Visual Repair" after seeing the preview.
7. Store edits, artifacts, and learned patterns for future jobs.

## Benchmark

```bash
bun run cad:eval         # all benchmark cases
bun run cad:eval:fast    # simple cases only
bun run cad:eval -- --model deepseek  # with specific model
bun run cad:eval:report  # parse results as JSON
```

Key metrics: compile success rate, geometry pass rate, repair success rate, average LLM calls per job, average latency per job.

## Repo Mental Model

| Layer | What it owns | Where to look |
|---|---|---|
| Agent workflow | Job state machine, retries, SSE progress, automatic workspace refresh | `src/lib/pipeline/`, `src/app/api/jobs/[id]/process/route.ts`, `src/app/api/cron/route.ts` |
| Skills | CAD reasoning contracts, repair strategy, validation review, library usage policy | `skills/scad-*`, `skills/RESOLVER.md` |
| Tools | Deterministic render, validation, SCAD sanitization, parameter extraction, artifact IO | `src/lib/tools/`, `scripts/validate_stl.py` |
| Memory | Job state, version history, artifacts, structured learned observations | `prisma/schema.prisma`, `src/lib/version-tracker.ts`, `src/lib/improvement-analyzer.ts`, `skills/scad-generation/learned-observations.jsonl` |
| Workspace UI | CAD viewport, job queue, parameter editing, review panels, chat helper | `src/components/cad/`, `src/app/` |

## Memory at a Glance

AgentSCAD uses explicit product memory instead of opaque chat history:

- **Working memory**: current job state, request, parameters, SCAD source, artifacts, validation results, and logs.
- **Episodic memory**: field-level `JobVersion` history for parameter, source, and note edits.
- **Artifact memory**: generated `model.scad`, `model.stl`, `preview.png`, and reports under `public/artifacts/{jobId}/`.
- **Skill memory**: Markdown CAD skills, schemas, library policy, and in-process skill/schema caches.
- **Learned memory**: structured numerical observations extracted from user edits, validation failures, and repair outcomes. Pipeline-triggered writes, append-only JSONL, prompt injection defense on user content.

Learned memory is used as prompt-time guidance, not as an override for rendering or validation.

**v3.0 improvements**: Observations are structured numerical data, stored in append-only JSONL for data safety, and written automatically by the pipeline on job completion and validation events. Source trust levels (`user_edit > repair_success > validation_pattern`) give higher confidence to user-driven changes. Prompt injection defense sanitizes user-sourced SCAD content before it enters the generation prompt. Quality metrics such as delivery rate and repair rate close the feedback loop.

## Skills at a Glance

The CAD skill layer keeps model-facing judgment editable as Markdown while deterministic code handles rendering, validation, storage, and streaming.

| Skill | Role |
|---|---|
| `skills/scad-generation/` | Creates strict JSON containing a summary, compatibility parameter metadata, and complete `scad_source`. |
| `skills/scad-repair/` | Repairs broken or failed OpenSCAD while preserving design intent and runtime contracts. |
| `skills/scad-validation-review/` | Reviews render logs, artifacts, and validation results to decide deliver, repair, or human review. |
| `skills/scad-visual-validate/` | Compares rendered previews against the user request to catch visible intent failures. |
| `skills/scad-improvement/` | Documents the edit-analysis loop that learns from user corrections. |
| `skills/scad-library-*` | Guides approved external OpenSCAD library usage with runtime availability and license gates. |
| `skills/scad-chat/` | Provides workspace CAD help outside the main generation pipeline. |

See [docs/SKILLS.md](./docs/SKILLS.md) for the full CAD skill map.

## Managed OpenSCAD Libraries

The approved library catalog lives in `skills/scad-library-policy/manifest.json`. It records source repositories, pinned commits, detection files, include examples, and license gates.

The default managed library directory is outside the repository:

```bash
~/.agentscad/openscad-libraries
```

Install and check default-approved libraries:

```bash
bun run scad:libs:install
bun run scad:libs:check
```

Default installation currently includes BOSL2, Round-Anything, and MCAD. GPL libraries such as NopSCADlib are not installed by default; installing them requires an explicit opt-in:

```bash
bun run scad:libs:install:gpl
```

Generated SCAD may reference available libraries with `include` or `use`, but AgentSCAD does not copy third-party library source into generated SCAD.

## Status

AgentSCAD is an active prototype for AI-native CAD workflows. It is designed for local experimentation with OpenSCAD-based parametric parts.

Current limitations:

- Generated CAD should be reviewed before manufacturing.
- Local rendering requires OpenSCAD to be installed and reachable by the app runtime.
- The Docker image intentionally does not bundle OpenSCAD.
- Visual repair depends on configured vision-capable model providers.
- Learned memory is conservative and used as guidance, not automatic retraining.

## Common Commands

| Task | Command |
|---|---|
| Dev app | `bun run dev:all` or `bun run dev` |
| Dev app alias | `bun run dev:app` |
| Build | `bun run build` |
| Start production server | `bun run start` |
| Test | `bun test` or `bun run test` |
| Lint | `bun run lint` |
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

Reviewed third-party license obligations are tracked in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Run `bun run license:audit` before changing package dependencies or OpenSCAD library policy.

## Project Structure

- `/src/app/api/`: REST APIs, thin HTTP/SSE adapters, SCAD apply routes.
- `/src/components/cad/`: domain-specific React components.
- `/src/lib/pipeline/`: CAD job runtime state machine.
- `/src/lib/harness/`: skill runner and structured-output normalization.
- `/src/lib/tools/`: deterministic rendering, validation, library resolution, sanitization, artifact, and parameter tools.
- `/src/lib/stores/`: shared persistence helpers.
- `/prisma/`: ORM schema and database setup.
- `/skills/`: AI model capabilities, SCAD generation/repair/library policy, usage guides, and deterministic skill scripts.
- `/docs/`: architecture, memory, skills, and frontend design notes.

## Deeper Docs

- [Architecture](./docs/ARCHITECTURE.md)
- [Skills](./docs/SKILLS.md)

## License

MIT - see [LICENSE](./LICENSE) for details.
