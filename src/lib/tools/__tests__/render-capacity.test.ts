import { describe, expect, test } from "bun:test";
import { claimRenderCapacitySlot } from "@/lib/tools/render-capacity";

describe("serverless render capacity", () => {
  test("claims the first globally available deterministic slot", async () => {
    const attempted: string[] = [];
    const slot = await claimRenderCapacitySlot(
      async (pathname) => {
        attempted.push(pathname);
        if (attempted.length < 3) throw new Error("already exists");
      },
      1784246400000,
      4
    );
    expect(slot).toBe(2);
    expect(attempted).toHaveLength(3);
    expect(attempted[2]).toEndWith("/slot-2");
  });

  test("fails closed when the shared minute bucket is full", async () => {
    await expect(
      claimRenderCapacitySlot(
        async () => {
          throw new Error("already exists");
        },
        1784246400000,
        2
      )
    ).rejects.toThrow("capacity is temporarily exhausted");
  });

  test("does not mistake a Blob outage for an occupied slot", async () => {
    await expect(
      claimRenderCapacitySlot(async () => {
        throw new Error("service unavailable");
      })
    ).rejects.toThrow("service unavailable");
  });

  test("confirms ambiguous Blob errors before treating a slot as occupied", async () => {
    class BlobUnknownError extends Error {
      constructor() {
        super("unknown");
      }
    }
    const attempted: string[] = [];
    const slot = await claimRenderCapacitySlot(
      async (pathname) => {
        attempted.push(pathname);
        if (attempted.length === 1) throw new BlobUnknownError();
      },
      1784246400000,
      2,
      async (pathname) => pathname === attempted[0]
    );
    expect(slot).toBe(1);
    expect(attempted).toHaveLength(2);

    await expect(
      claimRenderCapacitySlot(
        async () => {
          throw new BlobUnknownError();
        },
        1784246400000,
        2,
        async () => false
      )
    ).rejects.toThrow("unknown");
  });
});
