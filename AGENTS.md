# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|---|---|
| Dev | `bun run dev` |
| Dev compatibility alias | `bun run dev:all` (currently the same Next.js process) |
| Build for production | `bun run build` |
| Start production server | `bun run start` |
| Author preflight | `bun run doctor` |
| Lint | `bun run lint` |
| Test | `bun run test` |
| Test OpenSCAD WASM runtime | `bun run test:wasm` |
| Audit dependency licenses | `bun run license:audit` |
| Check OpenSCAD libraries | `bun run scad:libs:check` |
| Install default OpenSCAD libraries | `bun run scad:libs:install` |
| Install GPL OpenSCAD libraries explicitly | `bun run scad:libs:install:gpl` |
| Sync DB schema to SQLite | `bun run db:push` |
| Generate Prisma client | `bun run db:generate` |
| Run DB migrations | `bun run db:migrate` |
| Reset DB | `bun run db:reset` |
| Run offline CAD harness fixtures | `bun run cad:eval` |
| Run simple offline fixtures | `bun run cad:eval:fast` |
| Run one evidence case | `bun run cad:eval:case <id>` |
| Parse last harness report as JSON | `bun run cad:eval:report` |
| Run real deterministic WASM render benchmark | `bun run cad:eval:render` |
| Verify a downloaded assembly ZIP (no LLM or renderer) | `bun run cad:assembly:verify path/to/assembly.zip` |
| Reconstruct a placed assembly STL from a verified ZIP | `bun run cad:assembly:reconstruct assembly.zip layout.stl [--reference independent-pose.stl]` |
| Download a placed assembly layout from the app | `GET /api/jobs/{id}/assembly/layout?sourceSha256=...&specSha256=...&download=1` (complete generated-part assemblies only) |
| **UX baseline (states, acceptance, wait, cost, abandoned runs)** | `bun run ux:baseline [--stale-hours 2]` |
| Clear metric columns after a definition change | `bun run metrics:reset` (dry run) · `bun run metrics:reset -- --yes` (applies) |

## Functional assembly task tracker

Use [`docs/ASSEMBLY_EXECUTION_BACKLOG.md`](docs/ASSEMBLY_EXECUTION_BACKLOG.md) as the ordered A01–A14 execution ledger. Do not equate source completion with mechanical validation; update the ledger after CI and evidence checkpoints. The on-demand assembly inspection route is `/api/jobs/{id}/assembly/evidence` (source/spec hashes required), triggered only from the Assembly panel. It renders and measures; do not add it to background polling or implicitly mark the job accepted. The read-only result contains both current contract-gated verdicts and unapproved raw measured statuses.




## A05.2 — replayable collision frames (pre-viewport integration)

A failed or undecidable `checkRigidPosePath` now carries `replayFrame` on `blockedAt` or `undecidedAt`: exact validated row-major 4×4 `movingWorldFromLocal` and `obstacleWorldFromLocal` transforms *actually fed to BVH*, plus both STL SHA-256 values and the fixed right-handed millimetre coordinate convention. This is the smallest version-bound input needed to independently repeat the **sampled** collision measurement from the exported parts; it does not prove continuous motion or exact contact. The UI displays raw matrices for replay. Keep the saved report bound to source/spec/archive hashes, and bump the checker version to v5 so older history is not current.

The existing `ThreeDViewer` renders `job.stlPath` (single STL), not the separately reconstructed `assembly/layout` with instance transforms. **Do not** use the witness matrix to place a marker in the current viewport or claim 3D focus until that viewport loads the corresponding verified part-instance scene, matches source/spec hashes and maps the geometry to the same coordinate convention. A05 full feature remains open.

## A05.1 — sampled collision witnesses are evidence, not exact contact geometry

The declared rigid-pose disassembly checker now preserves actual `bvhIntersects` results for the first blocked or undecidable sampled pose: obstacle instance ID, zero-based pose index, collision kind, tested triangle-pair count and reason. Intersecting triangles carry their **triangle indices** and the BVH-reported **midpoint of triangle centroids**, which is not an exact contact point and is not penetration depth. `UNKNOWN` records `undecidedAt` and never becomes clear or PASS, including when pair budgets are exhausted. `testedTrianglePairs` is cumulative observed work, not a proof of clearance between poses. The report/UI must not invent continuous path clearance, tool reachability or mechanical force. Checker v3 invalidates older snapshots; A05 parent remains open for richer per-joint detail, allowed contacts and viewport navigation.


## A04.3 — conservative sampled radial fit margin

A diametral clearance check alone cannot approve an eccentric shaft. `measureRevoluteFit` now maps the measured bore/shaft section centres into assembly coordinates and computes, for each paired axial sample, `bore inscribed radius − shaft circumscribed radius − lateral centre offset`. A positive margin larger than the **explicit numerical reserve** (0.001 mm, not a calibration) is required even for an explicitly supplied fit requirement to report sampled fit PASS. At the reserve or below, return NOT_RUN with measured diagnostics: a conservative enclosure no longer establishes clearance, but it is not proof of mesh collision. Explicit user-requested axis limit failures and out-of-band nominal diameters still FAIL. One station cannot validate eccentricity. This only evaluates selected 2D sections, not continuous swept volume, feature intent, printer tolerances or material deformation; A04 parent remains open until independent calibration and intended-feature binding.

`manifest.fits[].radialEnclosure` and the A01/A02 report expose stations, offsets, margins, reserve and coverage. This changes evidence semantics: `ASSEMBLY_EVIDENCE_CHECKER_VERSION` is v4; old v3 records must remain historical, not current.

## Independent sampled feature topology (A04.2)

Actual STL fit checks now include `observeSectionFeatureRole`: for 2–16 sampled axial planes, it verifies closed degree-two cut contours and 29 radial ray crossings, reporting locally observed solid (odd crossing parity), surrounding void (even nonzero crossing parity), or NOT_RUN (open/non-manifold cuts, grazing rays, inconsistent parity/stations, ambiguous seeds). A nested solid insert is classified as solid, not as the intended bore. The observed role is **not** derived from part names or declared role, but the candidate axis and centre still come from a declaration/measurement and are not independently bound to the user's intended feature. Never equate sampled solid/void identity with full-part manifold topology, through-hole continuity, calibration, physical fit or user acceptance.

A measured numeric candidate clearance may PASS while the observed bore is solid; `prepareAssembly` now refuses to promote such a fit to assembly PASS (final NOT_RUN, with raw numeric values retained). Preserve legitimate outside-band FAIL measurements. The checker semantics changed; `ASSEMBLY_EVIDENCE_CHECKER_VERSION` is v2, and old snapshots must be historical. A04 remains incomplete until independently calibrated feature/axis association and uncertainty bounds exist.

## Candidate contract-bound fit checking

`resolveContractFitRequirements` binds an explicitly asserted, required mm diametral clearance to exactly one named revolute joint/bore in the frozen contract. `prepareAssembly` evaluates candidate geometry from rendered part meshes; `manifest.fitBinding`, `fits[*].measuredStatus` and clearance numbers are diagnostic evidence, but `fits[*].status` and `evidence.assembly.status` remain NOT_RUN without independent target-feature identification/calibration. **Never infer bore vs shaft from the larger diameter**, silently pick the first of multiple joints, or label candidate fit as manufacturing/function PASS. Parent A04 is not complete until calibrated identity/uncertainty and negative decoys are proven.

## Assembly evidence snapshot contract

A01 is the explicitly invoked, ephemeral `GET /api/jobs/{id}/assembly/evidence` (no persistence). A02 stores a *new*, independently server-measured, digest-bound history entry via `POST /api/jobs/{id}/assembly/evidence/snapshots?sourceSha256=...&specSha256=...`; read history via `GET /api/jobs/{id}/assembly/evidence/snapshots?limit=10&cursor=...`. Never trust client-provided evidence verdicts or overwrite a stored record. The API holds the assembly export lease while re-rendering and writing.

Each snapshot binds source SHA, spec SHA, ZIP SHA, requirement confirmation fingerprint and checker version. Reads must re-check source/spec/confirmation/DELIVERED/checker version; stale rows are retained but **cannot count as current PASS**. `bindingCurrent` means version match, not that the function was accepted or physically validated. Digest is not an origin signature. Do not add snapshot creation to regular polling or use it as an accepted/rejected outcome. Update `ASSEMBLY_EVIDENCE_CHECKER_VERSION` when the check semantics change.

## Deployment policy

- **Do not deploy to Vercel by default.** Git-triggered Vercel deployments for all branches, including `main` and PR previews, are disabled by `vercel.json` (`git.deploymentEnabled: false`).
- Ordinary development should create commits/PRs and run GitHub Actions CI. Building with `bun run build` is a local/CI verification step, not a deployment.
- Only initiate a Vercel deployment, promotion, redeployment, or enable Git deployments when the user explicitly asks to publish/deploy.
- Keep the current production deployment intact unless the user requests a production change. Do not re-enable automatic deployment as a side effect of other work.

Tests use Bun's built-in test runner. Run `bun run test` before handing off CAD pipeline or skill resolver changes.

`bun run ux:baseline` is the evidence loop's collection step: it prints state distribution, acceptance and verdict coverage, wait-time percentiles, model cost, and **runs that never finished**. A run ends by writing `latencyMs` in its `finally` block, so a job sitting in an in-flight state (`NEW` / `SCAD_GENERATED` / `RENDERED` / `VALIDATED` / `DEBUGGING` / `REPAIRING`) with no `latencyMs` is a run that never got to finish. That is the only abandonment signal the product has, and it depends entirely on the `finally` write — remove that write and the signal dies silently. It cannot distinguish a closed tab from a server restart; both look identical, and the script says so.

The offline evaluator uses `PASS|FAIL|SKIP|ERROR|NOT_RUN` evidence and never marks unexecuted geometry facts as passing. It does not call an LLM or OpenSCAD; treat it as intent/schema/retrieval evidence, not compile, mesh, bbox, semantic-quality, or model-comparison evidence. `cad:eval:render` is a separate real WASM compile/STL/bbox/PNG gate and still does not imply manifold, visual, or model quality. `cad:eval` includes frozen regressions; `cad:eval:fast` is the smallest offline smoke suite.

## Architecture

**AgentSCAD** is a local-first, open-source parametric CAD web app. It has no account system. Users configure their own model provider/API key, submit natural-language descriptions, and receive editable OpenSCAD plus rendered STL/PNG artifacts and validation evidence. Local development stores jobs in SQLite, artifacts on the local filesystem, and custom provider settings in `.agentscad/providers.json`.

OpenSCAD is the core CAD execution engine. Local development can use the native CLI; serverless and explicit `AGENTSCAD_OPENSCAD_BACKEND=wasm` runs use the checksum-pinned official OpenSCAD WASM CLI. LLMs handle request interpretation, SCAD generation, repair, chat, and optional visual review. Deterministic code remains authoritative for compiling/rendering geometry and checking measurable mesh/manufacturing facts.

### Core Pipeline

`src/app/api/jobs/[id]/process/route.ts` is a thin HTTP/SSE adapter. It validates the job exists, checks the state is processable, emits raw SSE frames, and calls `executeCadJob`.

`src/lib/pipeline/execute-cad-job.ts` owns the current runtime state machine:

1. **INTAKE** — analyze the deterministic intent index first; index-unknown requests get one bounded model intake whose untrusted JSON is validated. Any supported ambiguity is persisted and moves to `HUMAN_REVIEW`; the UI records the user's selected meaning before continuing.
2. **GENERATE** — the selected/configured LLM generates structured CAD intent and complete OpenSCAD for both known families and arbitrary freeform requests. Family detection is optional prompt/retrieval context, never a generation gate. Legacy templates for four known families are disabled by default and available only through the explicit `AGENTSCAD_TEMPLATE_FALLBACK=true` demo switch.
3. **RENDER** — native OpenSCAD or the isolated WASM child process renders SCAD to STL; the serverless preview path projects the STL to PNG.
4. **VALIDATE** — deterministic rules inspect compile/render evidence, dimensions, connectivity, holes, wall thickness, and mesh facts. Visual review is a separate user-triggered VLM path.
5. **DELIVER** — SCAD, STL, PNG, parameters, and validation reports are available. `DELIVERED` does not prove that the artifact matches the user's intent or that the user accepted it. Acceptance is a separate fact the user records through the outcome ledger (`POST /api/jobs/{id}/outcome` with `accepted` or `rejected`); the checks module offers that verdict once a part is built and nothing blocks it.

Each step emits SSE events to the requesting frontend. The broader workspace refreshes job data through polling; there is no separate WebSocket service in the current repository.

### Thin Harness, Fat Skills Rules

- Keep CAD reasoning, repair strategy, validation interpretation, and manufacturing judgment in `skills/`.
- Keep deterministic work in code: OpenSCAD rendering, Python/trimesh validation, Prisma writes, artifact paths, SCAD sanitization, SSE formatting, polling adapters, file IO, and tests.
- Preserve runtime contracts unless a migration explicitly updates the frontend and tests: SSE `data: ${JSON.stringify(payload)}\n\n`, existing state strings, existing step strings, `/artifacts/{jobId}/model.stl`, `/artifacts/{jobId}/preview.png`, and the legacy `validationResults` fields `rule_id`, `rule_name`, `level`, `passed`, `is_critical`, `message`. Results may add explicit `status` (`PASS|WARN|FAIL|SKIP|ERROR|NOT_RUN`); skipped/unavailable checks must not be counted as passed.
- Preserve model routing behavior: an explicitly configured provider/model first, then built-in OpenRouter/DeepSeek/MiMo routing where applicable, then `z-ai-web-dev-sdk`. Do not silently replace failed model generation with product-family templates; keep templates behind the explicit demo-only switch.
- Prefer wrappers and adapters over route rewrites. The process route should become thinner gradually, only after behavior-preserving tools are proven.
- Prefer artifact-first CAD architecture: generate or repair complete OpenSCAD, then let deterministic tools parse parameters from top-level SCAD assignments. Do not make hidden JSON-only parameters the source of truth.
- Improve CAD quality through general library support, render feedback, and repair loops rather than hardcoded product-family geometry.
- Do not copy third-party CAD app or library source code into this repository without explicit licensing review.
- Keep approved OpenSCAD library policy in `skills/scad-library-policy/manifest.json`, not hardcoded route logic.
- Managed OpenSCAD libraries live outside the repo at `~/.agentscad/openscad-libraries` by default. `AGENTSCAD_OPENSCAD_LIBRARY_DIR` overrides it; legacy `CADCAD_OPENSCAD_LIBRARY_DIR` is still accepted.
- Use `OPENSCAD_LIBRARY_PATHS`/`OPENSCADPATH` only for additional reviewed local OpenSCAD library parent directories.
- Default library installation must not include GPL libraries. NopSCADlib requires explicit opt-in through `bun run scad:libs:install:gpl`.
- Keep `src/app/api/jobs/[id]/process/route.ts` as a thin HTTP/SSE adapter. Put CAD job state-machine work in `src/lib/pipeline/execute-cad-job.ts` or lower-level tools.
- After generation or any SCAD rewrite (compile repair, validation repair, VLM repair, manual apply), re-derive `parameterSchema`/`parameterValues` from the persisted SCAD via `buildScadParameterPersistence`. Stale generation-era keys make the parameter UI inert.
- The job state display table in `src/components/cad/types.tsx` must cover every state in the API's `VALID_STATES` list. A missing state falls through to the default, and the default reads as 草稿 — so a job stuck in that state looks like a brand new empty part.
- Progress for a part is an explicit state → percentage map, not an index lookup into the happy-path steps. A lookup returns 0 for every off-path state, and the card clamps 0 to a 4% bar, so a part being repaired appears to have just started.
- The shortcuts sheet is a contract with the running app: it may only list keys the shell binds, and it must show the real inspector tab set (描述 / 源码 / 记录). Retiring a key means removing its row; promising a key means binding it.
- `accepted` and `rejected` must always have a UI producer. The outcome ledger is the only place the product records whether a generation worked; edits and exports are process signals, not verdicts, and a ledger with no decision events cannot measure task success.

### API Layer

Next.js Route Handlers under `src/app/api/`:
- `jobs/` — CRUD, batch operations, pipeline processing, SCAD editing, versioning
- `chat/` — LLM chat with SSE streaming
- `models/` — configured models plus 50 recommendations across 21 provider presets
- `providers/` — provider configuration, encrypted browser-session storage on Vercel, and connection testing
- `health/` — health check

### Frontend

`src/components/cad/workspace/MainWorkspace.tsx` is the central UI — a 3-panel IDE-like layout:
- **Left**: Job list with drag-and-drop reordering
- **Center**: 3D viewer (Three.js/R3F) + pipeline status
- **Right**: 6-tab inspector (SPEC, PARAMETERS, ASSIST, VALIDATION, HISTORY, CODE)

Key client files:
- `src/components/cad/api.ts` — client-side API functions + SSE streaming helpers
- `src/components/cad/types.tsx` — job types, state colors, pipeline step definitions

### Persistence and Realtime

- Prisma ORM uses SQLite locally (`DATABASE_URL`, default `db/dev.db`). The current canonical schema has `Job`, `JobVersion`, and the append-only `JobOutcome` ledger. `JobOutcome` records what the user did (accepted, rejected, edited, exported) and stays separate from pipeline state; `DELIVERED` still never implies acceptance. `accepted` and `rejected` are produced by the checks module's delivery verdict; `exported` and `user_edited` are produced by the artifact and parameter routes. The ledger is append-only, so the most recent decision wins.
- Rendered artifacts use local files in normal local development and Vercel Blob in serverless deployments.
- Browser requests receive an opaque HttpOnly job-session cookie for isolation. This is not an account or user-management system.
- Active process progress uses SSE; workspace list refresh uses polling. No standalone WebSocket or mini-service runtime exists in the current tree.
- **Run metrics are a contract, not decoration** (DESIGN.md §29). `latencyMs` = wall-clock time for one run, written once in the pipeline's `finally` block. `llmCallCount` = model calls a job has made, cumulative across runs, flushed as a delta. Two rules follow mechanically: never add a second `latencyMs` write, and never assign `llmCallCount` an absolute value — both mistakes already shipped once and produced numbers that looked trustworthy and were not. A regression test in `src/lib/__tests__/run-metrics-contract.test.ts` locks each invariant.
- Every model call reaches `createChatCompletionDetailed` in `lib/tools/model-router.ts`. It is the single counting point for `llmCallCount`. If you add a path that talks to a provider directly, those calls silently stop being counted.
- Changing what a metric means requires a cut-over: run `bun run metrics:reset -- --yes` against each database. It empties both columns so any non-null `latencyMs` afterwards is provably new-semantics. Without it, old and new rows are indistinguishable in one column.

### LLM Integration

- `src/lib/mimo.ts` — Xiaomi MiMo API client (OpenAI-compatible format)
- `src/lib/openrouter.ts` — OpenRouter API client (defaults to GPT-5.6 Sol)
- `src/lib/provider-catalog.ts` — source of truth for provider presets and recommended model metadata
- `src/lib/tools/model-router.ts` — Routes requests to MiMo, OpenRouter, DeepSeek, or fallback
- `src/lib/tools/model-stream.ts` — Accumulates OpenAI-compatible SSE completions for long generations; `stream: true` prevents multi-minute non-streaming bodies from being reset by providers (~240s observed) and JSON bodies still fall back cleanly.
- `src/lib/tools/model-transport-retry.ts` — Bounded, abortable retry for transient transport resets (ECONNRESET / undici socket codes); schema, auth, and truncation failures are not retried.
- User-configured OpenAI-compatible providers are the primary product path; environment presets and `z-ai-web-dev-sdk` provide compatibility/fallback paths. SCAD generation streams and retries a dropped connection once; repair/intake stay non-streaming.

### OpenSCAD Library Bundle

- `skills/scad-library-policy/manifest.json` is the source of truth for approved libraries, pinned commits, detection files, include examples, and license gates.
- `skills/scad-library-policy/scripts/install_scad_libraries.py` installs the managed local bundle.
- `skills/scad-library-policy/scripts/check_scad_libraries.py` reports what OpenSCAD can currently resolve.
- `skills/scad-library-policy/scripts/validate_scad_includes.py` validates generated `include`/`use` statements against approved and available libraries.
- `src/lib/tools/scad-library-resolver.ts` reads the manifest and runtime paths, then injects only available library skill guidance into generation prompts.
- `config/openscad-wasm-runtime.json` pins the official OpenSCAD WASM snapshot, checksums, license, and corresponding source commits used by serverless builds.

### v2.0 Module Structure

**Content directories** (repo root, not source code):
- `cad_knowledge/examples/` — reference SCAD files injected into generation prompts via ranked alias retrieval
- `cad_knowledge/retrieval-index.json` — alias table with strong/supporting weights, hard negatives, and family hints; the source of truth for what retrieval can match
- `cad_knowledge/patterns/` — design pattern docs (hole patterns, brackets, enclosures, printable rules)
- `cad_knowledge/failures/` — common failure mode docs for repair guidance
- `openscad_lib/agentscad_std.scad` — standard library (11 modules), pure OpenSCAD with optional BOSL2
- `openscad_lib/README.md` — module reference, doubles as LLM prompt injection content

**Source directories** (`src/lib/`, compiled TypeScript):
- `src/lib/retrieval/example-retriever.ts` — ranked local example/pattern retrieval (zero-token)
- `src/lib/retrieval/retrieval-index.ts` — alias table, normalization, weighted scoring, and hard negatives for retrieval and family hints; data lives in `cad_knowledge/retrieval-index.json`
- `src/lib/validation/validation-types.ts` — `ValidationCheck`, `ValidationReport`, `RawMeshData` interfaces
- `src/lib/validation/report.ts` — `computeReport()` factory for structured validation reports
- `src/lib/validation/compile-check.ts` — C001: OpenSCAD compile success/error detection
- `src/lib/validation/bbox-check.ts` — B001: bounding box match vs validation_targets
- `src/lib/validation/component-check.ts` — C002: floating/disconnected part detection
- `src/lib/validation/hole-check.ts` — H001: through-hole count via Euler characteristic
- `src/lib/validation/motion-contract.ts` — M001: motion-ready requests expose a crank/motion angle, kinematic function, phased internals, and a cutaway; a missing contract is a blocking critical failure
- `src/lib/repair/repair-controller.ts` — validation-driven LLM repair orchestrator
- `src/lib/repair/visual-repair-controller.ts` — user-triggered VLM visual repair

## Key Config

- **Runtime**: Bun (primary), Node.js as fallback
- **Path alias**: `@/*` maps to `./src/*`
- **Build**: standalone Next.js output (`next.config.ts`)
- **Styling**: Tailwind CSS v4 + Shadcn UI (new-york style, CSS variable theming, lucide icons)
- **ESLint**: nearly all rules disabled (flat config in `eslint.config.mjs`)
- **CAD runtime**: native OpenSCAD must be installed for local native rendering; Vercel/AWS Lambda and explicit `AGENTSCAD_OPENSCAD_BACKEND=wasm` builds use the checksum-pinned official WASM runtime

## Env Variables

Copy `.env.example` to `.env`. `DATABASE_URL` is required and already defaults to local SQLite. Provider variables are optional at process startup because users can add their own provider in **Settings → Providers**; full LLM-backed CAD quality requires at least one working provider/key. Template generation without a key is diagnostic fallback behavior, not the main quality path.

OpenSCAD library env:

- `AGENTSCAD_OPENSCAD_LIBRARY_DIR` overrides the managed library directory; `CADCAD_OPENSCAD_LIBRARY_DIR` is legacy compatibility.
- `OPENSCAD_LIBRARY_PATHS` adds extra reviewed library parent paths.
- `OPENSCADPATH` is passed through to OpenSCAD and augmented by the resolver.

Native OpenSCAD render env:

- `AGENTSCAD_OPENSCAD_TIMEOUT_MS` sets the native compile/render budget in milliseconds (default `300000`, clamped 5s-50min). Exceeding it is classified as a complexity timeout: the pipeline attempts one simplification repair and preserves the rejected source for review. The isolated WASM renderer keeps its fixed 120s timeout.
- Compile validation keeps a bounded in-process STL cache for the following render (parameter overrides recompile). Native output uses binary STL; native sources without `color()` use the fast mesh projection for the PNG, while sources containing `color()` use the OpenSCAD PNG renderer so material colours and the cutaway survive (both fall back to the projection when the OpenSCAD preview fails). WASM keeps the fixed child-process projection. Compilation diagnostics travel with cached native STL. Rejected generation snapshots are retained in `repairHistory`, and unavailable validation preserves the editable source without spending a model repair call.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "wtf", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health
