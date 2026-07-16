import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const uploads: Array<{
  pathname: string;
  body: unknown;
  options: Record<string, unknown>;
}> = [];
const deletedUrls: string[][] = [];
let failedType: string | null = null;
let headMode: "present" | "missing" | "error" = "present";
class TestBlobNotFoundError extends Error {}

beforeAll(() => {
  mock.module("@vercel/blob", () => ({
    BlobNotFoundError: TestBlobNotFoundError,
    del: mock(async (urls: string[]) => {
      deletedUrls.push(urls);
    }),
    get: mock(async () => null),
    head: mock(async () => {
      if (headMode === "missing") throw new TestBlobNotFoundError();
      if (headMode === "error") throw new Error("Blob service unavailable");
      return {};
    }),
    list: mock(async ({ prefix }: { prefix: string }) => ({
      blobs: [
        {
          url: `https://store.public.blob.vercel-storage.com/${prefix}old/model.stl`,
        },
        {
          url: `https://store.public.blob.vercel-storage.com/${prefix}new/preview.png`,
        },
      ],
      cursor: undefined,
      hasMore: false,
    })),
    put: mock(
      async (
        pathname: string,
        body: unknown,
        options: Record<string, unknown>
      ) => {
        uploads.push({ pathname, body, options });
        if (failedType && pathname.endsWith(failedType)) {
          throw new Error("Blob upload unavailable");
        }
        if (
          body &&
          typeof body === "object" &&
          Symbol.asyncIterator in body
        ) {
          for await (const _chunk of body as AsyncIterable<unknown>) {
            // Consume file streams like the real SDK before resolving.
          }
        }
        return {
          pathname,
          url: `https://store.public.blob.vercel-storage.com/${pathname}`,
        };
      }
    ),
  }));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  uploads.length = 0;
  deletedUrls.length = 0;
  failedType = null;
  headMode = "present";
});

describe("artifact Blob persistence", () => {
  test("uploads one immutable STL and PNG version with explicit metadata", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-artifact-upload-test-")
    );
    const previous = {
      VERCEL: process.env.VERCEL,
      workDir: process.env.AGENTSCAD_ARTIFACT_WORK_DIR,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    };

    try {
      process.env.VERCEL = "1";
      process.env.AGENTSCAD_ARTIFACT_WORK_DIR = root;
      process.env.BLOB_READ_WRITE_TOKEN = "test-token";
      const {
        persistJobArtifacts,
        writeJobScadSource,
      } = await import("@/lib/tools/artifact-store");
      const paths = await writeJobScadSource("job_upload", "cube(10);");
      await fs.writeFile(paths.stlFilePath, "solid model");
      await fs.writeFile(paths.pngFilePath, "png bytes");

      const result = await persistJobArtifacts("job_upload", paths);

      expect(uploads).toHaveLength(2);
      expect(uploads.map((upload) => path.basename(upload.pathname))).toEqual([
        "model.stl",
        "preview.png",
      ]);
      expect(
        new Set(
          uploads.map((upload) => path.dirname(upload.pathname))
        ).size
      ).toBe(1);
      expect(uploads[0].pathname).toMatch(
        /^artifacts\/job_upload\/\d+-[0-9a-f-]+\/model\.stl$/
      );
      expect(uploads.map((upload) => upload.options.contentType)).toEqual([
        "application/sla",
        "image/png",
      ]);
      expect(
        uploads.every(
          (upload) =>
            upload.options.access === "public" &&
            upload.options.addRandomSuffix === false &&
            upload.options.token === "test-token"
        )
      ).toBe(true);
      expect(result).toEqual({
        stl: uploads[0].pathname,
        png: uploads[1].pathname,
      });
    } finally {
      if (previous.VERCEL === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous.VERCEL;
      if (previous.workDir === undefined) {
        delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
      } else {
        process.env.AGENTSCAD_ARTIFACT_WORK_DIR = previous.workDir;
      }
      if (previous.token === undefined) {
        delete process.env.BLOB_READ_WRITE_TOKEN;
      } else {
        process.env.BLOB_READ_WRITE_TOKEN = previous.token;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("propagates a failed upload so the job cannot claim durable delivery", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-artifact-upload-failure-test-")
    );
    const previous = {
      VERCEL: process.env.VERCEL,
      workDir: process.env.AGENTSCAD_ARTIFACT_WORK_DIR,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    };

    try {
      process.env.VERCEL = "1";
      process.env.AGENTSCAD_ARTIFACT_WORK_DIR = root;
      process.env.BLOB_READ_WRITE_TOKEN = "test-token";
      const {
        persistJobArtifacts,
        writeJobScadSource,
      } = await import("@/lib/tools/artifact-store");
      const paths = await writeJobScadSource("job_upload_failure", "cube(10);");
      await fs.writeFile(paths.stlFilePath, "solid model");
      await fs.writeFile(paths.pngFilePath, "png bytes");
      failedType = "model.stl";

      await expect(
        persistJobArtifacts("job_upload_failure", paths)
      ).rejects.toThrow("Blob upload unavailable");
      expect(deletedUrls).toHaveLength(1);
      expect(deletedUrls[0]).toHaveLength(1);
    } finally {
      if (previous.VERCEL === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous.VERCEL;
      if (previous.workDir === undefined) {
        delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
      } else {
        process.env.AGENTSCAD_ARTIFACT_WORK_DIR = previous.workDir;
      }
      if (previous.token === undefined) {
        delete process.env.BLOB_READ_WRITE_TOKEN;
      } else {
        process.env.BLOB_READ_WRITE_TOKEN = previous.token;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("removes local and persisted versions when a job is deleted", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-artifact-delete-test-")
    );
    const previous = {
      workDir: process.env.AGENTSCAD_ARTIFACT_WORK_DIR,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    };

    try {
      process.env.AGENTSCAD_ARTIFACT_WORK_DIR = root;
      process.env.BLOB_READ_WRITE_TOKEN = "test-token";
      const {
        deleteJobArtifacts,
        writeJobScadSource,
      } = await import("@/lib/tools/artifact-store");
      const paths = await writeJobScadSource("job_delete", "cube(10);");

      await deleteJobArtifacts("job_delete");

      await expect(fs.stat(paths.artifactsDir)).rejects.toThrow();
      expect(deletedUrls).toHaveLength(1);
      expect(deletedUrls[0]).toHaveLength(2);
      expect(
        deletedUrls[0].every((url) => url.includes("artifacts/job_delete/"))
      ).toBe(true);
    } finally {
      if (previous.workDir === undefined) {
        delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
      } else {
        process.env.AGENTSCAD_ARTIFACT_WORK_DIR = previous.workDir;
      }
      if (previous.token === undefined) {
        delete process.env.BLOB_READ_WRITE_TOKEN;
      } else {
        process.env.BLOB_READ_WRITE_TOKEN = previous.token;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("distinguishes missing artifacts from transient Blob failures", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-artifact-head-test-")
    );
    const previous = {
      workDir: process.env.AGENTSCAD_ARTIFACT_WORK_DIR,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    };
    const renderLog = {
      artifact_pathnames: {
        stl: "artifacts/job_head/1784210000000-11111111-1111-4111-8111-111111111111/model.stl",
        png: "artifacts/job_head/1784210000000-11111111-1111-4111-8111-111111111111/preview.png",
      },
    } as never;

    try {
      process.env.AGENTSCAD_ARTIFACT_WORK_DIR = root;
      process.env.BLOB_READ_WRITE_TOKEN = "test-token";
      const { checkPublicArtifact } = await import("@/lib/tools/artifact-store");

      await expect(
        checkPublicArtifact(
          "/artifacts/job_head/model.stl",
          renderLog,
          "stl"
        )
      ).resolves.toBe("present");
      headMode = "missing";
      await expect(
        checkPublicArtifact(
          "/artifacts/job_head/model.stl",
          renderLog,
          "stl"
        )
      ).resolves.toBe("missing");
      headMode = "error";
      await expect(
        checkPublicArtifact(
          "/artifacts/job_head/model.stl",
          renderLog,
          "stl"
        )
      ).resolves.toBe("unknown");
    } finally {
      if (previous.workDir === undefined) {
        delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
      } else {
        process.env.AGENTSCAD_ARTIFACT_WORK_DIR = previous.workDir;
      }
      if (previous.token === undefined) {
        delete process.env.BLOB_READ_WRITE_TOKEN;
      } else {
        process.env.BLOB_READ_WRITE_TOKEN = previous.token;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
