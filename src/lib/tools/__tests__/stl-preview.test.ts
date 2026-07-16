import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  inspectBinaryStl,
  renderBinaryStlPreview,
} from "@/lib/tools/stl-preview";

function triangleStl(count = 1): Buffer {
  const buffer = Buffer.alloc(84 + count * 50);
  buffer.writeUInt32LE(count, 80);
  for (let triangle = 0; triangle < count; triangle += 1) {
    const base = 84 + triangle * 50;
    const values = [
      0, 0, 1,
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
    ];
    values.forEach((value, index) => {
      buffer.writeFloatLE(value, base + index * 4);
    });
  }
  return buffer;
}

function overlappingDepthStl(): Buffer {
  const buffer = Buffer.alloc(84 + 2 * 50);
  buffer.writeUInt32LE(2, 80);
  const far = [
    [0, 0, 0],
    [1, -1, 0],
    [0, -1, -1],
  ];
  const near = far
    .map(([x, y, z]) => [x + 10, y + 10, z + 10])
    .reverse();
  [far, near].forEach((points, triangle) => {
    const base = 84 + triangle * 50;
    points.flat().forEach((value, index) => {
      buffer.writeFloatLE(value, base + 12 + index * 4);
    });
  });
  return buffer;
}

describe("binary STL preview input", () => {
  test("reads a valid binary triangle table", () => {
    const result = inspectBinaryStl(triangleStl());
    expect(result.triangleCount).toBe(1);
    expect(result.triangles).toHaveLength(1);
  });

  test("rejects truncated and empty meshes", () => {
    expect(() => inspectBinaryStl(Buffer.alloc(20))).toThrow(
      "shorter than its binary header"
    );
    expect(() => inspectBinaryStl(Buffer.alloc(84))).toThrow(
      "invalid binary triangle table"
    );
    const truncated = triangleStl();
    truncated.writeUInt32LE(2, 80);
    expect(() => inspectBinaryStl(truncated)).toThrow(
      "invalid binary triangle table"
    );
  });

  test("rejects non-finite meshes and skips non-finite faces when valid faces remain", () => {
    const invalid = triangleStl();
    invalid.writeFloatLE(Number.NaN, 84 + 12);
    expect(() => inspectBinaryStl(invalid)).toThrow(
      "contains no finite triangles"
    );

    const mixed = triangleStl(2);
    mixed.writeFloatLE(Number.POSITIVE_INFINITY, 84 + 12);
    expect(inspectBinaryStl(mixed).triangles).toHaveLength(1);
  });

  test("rejects meshes that cannot be previewed without dropping geometry", () => {
    expect(() => inspectBinaryStl(triangleStl(100_001))).toThrow(
      "preview limit is 100000"
    );
  });

  test("renders degenerate zero-span geometry without division errors", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-stl-preview-test-")
    );
    const pngPath = path.join(tempDir, "preview.png");
    const degenerate = triangleStl();
    for (let offset = 84 + 12; offset < 84 + 48; offset += 4) {
      degenerate.writeFloatLE(0, offset);
    }
    try {
      await renderBinaryStlPreview(degenerate, pngPath);
      const metadata = await sharp(pngPath).metadata();
      expect(metadata.width).toBe(800);
      expect(metadata.height).toBe(600);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("paints nearer faces after farther faces", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-stl-depth-test-")
    );
    const pngPath = path.join(tempDir, "preview.png");
    try {
      await renderBinaryStlPreview(overlappingDepthStl(), pngPath);
      const { data, info } = await sharp(pngPath)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const offset = (270 * info.width + 400) * info.channels;
      expect(Array.from(data.subarray(offset, offset + 3))).toEqual([
        34, 155, 183,
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
