# Changelog

All notable changes to AgentSCAD are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.3.2.0] - 2026-07-16

### Added
- Durable Vercel Blob persistence for generated STL and PNG artifacts while keeping stable application URLs
- Serverless artifact lifecycle cleanup for deleted jobs, superseded renders, partial uploads, and temporary workspaces

### Changed
- Vercel rendering now uses isolated `/tmp` workspaces instead of the read-only deployment filesystem
- Artifact downloads are streamed through AgentSCAD so Blob storage paths are not exposed to users
- Serverless mesh validation and learning writes fail safely without attempting to modify the deployed application

### Fixed
- `ENOENT` failures caused by creating `/var/task/public/artifacts` during CAD generation
- Concurrent renders overwriting one another or publishing artifacts after a job was cancelled or deleted
- Internal Blob metadata leaking through public job API responses

## [0.3.1.1] - 2026-07-16

### Fixed
- Refresh the Create Job engine list whenever the dialog opens or Provider Settings change

## [0.3.1.0] - 2026-07-16

### Added
- Session-only Provider Save on Vercel, with API keys encrypted in HttpOnly browser cookies
- One-click **Clear keys** control for immediately removing provider credentials from the browser session
- Provider model recommendations grouped by flagship, balanced, fast, reasoning, vision, and code use cases
- Anthropic and Google Gemini presets through their OpenAI-compatible endpoints
- Provider catalog and model-route regression tests covering environment detection, routing IDs, metadata, and multimodal capability checks
- `CONTRIBUTING.md` with step-by-step contributor setup guide including fork workflow
- GitHub Issue templates for bug reports and feature requests
- `Prerequisites` section in README/README_CN with Node.js, Bun, and OpenSCAD install links
- OpenSCAD PATH warning: jobs stuck in `GEOMETRY_FAILED` state without renderer in PATH
- `Try Example` button in Job Composer (visible when textarea is empty, auto-fills sample prompt)
- `CONTRIBUTING.md` and `CHANGELOG.md` links in README Deeper Docs section

### Changed
- Provider connections in production are restricted to trusted HTTPS preset URLs or an operator-managed allowlist
- Next.js updated to 16.2.6 and GitHub Actions pinned to reviewed commit SHAs

### Fixed
- Restored the Provider Settings **Save** button on Vercel without sharing credentials between visitors
- Protected nested Provider API routes with route-level authorization and middleware coverage
- Blocked provider connection-test SSRF and stopped returning raw upstream error bodies

## [0.3.0] - 2026-05-02

### Added
- Progressive CAD generation pipeline: one LLM call produces structured CAD intent, modeling plan, validation targets, and library-backed OpenSCAD
- AgentSCAD standard OpenSCAD library (`openscad_lib/agentscad_std.scad`) with 11 reusable modules (mounting plates, brackets, enclosures, fasteners, ribs, hole patterns)
- Local keyword-based example retrieval (`cad_knowledge/`) — zero LLM tokens, injected into generation prompts
- Deterministic validation checks: compile (C001), bounding box match (B001), connected components (C002), through-hole count via Euler characteristic (H001)
- Validation-driven auto-repair: one LLM repair attempt on validation failure with re-render and re-validation
- User-triggered visual repair: VLM-based image analysis runs only when you click "Visual Repair" in the preview
- Benchmark suite with 14 test cases across simple/medium/hard difficulty, eval CLI (`bun run cad:eval`)
- Dockerfile (non-root user), docker-compose.yml, CI workflow (GitHub Actions)
- Memory system v3.0: structured numerical observations, append-only JSONL, pipeline-triggered writes, prompt injection defense on user SCAD content, quality feedback loop (delivery rate, repair rate)

### Changed
- Updated 21 provider presets and 50 model recommendations to current July 2026 API model IDs
- Environment-backed providers now expose qualified recommendation IDs while inactive local servers stay hidden until explicitly configured
- Provider settings now offer one-click recommended model selection
- Model dropdown in Job Composer now shows only your configured providers (not auto-detected placeholders)
- Visual validation (VLM) is no longer part of the default pipeline — runs only when you click "Visual Repair"
- SCAD repair skill now uses structured CAD intent with validation feedback for targeted fixes
- Architecture docs, skills docs, and CLAUDE.md updated for v2.0 module structure

### Fixed
- Vercel provider settings no longer attempt to write API keys into the read-only `/var/task` filesystem; production now guides users to environment-managed provider keys
- 304 duplicate React key errors from model dropdown (distinct defaultModel names for providers)
- Repair route was calling OpenSCAD render twice per repair — now reuses first render result
- Shell argument quoting in mesh validator (`--min-wall` parameter)
- Docker container now runs as non-root (`USER bun`)
- CI third-party action pinned to commit SHA for supply chain security
