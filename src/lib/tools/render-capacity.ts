import {
  BlobNotFoundError,
  del,
  head,
  list,
  put,
} from "@vercel/blob";
import { isEphemeralRuntime } from "@/lib/runtime-environment";

const MAX_SERVERLESS_RENDERS_PER_MINUTE = 20;
const CONTROL_PREFIX = ".agentscad-control/render-capacity/";

type SlotWriter = (pathname: string) => Promise<void>;
type SlotReader = (pathname: string) => Promise<boolean>;

export async function claimRenderCapacitySlot(
  writeSlot: SlotWriter,
  now = Date.now(),
  limit = MAX_SERVERLESS_RENDERS_PER_MINUTE,
  slotExists?: SlotReader
): Promise<number> {
  const minute = Math.floor(now / 60_000).toString().padStart(12, "0");
  for (let slot = 0; slot < limit; slot += 1) {
    try {
      await writeSlot(`${CONTROL_PREFIX}${minute}/slot-${slot}`);
      return slot;
    } catch (error) {
      let isOccupiedSlot =
        error instanceof Error &&
        /already exists|overwrite/i.test(error.message);
      if (
        !isOccupiedSlot &&
        error instanceof Error &&
        error.constructor.name === "BlobUnknownError" &&
        slotExists
      ) {
        isOccupiedSlot = await slotExists(
          `${CONTROL_PREFIX}${minute}/slot-${slot}`
        );
      }
      if (!isOccupiedSlot) {
        throw error;
      }
      // A deterministic pathname already exists, so another invocation owns
      // this slot. Other Blob service failures are handled above.
    }
  }
  throw new Error(
    "OpenSCAD render capacity is temporarily exhausted; retry in one minute"
  );
}

async function cleanupExpiredCapacitySlots(now: number): Promise<void> {
  try {
    const result = await list({ prefix: CONTROL_PREFIX, limit: 1000 });
    const expired = result.blobs
      .filter((blob) => blob.uploadedAt.getTime() < now - 2 * 60_000)
      .map((blob) => blob.pathname);
    if (expired.length > 0) await del(expired);
  } catch (error) {
    console.warn("Unable to clean expired render capacity slots:", error);
  }
}

export async function enforceServerlessRenderCapacity(): Promise<void> {
  if (!isEphemeralRuntime()) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error(
      "Serverless OpenSCAD rendering requires Blob storage for global capacity enforcement"
    );
  }

  const now = Date.now();
  const claimedSlot = await claimRenderCapacitySlot(
    async (pathname) => {
      await put(pathname, "1", {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/octet-stream",
      });
    },
    now,
    MAX_SERVERLESS_RENDERS_PER_MINUTE,
    async (pathname) => {
      try {
        await head(pathname);
        return true;
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          return false;
        }
        throw error;
      }
    }
  );
  if (claimedSlot === 0) await cleanupExpiredCapacitySlots(now);
}
