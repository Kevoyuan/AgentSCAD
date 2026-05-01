# Changelog

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
- Model dropdown in Job Composer now shows only your configured providers (not auto-detected placeholders)
- Visual validation (VLM) is no longer part of the default pipeline — runs only when you click "Visual Repair"
- SCAD repair skill now uses structured CAD intent with validation feedback for targeted fixes
- Architecture docs, skills docs, and CLAUDE.md updated for v2.0 module structure

### Fixed
- 304 duplicate React key errors from model dropdown (distinct defaultModel names for providers)
- Repair route was calling OpenSCAD render twice per repair — now reuses first render result
- Shell argument quoting in mesh validator (`--min-wall` parameter)
- Docker container now runs as non-root (`USER bun`)
- CI third-party action pinned to commit SHA for supply chain security
