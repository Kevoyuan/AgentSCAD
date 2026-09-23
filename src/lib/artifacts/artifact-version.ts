import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import type { RenderedArtifacts } from "@/lib/harness/types";
import { isEphemeralRuntime } from "@/lib/runtime-environment";

export interface RecordArtifactVersionInput {
  jobId: string;
  scadSource: string;
  artifacts?: RenderedArtifacts | null;
  validationResults?: unknown;
  instructionFingerprint?: string | null;
  modelExecution?: unknown;
}

/** An immutable source and render snapshot for one completed build attempt. */
export async function recordArtifactVersion(input: RecordArtifactVersionInput) {
  if (!db.jobArtifactVersion) return null; // Compatibility with isolated test DB doubles.
  const id = randomUUID();
  let stlPath: string | null = null;
  let pngPath: string | null = null;
  const remote = input.artifacts?.renderLog.artifact_pathnames;
  if (remote) {
    stlPath = remote.stl;
    pngPath = remote.png;
  } else if (input.artifacts && !isEphemeralRuntime()) {
    const root = input.artifacts.artifactsDir;
    const jobRoot = path.basename(root).startsWith("render-") ? path.dirname(root) : root;
    const versionDir = path.join(jobRoot, "versions", id);
    await fs.mkdir(versionDir, { recursive: true });
    await Promise.all([
      fs.copyFile(input.artifacts.stlFilePath, path.join(versionDir, "model.stl")),
      fs.copyFile(input.artifacts.pngFilePath, path.join(versionDir, "preview.png")),
    ]);
    stlPath = path.join(versionDir, "model.stl");
    pngPath = path.join(versionDir, "preview.png");
  }
  return db.jobArtifactVersion.create({
    data: {
      id,
      jobId: input.jobId,
      scadHash: createHash("sha256").update(input.scadSource).digest("hex"),
      scadSource: input.scadSource,
      stlPath,
      pngPath,
      validationResults: input.validationResults === undefined ? null : JSON.stringify(input.validationResults),
      instructionFingerprint: input.instructionFingerprint ?? null,
      modelExecution: input.modelExecution === undefined ? null : JSON.stringify(input.modelExecution),
    },
  });
}

export async function latestArtifactVersionId(jobId: string): Promise<string | null> {
  if (!db.jobArtifactVersion) return null;
  const latest = await db.jobArtifactVersion.findFirst({
    where: { jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
  });
  return latest?.id ?? null;
}
