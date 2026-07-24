import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";

/**
 * GET /api/jobs/similar
 * Search DELIVERED jobs for similar inputRequests using keyword matching.
 * Query params: q (search query), partFamily (optional filter)
 * Returns top 5 similar jobs with their parameters and part family.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const partFamily = searchParams.get("partFamily") || "";

    if (!query.trim()) {
      return NextResponse.json({ similar: [] });
    }

    // Split query into keywords for matching
    const keywords = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2); // Ignore very short words

    if (keywords.length === 0) {
      return NextResponse.json({ similar: [] });
    }

    // Build where clause: only DELIVERED jobs, with keyword matching
    const where: Record<string, unknown> = {
      ...jobAccessFilter(access),
      state: "DELIVERED",
    };

    // Add part family filter if specified
    if (partFamily) {
      where.partFamily = partFamily;
    }

    // Search using OR conditions for each keyword
    where.OR = keywords.map((keyword) => ({
      inputRequest: { contains: keyword },
    }));

    const similarJobs = await db.job.findMany({
      where,
      select: {
        id: true,
        inputRequest: true,
        partFamily: true,
        parameterSchema: true,
        parameterValues: true,
        state: true,
        createdAt: true,
        completedAt: true,
        builderName: true,
        generationPath: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 5,
    });

    return NextResponse.json({ similar: similarJobs });
  } catch (error) {
    console.error("Error searching similar jobs:", error);
    return NextResponse.json(
      { error: "Failed to search similar jobs" },
      { status: 500 }
    );
  }
}
