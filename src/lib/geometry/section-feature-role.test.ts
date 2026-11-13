import { describe, expect, test } from "bun:test";
import { tubeStl, mergeStl } from "./__tests__/solids";
import { prismStl } from "./__tests__/prism";
import { observeSectionFeatureRole } from "./section-feature-role";

const axis = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
const stationsMm = [2, 5, 8];
const sample = (stl: Buffer, centers?: Array<[number, number]>) =>
  observeSectionFeatureRole({ stl, axis, stationsMm, centers });

describe("independent sampled section role", () => {
  test("solid prism has one enclosing contour and is a local shaft, regardless of its filename or claim", () => {
    const solid = prismStl({ radius: 3, height: 10, segments: 64 });
    const observed = sample(solid);
    expect(observed.status).toBe("OBSERVED");
    expect(observed.observedRole).toBe("shaft");
    expect(observed.crossingsPerRay).toBe(1);
    expect(observed.stationsChecked).toBe(3);
    expect(observed.coverage).toContain("No through-hole continuity");
  });

  test("an annular tube has two enclosing contours and is a local bore at every station", () => {
    const tube = tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 });
    const observed = sample(tube);
    expect(observed.status).toBe("OBSERVED");
    expect(observed.observedRole).toBe("bore");
    expect(observed.crossingsPerRay).toBe(2);
    expect(observed.stationsChecked).toBe(3);
  });

  test("a nested solid insert changes a claimed bore into an observed solid rather than false bore PASS", () => {
    const merged = mergeStl(
      tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
      prismStl({ radius: 1, height: 10, segments: 64 }),
    );
    const observed = sample(merged);
    expect(observed.status).toBe("OBSERVED");
    expect(observed.observedRole).toBe("shaft");
    expect(observed.crossingsPerRay).toBe(3);
  });

  test("a centre outside the profile is not misidentified as a shaft or a bore", () => {
    const solid = prismStl({ radius: 3, height: 10, segments: 64 });
    const observed = sample(solid, [[5, 0], [5, 0], [5, 0]]);
    expect(observed.status).toBe("NOT_RUN");
    expect(observed.observedRole).toBeNull();
  });

  test("an incomplete STL wall produces an open cut, never an observed role", () => {
    const tube = tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 });
    const count = tube.readUInt32LE(80);
    // Delete the first triangle of an outer wall, keeping the other triangles
    // and a valid binary STL table. This exposes a dangling cut at z = 5.
    const broken = Buffer.alloc(tube.length - 50);
    tube.copy(broken, 0, 0, 84);
    tube.copy(broken, 84, 134);
    broken.writeUInt32LE(count - 1, 80);
    const observed = sample(broken);
    expect(observed.status).toBe("NOT_RUN");
    expect(observed.reason).toContain("open");
  });

  test("a dense or invalid station request cannot turn into a geometry verdict", () => {
    const tube = tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 });
    expect(observeSectionFeatureRole({ stl: tube, axis, stationsMm: [5] }).status).toBe("NOT_RUN");
    expect(observeSectionFeatureRole({ stl: tube, axis, stationsMm: [NaN, 5] }).status).toBe("NOT_RUN");
    expect(observeSectionFeatureRole({ stl: tube, axis, stationsMm: Array.from({ length: 20 }, (_, i) => i) }).status).toBe("NOT_RUN");
    const invalid = Buffer.alloc(84);
    expect(sample(invalid).status).toBe("NOT_RUN");
  });
});
