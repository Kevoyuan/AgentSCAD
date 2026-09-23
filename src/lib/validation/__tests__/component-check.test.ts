import { describe, expect, test } from "bun:test";

import { checkComponents } from "../component-check";
import type { RawMeshData } from "../validation-types";

const mesh = (overrides: Partial<RawMeshData> = {}): RawMeshData => ({
  bbox: null,
  vertices: 0,
  faces: 0,
  edges: 0,
  isWatertight: true,
  isVolume: true,
  componentCount: 1,
  eulerCharacteristic: 2,
  genus: 0,
  ...overrides,
});

describe("C002 connected components", () => {
  test("still fails multiple bodies when the request asked for one printable part", () => {
    const result = checkComponents(mesh({ componentCount: 2 }));
    expect(result.status).toBe("FAIL");
    expect(result.is_critical).toBe(true);
  });

  test("warns instead of failing when the request explicitly asked for separate parts", () => {
    const result = checkComponents(mesh({ componentCount: 2 }), { allow_multiple_components: true });
    expect(result.status).toBe("WARN");
    expect(result.is_critical).toBe(false);
  });

  test("fails when the declared component count does not match the render", () => {
    const result = checkComponents(mesh({ componentCount: 3 }), { expected_component_count: 2 });
    expect(result.status).toBe("FAIL");
    expect(result.is_critical).toBe(true);
  });
});
