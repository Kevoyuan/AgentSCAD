import { describe, expect, test } from "bun:test";
import { toPublicJob } from "@/lib/public-job";

describe("public job serialization", () => {
  test("removes internal Blob pathnames while preserving render diagnostics", () => {
    const job = {
      id: "job_public",
      renderLog: JSON.stringify({
        openscad_version: "real",
        warnings: ["example"],
        artifact_pathnames: {
          stl: "artifacts/job_public/version/model.stl",
          png: "artifacts/job_public/version/preview.png",
        },
      }),
    };

    const publicJob = toPublicJob(job);
    const renderLog = JSON.parse(publicJob.renderLog);

    expect(renderLog.artifact_pathnames).toBeUndefined();
    expect(renderLog).toMatchObject({
      openscad_version: "real",
      warnings: ["example"],
    });
    expect(JSON.parse(job.renderLog).artifact_pathnames).toBeDefined();
  });
});
