import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { analyzeCadRequest } from "@/lib/intake/request-intelligence";

type Row = Record<string, unknown>;

let row: Row;
let forceTransitionConflict = false;
let lastUpdateWhere: Row | undefined;
const SESSION_TOKEN = "11111111-1111-4111-8111-111111111111";

async function browserScope(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`agentscad-job-session:v1:${token}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function matchesWhere(candidate: Row, where: Row | undefined) {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => candidate[key] === value);
}

beforeAll(() => {
  mock.module("@/lib/db", () => ({
    db: {
      job: {
        findFirst: mock(async ({ where }: { where?: Row }) =>
          matchesWhere(row, where) ? { ...row } : null),
        updateMany: mock(async ({ where, data }: { where?: Row; data: Row }) => {
          lastUpdateWhere = where;
          if (forceTransitionConflict || !matchesWhere(row, where)) return { count: 0 };
          row = { ...row, ...data };
          return { count: 1 };
        }),
      },
    },
  }));
});

afterAll(() => mock.restore());

beforeEach(async () => {
  const inputRequest = "行星发动机模型";
  row = {
    id: "job-intent",
    browserSessionId: await browserScope(SESSION_TOKEN),
    state: "HUMAN_REVIEW",
    generationPath: "intent_clarification",
    inputRequest,
    intentResult: JSON.stringify(analyzeCadRequest(inputRequest)),
    cadIntentJson: null,
    executionLogs: null,
    completedAt: null,
  };
  forceTransitionConflict = false;
  lastUpdateWhere = undefined;
});

function request(body?: unknown, withSession = true) {
  return new Request("https://agentscad.test/api/jobs/job-intent/intent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withSession ? { "x-agentscad-job-session": SESSION_TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("intent approval route", () => {
  test("requires a scoped browser session", async () => {
    const { POST } = await import("@/app/api/jobs/[id]/intent/route");
    const response = await POST(request({}, false) as never, {
      params: Promise.resolve({ id: "job-intent" }),
    });

    expect(response.status).toBe(401);
  });

  test("validates the selected interpretation", async () => {
    const { POST } = await import("@/app/api/jobs/[id]/intent/route");
    const response = await POST(request({ selectedInterpretationId: "not-an-option" }) as never, {
      params: Promise.resolve({ id: "job-intent" }),
    });

    expect(response.status).toBe(400);
    expect(row.state).toBe("HUMAN_REVIEW");
  });

  test("atomically approves a scoped pending clarification", async () => {
    const { POST } = await import("@/app/api/jobs/[id]/intent/route");
    const selectedId = analyzeCadRequest(row.inputRequest as string).interpretations[0].id;
    const response = await POST(request({ selectedInterpretationId: selectedId }) as never, {
      params: Promise.resolve({ id: "job-intent" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(lastUpdateWhere).toEqual({
      id: "job-intent",
      browserSessionId: await browserScope(SESSION_TOKEN),
      state: "HUMAN_REVIEW",
      generationPath: "intent_clarification",
    });
    expect(row.state).toBe("NEW");
    expect(row.generationPath).toBe("intent_approved");
    expect(JSON.parse(row.intentResult as string).approval.selectedInterpretationId).toBe(selectedId);
    expect(body.job.browserSessionId).toBeUndefined();
  });

  test("returns conflict when another request wins the transition", async () => {
    const { POST } = await import("@/app/api/jobs/[id]/intent/route");
    forceTransitionConflict = true;
    const selectedId = analyzeCadRequest(row.inputRequest as string).interpretations[0].id;
    const response = await POST(request({ selectedInterpretationId: selectedId }) as never, {
      params: Promise.resolve({ id: "job-intent" }),
    });

    expect(response.status).toBe(409);
    expect(row.state).toBe("HUMAN_REVIEW");
  });

  test("process endpoint cannot bypass pending clarification", async () => {
    const { POST } = await import("@/app/api/jobs/[id]/process/route");
    const response = await POST(request(undefined) as never, {
      params: Promise.resolve({ id: "job-intent" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Resolve the pending intent clarification before processing this job",
    });
  });
});
