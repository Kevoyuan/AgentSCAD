import fs from "fs/promises";
import { createHash, randomUUID } from "crypto";
import os from "os";
import path from "path";
import { exec } from "child_process";
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
import openScadPolicy from "../../../config/openscad-wasm-runtime.json";
import type { RenderedArtifacts, RenderLog } from "@/lib/harness/types";

const execAsync = promisify(exec);

/** Native OpenSCAD is external; serverless uses the reviewed child-process WASM runtime. */
const OPENSCAD_BIN = process.env.OPENSCAD_BIN || "openscad";
const RENDER_TIMEOUT_MS = 120_000; // 2 minutes — rendering is slower than validation
const MAX_VALIDATED_WASM_CACHE_ENTRIES = 2;
const validatedWasmStlCache = new Map<string, Buffer>();

function wasmCacheKey(scadSource: string): string {
  return createHash("sha256").update(scadSource).digest("hex");
}

function cacheValidatedWasmStl(scadSource: string, stl: Buffer): void {
  validatedWasmStlCache.set(wasmCacheKey(scadSource), stl);
  while (validatedWasmStlCache.size > MAX_VALIDATED_WASM_CACHE_ENTRIES) {
    const oldest = validatedWasmStlCache.keys().next().value;
    if (oldest === undefined) break;
    validatedWasmStlCache.delete(oldest);
  }
}

function takeValidatedWasmStl(scadSource: string): Buffer | null {
  const key = wasmCacheKey(scadSource);
  const stl = validatedWasmStlCache.get(key) ?? null;
  validatedWasmStlCache.delete(key);
  return stl;
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function buildOpenScadDefineArgs(definitions?: Record<string, unknown>): string {
  return getOpenScadDefinitionEntries(definitions)
    .map(([key, value]) => `-D ${quoteShellArg(`${key}=${value}`)}`)
    .join(" ");
}

export async function validateGeneratedScadSource(scadSource: string): Promise<void> {
  if (usesOpenScadWasm()) {
    await prepareScadForWasm(scadSource);
    cacheValidatedWasmStl(
      scadSource,
      await renderScadToStlWasm(scadSource)
    );
    return;
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentscad-scad-"));
  const tempScadPath = path.join(tmpDir, "validate.scad");
  const tempStlPath = path.join(tmpDir, "validate.stl");

  try {
    await fs.writeFile(tempScadPath, scadSource, "utf8");
    await execAsync(`${OPENSCAD_BIN} -o "${tempStlPath}" "${tempScadPath}"`, {
      env: await buildOpenScadExecEnv(),
      timeout: RENDER_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenSCAD validation error";
    throw new Error(`Generated SCAD failed OpenSCAD validation: ${message}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function renderStl(
  scadFilePath: string,
  stlFilePath: string,
  definitions?: Record<string, unknown>
): Promise<void> {
  if (usesOpenScadWasm()) {
    const source = await fs.readFile(scadFilePath, "utf8");
    const hasDefinitions = getOpenScadDefinitionEntries(definitions).length > 0;
    const stl =
      (hasDefinitions ? null : takeValidatedWasmStl(source)) ??
      (await renderScadToStlWasm(source, definitions));
    await fs.writeFile(stlFilePath, stl);
    return;
  }
  const defineArgs = buildOpenScadDefineArgs(definitions);
  await execAsync(`${OPENSCAD_BIN} ${defineArgs} -o ${quoteShellArg(stlFilePath)} ${quoteShellArg(scadFilePath)}`, {
    env: await buildOpenScadExecEnv(),
    timeout: RENDER_TIMEOUT_MS,
  });
}

export async function renderPng(
  scadFilePath: string,
  pngFilePath: string,
  definitions?: Record<string, unknown>
): Promise<void> {
  const defineArgs = buildOpenScadDefineArgs(definitions);
  await execAsync(`${OPENSCAD_BIN} ${defineArgs} -o ${quoteShellArg(pngFilePath)} --colorscheme=Tomorrow ${quoteShellArg(scadFilePath)}`, {
    env: await buildOpenScadExecEnv(),
    timeout: RENDER_TIMEOUT_MS,
  });
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
  definitions?: Record<string, unknown>
): Promise<RenderedArtifacts> {
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
    await renderStl(paths.scadFilePath, paths.stlFilePath, definitions);
    let triangleCount = 0;
    if (usesOpenScadWasm()) {
      triangleCount = (
        await renderStlPreview(paths.stlFilePath, paths.pngFilePath)
      ).triangleCount;
    } else {
      await renderPng(paths.scadFilePath, paths.pngFilePath, definitions);
    }
    const artifactPathnames = await persistJobArtifacts(jobId, paths);
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
      warnings: [],
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
