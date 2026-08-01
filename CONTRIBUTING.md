# Contributing to AgentSCAD

Thank you for your interest in contributing to AgentSCAD!

## Quick Setup

```bash
# 0. Fork the repo on GitHub first:
#    https://github.com/Kevoyuan/AgentSCAD/fork

# 1. Clone YOUR fork (replace <your-username>)
git clone https://github.com/<your-username>/AgentSCAD.git
cd AgentSCAD

# 2. Install dependencies
bun install --frozen-lockfile

# 3. Set up environment
cp .env.example .env
# API keys may be added here, or configured in Settings → Providers after startup.
# Template fallback is diagnostic only and does not represent full AI CAD quality.

# 4. Initialize database
mkdir -p db && touch db/dev.db
bun run db:push

# 5. Verify the local author environment
bun run doctor

# 6. Start development server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

Then configure your own provider/key under **Settings → Providers → Test → Save**. Local settings are written to `.agentscad/providers.json`; never commit or share that file.

> **OpenSCAD is the core CAD engine.** Install the [native CLI](https://openscad.org/downloads.html) and add it to PATH, or configure `AGENTSCAD_OPENSCAD_BACKEND=wasm`. Without a working OpenSCAD backend, AgentSCAD cannot produce real STL/PNG geometry.

## Development Commands

| Command | What it does |
|---|---|
| `bun run dev` | Start Next.js dev server on port 3000 |
| `bun run doctor` | Check author runtime, SQLite, provider setup, OpenSCAD, libraries, artifacts, and local secret boundaries |
| `bun run test` | Run unit tests |
| `bun run test:wasm` | Run the verified OpenSCAD WASM integration suite |
| `bun run lint` | Check for lint errors |
| `bun run typecheck` | TypeScript type-check |
| `bun run build` | Production build |
| `bun run cad:eval:fast` | Run the offline intent/schema/retrieval harness for simple fixtures |
| `bun run cad:eval` | Run dev plus frozen offline fixtures; any missing required evidence or regression exits nonzero |
| `bun run cad:eval:case <id>` | Inspect one case with tagged evidence and provenance |
| `bun run cad:eval:render` | Run the real checksum-pinned WASM compile/STL/bbox/PNG benchmark |

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make your changes**, following the architecture rules in [AGENTS.md](./AGENTS.md).

3. **Run the checks** before committing:
   ```bash
   bun run lint
   bun run typecheck
   bun run test
   bun run test:wasm
   ```

4. **Commit** with a descriptive message:
   ```bash
   git commit -m "feat(pipeline): add support for threaded joints"
   # or
   git commit -m "fix(ui): resolve stats dashboard scrollbar overflow"
   ```

5. **Push** and open a Pull Request against `main`.

## Architecture Principles

Keep these in mind when contributing:

- **Thin HTTP routes, fat pipeline**: Keep CAD reasoning guidance in `skills/`, deterministic work in `src/lib/`.
- **Explicit judgment boundary**: Model-facing CAD guidance lives in `skills/`; measurable render/mesh/manufacturing checks live in deterministic TypeScript/Python code.
- **Artifact-first**: OpenSCAD source is the source of truth — not hidden JSON parameters.
- **Test the deterministic parts**: Unit tests for `src/lib/tools/`, `src/lib/validation/`, and `src/lib/pipeline/`.
- **Separate evidence levels**: `DELIVERED` means artifacts are available; it does not mean the design matches the request or that a user accepted it.

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design context.

## Code Style

- TypeScript everywhere (no `any` without a comment explaining why).
- Tailwind CSS v4 for styling.
- No `git add -A` — only stage intentional files.
- Write tests for new utility functions in `src/lib/`.

## Submitting a Pull Request

- Keep PRs focused — one feature or fix per PR.
- Include a brief description of what changed and why.
- If your change affects the CAD pipeline, run the relevant unit tests and at least one real OpenSCAD backend check (`bun run test:wasm`, `bun run cad:eval:render`, or `OPENSCAD_BIN=openscad bun run test:openscad`). You may also attach `bun run cad:eval:fast` as offline harness evidence, but its LLM/compile/mesh/bbox/visual fields remain `NOT_RUN` and are not CAD quality evidence. The render benchmark proves only its named compile/STL/bbox/PNG facts.
- If your change touches UI, attach a screenshot or short screen recording.

## Reporting Issues

Use the [GitHub Issues](https://github.com/Kevoyuan/AgentSCAD/issues) page. Pick the appropriate template:
- **Bug Report** — for unexpected behavior or crashes.
- **Feature Request** — for new ideas or improvements.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
