import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  formatDoctorReport,
  resolveSqliteDatabasePath,
  summarizeDoctorChecks,
} from "./doctor";

describe("AgentSCAD doctor", () => {
  test("resolves Prisma SQLite paths relative to the schema directory", () => {
    expect(resolveSqliteDatabasePath("file:../db/dev.db", "/workspace/agentscad"))
      .toBe(path.normalize("/workspace/agentscad/db/dev.db"));
    expect(resolveSqliteDatabasePath("postgres://example.invalid/db", "/workspace/agentscad"))
      .toBeNull();
  });

  test("summarizes statuses and fails only when a failed check exists", () => {
    const checks = [
      { id: "a", status: "PASS" as const, message: "ok" },
      { id: "b", status: "WARN" as const, message: "warning", action: "fix it" },
      { id: "c", status: "FAIL" as const, message: "failed" },
    ];
    expect(summarizeDoctorChecks(checks)).toEqual({ PASS: 1, WARN: 1, FAIL: 1 });
    expect(formatDoctorReport({
      schemaVersion: 1,
      ok: false,
      checks,
      summary: { PASS: 1, WARN: 1, FAIL: 1 },
      durationMs: 8,
    })).toContain("Resolve failed checks");
  });
});
