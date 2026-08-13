import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";

describe("compile repair lease contract", () => {
  test("uses a unique repair token for commits and preserves durable repair history", () => {
    const pipeline = fs.readFileSync(
      path.join(process.cwd(), "src/lib/pipeline/execute-cad-job.ts"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/jobs/[id]/process/route.ts"),
      "utf8",
    );

    expect(pipeline).toContain('type: "compile_repair_lease"');
    expect(pipeline).toContain('where: { id: jobId, state: "REPAIRING", repairHistory: repairLease }');
    expect(pipeline).toContain('repairHistory: compileRepairPreviousHistory');
    expect(route).toContain('removeCompileRepairLease(job.repairHistory)');
    expect(route).toContain('isStaleRepairLease(job.state, job.updatedAt, job.repairHistory)');
    expect(route).toContain('updatedAt: job.updatedAt');
  });
});
