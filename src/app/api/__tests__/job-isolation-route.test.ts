import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const rows: Array<Record<string, unknown>> = [];

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
) {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

beforeAll(() => {
  mock.module("@/lib/db", () => ({
    db: {
      job: {
        create: mock(async ({ data }: { data: Record<string, unknown> }) => {
          const job = {
            id: `job-${rows.length + 1}`,
            createdAt: new Date("2026-07-24T00:00:00.000Z"),
            updatedAt: new Date("2026-07-24T00:00:00.000Z"),
            completedAt: null,
            ...data,
          };
          rows.push(job);
          return job;
        }),
        findMany: mock(async ({
          where,
          take,
        }: {
          where?: Record<string, unknown>;
          take?: number;
        }) => rows.filter((row) => matchesWhere(row, where)).slice(0, take)),
        count: mock(async ({ where }: { where?: Record<string, unknown> }) =>
          rows.filter((row) => matchesWhere(row, where)).length),
      },
    },
  }));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  rows.length = 0;
  delete process.env.API_SECRET;
});

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

function request(url: string, token?: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-agentscad-job-session", token);
  return new Request(url, { ...init, headers });
}

describe("job API browser isolation", () => {
  test("creates and lists jobs only inside the originating browser scope", async () => {
    const { GET, POST } = await import("@/app/api/jobs/route");

    const created = await POST(request(
      "https://agentscad.test/api/jobs",
      TOKEN_A,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputRequest: "private browser A model" }),
      },
    ) as never);
    expect(created.status).toBe(201);
    expect(await created.text()).not.toContain("browserSessionId");

    const browserA = await GET(request(
      "https://agentscad.test/api/jobs?summary=true",
      TOKEN_A,
    ) as never);
    const browserB = await GET(request(
      "https://agentscad.test/api/jobs?summary=true",
      TOKEN_B,
    ) as never);

    expect((await browserA.json()).jobs).toHaveLength(1);
    expect((await browserB.json()).jobs).toHaveLength(0);
  });

  test("fails closed when middleware has not established a browser session", async () => {
    const { GET } = await import("@/app/api/jobs/route");
    const response = await GET(
      request("https://agentscad.test/api/jobs") as never,
    );

    expect(response.status).toBe(401);
  });
});
