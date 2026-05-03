# AgentSCAD Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `openscad` not found | OpenSCAD is not installed or not in PATH | Install OpenSCAD and set `OPENSCAD_BIN` if needed |
| Prisma/database error | SQLite DB or schema is not initialized | Run `mkdir -p db`, `touch db/dev.db`, then `bun run db:push` |
| No AI generation | Provider keys are missing or provider calls failed | Add at least one provider key to `.env`; fallback/template generation may still run |
| Visual repair unavailable | Selected model lacks vision support or provider credentials are missing | Switch to a vision-capable configured model and add the needed provider key |
| Visual validation skipped | Normal pipeline skips visual checks unless the user requests visual repair | Treat skipped visual checks as uncertainty; configure a vision-capable provider before using Visual Repair |
| Docker port conflict | Port 3000 is already in use | Stop the existing process or change the Compose port mapping |
| Docker rendering fails | The Docker image does not bundle OpenSCAD | Use local development with OpenSCAD installed, or provide a custom image |
| Bun command missing | Bun is not installed | Install Bun, or use npm only for basic development commands |
| Windows shell commands fail | Bash commands were pasted into PowerShell | Use the Windows PowerShell setup block in the README |

See [Development and CI](./DEVELOPMENT.md) for commands and [OpenSCAD libraries](./OPENSCAD_LIBRARIES.md) for runtime boundary details.
