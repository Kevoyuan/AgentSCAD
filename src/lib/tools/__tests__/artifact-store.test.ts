import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test } from "bun:test";
import {
  getJobArtifactPaths,
  getPersistedArtifactPathnames,
  persistJobArtifacts,
  resolveStoredArtifact,
  writeJobScadSource,
} from "@/lib/tools/artifact-store";

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void> | void
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("artifact-store", () => {
  test("uses a writable temporary workspace in serverless runtimes", async () => {
    await withEnvironment(
      {
        VERCEL: "1",
        AGENTSCAD_ARTIFACT_WORK_DIR: undefined,
      },
      () => {
        const paths = getJobArtifactPaths("job_123");
        expect(paths.artifactsDir).toBe(
          path.join(os.tmpdir(), "agentscad", "artifacts", "job_123")
        );
        expect(paths.stlPublicPath).toBe("/artifacts/job_123/model.stl");
        expect(paths.pngPublicPath).toBe("/artifacts/job_123/preview.png");
      }
    );
  });

  test("rejects job ids that could escape the artifact root", () => {
    expect(() => getJobArtifactPaths("../private")).toThrow(
      "Invalid job id for artifact storage"
    );
  });

  test("isolates render attempts while preserving canonical public paths", () => {
    const first = getJobArtifactPaths("job_concurrent", "render-first");
    const second = getJobArtifactPaths("job_concurrent", "render-second");

    expect(first.artifactsDir).not.toBe(second.artifactsDir);
    expect(first.stlPublicPath).toBe(second.stlPublicPath);
    expect(first.pngPublicPath).toBe(second.pngPublicPath);
  });

  test("writes and resolves local working artifacts", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-artifact-store-test-")
    );

    try {
      await withEnvironment(
        { AGENTSCAD_ARTIFACT_WORK_DIR: root },
        async () => {
          const paths = await writeJobScadSource("job_local", "cube(10);");
          await fs.writeFile(paths.stlFilePath, "solid model");
          await fs.writeFile(paths.pngFilePath, "png");

          const location = await resolveStoredArtifact(
            paths.stlPublicPath,
            null,
            "stl"
          );
          expect(location).toEqual({
            kind: "local",
            filePath: paths.stlFilePath,
          });
        }
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("accepts only trusted Vercel Blob artifact pathnames", () => {
    const trusted = {
      stl: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/model.stl",
      png: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/preview.png",
    };
    expect(
      getPersistedArtifactPathnames({
        openscad_version: "real",
        render_time_ms: 10,
        stl_triangles: 0,
        stl_vertices: 0,
        png_resolution: "800x600",
        warnings: [],
        artifact_pathnames: trusted,
      })
    ).toEqual({ stl: trusted.stl, png: trusted.png });

    expect(
      getPersistedArtifactPathnames(
        JSON.stringify({
          artifact_pathnames: {
            ...trusted,
            stl: "artifacts/../secrets/model.stl",
          },
        })
      )
    ).toBeNull();
  });

  test("treats malformed render logs and incomplete URL sets as unavailable", () => {
    expect(getPersistedArtifactPathnames("{not-json")).toBeNull();
    expect(
      getPersistedArtifactPathnames(
        JSON.stringify({
          artifact_pathnames: {
            stl: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/model.stl",
          },
        })
      )
    ).toBeNull();
    expect(
      getPersistedArtifactPathnames(
        JSON.stringify({
          artifact_pathnames: {
            stl: "artifacts/job_remote/not-a-version/model.stl",
            png: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/preview.png",
          },
        })
      )
    ).toBeNull();
  });

  test("does not persist local artifacts unless persistence is explicitly enabled", async () => {
    await withEnvironment(
      {
        VERCEL: undefined,
        AWS_LAMBDA_FUNCTION_NAME: undefined,
        AGENTSCAD_PERSIST_ARTIFACTS: undefined,
        BLOB_READ_WRITE_TOKEN: undefined,
      },
      async () => {
        const paths = getJobArtifactPaths("job_local_only");
        await expect(
          persistJobArtifacts("job_local_only", paths)
        ).resolves.toBeNull();
      }
    );
  });

  test("requires a Blob token before serverless persistence starts", async () => {
    await withEnvironment(
      {
        VERCEL: "1",
        BLOB_READ_WRITE_TOKEN: undefined,
      },
      async () => {
        const paths = getJobArtifactPaths("job_serverless");
        await expect(
          persistJobArtifacts("job_serverless", paths)
        ).rejects.toThrow(
          "BLOB_READ_WRITE_TOKEN is required to persist rendered artifacts"
        );
      }
    );
  });

  test("falls back to the trusted persisted pathname when the local workspace is gone", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-artifact-store-remote-test-")
    );
    const pathnames = {
      stl: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/model.stl",
      png: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/preview.png",
    };

    try {
      await withEnvironment(
        { AGENTSCAD_ARTIFACT_WORK_DIR: root },
        async () => {
          await expect(
            resolveStoredArtifact(
              "/artifacts/job_remote/model.stl",
              { artifact_pathnames: pathnames } as never,
              "stl"
            )
          ).resolves.toEqual({
            kind: "remote",
            pathname: pathnames.stl,
          });
        }
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("does not resurrect an artifact whose canonical database path is absent", async () => {
    const pathnames = {
      stl: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/model.stl",
      png: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/preview.png",
    };

    await expect(
      resolveStoredArtifact(null, { artifact_pathnames: pathnames } as never, "stl")
    ).resolves.toBeNull();
    await expect(
      resolveStoredArtifact(
        "/not-an-artifact/model.stl",
        { artifact_pathnames: pathnames } as never,
        "stl"
      )
    ).resolves.toBeNull();
    await expect(
      resolveStoredArtifact(
        "/artifacts/job_remote/preview.png",
        { artifact_pathnames: pathnames } as never,
        "stl"
      )
    ).resolves.toBeNull();
  });

});
