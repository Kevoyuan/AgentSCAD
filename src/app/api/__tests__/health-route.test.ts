import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import packageJson from "../../../../package.json";

beforeAll(() => {
  mock.module("@/lib/db", () => ({
    db: {
      job: {
        count: mock(async () => 0),
      },
    },
  }));
});

afterAll(() => mock.restore());

describe("health route", () => {
  test("reports the application release version", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "healthy",
      version: packageJson.version,
      database: "connected",
    });
  });
});
