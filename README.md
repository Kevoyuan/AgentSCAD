**English** | [中文](./README_CN.md)

# AgentSCAD

![CI](https://github.com/Kevoyuan/AgentSCAD/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![OpenSCAD](https://img.shields.io/badge/OpenSCAD-required-blue)
![Status](https://img.shields.io/badge/status-active-green)

AgentSCAD is a full-stack AI CAD workspace that turns natural-language part requests into editable OpenSCAD, rendered STL/PNG artifacts, and validation-backed job workflows.

It uses a progressive pipeline: one LLM call generates structured CAD intent and OpenSCAD by default. Repair runs only after validation failure, and visual repair runs only when the user requests it.

![AgentSCAD system overview](./docs/images/agentscad_overview.png)

## Demo Flow

![Create a CAD job from natural language, reusable case memory, model selection, and manufacturing constraints.](./docs/images/spec.png)

![AgentSCAD's generation and repair agents work together to deliver validated CAD artifacts.](./docs/images/repair.png)

![Delivered CAD artifacts remain inspectable with preview, STL readiness, SCAD source, and validation status.](./docs/images/Example.png)

## 60-Second Overview

- AgentSCAD turns natural-language CAD requests into `model.scad`, `model.stl`, `preview.png`, validation results, and persistent job history.
- It is more than a text-to-code demo: the app stores jobs, extracts editable parameters, renders through OpenSCAD, validates mesh/manufacturing constraints, and attempts repair only when validation fails.
- Without API keys, the workspace UI, SQLite setup, local artifacts, SCAD/parameter editing, and deterministic rendering/validation paths remain inspectable when OpenSCAD is available.
- Provider keys enable full LLM-backed generation, automatic repair, chat help, and user-triggered visual repair.
- Code entry points: `src/lib/pipeline/execute-cad-job.ts`, `src/lib/tools/`, `src/components/cad/`, `src/app/api/`, `prisma/schema.prisma`, and `skills/`.

## Quick Start

### Option A: Docker Compose

Docker Compose brings up the production-built web app and SQLite-backed workspace:

```bash
cp .env.example .env
mkdir -p db public/artifacts
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

Docker initializes the Prisma SQLite schema before starting the app. The image intentionally does **not** bundle OpenSCAD, so Docker is best for UI, API, persistence, and workflow review unless you provide OpenSCAD inside a custom image.

### Option B: Local Development

Requirements: Node.js 20 or 22 LTS, Bun, and OpenSCAD in your PATH.

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
mkdir -p db
touch db/dev.db
bun run db:push
bun run dev:all
```

Open [http://localhost:3000](http://localhost:3000).

Windows setup and extended commands are in [Development and CI](./docs/DEVELOPMENT.md).

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
- repair, visual repair, re-render, or export actions when the job state supports them

Without API keys, you can still inspect the UI, initialize the database, edit SCAD/parameters, inspect existing local artifacts, and run deterministic rendering/validation when OpenSCAD is available. If model generation fails or no provider is available, the pipeline falls back to template-style parametric generation for supported part families.

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

Visual validation is skipped in the normal pipeline unless explicitly requested. Missing visual provider support is treated as uncertainty, not as a blocking pass.

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

Without provider keys, generated geometry may come from the template fallback path. That is still useful for evaluating the workflow, artifacts, and deterministic checks, but not a substitute for reviewing model-backed CAD quality.

## Features

- **Artifact-first CAD generation**: OpenSCAD source is the source of truth.
- **Cost-aware defaults**: one generation call on the happy path, one repair attempt only on failure, visual repair only when user-triggered.
- **Deterministic CAD tooling**: OpenSCAD renders STL/PNG artifacts; Python/trimesh checks rendered meshes.
- **Parametric editing**: extracted SCAD assignments become editable constrained parameters.
- **Persistent workflow**: job state, version history, artifacts, validation results, and logs survive refreshes.
- **Multi-provider model routing**: generation can route through configured providers such as MiMo, OpenRouter, DeepSeek, OpenAI-compatible endpoints, and local fallback paths.

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

## Code Tour

Key areas:

- Full-stack workspace: `src/app`, `src/components/cad`
- CAD generation pipeline: `src/lib/pipeline`
- OpenSCAD rendering and validation tools: `src/lib/tools`, `scripts/validate_stl.py`
- Job/version persistence: `prisma/schema.prisma`
- Skill system: `skills/`
- API/SSE routes: `src/app/api`

## Status / Limitations

- Generated CAD should be reviewed before manufacturing.
- Local rendering requires OpenSCAD to be installed and reachable through `OPENSCAD_BIN` or `openscad`.
- The Docker image intentionally does not bundle OpenSCAD.
- Full LLM generation, repair, chat help, and visual repair require configured provider keys.
- Core CI is strict and does not require OpenSCAD; OpenSCAD render checks run separately. See [Development and CI](./docs/DEVELOPMENT.md).

## Deeper Docs

- [Architecture](./docs/ARCHITECTURE.md)
- [Development and CI](./docs/DEVELOPMENT.md)
- [Benchmarking](./docs/BENCHMARK.md)
- [Memory](./docs/MEMORY.md)
- [Skills](./docs/SKILLS.md)
- [OpenSCAD runtime and libraries](./docs/OPENSCAD_LIBRARIES.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

## License

MIT - see [LICENSE](./LICENSE) for details.
