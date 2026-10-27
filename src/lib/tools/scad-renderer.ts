import fs from "fs/promises";
import { createHash, randomUUID } from "crypto";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  cleanupArtifactWorkspace,
  getJobArtifactPaths,
  deletePersistedArtifactPathnames,
  persistJobArtifacts,
  writeJobScadSource,
} from "@/lib/tools/artifact-store";
import { isEphemeralRuntime } from "@/lib/runtime-environment";
import { usesOpenScadWasm } from "@/lib/tools/openscad-backend";
import { db } from "@/lib/db";
import { buildOpenScadExecEnv } from "@/lib/tools/scad-library-resolver";
import {
  prepareScadForWasm,
  renderScadToStlWasm,
} from "@/lib/tools/openscad-wasm-runtime";
import { renderStlFilePreview } from "@/lib/tools/stl-preview";
import { getOpenScadDefinitionEntries } from "@/lib/tools/scad-definitions";
import {
  OPENSCAD_WASM_TIMEOUT_MS,
  OpenScadTimeoutError,
  getOpenScadTimeoutMs,
  isOpenScadTimeoutMessage,
  toOpenScadExecError,
  type OpenScadTimeoutStage,
} from "@/lib/tools/scad-timeout";
import openScadPolicy from "../../../config/openscad-wasm-runtime.json";
import type { RenderedArtifacts, RenderLog } from "@/lib/harness/types";

const execFileAsync = promisify(execFile);

export interface ScadExecutionOptions {
  signal?: AbortSignal;
  onDiagnostic?: (message: string) => void;
  onStage?: (stage: "rendering" | "previewing") => void;
}


/** Native OpenSCAD is external; serverless uses the reviewed child-process WASM runtime. */
const OPENSCAD_BIN = process.env.OPENSCAD_BIN || "openscad";
const MAX_VALIDATED_STL_CACHE_ENTRIES = 2;
const validatedStlCache = new Map<string, { stl: Buffer; output: string }>();

function validatedStlCacheKey(scadSource: string): string {
  return createHash("sha256").update(`${usesOpenScadWasm() ? "wasm" : "native"}:`).update(scadSource).digest("hex");
}

/**
 * Cache the STL produced by compile validation so the following render step can
 * reuse it. Native OpenSCAD renders are expensive; without this a dense job paid
 * for the same CGAL compile twice (validation, then STL render).
 */
function cacheValidatedStl(scadSource: string, stl: Buffer, output = ""): void {
  if (stl.length > 32 * 1024 * 1024) return;
  validatedStlCache.set(validatedStlCacheKey(scadSource), { stl, output });
  while (validatedStlCache.size > MAX_VALIDATED_STL_CACHE_ENTRIES) {
    const oldest = validatedStlCache.keys().next().value;
    if (oldest === undefined) break;
    validatedStlCache.delete(oldest);
  }
}

function takeValidatedStl(scadSource: string): { stl: Buffer; output: string } | null {
  const key = validatedStlCacheKey(scadSource);
  const stl = validatedStlCache.get(key) ?? null;
  validatedStlCache.delete(key);
  return stl;
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Count triangles in an STL file buffer. OpenSCAD writes ASCII STL by default and
 * binary STL on request, so both layouts have to be understood: the previous
 * implementation only read the binary header and reported 0 triangles for every
 * native render, which made the C001 compile check fail on healthy geometry.
 */
export function countStlTriangles(buffer: Buffer): number {
  if (buffer.length >= 84) {
    const binaryTriangles = buffer.readUInt32LE(80);
    if (binaryTriangles > 0 && buffer.length >= 84 + binaryTriangles * 50) {
      return binaryTriangles;
    }
  }
  const asciiFacets = buffer.toString("utf8").match(/^\s*facet\s+normal\s/gim);
  return asciiFacets ? asciiFacets.length : 0;
}

const OPENSCAD_WARNING_PATTERN =
  /^(?:WARNING|ERROR|DEPRECATED|Ignoring unknown module|Can.t open include file)\b/i;

/**
 * Keep the OpenSCAD diagnostics that explain a silently degraded render
 * ("Can't open include file", "Ignoring unknown module") instead of dropping them.
 */
export function collectOpenScadWarnings(...outputs: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const output of outputs) {
    if (!output) continue;
    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || seen.has(line)) continue;
      if (!OPENSCAD_WARNING_PATTERN.test(line)) continue;
      seen.add(line);
      warnings.push(line);
    }
  }
  return warnings;
}

export function buildOpenScadDefineArgs(definitions?: Record<string, unknown>): string {
  return getOpenScadDefinitionEntries(definitions)
    .map(([key, value]) => `-D ${quoteShellArg(`${key}=${value}`)}`)
    .join(" ");
}

/**
 * Run native OpenSCAD with the configured budget. Timeout kills become a typed
 * {@link OpenScadTimeoutError}; other failures keep stdout/stderr diagnostics so
 * the compile-repair classifier can still read parser/CGAL messages.
 */
async function execNativeOpenScad(
  args: string[],
  stage: OpenScadTimeoutStage,
  failurePrefix: string,
  options: ScadExecutionOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = getOpenScadTimeoutMs();
  const startedAt = Date.now();
  try {
    options.signal?.throwIfAborted();
    const pending = execFileAsync(OPENSCAD_BIN, args, {
      env: await buildOpenScadExecEnv(),
      timeout: timeoutMs,
      signal: options.signal,
    });
    pending.child.stderr?.on("data", chunk => options.onDiagnostic?.(String(chunk).trim().slice(-1000)));
    return await pending;
  } catch (error) {
    options.signal?.throwIfAborted();
    throw toOpenScadExecError({
      error,
      stage,
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      prefix: failurePrefix,
    });
  }
}

/** The WASM child process reports its fixed timeout as a plain error message. */
function wrapWasmRenderTimeout(
  error: unknown,
  stage: OpenScadTimeoutStage,
  startedAt: number,
): unknown {
  if (!isOpenScadTimeoutMessage(error)) return error;
  return new OpenScadTimeoutError({
    stage,
    timeoutMs: OPENSCAD_WASM_TIMEOUT_MS,
    backend: "wasm",
    elapsedMs: Date.now() - startedAt,
  });
}

export async function validateGeneratedScadSource(scadSource: string, options: ScadExecutionOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  if (usesOpenScadWasm()) {
    const startedAt = Date.now();
    try {
      await prepareScadForWasm(scadSource);
      cacheValidatedStl(scadSource, await renderScadToStlWasm(scadSource, undefined, options.signal));
    } catch (error) {
      throw wrapWasmRenderTimeout(error, "validation", startedAt);
    }
    return;
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentscad-scad-"));
  const tempScadPath = path.join(tmpDir, "validate.scad");
  const tempStlPath = path.join(tmpDir, "validate.stl");

  try {
    await fs.writeFile(tempScadPath, scadSource, "utf8");
    const { stdout, stderr } = await execNativeOpenScad(
      ["--export-format", "binstl", "-o", tempStlPath, tempScadPath],
      "validation",
      "Generated SCAD failed OpenSCAD validation",
      options,
    );
    // Reuse this STL in the render step instead of paying for a second compile.
    cacheValidatedStl(scadSource, await fs.readFile(tempStlPath), `${stdout}\n${stderr}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function renderStl(
  scadFilePath: string,
  stlFilePath: string,
  definitions?: Record<string, unknown>,
  options: ScadExecutionOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  if (usesOpenScadWasm()) {
    const source = await fs.readFile(scadFilePath, "utf8");
    const hasDefinitions = getOpenScadDefinitionEntries(definitions).length > 0;
    const startedAt = Date.now();
    let stl: Buffer;
    try {
      stl =
        (hasDefinitions ? null : takeValidatedStl(source)?.stl) ??
        (await renderScadToStlWasm(source, definitions, options.signal));
    } catch (error) {
      throw wrapWasmRenderTimeout(error, "render", startedAt);
    }
    await fs.writeFile(stlFilePath, stl);
    return "";
  }
  if (getOpenScadDefinitionEntries(definitions).length === 0) {
    const source = await fs.readFile(scadFilePath, "utf8");
    const cached = takeValidatedStl(source);
    if (cached) {
      await fs.writeFile(stlFilePath, cached.stl);
      return cached.output;
    }
  }
  const defineArgs = getOpenScadDefinitionEntries(definitions).flatMap(([key, value]) => ["-D", `${key}=${value}`]);
  const { stdout, stderr } = await execNativeOpenScad(
    [...defineArgs, "--export-format", "binstl", "-o", stlFilePath, scadFilePath],
    "render",
    "OpenSCAD STL render failed",
    options,
  );
  return `${stdout}\n${stderr}`;
}

export async function renderPng(
  scadFilePath: string,
  pngFilePath: string,
  definitions?: Record<string, unknown>,
  options: ScadExecutionOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const defineArgs = getOpenScadDefinitionEntries(definitions).flatMap(([key, value]) => ["-D", `${key}=${value}`]);
  const { stdout, stderr } = await execNativeOpenScad(
    [
      ...defineArgs,
      "-o",
      pngFilePath,
      "--imgsize=800,600",
      "--viewall",
      "--autocenter",
      "--colorscheme=Tomorrow",
      scadFilePath,
    ],
    "preview",
    "OpenSCAD PNG preview render failed",
    options,
  );
  return `${stdout}\n${stderr}`;
}

export async function renderStlPreview(
  stlFilePath: string,
  pngFilePath: string
): Promise<{ triangleCount: number }> {
  return renderStlFilePreview(stlFilePath, pngFilePath);
}

export async function renderScadArtifacts(
  jobId: string,
  scadSource: string,
  definitions?: Record<string, unknown>,
  assertActive?: () => Promise<void>,
  options: ScadExecutionOptions = {},
): Promise<RenderedArtifacts> {
  await assertActive?.();
  if (isEphemeralRuntime()) {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { state: true },
    });
    if (!job || ["CANCELLED", "DELETING"].includes(job.state)) {
      throw new Error("Artifact render cancelled because the job is being deleted");
    }
  }

  const paths = await writeJobScadSource(
    jobId,
    scadSource,
    isEphemeralRuntime() ? `render-${randomUUID()}` : undefined
  );
  const startTime = Date.now();

  try {
    await assertActive?.();
    options.signal?.throwIfAborted();
    options.onStage?.("rendering");
    const stlOutput = await renderStl(paths.scadFilePath, paths.stlFilePath, definitions, options);
    await assertActive?.();
    options.signal?.throwIfAborted();
    options.onStage?.("previewing");
    // Colored sources need OpenSCAD's PNG renderer: the fast mesh projection is
    // monochrome and would drop every color() call (and the cutaway colours) from
    // the preview. Plain and dense native models keep the cheap projection path,
    // with an OpenSCAD fallback when its triangle budget is exceeded.
    const prefersColoredPreview = !usesOpenScadWasm() && /\bcolor\s*\(/.test(scadSource);
    let triangleCount = 0;
    let pngOutput = "";
    if (prefersColoredPreview) {
      try {
        pngOutput = await renderPng(paths.scadFilePath, paths.pngFilePath, definitions, options);
        triangleCount = countStlTriangles(await fs.readFile(paths.stlFilePath));
      } catch (previewError) {
        // Never lose a render because the colored preview failed; the mesh
        // projection is still a valid (if monochrome) preview.
        console.warn("Colored OpenSCAD preview failed; falling back to mesh projection", previewError);
        triangleCount = (await renderStlPreview(paths.stlFilePath, paths.pngFilePath)).triangleCount;
      }
    } else {
      try {
        triangleCount = (await renderStlPreview(paths.stlFilePath, paths.pngFilePath)).triangleCount;
      } catch (previewError) {
        if (usesOpenScadWasm()) throw previewError;
        pngOutput = await renderPng(paths.scadFilePath, paths.pngFilePath, definitions, options);
        triangleCount = countStlTriangles(await fs.readFile(paths.stlFilePath));
      }
    }
    const warnings = collectOpenScadWarnings(stlOutput, pngOutput);
    await assertActive?.();
    const artifactPathnames = await persistJobArtifacts(jobId, paths);
    try {
      await assertActive?.();
    } catch (error) {
      if (artifactPathnames) await deletePersistedArtifactPathnames(artifactPathnames);
      throw error;
    }
    if (isEphemeralRuntime() && artifactPathnames) {
      const job = await db.job.findUnique({
        where: { id: jobId },
        select: { state: true },
      });
      if (!job || ["CANCELLED", "DELETING"].includes(job.state)) {
        await deletePersistedArtifactPathnames(artifactPathnames);
        throw new Error("Artifact render cancelled because the job is being deleted");
      }
    }

    const renderLog: RenderLog = {
      openscad_version: usesOpenScadWasm()
        ? `${openScadPolicy.version}-wasm`
        : "real",
      render_time_ms: Date.now() - startTime,
      stl_triangles: triangleCount,
      stl_vertices: 0,
      png_resolution: "800x600",
      warnings,
      ...(artifactPathnames
        ? { artifact_pathnames: artifactPathnames }
        : {}),
    };

    return {
      artifactsDir: paths.artifactsDir,
      scadFilePath: paths.scadFilePath,
      stlFilePath: paths.stlFilePath,
      pngFilePath: paths.pngFilePath,
      stlPath: paths.publicStlPath,
      pngPath: paths.publicPngPath,
      renderLog,
    };
  } catch (error) {
    await cleanupArtifactWorkspace(paths.scadFilePath);
    throw error;
  }
}

export function buildRenderFailureLog(renderTime = 0, warnings: string[] = []): RenderLog {
  return {
    openscad_version: "error",
    render_time_ms: renderTime,
    stl_triangles: 0,
    stl_vertices: 0,
    png_resolution: null,
    warnings,
  };
}

export function getRenderedArtifactPaths(jobId: string) {
  return getJobArtifactPaths(jobId);
}
