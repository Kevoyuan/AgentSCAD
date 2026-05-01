import fs from "fs/promises";
import os from "os";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { getJobArtifactPaths, writeJobScadSource } from "@/lib/tools/artifact-store";
import { buildOpenScadExecEnv } from "@/lib/tools/scad-library-resolver";
import type { RenderedArtifacts, RenderLog } from "@/lib/harness/types";

const execAsync = promisify(exec);

/** External CLI boundary — uses user-provided or system OpenSCAD. Not bundled. */
const OPENSCAD_BIN = process.env.OPENSCAD_BIN || "openscad";

function quoteShellArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function formatOpenScadDefineValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return null;
}

export function buildOpenScadDefineArgs(definitions?: Record<string, unknown>): string {
  if (!definitions) return "";

  return Object.entries(definitions)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => {
      const formatted = formatOpenScadDefineValue(value);
      return formatted ? `-D ${quoteShellArg(`${key}=${formatted}`)}` : null;
    })
    .filter(Boolean)
    .join(" ");
}

export async function validateGeneratedScadSource(scadSource: string): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentscad-scad-"));
  const tempScadPath = path.join(tmpDir, "validate.scad");
  const tempStlPath = path.join(tmpDir, "validate.stl");

  try {
    await fs.writeFile(tempScadPath, scadSource, "utf8");
    await execAsync(`${OPENSCAD_BIN} -o "${tempStlPath}" "${tempScadPath}"`, {
      env: await buildOpenScadExecEnv(),
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
  const defineArgs = buildOpenScadDefineArgs(definitions);
  await execAsync(`${OPENSCAD_BIN} ${defineArgs} -o ${quoteShellArg(stlFilePath)} ${quoteShellArg(scadFilePath)}`, {
    env: await buildOpenScadExecEnv(),
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
  });
}

export async function renderScadArtifacts(
  jobId: string,
  scadSource: string,
  definitions?: Record<string, unknown>
): Promise<RenderedArtifacts> {
  const paths = await writeJobScadSource(jobId, scadSource);
  const startTime = Date.now();

  await renderStl(paths.scadFilePath, paths.stlFilePath, definitions);
  await renderPng(paths.scadFilePath, paths.pngFilePath, definitions);

  const renderLog: RenderLog = {
    openscad_version: "real",
    render_time_ms: Date.now() - startTime,
    stl_triangles: 0,
    stl_vertices: 0,
    png_resolution: "800x600",
    warnings: [],
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
