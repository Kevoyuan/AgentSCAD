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
| Verify an exported assembly ZIP without running CAD | `bun run cad:assembly:verify path/to/assembly.zip` |
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
| `AGENTSCAD_LLM_TIMEOUT_MS` | Optional | Application-level model timeout in milliseconds. Unset or `0` disables it; positive values are opt-in. Hosting platforms may still enforce their own function duration limit. |
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


## Assembly ZIP integrity verification

After downloading a generated assembly ZIP, run:

```bash
bun run cad:assembly:verify path/to/agentscad-assembly.zip
```

The offline verifier checks ZIP entry names and size limits, SHA-256 of the
canonical assembly specification and each generated STL, valid binary STL
triangle tables, declared part IDs and manufacturing quantities, and exact
manifest/specification instance transforms. Purchased parts are intentionally
listed without an STL. On success it prints JSON with `status: "PASS"`;
on failure it prints a machine-readable error and returns a nonzero exit code.
No API key, model call, OpenSCAD executable, database or server is needed.

**Evidence boundary:** this verifies internal consistency of a downloaded ZIP,
not its origin or whether the part is mechanically sound. The ZIP is not signed,
its source SCAD is not embedded and cannot be checked against
`sourceSha256` offline. README text, recorded validation verdicts,
unobserved joint behavior and physical function are not independently validated.
Do not interpret an integrity PASS as an assembly-function PASS.


## Offline assembly layout reconstruction (M2)

Create a separate, **unmerged** assembly-pose STL from the manufacturing parts
and instance transforms inside an already-verified ZIP:

```bash
bun run cad:assembly:reconstruct assembly.zip layout.stl
```

- Each declared generated instance is placed using its row-major local-to-world
  rigid transform. Identical designs used multiple times remain distinct
  instances in the output; this is not a Boolean union.
- Missing purchased-part geometry prevents full reconstruction by default.
  Use `--allow-partial` only for an explicitly incomplete layout.
- The command prints the source, archive, specification and reconstruction
  SHA-256 digests, per-instance part IDs and triangle counts, world-space bounds,
  purchased-instance gaps and reference-comparison status.
- For an independent **single-pose** geometry check, first produce an assembled
  STL from the original source separately (for example by OpenSCAD) and run:

```bash
bun run cad:assembly:reconstruct assembly.zip layout.stl --reference independent-pose.stl
```

  With a reference, the command exits successfully only if the reference
  matches the reconstructed triangulated surface within the checker tolerance.
  A clear bounds difference is FAIL; incompatible triangulations or exhausted
  comparison budgets are NOT_RUN; invalid inputs are ERROR. In all cases the
  report retains the exact archive and reference hashes. If no reference is
  provided, the comparison remains NOT_RUN. Purchased geometry cannot be
  silently invented or counted as an independently reconstructed instance.

**Evidence boundary:** a successful reconstruction establishes only that a
rigid layout STL was deterministically produced from the archive. Even a
matching independently rendered STL checks a single tessellated pose, not
joint kinematics, interference, manufacturing fit, tools, strength or physical
function. The reference source and its origin must be independently trusted;
matching a reference derived from the ZIP itself is circular evidence.

## Functional assembly roadmap and measured evidence UI

The ordered, evidence-gated task breakdown is [`ASSEMBLY_EXECUTION_BACKLOG.md`](./ASSEMBLY_EXECUTION_BACKLOG.md) (A01–A14). The UI's **Run assembly geometry checks** button calls `GET /api/jobs/{id}/assembly/evidence?sourceSha256=<64hex>&specSha256=<64hex>` only on user demand. The authenticated route takes the same execution lease as the ZIP export; it renders original generated parts, runs the declared sampled disassembly check, checks the job/source/spec and confirmed requirement contract again, and returns a bounded JSON report. No LLM call or background polling is involved.

The response carries source/spec/archive hashes, `evidence` statuses and reasons, contract confirmation, raw/gated disassembly results, sampled pose counts/steps, first blocking instance and optional fit measurements. **No result is persisted in A01**, and no `accepted`, `validated`, or `exported` outcome is recorded. On confirmation or source changes the user must run the check again; A02 explicitly covers durable snapshots and invalidation. A printed `PASS` only applies to its exact sampled method, artifact versions and requirements; a raw PASS under an unconfirmed contract is exposed but not promoted. No browser preview, simulation or physical test is silently inferred.





## A05.2 — collision reproduction with exact witness poses

For each first sampled collision or undecidable BVH query, `rigid-pose-path` now captures the exact validated 4×4 row-major transforms of the **moving** and **obstacle** meshes used in that query, along with their actual rendered STL SHA-256 hashes. These values travel through the bounded A01 inspection and append-only A02 snapshots in `blockedAt.replayFrame` / `undecidedAt.replayFrame`. The UI provides expandable, selectable matrices. Regression tests re-run the independent triangle collision checker from the recorded matrices, including translated obstacles and an UNKNOWN mesh. Exact matrix output is evidence for a *single sampled pose*, not an exact contact point or sweep.

**Viewport gap:** `ThreeDViewer` currently visualizes the single job STL; it is not a per-instance assembly renderer. Therefore A05.2 does NOT claim collision focus or drop a marker into unrelated geometry. A full assembly-scene renderer must load verified ZIP parts with instance placements and verify source/spec hashes before adding a 3D focus/highlight action. Existing readout is intentionally read-only. Evidence checker v5 makes earlier snapshot reports historical.

## A05.1 — collision pair evidence and undecided positions

The deterministic `checkRigidPosePath` returns the first blocking (FAIL) sample as `blockedAt`, including `poseIndex`, `obstacleId`, collision status, the actual number of triangle-pair tests in that comparison, and `collisionReason`. If the BVH finds an intersecting pair, it also returns the indices of those two triangles and `witnessCentroidPointMm` (centroid midpoint as computed by the collision backend, **not** a precise intersection/contact coordinate). Containment may report no triangle witness; the UI must not fabricate one.

For `UNKNOWN`, the same checker returns a bounded `undecidedAt` with the specific zero-based pose, obstacle instance, reason, tested pairs, and whether the triangle-pair budget was exhausted. It records `testedTrianglePairs` across the evaluated sequence, plus the original sampling bounds. The A01/A02 evidence report and UI display these details; status remains NOT_RUN for undecided and FAIL for actual blocking observations. Checks are still only at discrete declared poses; no swept volume, minimum clearance, contact depth, tools, loading or physical assembly is established. Evidence checker v3 marks pre-v3 saved reports historical.


## A04.3 — sampled radial enclosure guard against false nominal clearance PASS

A nominal diametral interval may match the frozen requirement even if the shaft is too far off-axis to fit the bore. The deterministic `fit-measurement` module now transforms **measured** local section centres on both generated meshes into assembly coordinates. For each matching sampled axial station it measures their lateral offset and computes a conservative local radial margin: bore inscribed radius − shaft circumscribed radius − lateral offset. The report includes `radialEnclosure.stations[]` with station position, offset, and margin, plus the worst observed margin and a 0.001 mm *numerical safety reserve*. This reserve is a software guard, **not** a calibrated error bar or a claim about print shrinkage or physical tolerances.

If the worst observed margin cannot exceed the reserve, `assessFit` returns NOT_RUN, not PASS. An off-axis condition is not itself an observed triangle collision, so FAIL is not invented. Independently asserted offset/angle limits and out-of-band diameter requirements continue to yield FAIL. With fewer than two stations, the radial enclosure is NOT_RUN. Older snapshots cannot remain current when the check changes: v4 makes v3 and older records historical. This work reduces false positives but does not establish intended bore/shaft identity, independent centre uncertainty, continuous clearance, or an all-geometry contact guarantee; parent A04 is still open.

## A04.2 — observed section topology of actual candidate features

The deterministic `observeSectionFeatureRole` tool observes the STL at 2–16 specified axial stations. It requires cut contours made of closed degree-two edge loops and samples 29 non-tangent rays from the candidate centre per station. Odd nonzero ray crossing parity suggests local solid, even nonzero parity suggests local void. A real hinge's outer arm can add pairs of crossings along some rays without changing void classification. A solid insert inside a tube changes the centre to solid. Open cuts, vertex/grazing rays, offset seeds and inconsistent parity/stations return `NOT_RUN`. The result appears on each fit as `boreRoleCheck` and `shaftRoleCheck` in the manifest and bounded A01/A02 evidence report, with a warning in the UI if the declared bore/shaft label contradicts the geometry.

The check cannot establish that the local void is the user's *intended* bore, that a hole continues between sampling planes or that the full mesh is watertight/manifold. It does not calibrate feature-centre or ray-sampling uncertainty. No automatic fit is promoted to PASS; even explicitly supplied fit checks cannot return PASS if observed topology contradicts the role or is undecidable, although the raw candidate diameter comparison remains inspectable. This change increments `ASSEMBLY_EVIDENCE_CHECKER_VERSION` from v1 to v2: old saved reports remain inspectable historical evidence but are not current. The A04 parent task still requires independent calibration and holdout/decoy validation.

## A04.1 — candidate bore/shaft fit from the frozen requirement contract

`prepareAssembly` now connects a **required, applicable, explicitly stated** diameter-clearance range (mm) in the supplied requirement contract to the existing `measureRevoluteFit` tool when a single revolute connection names its bore instance. No client-side manual `fitRequirements` JSON is needed. The renderer supplies the real generated STL bytes, and the manifest/report retains candidate measured diametral clearance, axis offset, raw assessment and original contract bounds.

**Evidence safety:** the role `boreInstanceId` comes from the *assembly declaration*. A declared or well-fitted cylindrical surface is not proof that the measured feature is the user's intended bore/shaft. Consequently, automatic binding remains **NOT_RUN for final assembly fit**, even if the candidate assessment is PASS or FAIL; the raw candidate result remains inspectable. Ambiguous multiple revolute connections, missing bore identity, waived/missing requirements, unsupported units or corrupt spec are not guessed or promoted to PASS. Independently calibrated feature identity and measurement uncertainty remain under parent task A04 (#26). Existing explicitly supplied test fit requirements preserve their old semantics.

## A02 — retained assembly evidence snapshots

An explicit **Save new evidence snapshot** action performs a fresh authenticated, current-source/spec-guarded server render and deterministic measurement (not a client upload). It saves an immutable `JobVersion` row (`field = __assembly_evidence_snapshot`); the row includes the full bounded A01 summary, the archive SHA-256, source/specification hashes, the exact requirement confirmation fingerprint, a checker version, a check timestamp and a canonical JSON digest. There is no schema migration, no job acceptance event and no automatic model call.

`GET /api/jobs/{id}/assembly/evidence/snapshots` reads the latest ten records, optionally with `limit` (max 20) and `cursor` for older records, and returns `{ snapshots, nextCursor }`. Session authorization is mandatory. Every read recomputes the current source/spec/requirements/DELIVERED binding. Historic reports remain accessible but return `bindingCurrent: false` with reasons; malformed or modified rows return `integrity: ERROR` and `snapshot: null`. A newer checker version makes older reports historical. UI offers history inspection and JSON export; unapproved raw measurements are not elevated to PASS.

**Limits:** the SHA-256 record digest detects accidental mutation, not malicious substitution by someone with DB write access. Stored results attest only the measured artifacts and method at the capture instant, not future source revisions, hidden geometric contacts, continuous clearance or physical function. No source ZIP is re-rendered on history GET; always re-measure to get a new current observation. Each record is size-bounded (512 kB), history pages are size-bounded (20 records); records remain append-only and available by pagination. Production backup and external attestation still belong to future tasks.

## Assembly layout export in the UI (M2)

The Assembly panel now offers **Download assembly layout (STL)** alongside
**Download all parts (ZIP)** for delivered jobs with a current source and
assembly specification. The endpoint is `GET /api/jobs/{id}/assembly/layout`;
it accepts the same `sourceSha256`, `specSha256` and optional `download=1`
query arguments as the ZIP route. It reuses `lockAssemblyExport`, a bounded
part renderer, the hash-verified archive reconstruction and a final
`verifyUnchanged()` check before responding. A download logs `exported`
with artifact `assembly_layout`, instance count, source/spec/bundle/layout
hashes and a `referenceStatus: NOT_RUN`; download does not imply acceptance.

Layouts are deliberately only offered when **all instances have generated
geometry**. If any instance is purchased and no geometry was exported, the
endpoint returns HTTP 422 and the UI explains the missing geometry. The ZIP
remains available as the manufacturing inventory. This prevents an incomplete
render from masquerading as the whole assembly.

The returned STL is a transformed triangle collection, not a Boolean union
and not a validated, directly printable assembly. Header
`X-AgentSCAD-Layout-Status: COMPLETE` describes reconstruction completeness,
while `X-AgentSCAD-Reference-Status: NOT_RUN` correctly records that no
independently rendered pose was checked by this request. Collision, fit,
motion, tool access and physical function have not been established.
