# Changelog

All notable changes to AgentSCAD are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.4.1.0] - 2026-08-02

### Added
- Generate arbitrary, non-template parametric OpenSCAD models through the configured LLM, including explicit generation-path metadata for freeform requests
- Configurable long-running model request timeouts with actionable timeout, authentication, rate-limit, and provider-unavailable diagnostics

### Changed
- Template generation is now opt-in demo behavior instead of a silent production fallback, so unsupported creative requests fail honestly and can be retried with a provider
- Visual repair can be launched for delivered jobs that still need visual evidence, while atomic repair leases prevent duplicate paid work
- Documentation and environment examples now describe the local-first BYO-key workflow and the freeform generation contract

### Fixed
- Preserve the original request's family classification after intent approval instead of routing internal intent IDs to unrelated templates

## [0.4.0.0] - 2026-08-01

### Added
- Ambiguity-aware CAD intake with a frozen `行星发动机模型` benchmark and explicit user approval before any generation or rendering
- Bounded model-assisted intake for requests not covered by the local intent index
- Truthful offline and real OpenSCAD WASM render benchmarks with explicit `PASS`, `FAIL`, `SKIP`, `ERROR`, and `NOT_RUN` evidence
- `bun run doctor` for local runtime, database, provider, OpenSCAD, library, and artifact readiness checks

### Changed
- Validation, visual repair, retrieval, skill loading, and prompt-memory behavior now preserve evidence boundaries and avoid unsupported success claims
- Approved interpretations remain visible and reusable across processing while unsupported requests no longer fall back to unrelated CAD templates
- Public production deployments use encrypted per-browser BYO provider keys; shared environment credentials require `API_SECRET`
- Documentation now describes AgentSCAD as a local-first, account-free parametric CAD Web App with OpenSCAD as its geometry engine

### Fixed
- Concurrent intent approvals and visual-repair requests can no longer overwrite one another or duplicate paid work
- Post-repair visual validation is rerun against rendered pixels and cannot silently downgrade to a text-only model
- Validation warnings, incomplete evidence, and operational errors retain distinct server and UI semantics
- Reprocessing restores validated intake evidence instead of repeating paid model calls, and stale artifacts are cleared before clarification

### Security
- Production fails closed for deployment-owned provider credentials unless administrative bearer access is configured
- Public visual-repair errors no longer expose filesystem paths or upstream provider details

## [0.3.3.0] - 2026-07-16

### Added
- Official checksum-pinned OpenSCAD 2026.01.12 WebAssembly rendering on Vercel
- Server-side STL mesh projection for 800×600 PNG previews when OpenGL is unavailable
- Strict OpenSCAD WASM integration tests covering standard-library models and secret isolation

### Changed
- Serverless renders use the WASM child-process boundary while local development keeps native OpenSCAD
- CAD generation guidance avoids fonts and external files unsupported by the serverless renderer
- Long-running render routes allow up to five minutes on supported Vercel plans

### Security
- OpenSCAD receives a minimal environment without provider keys, Blob tokens, or application secrets
- Untrusted SCAD is restricted to stdin-only geometry: external libraries, imports, surfaces, and fonts are rejected, while a child-process filesystem guard exposes only a fresh empty working directory
- Serverless render starts use Blob-backed atomic slots for a deployment-wide 20-per-minute ceiling; SCAD input, STL output, stderr, execution time, local concurrency, heap, and artifact size are also bounded
- Build and license audits verify the official archive, extracted runtime, GPL notice, and corresponding source commits

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
