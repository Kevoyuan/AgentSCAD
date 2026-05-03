# AgentSCAD Development

This document holds the longer setup, testing, and CI notes that would otherwise make the main README too heavy.

## Local Commands

| Task | Command |
|---|---|
| Dev app | `bun run dev:all` or `bun run dev` |
| Dev app alias | `bun run dev:app` |
| Build | `bun run build` |
| Start production server | `bun run start` |
| Core unit tests | `bun run test` or `bun run test:unit` |
| OpenSCAD integration tests | `OPENSCAD_BIN=openscad bun run test:openscad` |
| Typecheck | `bun run typecheck` |
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

Reviewed third-party license obligations are tracked in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Run `bun run license:audit` before changing package dependencies or OpenSCAD library policy.

## Configuration

Model providers are optional for local exploration and required for full AI-assisted generation/repair quality. Start by copying `.env.example` to `.env`, then add the providers you want to use.

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

## Testing

Run core checks:

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run build
```

Run OpenSCAD integration checks locally:

```bash
OPENSCAD_BIN=openscad bun run test:openscad
```

If OpenSCAD is not installed, install it first and make sure `openscad` is available in PATH.

On Linux:

```bash
sudo apt-get update
sudo apt-get install -y openscad
```

On macOS, install OpenSCAD from <https://openscad.org/downloads.html> and set `OPENSCAD_BIN` if the executable is not in PATH.

On Windows, install OpenSCAD and set `OPENSCAD_BIN` to the executable path if it is not in PATH.

Test categories:

- Unit tests: no OpenSCAD, no external model APIs, safe for every PR.
- OpenSCAD integration tests: require OpenSCAD and may render filesystem artifacts.
- Model/API tests: should be mocked by default and should not require paid provider keys in CI.

## CI Strategy

AgentSCAD uses a two-layer CI setup.

### Core CI

Core CI runs on pull requests and pushes to `main`, and can also be run manually. It checks the application without requiring system-level CAD tooling:

- dependency installation
- Prisma / SQLite setup
- linting
- type checking
- unit tests with mocked or deterministic dependencies
- Next.js build

This job is strict: failures fail the workflow.

### OpenSCAD Integration Checks

Rendering and mesh validation depend on the external OpenSCAD CLI. These checks are separated from Core CI because OpenSCAD is a system-level CAD dependency and rendering behavior can vary across environments.

OpenSCAD integration checks cover:

- SCAD to STL rendering
- preview generation
- mesh/manufacturing validation on rendered artifacts when Python mesh dependencies are available
- render pipeline smoke tests that require the OpenSCAD executable

They can be run locally with OpenSCAD installed, or through the optional manual/scheduled OpenSCAD integration job. The GitHub Actions OpenSCAD job is non-blocking so core application quality remains the required signal.
