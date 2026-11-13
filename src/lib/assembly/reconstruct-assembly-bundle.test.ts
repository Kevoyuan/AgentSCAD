import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { unzipSync, zipSync } from "fflate";
import { buildAssemblyBundle } from "./assembly-bundle";
import { reconstructAssemblyBundle, AssemblyReconstructionError } from "./reconstruct-assembly-bundle";
import { readBinaryStl, meshBounds } from "../geometry/stl-mesh";
import { boxStl } from "../geometry/__tests__/solids";

const localBox = boxStl([0, 0, 0], [1, 2, 3]);
const pose = (x: number, y: number, z: number) =>
  [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const rotated = [0, -1, 0, 10, 1, 0, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1];

async function createBundle(opts: {
  transforms?: number[][];
  purchased?: boolean;
} = {}) {
  const transforms = opts.transforms ?? [pose(4, 5, 6)];
  const instances = transforms.map((transform, i) => ({
    id: "block-" + i, partId: "block", subassemblyId: null, transform,
  }));
  if (opts.purchased) instances.push({
    id: "bolt-1", partId: "bolt", subassemblyId: null, transform: pose(0, 0, 0),
  });
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "block", name: "Block", selector: "block", source: "generated", material: null },
      ...(opts.purchased ? [{ id: "bolt", name: "Bolt", selector: "bolt", source: "purchased", material: null }] : []),
    ],
    instances, subassemblies: [], connections: [],
    groundedInstanceId: "block-0",
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const artifactSha = createHash("sha256").update(localBox).digest("hex");
  return buildAssemblyBundle({
    scadSource: "cube([1,2,3]);", spec,
    render: async () => ({
      parts: [{
        partId: "block", stl: localBox, sha256: artifactSha,
        triangleCount: localBox.readUInt32LE(80), diagnostics: "",
      }],
      purchasedPartIds: opts.purchased ? ["bolt"] : [],
    }),
    modifiedAt: new Date("2020-01-01T00:00:00.000Z"),
  });
}

describe("offline assembly pose reconstruction", () => {
  test("rebuilds a real reference pose from one verified part STL", async () => {
    const bundle = await createBundle();
    const referenceStl = boxStl([4, 5, 6], [5, 7, 9]);
    const { stl, report } = reconstructAssemblyBundle({ zip: bundle.zip, referenceStl });
    expect(report.archiveIntegrity).toBe("PASS");
    expect(report.reconstruction).toBe("COMPLETE");
    expect(report.reference.status).toBe("PASS");
    expect(report.reference.matchedTriangles).toBe(12);
    expect(report.triangleCount).toBe(12);
    expect(report.boundsMm).toEqual({ min: [4, 5, 6], max: [5, 7, 9] });
    expect(report.assembledStlSha256).toBe(createHash("sha256").update(stl).digest("hex"));
    expect(readBinaryStl(stl).triangleCount).toBe(12);
    expect(report.instances[0].artifactSha256).toBe(bundle.manifest.parts[0].artifactSha256!);
  });

  test("retains repeated instances and applies independent rigid rotation and translation", async () => {
    const bundle = await createBundle({ transforms: [rotated, pose(-5, 4, 0)] });
    const first = reconstructAssemblyBundle({ zip: bundle.zip });
    const again = reconstructAssemblyBundle({ zip: bundle.zip });
    expect(first.stl.equals(again.stl)).toBe(true);
    expect(first.report.triangleCount).toBe(24);
    expect(first.report.instances.map(i => i.id)).toEqual(["block-0", "block-1"]);
    expect(first.report.boundsMm).toEqual({ min: [-5, 4, 0], max: [10, 21, 33] });
    expect(meshBounds(readBinaryStl(first.stl))).toEqual(first.report.boundsMm);
    expect(first.report.reference.status).toBe("NOT_RUN");
  });

  test("detects a wrong source-pose observation and does not promote it to PASS", async () => {
    const bundle = await createBundle();
    const referenceStl = boxStl([4, 5, 7], [5, 7, 10]);
    const result = reconstructAssemblyBundle({ zip: bundle.zip, referenceStl });
    expect(result.report.reference.status).toBe("FAIL");
    expect(result.report.reference.bboxErrorMm).toBeGreaterThan(0.9);
  });

  test("rejects a partial layout unless explicitly requested", async () => {
    const bundle = await createBundle({ purchased: true });
    expect(() => reconstructAssemblyBundle({ zip: bundle.zip }))
      .toThrow(AssemblyReconstructionError);
    const partial = reconstructAssemblyBundle({
      zip: bundle.zip, allowPartial: true,
      referenceStl: boxStl([4, 5, 6], [5, 7, 9]),
    });
    expect(partial.report.reconstruction).toBe("PARTIAL");
    expect(partial.report.missingPurchasedInstances).toEqual(["bolt-1"]);
    expect(partial.report.reference.status).toBe("NOT_RUN");
    expect(partial.report.triangleCount).toBe(12);
  });

  test("rejects invalid geometry budgets and float32 placement overflow", async () => {
    const repeated = await createBundle({ transforms: [rotated, pose(-5, 4, 0)] });
    expect(() => reconstructAssemblyBundle({ zip: repeated.zip, maxTriangles: 23 }))
      .toThrow("triangle budget");
    expect(() => reconstructAssemblyBundle({ zip: repeated.zip, maxTriangles: 0 }))
      .toThrow("maxTriangles");
    const huge = await createBundle({ transforms: [pose(1e40, 0, 0)] });
    expect(() => reconstructAssemblyBundle({ zip: huge.zip }))
      .toThrow("float32");
  });

  test("does not reconstruct corrupt archive entries", async () => {
    const original = await createBundle();
    const files = unzipSync(original.zip);
    files["block.stl"] = files["block.stl"].slice();
    files["block.stl"][100] ^= 1;
    expect(() => reconstructAssemblyBundle({ zip: zipSync(files) })).toThrow("hash");
  });
});
