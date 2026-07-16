import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import os from "os";
import path from "path";

let currentJob: Record<string, unknown> | null;
const originalWorkDir = process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const workDir = path.join(os.tmpdir(), "agentscad-artifact-routes-test");

const artifactPathnames = {
  stl: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/model.stl",
  png: "artifacts/job_remote/1784210000000-11111111-1111-4111-8111-111111111111/preview.png",
};
let blobMissing = false;
let blobReadCount = 0;

beforeAll(() => {
  class TestBlobNotFoundError extends Error {}
  mock.module("@vercel/blob", () => ({
    BlobNotFoundError: TestBlobNotFoundError,
    del: mock(async () => undefined),
    get: mock(async (pathname: string) => {
      blobReadCount++;
      if (blobMissing) return null;
      const body = pathname.endsWith(".stl") ? "solid model" : "png";
      return {
        statusCode: 200,
        stream: new Response(body).body,
        blob: { size: body.length },
      };
    }),
    head: mock(async () => ({})),
    list: mock(async () => ({ blobs: [], hasMore: false })),
    put: mock(async () => {
      throw new Error("put is not used by artifact route tests");
    }),
  }));
  mock.module("@/lib/db", () => ({
    db: {
      job: {
        findUnique: mock(async () => currentJob),
      },
    },
  }));
});

afterAll(() => {
  mock.restore();
  if (originalWorkDir === undefined) {
    delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
  } else {
    process.env.AGENTSCAD_ARTIFACT_WORK_DIR = originalWorkDir;
  }
  if (originalBlobToken === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  }
});

beforeEach(() => {
  process.env.AGENTSCAD_ARTIFACT_WORK_DIR = workDir;
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  blobMissing = false;
  blobReadCount = 0;
  currentJob = {
    id: "job_remote",
    state: "DELIVERED",
    scadSource: "cube(10);",
    stlPath: "/artifacts/job_remote/model.stl",
    pngPath: "/artifacts/job_remote/preview.png",
    renderLog: JSON.stringify({ artifact_pathnames: artifactPathnames }),
  };
});

describe("canonical artifact route", () => {
  test("serves SCAD from the database without exposing Blob storage", async () => {
    const { GET } = await import("@/app/artifacts/[id]/[filename]/route");
    const response = await GET(
      new Request("https://agentscad.test/artifacts/job_remote/model.scad") as never,
      {
        params: Promise.resolve({
          id: "job_remote",
          filename: "model.scad",
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("cube(10);");
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("rejects unknown filenames, unsafe job ids, and missing jobs", async () => {
    const { GET } = await import("@/app/artifacts/[id]/[filename]/route");

    const unknownFile = await GET(
      new Request("https://agentscad.test/artifacts/job_remote/secrets.txt") as never,
      {
        params: Promise.resolve({
          id: "job_remote",
          filename: "secrets.txt",
        }),
      }
    );
    const unsafeId = await GET(
      new Request("https://agentscad.test/artifacts/unsafe/model.stl") as never,
      {
        params: Promise.resolve({
          id: "../unsafe",
          filename: "model.stl",
        }),
      }
    );
    currentJob = null;
    const missingJob = await GET(
      new Request("https://agentscad.test/artifacts/missing/model.stl") as never,
      {
        params: Promise.resolve({
          id: "missing",
          filename: "model.stl",
        }),
      }
    );

    expect(unknownFile.status).toBe(404);
    expect(unsafeId.status).toBe(404);
    expect(missingJob.status).toBe(404);
  });

  test("streams canonical STL and PNG paths without exposing Blob URLs", async () => {
    const { GET } = await import("@/app/artifacts/[id]/[filename]/route");

    const stl = await GET(
      new Request("https://agentscad.test/artifacts/job_remote/model.stl") as never,
      {
        params: Promise.resolve({
          id: "job_remote",
          filename: "model.stl",
        }),
      }
    );
    const png = await GET(
      new Request("https://agentscad.test/artifacts/job_remote/preview.png") as never,
      {
        params: Promise.resolve({
          id: "job_remote",
          filename: "preview.png",
        }),
      }
    );

    expect(stl.status).toBe(200);
    expect(await stl.text()).toBe("solid model");
    expect(stl.headers.get("Location")).toBeNull();
    expect(png.status).toBe(200);
    expect(await png.text()).toBe("png");
    expect(png.headers.get("Location")).toBeNull();
  });

  test("returns 404 when neither a working file nor persisted metadata exists", async () => {
    const { GET } = await import("@/app/artifacts/[id]/[filename]/route");
    currentJob = {
      ...currentJob,
      renderLog: null,
    };

    const response = await GET(
      new Request("https://agentscad.test/artifacts/job_remote/model.stl") as never,
      {
        params: Promise.resolve({
          id: "job_remote",
          filename: "model.stl",
        }),
      }
    );

    expect(response.status).toBe(404);
  });

  test("does not substitute preview storage when SCAD source is absent", async () => {
    currentJob = {
      ...currentJob,
      scadSource: null,
    };
    const { GET } = await import("@/app/artifacts/[id]/[filename]/route");

    const response = await GET(
      new Request("https://agentscad.test/artifacts/job_remote/model.scad") as never,
      {
        params: Promise.resolve({
          id: "job_remote",
          filename: "model.scad",
        }),
      }
    );

    expect(response.status).toBe(404);
    expect(blobReadCount).toBe(0);
  });
});

describe("artifact download API", () => {
  test("downloads a persisted artifact with stable attachment headers", async () => {
    const { GET } = await import("@/app/api/jobs/[id]/artifacts/[type]/route");

    const response = await GET(
      new Request("https://agentscad.test/api/jobs/job_remote/artifacts/stl") as never,
      { params: Promise.resolve({ id: "job_remote", type: "stl" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("solid model");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="model.stl"'
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("maps invalid types, absent files, and failed Blob reads to safe errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const { GET } = await import("@/app/api/jobs/[id]/artifacts/[type]/route");

    const invalidType = await GET(
      new Request("https://agentscad.test/api/jobs/job_remote/artifacts/exe") as never,
      { params: Promise.resolve({ id: "job_remote", type: "exe" }) }
    );

    currentJob = { ...currentJob, stlPath: null };
    const absent = await GET(
      new Request("https://agentscad.test/api/jobs/job_remote/artifacts/stl") as never,
      { params: Promise.resolve({ id: "job_remote", type: "stl" }) }
    );

    currentJob = {
      ...currentJob,
      stlPath: "/artifacts/job_remote/model.stl",
    };
    blobMissing = true;
    const failedRead = await GET(
      new Request("https://agentscad.test/api/jobs/job_remote/artifacts/stl") as never,
      { params: Promise.resolve({ id: "job_remote", type: "stl" }) }
    );

    expect(invalidType.status).toBe(400);
    expect(absent.status).toBe(404);
    expect(failedRead.status).toBe(404);
    expect(await failedRead.json()).toMatchObject({
      error: "STL artifact file has not been generated",
      state: "DELIVERED",
      artifactPath: "/artifacts/job_remote/model.stl",
    });
    errorSpy.mockRestore();
  });
});
