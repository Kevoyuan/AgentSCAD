import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  BlobNotFoundError,
  del,
  get,
  head,
  list,
  put,
} from "@vercel/blob";
import type { RenderLog } from "@/lib/harness/types";
import { isEphemeralRuntime } from "@/lib/runtime-environment";

export type ArtifactType = "scad" | "stl" | "png";

export interface PersistedArtifactPathnames {
  stl: string;
  png: string;
}

export type StoredArtifactLocation =
  | { kind: "local"; filePath: string }
  | { kind: "remote"; pathname: string };

export type ArtifactExistence = "present" | "missing" | "unknown";

export interface ArtifactPaths {
  artifactsDir: string;
  scadFilePath: string;
  stlFilePath: string;
  pngFilePath: string;
  scadPublicPath: string;
  stlPublicPath: string;
  pngPublicPath: string;
  publicScadPath: string;
  publicStlPath: string;
  publicPngPath: string;
}

export const ARTIFACT_FILENAMES: Record<ArtifactType, string> = {
  scad: "model.scad",
  stl: "model.stl",
  png: "preview.png",
};

export const ARTIFACT_CONTENT_TYPES: Record<ArtifactType, string> = {
  scad: "text/plain; charset=utf-8",
  stl: "application/sla",
  png: "image/png",
};

function assertSafeJobId(jobId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
    throw new Error("Invalid job id for artifact storage");
  }
}

function artifactsRoot(): string {
  if (process.env.AGENTSCAD_ARTIFACT_WORK_DIR) {
    return path.resolve(process.env.AGENTSCAD_ARTIFACT_WORK_DIR);
  }

  return isEphemeralRuntime()
    ? path.join(os.tmpdir(), "agentscad", "artifacts")
    : path.join(process.cwd(), "public", "artifacts");
}

export function getJobArtifactPaths(
  jobId: string,
  attemptId?: string
): ArtifactPaths {
  assertSafeJobId(jobId);
  if (attemptId) assertSafeJobId(attemptId);
  const artifactsDir = path.join(
    artifactsRoot(),
    jobId,
    ...(attemptId ? [attemptId] : [])
  );

  const scadPublicPath = `/artifacts/${jobId}/model.scad`;
  const stlPublicPath = `/artifacts/${jobId}/model.stl`;
  const pngPublicPath = `/artifacts/${jobId}/preview.png`;

  return {
    artifactsDir,
    scadFilePath: path.join(artifactsDir, "model.scad"),
    stlFilePath: path.join(artifactsDir, "model.stl"),
    pngFilePath: path.join(artifactsDir, "preview.png"),
    scadPublicPath,
    stlPublicPath,
    pngPublicPath,
    publicScadPath: scadPublicPath,
    publicStlPath: stlPublicPath,
    publicPngPath: pngPublicPath,
  };
}

export async function ensureJobArtifactsDir(
  jobId: string,
  attemptId?: string
): Promise<ArtifactPaths> {
  const paths = getJobArtifactPaths(jobId, attemptId);
  await fs.mkdir(paths.artifactsDir, { recursive: true });
  return paths;
}

export async function writeJobScadSource(
  jobId: string,
  scadSource: string,
  attemptId?: string
): Promise<ArtifactPaths> {
  const paths = await ensureJobArtifactsDir(jobId, attemptId);
  await fs.writeFile(paths.scadFilePath, scadSource, "utf8");
  return paths;
}

function localPathForPublicArtifact(
  publicPath: string | null | undefined
): string | null {
  if (!publicPath) return null;

  const match = publicPath.match(
    /^\/artifacts\/([A-Za-z0-9_-]+)\/(model\.scad|model\.stl|preview\.png)$/
  );
  if (!match) return null;

  return path.join(artifactsRoot(), match[1], match[2]);
}

function isTrustedBlobPathname(
  value: unknown,
  filename: "model.stl" | "preview.png"
): value is string {
  return (
    typeof value === "string" &&
    new RegExp(
      `^artifacts/[A-Za-z0-9_-]+/[0-9]+-[0-9a-f-]+/${filename.replace(".", "\\.")}$`
    ).test(value)
  );
}

export function getPersistedArtifactPathnames(
  rawRenderLog: string | RenderLog | null | undefined
): PersistedArtifactPathnames | null {
  if (!rawRenderLog) return null;

  try {
    const renderLog =
      typeof rawRenderLog === "string"
        ? (JSON.parse(rawRenderLog) as RenderLog)
        : rawRenderLog;
    const pathnames = renderLog.artifact_pathnames;
    if (
      pathnames &&
      isTrustedBlobPathname(pathnames.stl, "model.stl") &&
      isTrustedBlobPathname(pathnames.png, "preview.png")
    ) {
      return { stl: pathnames.stl, png: pathnames.png };
    }
  } catch {
    // Malformed legacy render logs simply have no persisted artifact metadata.
  }

  return null;
}

export async function persistJobArtifacts(
  jobId: string,
  paths: ArtifactPaths
): Promise<PersistedArtifactPathnames | null> {
  if (
    !isEphemeralRuntime() &&
    process.env.AGENTSCAD_PERSIST_ARTIFACTS !== "1"
  ) {
    return null;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    if (isEphemeralRuntime()) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is required to persist rendered artifacts in serverless runtime"
      );
    }
    return null;
  }

  assertSafeJobId(jobId);
  const version = `${Date.now()}-${randomUUID()}`;
  const prefix = `artifacts/${jobId}/${version}`;

  const upload = async (type: ArtifactType, filePath: string) => {
    return put(`${prefix}/${ARTIFACT_FILENAMES[type]}`, createReadStream(filePath), {
      access: "public",
      addRandomSuffix: false,
      contentType: ARTIFACT_CONTENT_TYPES[type],
      token,
    });
  };

  const uploads = await Promise.allSettled([
    upload("stl", paths.stlFilePath),
    upload("png", paths.pngFilePath),
  ]);
  const [stl, png] = uploads;
  if (stl.status === "rejected" || png.status === "rejected") {
    const completedUrls = uploads
      .filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof put>>> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value.url);
    if (completedUrls.length > 0) {
      try {
        await del(completedUrls, { token });
      } catch (cleanupError) {
        console.error("Failed to clean partial artifact upload:", cleanupError);
      }
    }
    const failureReason =
      stl.status === "rejected"
        ? stl.reason
        : png.status === "rejected"
          ? png.reason
          : new Error("Artifact upload failed without a rejection reason");
    throw failureReason;
  }

  return {
    stl: stl.value.pathname,
    png: png.value.pathname,
  };
}

export async function deleteJobArtifacts(jobId: string): Promise<void> {
  assertSafeJobId(jobId);
  await fs.rm(path.join(artifactsRoot(), jobId), {
    recursive: true,
    force: true,
  });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;

  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: `artifacts/${jobId}/`,
      cursor,
      limit: 1000,
      token,
    });
    if (page.blobs.length > 0) {
      await del(
        page.blobs.map((blob) => blob.url),
        { token }
      );
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteSupersededJobArtifacts(
  jobId: string,
  rawRenderLog: string | RenderLog | null | undefined
): Promise<void> {
  assertSafeJobId(jobId);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const current = getPersistedArtifactPathnames(rawRenderLog);
  if (!token || !current) return;

  const retained = new Set([current.stl, current.png]);
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: `artifacts/${jobId}/`,
      cursor,
      limit: 1000,
      token,
    });
    const superseded = page.blobs
      .filter((blob) => !retained.has(blob.pathname))
      .map((blob) => blob.url);
    if (superseded.length > 0) {
      await del(superseded, { token });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function deletePersistedArtifactPathnames(
  pathnames: PersistedArtifactPathnames
): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  await del([pathnames.stl, pathnames.png], { token });
}

export async function resolveStoredArtifact(
  publicPath: string | null | undefined,
  rawRenderLog: string | RenderLog | null | undefined,
  type: ArtifactType
): Promise<StoredArtifactLocation | null> {
  if (!publicPath?.endsWith(`/${ARTIFACT_FILENAMES[type]}`)) return null;
  const localPath = localPathForPublicArtifact(publicPath);
  if (!localPath) return null;

  try {
    await fs.access(localPath);
    return { kind: "local", filePath: localPath };
  } catch {
    // A serverless invocation usually cannot see another invocation's /tmp.
  }

  if (type === "scad") return null;
  const pathnames = getPersistedArtifactPathnames(rawRenderLog);
  if (!pathnames) return null;
  const expectedPrefix = `artifacts/${publicPath?.split("/")[2]}/`;
  const pathname = pathnames[type];
  return pathname.startsWith(expectedPrefix)
    ? { kind: "remote", pathname }
    : null;
}

export async function readRemoteArtifact(pathname: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to read persisted artifacts");
  }
  return get(pathname, {
    access: "public",
    token,
    abortSignal: AbortSignal.timeout(30_000),
  });
}

export async function materializeStoredArtifact(
  jobId: string,
  publicPath: string | null | undefined,
  rawRenderLog: string | RenderLog | null | undefined,
  type: "stl" | "png"
): Promise<{ filePath: string; temporary: boolean } | null> {
  const location = await resolveStoredArtifact(
    publicPath,
    rawRenderLog,
    type
  );
  if (!location) return null;
  if (location.kind === "local") {
    return { filePath: location.filePath, temporary: false };
  }

  const blob = await readRemoteArtifact(location.pathname);
  if (!blob || blob.statusCode !== 200) return null;

  const attemptId = `materialize-${randomUUID()}`;
  const paths = await ensureJobArtifactsDir(jobId, attemptId);
  const filePath = type === "stl" ? paths.stlFilePath : paths.pngFilePath;
  await fs.writeFile(
    filePath,
    new Uint8Array(await new Response(blob.stream).arrayBuffer())
  );
  return { filePath, temporary: true };
}

export async function cleanupArtifactWorkspace(filePath: string): Promise<void> {
  if (!isEphemeralRuntime()) return;
  const root = path.resolve(artifactsRoot());
  const directory = path.resolve(path.dirname(filePath));
  if (directory.startsWith(`${root}${path.sep}`)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function checkPublicArtifact(
  publicPath: string | null | undefined,
  rawRenderLog?: string | RenderLog | null,
  type?: ArtifactType
): Promise<ArtifactExistence> {
  const inferredType =
    type ??
    (publicPath?.endsWith(".stl")
      ? "stl"
      : publicPath?.endsWith(".png")
        ? "png"
        : "scad");
  const location = await resolveStoredArtifact(
    publicPath,
    rawRenderLog,
    inferredType
  );
  if (!location) return "missing";
  if (location.kind === "local") return "present";

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return "unknown";
    await head(location.pathname, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      abortSignal: AbortSignal.timeout(5_000),
    });
    return "present";
  } catch (error) {
    return error instanceof BlobNotFoundError ? "missing" : "unknown";
  }
}

export async function publicArtifactExists(
  publicPath: string | null | undefined,
  rawRenderLog?: string | RenderLog | null,
  type?: ArtifactType
): Promise<boolean> {
  return (
    (await checkPublicArtifact(publicPath, rawRenderLog, type)) === "present"
  );
}
