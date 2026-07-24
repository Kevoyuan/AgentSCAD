import { afterEach, describe, expect, test } from "bun:test";

import {
  getJobAccessScope,
  isValidJobSessionToken,
  JOB_SESSION_COOKIE_NAME,
  JOB_SESSION_HEADER,
  jobAccessFilter,
  readJobSessionCookie,
} from "@/lib/job-session";

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";
const originalApiSecret = process.env.API_SECRET;

afterEach(() => {
  if (originalApiSecret === undefined) {
    delete process.env.API_SECRET;
  } else {
    process.env.API_SECRET = originalApiSecret;
  }
});

describe("browser-scoped job access", () => {
  test("derives stable, distinct database scopes without storing cookie tokens", async () => {
    const first = await getJobAccessScope(
      new Request("https://agentscad.test/api/jobs", {
        headers: { [JOB_SESSION_HEADER]: TOKEN_A },
      }),
    );
    const repeated = await getJobAccessScope(
      new Request("https://agentscad.test/api/jobs", {
        headers: { cookie: `${JOB_SESSION_COOKIE_NAME}=${TOKEN_A}` },
      }),
    );
    const secondBrowser = await getJobAccessScope(
      new Request("https://agentscad.test/api/jobs", {
        headers: { [JOB_SESSION_HEADER]: TOKEN_B },
      }),
    );

    expect(first).toEqual(repeated);
    expect(first).not.toEqual(secondBrowser);
    expect(first?.kind).toBe("browser");
    expect(secondBrowser?.kind).toBe("browser");
    expect(JSON.stringify(first)).not.toContain(TOKEN_A);
    expect(JSON.stringify(secondBrowser)).not.toContain(TOKEN_B);
    expect(first && jobAccessFilter(first)).not.toEqual(
      secondBrowser && jobAccessFilter(secondBrowser),
    );
  });

  test("fails closed for absent or malformed browser identifiers", async () => {
    expect(await getJobAccessScope(
      new Request("https://agentscad.test/api/jobs"),
    )).toBeNull();
    expect(isValidJobSessionToken("attacker-controlled")).toBe(false);
    expect(readJobSessionCookie(
      `${JOB_SESSION_COOKIE_NAME}=attacker-controlled`,
    )).toBeUndefined();
  });

  test("allows an explicitly configured bearer secret to act as admin", async () => {
    process.env.API_SECRET = "test-admin-secret";
    const access = await getJobAccessScope(
      new Request("https://agentscad.test/api/jobs", {
        headers: { authorization: "Bearer test-admin-secret" },
      }),
    );

    expect(access).toEqual({ kind: "admin" });
    expect(access && jobAccessFilter(access)).toEqual({});
  });
});
