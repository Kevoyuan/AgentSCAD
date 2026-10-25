import { describe, expect, test } from "bun:test";

import { checkDegenerateGeometry } from "../degeneracy-check";
import type { RawMeshData } from "../validation-types";

const mesh = (overrides: Partial<RawMeshData> = {}): RawMeshData => ({
  bbox: { length: 50, width: 50, height: 5, unit: "mm" },
  vertices: 0,
  faces: 0,
  edges: 0,
  isWatertight: true,
  isVolume: true,
  componentCount: 1,
  eulerCharacteristic: 2,
  genus: 0,
  volume: 12500,
  ...overrides,
});

describe("B002 degenerate geometry sanity", () => {
  test("fails a near-zero-thickness hull (golden case)", () => {
    const result = checkDegenerateGeometry(
      mesh({
        bbox: { length: 50, width: 50, height: 0.0001, unit: "mm" },
        volume: 0.25,
      }),
    );
    expect(result.status).toBe("FAIL");
    expect(result.passed).toBe(false);
    expect(result.is_critical).toBe(true);
  });

  test("passes a healthy solid of real volume", () => {
    const result = checkDegenerateGeometry(mesh());
    expect(result.status).toBe("PASS");
    expect(result.is_critical).toBe(false);
  });

  test("passes a thin but real sheet (volume above floor despite thin axis)", () => {
    const result = checkDegenerateGeometry(
      mesh({
        bbox: { length: 20, width: 20, height: 0.2, unit: "mm" },
        volume: 80,
      }),
    );
    expect(result.status).toBe("PASS");
  });

  test("skips when volume is unavailable (non-watertight mesh)", () => {
    const result = checkDegenerateGeometry(mesh({ volume: null, isWatertight: false }));
    expect(result.status).toBe("SKIP");
  });

  test("skips when no bounding box is present", () => {
    const result = checkDegenerateGeometry(mesh({ bbox: null }));
    expect(result.status).toBe("SKIP");
  });

  test("fails when both extent and volume sit just under the floor", () => {
    const result = checkDegenerateGeometry(
      mesh({
        bbox: { length: 10, width: 10, height: 0.29, unit: "mm" },
        volume: 0.99,
      }),
    );
    expect(result.status).toBe("FAIL");
    expect(result.is_critical).toBe(true);
  });

  test("passes a thin axis when volume is still substantial", () => {
    const result = checkDegenerateGeometry(
      mesh({
        bbox: { length: 200, width: 200, height: 0.29, unit: "mm" },
        volume: 200 * 200 * 0.29,
      }),
    );
    expect(result.status).toBe("PASS");
  });
});
