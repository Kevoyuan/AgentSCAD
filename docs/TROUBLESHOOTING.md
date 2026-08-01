# AgentSCAD Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `openscad` not found locally | Native OpenSCAD is not installed or not in PATH | Install OpenSCAD and set `OPENSCAD_BIN`, or set `AGENTSCAD_OPENSCAD_BACKEND=wasm` and rebuild |
| Serverless WASM runtime unavailable | The verified runtime was not installed during the build or its checksum changed | Run `bun run runtime:openscad:install`, then `bun run license:audit` and redeploy |
| Serverless render capacity exhausted | The deployment-wide 20-render-starts-per-minute limit was reached | Wait until the next minute and retry |
| Prisma/database error | SQLite DB or schema is not initialized | Run `mkdir -p db`, `touch db/dev.db`, then `bun run db:push` |
| No AI generation | No usable provider/model is configured, or the provider test failed | Open **Settings → Providers**, choose a preset or OpenAI-compatible endpoint, enter your own key/model, click **Test**, then **Save**. Environment variables are an alternative for unattended deployments. Template fallback is diagnostic only. |
| Provider Save is disabled on Vercel | `PROVIDER_SETTINGS_SECRET` is missing or shorter than 32 characters | Generate a secret with `openssl rand -base64 48`, add it to Vercel Project Settings, then redeploy |
| Remove a saved provider key | The encrypted session cookie remains available to this browser session | Click **Clear keys** in Provider Settings before leaving a shared device; closing one tab alone is not a guaranteed wipe |
| Visual repair unavailable | Selected model lacks vision support or provider credentials are missing | Switch to a vision-capable configured model and add the needed provider key |
| Visual validation skipped | Normal pipeline skips visual checks unless the user requests visual repair | Treat skipped visual checks as uncertainty; configure a vision-capable provider before using Visual Repair |
| Docker port conflict | Port 3000 is already in use | Stop the existing process or change the Compose port mapping |
| Docker rendering fails | The verified WASM runtime was not installed/traced correctly, or the backend was overridden to native without installing a native CLI | Keep the Compose default `AGENTSCAD_OPENSCAD_BACKEND=wasm` and rebuild. If intentionally using `native`, build a custom image that installs the configured `OPENSCAD_BIN`. |
| `行星发动机模型` stops at `HUMAN_REVIEW` | The request has two supported meanings and generation is intentionally blocked | Choose either the planetary propulsion megastructure or planetary-gear motor option. The job records the choice and resumes automatically. |
| `bun run doctor` reports failed checks | A required local runtime, SQLite, OpenSCAD backend, or storage path is unavailable | Follow the exact `Fix:` line printed for each failed check, then rerun `bun run doctor`. Warnings such as missing optional OpenSCAD libraries do not fail preflight. |
| Offline eval is green but no STL was produced | Offline mode intentionally leaves SCAD/LLM/compile/mesh/bbox/visual facts as `NOT_RUN` | Use `bun run test:wasm` or `OPENSCAD_BIN=openscad bun run test:openscad` for real render evidence. |
| Jobs seem separated but there is no login | AgentSCAD has browser-session scoping, not user accounts | This is expected. Without `API_SECRET`, production accepts same-origin browser requests and assigns an HttpOnly job-session cookie. Do not treat it as multi-tenant identity/authentication. |
| Environment provider key is ignored in production | Public mode has no `API_SECRET` | This is intentional fail-closed behavior. Configure `PROVIDER_SETTINGS_SECRET` and enter a per-browser BYO key, or protect a private deployment with `API_SECRET` before enabling shared environment credentials. |
| Bun command missing | Bun is not installed | Install Bun, or use npm only for basic development commands |
| Windows shell commands fail | Bash commands were pasted into PowerShell | Use the Windows PowerShell setup block in the README |

See [Development and CI](./DEVELOPMENT.md) for commands and [OpenSCAD libraries](./OPENSCAD_LIBRARIES.md) for runtime boundary details.
