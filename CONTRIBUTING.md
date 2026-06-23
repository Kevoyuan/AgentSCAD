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
# Edit .env to add your API keys (optional — template fallback works without keys)

# 4. Initialize database
mkdir -p db && touch db/dev.db
bun run db:push

# 5. Start development server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Tip:** Install [OpenSCAD](https://openscad.org/downloads.html) and add it to your PATH to enable real STL/PNG rendering. Without it, the app works but jobs stay in `GEOMETRY_FAILED` state.

## Development Commands

| Command | What it does |
|---|---|
| `bun run dev` | Start Next.js dev server on port 3000 |
| `bun run test` | Run unit tests |
| `bun run lint` | Check for lint errors |
| `bun run typecheck` | TypeScript type-check |
| `bun run build` | Production build |
| `bun run cad:eval:fast` | Run CAD benchmark (simple cases) |
| `bun run cad:eval` | Run full CAD benchmark suite (14 cases) |

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

- **Thin HTTP routes, fat pipeline**: Keep CAD reasoning in `skills/`, deterministic work in `src/lib/`.
- **Skills over hardcoded logic**: CAD generation, repair, and validation rules live in `skills/scad-*/SKILL.md`.
- **Artifact-first**: OpenSCAD source is the source of truth — not hidden JSON parameters.
- **Test the deterministic parts**: Unit tests for `src/lib/tools/`, `src/lib/validation/`, and `src/lib/pipeline/`.

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design context.

## Code Style

- TypeScript everywhere (no `any` without a comment explaining why).
- Tailwind CSS v4 for styling.
- No `git add -A` — only stage intentional files.
- Write tests for new utility functions in `src/lib/`.

## Submitting a Pull Request

- Keep PRs focused — one feature or fix per PR.
- Include a brief description of what changed and why.
- If your change affects the CAD pipeline, run `bun run cad:eval:fast` and paste the results.
- If your change touches UI, attach a screenshot or short screen recording.

## Reporting Issues

Use the [GitHub Issues](https://github.com/Kevoyuan/AgentSCAD/issues) page. Pick the appropriate template:
- **Bug Report** — for unexpected behavior or crashes.
- **Feature Request** — for new ideas or improvements.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
