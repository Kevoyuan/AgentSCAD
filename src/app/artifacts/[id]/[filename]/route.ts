import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import {
  ARTIFACT_CONTENT_TYPES,
  ARTIFACT_FILENAMES,
  readRemoteArtifact,
  resolveStoredArtifact,
  type ArtifactType,
} from "@/lib/tools/artifact-store";

interface RouteParams {
  params: Promise<{ id: string; filename: string }>;
}

const FILES = Object.fromEntries(
  (Object.entries(ARTIFACT_FILENAMES) as Array<[ArtifactType, string]>).map(
    ([type, filename]) => [
      filename,
      { type, contentType: ARTIFACT_CONTENT_TYPES[type] },
    ]
  )
) as Record<string, { type: ArtifactType; contentType: string }>;

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const access = await getJobAccessScope(request);
  if (!access) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const { id, filename } = await params;
  const file = FILES[filename];
  if (!file || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const job = await db.job.findFirst({
    where: { id, ...jobAccessFilter(access) },
    select: {
      scadSource: true,
      stlPath: true,
      pngPath: true,
      renderLog: true,
    },
  });
  if (!job) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  if (file.type === "scad" && job.scadSource) {
    return new Response(job.scadSource, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (file.type === "scad") {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const publicPath = file.type === "stl" ? job.stlPath : job.pngPath;
  const location = await resolveStoredArtifact(
    publicPath,
    job.renderLog,
    file.type
  );
  if (!location) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  if (location.kind === "remote") {
    const blobResponse = await readRemoteArtifact(location.pathname);
    if (!blobResponse || blobResponse.statusCode !== 200) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    return new Response(blobResponse.stream, {
      headers: {
        "Content-Type": file.contentType,
        ...(blobResponse.blob.size
          ? { "Content-Length": String(blobResponse.blob.size) }
          : {}),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const artifact = await fs.readFile(location.filePath);
  return new Response(artifact, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": artifact.byteLength.toString(),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
