import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import {
  canProcessJobState,
  executeCadJob,
  processableJobStatesMessage,
} from "@/lib/pipeline/execute-cad-job";

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/process
 * Thin HTTP/SSE adapter for the CAD job pipeline.
 *
 * Runtime contract intentionally preserved:
 * - raw Server-Sent Events frames: `data: ${JSON.stringify(payload)}\n\n`
 * - no named `event:` fields
 * - same frontend-visible step strings and payload fields emitted by executeCadJob
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;

  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }
    const job = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
    });

    if (!job) {
      return NextResponse.json(
        { error: `Job not found with id: ${id}` },
        { status: 404 }
      );
    }

    if (!canProcessJobState(job.state)) {
      return NextResponse.json(
        {
          error: `Job cannot be processed in state: ${job.state}. Must be in one of: ${processableJobStatesMessage()}`,
        },
        { status: 409 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;

        function sendEvent(data: Record<string, unknown>) {
          if (streamClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            streamClosed = true;
          }
        }

        function closeStream() {
          if (streamClosed) return;
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // Clients can disconnect after receiving the final event.
          }
        }

        try {
          await executeCadJob(id, sendEvent);
        } catch (error) {
          console.error("Error starting job processing:", error);
          sendEvent({
            state: "GEOMETRY_FAILED",
            step: "error",
            message: `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        } finally {
          closeStream();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error starting job processing:", error);
    return NextResponse.json(
      { error: "Failed to start job processing" },
      { status: 500 }
    );
  }
}
