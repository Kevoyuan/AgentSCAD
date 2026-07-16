import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ARTIFACT_CONTENT_TYPES,
  ARTIFACT_FILENAMES,
  readRemoteArtifact,
  resolveStoredArtifact,
  type ArtifactType,
} from "@/lib/tools/artifact-store";

interface RouteParams {
  params: Promise<{ id: string; type: string }>;
}

const VALID_ARTIFACT_TYPES = Object.keys(ARTIFACT_FILENAMES) as ArtifactType[];

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id, type } = await params;

    if (!VALID_ARTIFACT_TYPES.includes(type as (typeof VALID_ARTIFACT_TYPES)[number])) {
      return NextResponse.json(
        { error: `Invalid artifact type: ${type}. Valid types: ${VALID_ARTIFACT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const job = await db.job.findUnique({ where: { id } });

    if (!job) {
      return NextResponse.json({ error: `Job not found with id: ${id}` }, { status: 404 });
    }

    if (type === "scad") {
      if (!job.scadSource) {
        return NextResponse.json({ error: "SCAD source not available for this job" }, { status: 404 });
      }

      return new Response(job.scadSource, {
        headers: {
          "Content-Type": ARTIFACT_CONTENT_TYPES.scad,
          "Content-Disposition": `attachment; filename="job_${id}.scad"`,
        },
      });
    }

    const requestedArtifactPath = type === "stl" ? job.stlPath : job.pngPath;
    const location = await resolveStoredArtifact(
      requestedArtifactPath,
      job.renderLog,
      type as ArtifactType
    );

    if (!location) {
      return NextResponse.json(
        {
          error: `${type.toUpperCase()} artifact file has not been generated`,
          state: job.state,
          artifactPath: requestedArtifactPath,
        },
        { status: 404 }
      );
    }

    const filename =
      location.kind === "local"
        ? path.basename(location.filePath)
        : type === "stl"
          ? "model.stl"
          : "preview.png";

    if (location.kind === "remote") {
      const blobResponse = await readRemoteArtifact(location.pathname);
      if (!blobResponse) {
        return NextResponse.json(
          {
            error: `${type.toUpperCase()} artifact file has not been generated`,
            state: job.state,
            artifactPath: requestedArtifactPath,
          },
          { status: 404 }
        );
      }
      if (blobResponse.statusCode !== 200) {
        throw new Error("Blob fetch returned no artifact body");
      }

      return new Response(blobResponse.stream, {
        headers: {
          "Content-Type": ARTIFACT_CONTENT_TYPES[type],
          "Content-Disposition": `attachment; filename="${filename}"`,
          ...(blobResponse.blob.size
            ? { "Content-Length": String(blobResponse.blob.size) }
            : {}),
          "Cache-Control": "no-store",
        },
      });
    }

    const artifactBuffer = await fs.readFile(location.filePath);
    return new Response(artifactBuffer, {
      headers: {
        "Content-Type": ARTIFACT_CONTENT_TYPES[type],
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": artifactBuffer.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error fetching artifact:", error);
    return NextResponse.json({ error: "Failed to fetch artifact" }, { status: 500 });
  }
}
