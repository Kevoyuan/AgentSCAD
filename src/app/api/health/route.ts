import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import packageJson from "../../../../package.json";

const APP_VERSION = packageJson.version;

export async function GET() {
  try {
    // Simple DB connectivity check
    await db.job.count();
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "AgentSCAD API",
      version: APP_VERSION,
      database: "connected",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "AgentSCAD API",
        version: APP_VERSION,
        database: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
