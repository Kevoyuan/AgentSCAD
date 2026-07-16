import { afterEach, describe, expect, test } from "bun:test";

import { fetchProviders } from "@/components/cad/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider API client", () => {
  test("preserves persistence capabilities returned by the providers API", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          providers: [],
          envProviders: [],
          persistence: {
            mode: "environment",
            writable: false,
          },
        }),
      { preconnect: originalFetch.preconnect }
    );

    await expect(fetchProviders()).resolves.toEqual({
      providers: [],
      envProviders: [],
      persistence: {
        mode: "environment",
        writable: false,
      },
    });
  });
});
