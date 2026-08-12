import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

describe("visual repair route contract", () => {
  test("claims eligible jobs atomically before paid repair work and commits only while leased", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "src/app/api/jobs/[id]/visual-repair/route.ts"),
      "utf8",
    );

    expect(source).toContain("const claim = await db.job.updateMany");
    expect(source).toContain('state: { in: ["HUMAN_REVIEW", "DELIVERED"] }');
    expect(source).toContain("if (claim.count !== 1)");
    expect(source).toContain('where: { id, state: "REPAIRING" }');
    expect(source).toContain("if (committed.count !== 1)");
  });
});
