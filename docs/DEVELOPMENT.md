# AgentSCAD Development

This document holds the longer setup, testing, and CI notes that would otherwise make the main README too heavy.

For setup failures and common runtime issues, see [Troubleshooting](./TROUBLESHOOTING.md).

## Local Commands

| Task | Command |
|---|---|
| Dev app | `bun run dev` |
| Compatibility aliases | `bun run dev:all` or `bun run dev:app` (currently start the same Next.js process) |
| Author preflight | `bun run doctor` |
| Build | `bun run build` |
| Start production server | `bun run start` |
| Core unit tests | `bun run test` or `bun run test:unit` |
| OpenSCAD WASM integration tests | `bun run test:wasm` |
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
| Offline harness full regression | `bun run cad:eval` |
| Offline harness, simple fixtures | `bun run cad:eval:fast` |
| One evidence case | `bun run cad:eval:case <id>` |
| Parse the last harness report | `bun run cad:eval:report` |
| Real deterministic WASM render benchmark | `bun run cad:eval:render` |

Reviewed third-party license obligations are tracked in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Run `bun run license:audit` before changing package dependencies or OpenSCAD library policy.

## Windows PowerShell Setup

```powershell
bun install --frozen-lockfile
if (!(Test-Path .env)) { Copy-Item .env.example .env }
New-Item -ItemType Directory -Force db
if (!(Test-Path db/dev.db)) { New-Item -ItemType File db/dev.db }
bun run db:push
bun run doctor
bun run dev
```

## Configuration

Model providers are optional for UI/deterministic-tool exploration and required for real LLM-assisted generation/repair quality. The primary product path is to start the app and configure your own key under **Settings → Providers → Test → Save**. Environment variables remain useful for unattended or shared deployments.

Local development saves custom Provider Settings to `.agentscad/providers.json`. In public production, set `PROVIDER_SETTINGS_SECRET` to enable per-browser Provider Save without writing credentials to the application filesystem or database. The server encrypts settings into an HttpOnly session cookie; visitors can remove it immediately with **Clear keys**. Closing a tab alone is not a guaranteed wipe because browsers control session restoration. When `API_SECRET` is unset, production ignores environment- and file-backed provider credentials. Shared environment providers are available only to private administrative deployments protected by `API_SECRET`.

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | SQLite database path used by Prisma. Defaults to `file:../db/dev.db` in `.env.example`. |
| `OPENSCAD_BIN` | Optional | Path to the external OpenSCAD CLI. Defaults to `openscad`. |
| `AGENTSCAD_OPENSCAD_BACKEND` | Optional | Selects `native` or `wasm`. Vercel and AWS Lambda default to the verified WASM runtime. |
| `MIMO_API_KEY` | Optional | Enables MiMo generation fallback and MiMo-backed visual validation where supported. |
| `OPENROUTER_API_KEY` | Optional | Enables OpenRouter model routing. |
| `DEEPSEEK_API_KEY` | Optional | Enables DeepSeek model routing. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DASHSCOPE_API_KEY`, etc. | Optional | Enable additional configured providers and their recommended model lists. |
| `AGENTSCAD_OPENSCAD_LIBRARY_DIR` | Optional | Overrides the managed OpenSCAD library directory. |
| `OPENSCAD_LIBRARY_PATHS` | Optional | Adds extra local OpenSCAD library search paths. |
| `CRON_SECRET` | Conditional | Required when the production cron endpoint is enabled. |
| `API_SECRET` | Optional | Enables bearer-token administrative API access and permits environment-backed shared provider credentials. Without it, production uses same-origin browser requests, HttpOnly job-session scoping, and encrypted per-browser BYO provider keys only. This is not an account system. |
| `PROVIDER_SETTINGS_SECRET` | Vercel | Encrypts per-browser provider settings in an HttpOnly session cookie. Generate at least 32 random characters; rotating it invalidates saved sessions. |
| `PROVIDER_BASE_URL_ALLOWLIST` | Optional | Comma-separated exact HTTPS base URLs for trusted custom providers in production. |
| `AGENTSCAD_LLM_TIMEOUT_MS` | Optional | Total budget for one model request. Defaults to `90000`, bounded to 5–240 seconds. |
| `AGENTSCAD_TEMPLATE_FALLBACK` | Optional demo only | Set to `true` only for deterministic legacy-template diagnostics. Disabled by default and never required for arbitrary/freeform CAD. |

Built-in production presets are already trusted. To enable a custom OpenAI-compatible endpoint, add its exact base URL, without a trailing slash, for example:

```dotenv
PROVIDER_BASE_URL_ALLOWLIST="https://llm.example.com/v1"
```

HTTP URLs, URL credentials, query strings, fragments, redirects, and endpoints outside the preset list or this allowlist are rejected in production.

## Testing

Run core checks:

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run test:wasm
bun run build
```

Run the official checksum-pinned OpenSCAD WASM integration checks:

```bash
bun run test:wasm
```

The first install/build downloads the reviewed upstream snapshot into the
ignored `.openscad-runtime` directory and verifies its archive, runtime, and
license checksums. Run native OpenSCAD integration checks locally with:

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

### Reading Evaluation Results Correctly

The offline evaluator exercises fixture loading, the shared request-intelligence analyzer, part-family detection, family schema loading, and local retrieval. Facts use `PASS|FAIL|SKIP|ERROR|NOT_RUN`; unexecuted LLM, compile, mesh, bbox, and visual facts remain `NOT_RUN`. Do not quote the offline suite as CAD generation quality. `bun run cad:eval` includes frozen regression requirements and exits nonzero whenever required evidence regresses; use `bun run cad:eval:fast` for the smallest harness smoke path. See [Benchmarking](./BENCHMARK.md).

For a CAD pipeline change today, pair unit tests with at least one real backend check:

```bash
bun run test:wasm
# or, for a local native installation
OPENSCAD_BIN=openscad bun run test:openscad
```

`bun run cad:eval:case planetary-engine-ambiguity` invokes the same deterministic analyzer as the product pipeline and verifies the frozen two-option clarification contract. It still reports SCAD/STL/views/validation/baseline data as `NOT_RUN`.

`bun run cad:eval:render` is the separate real-backend gate. It invokes the pinned OpenSCAD WASM runtime, parses the generated binary STL, measures the expected bounding box, verifies the PNG artifact, and writes ignored JSON evidence. It does not call a model and therefore leaves manifold and visual fidelity as `NOT_RUN`. Online model quality/cost evaluation remains a separate future mode.

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

CI installs the checksum-pinned official WASM runtime, audits its license and
integrity metadata, runs the WASM renderer suite, and verifies the traced
standalone runtime. Native OpenSCAD checks remain separate because the system
CLI and OpenGL behavior can vary across environments.

OpenSCAD integration checks cover:

- SCAD to STL rendering
- STL to PNG preview generation without OpenGL
- WASM child-process filesystem and secret isolation
- runtime checksum tamper detection and render capacity recovery
- mesh/manufacturing validation on rendered artifacts when Python mesh dependencies are available
- render pipeline smoke tests that require the OpenSCAD executable

They can be run locally with OpenSCAD installed, or through the optional manual/scheduled OpenSCAD integration job. The GitHub Actions OpenSCAD job is non-blocking so core application quality remains the required signal.
