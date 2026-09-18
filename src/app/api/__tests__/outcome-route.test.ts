import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const JOB_ID = "job-outcome-route";
const OTHER_JOB_ID = "job-outcome-route-other";
const TOKEN = "11111111-1111-4111-8111-111111111111";
const SESSION_HASH = await crypto.subtle
  .digest("SHA-256", new TextEncoder().encode(`agentscad-job-session:v1:${TOKEN}`))
  .then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );

const jobs = [
  { id: JOB_ID, browserSessionId: SESSION_HASH },
  { id: OTHER_JOB_ID, browserSessionId: "some-other-browser-session" },
];

let outcomeRows: Array<Record<string, unknown>> = [];

beforeAll(() => {
  mock.module("@/lib/db", () => ({
    db: {
      job: {
        findFirst: mock(async ({ where }: { where: Record<string, unknown> }) =>
          jobs.find((job) =>
            Object.entries(where).every(([key, value]) => job[key as keyof typeof job] === value),
          ) ?? null,
        ),
      },
      jobOutcome: {
        create: mock(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `outcome-${outcomeRows.length + 1}`,
            createdAt: new Date(Date.UTC(2026, 8, 18, 10, outcomeRows.length)),
            ...data,
          };
          outcomeRows.push(row);
          return row;
        }),
        findMany: mock(async ({ where, take }: { where: { jobId: string }; take: number }) =>
          outcomeRows
            .filter((row) => row.jobId === where.jobId)
            .slice()
            .reverse()
            .slice(0, take),
        ),
      },
    },
  }));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  outcomeRows = [];
  delete process.env.API_SECRET;
});

function request(url: string, token?: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-agentscad-job-session", token);
  return new Request(url, { ...init, headers });
}

function postOutcome(id: string, body: unknown, token = TOKEN) {
  return request(`https://agentscad.test/api/jobs/${id}/outcome`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const route = () => import("@/app/api/jobs/[id]/outcome/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("job outcome route", () => {
  test("requires a browser session", async () => {
    const { POST } = await route();
    const anonymous = request(`https://agentscad.test/api/jobs/${JOB_ID}/outcome`, undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "accepted" }),
    });
    const response = await POST(anonymous as never, params(JOB_ID));
    expect(response.status).toBe(401);
  });

  test("does not expose another browser's job", async () => {
    const { POST, GET } = await route();
    expect((await POST(postOutcome(OTHER_JOB_ID, { kind: "accepted" }) as never, params(OTHER_JOB_ID))).status).toBe(404);
    expect(
      (await GET(request(`https://agentscad.test/api/jobs/${OTHER_JOB_ID}/outcome`, TOKEN) as never, params(OTHER_JOB_ID))).status,
    ).toBe(404);
  });

  test("rejects an unknown kind without writing anything", async () => {
    const { POST } = await route();
    const response = await POST(postOutcome(JOB_ID, { kind: "delivered" }) as never, params(JOB_ID));
    expect(response.status).toBe(400);
    expect(outcomeRows).toHaveLength(0);
  });

  test("records a decision and reports a strict success summary", async () => {
    const { POST } = await route();
    const response = await POST(
      postOutcome(JOB_ID, { kind: "accepted", detail: { note: "fits" } }) as never,
      params(JOB_ID),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, any>;
    expect(body.outcome).toMatchObject({ kind: "accepted", source: "user" });
    expect(body.summary.taskSucceeded).toBe(true);
    expect(body.summary.counts.accepted).toBe(1);
  });

  test("a later rejection overrides an earlier acceptance", async () => {
    const { POST, GET } = await route();
    await POST(postOutcome(JOB_ID, { kind: "accepted" }) as never, params(JOB_ID));
    await POST(postOutcome(JOB_ID, { kind: "rejected" }) as never, params(JOB_ID));

    const response = await GET(
      request(`https://agentscad.test/api/jobs/${JOB_ID}/outcome`, TOKEN) as never,
      params(JOB_ID),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.outcomes.map((event: { kind: string }) => event.kind)).toEqual([
      "accepted",
      "rejected",
    ]);
    expect(body.summary.latestDecision.kind).toBe("rejected");
    expect(body.summary.taskSucceeded).toBe(false);
  });

  test("an edit alone is not a success", async () => {
    const { POST } = await route();
    const response = await POST(
      postOutcome(JOB_ID, { kind: "user_edited", detail: { field: "parameters" } }) as never,
      params(JOB_ID),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(body.summary.taskSucceeded).toBe(false);
    expect(body.summary.latestDecision).toBeNull();
  });
});
