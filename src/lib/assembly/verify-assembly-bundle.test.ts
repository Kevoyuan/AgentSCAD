import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildAssemblyBundle } from "./assembly-bundle";
import { AssemblyBundleVerificationError, verifyAssemblyBundle } from "./verify-assembly-bundle";
import { boxStl } from "../geometry/__tests__/solids";

const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function specification(purchased = false) {
  const parts = [
    { id: "base", name: "Base", selector: "base", source: "generated", material: null },
    { id: "lid", name: "Lid", selector: "lid", source: purchased ? "purchased" : "generated", material: null },
  ];
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts, instances: [
      { id: "base1", partId: "base", subassemblyId: null, transform: pose },
      { id: "lid1", partId: "lid", subassemblyId: null, transform: pose },
      { id: "lid2", partId: "lid", subassemblyId: null, transform: pose },
    ],
    subassemblies: [], connections: [], groundedInstanceId: "base1",
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
}

const meshes = {
  base: boxStl([0, 0, 0], [10, 10, 2]),
  lid: boxStl([0, 0, 4], [7, 7, 6]),
};

async function bundle(purchased = false) {
  return buildAssemblyBundle({
    scadSource: "cube(1);", spec: specification(purchased),
    render: async () => ({
      parts: Object.entries(meshes).filter(([id]) => !purchased || id !== "lid").map(([partId, stl]) => ({
        partId, stl, sha256: createHash("sha256").update(stl).digest("hex"),
        triangleCount: stl.readUInt32LE(80), diagnostics: "",
      })),
      purchasedPartIds: purchased ? ["lid"] : [],
    }),
  });
}

function edit(zip: Uint8Array, change: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(zip);
  change(files);
  return zipSync(files);
}

function mutateManifest(files: Record<string, Uint8Array>, mutate: (manifest: Record<string, any>) => void) {
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  mutate(manifest);
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
}

function expectFailure(bytes: Uint8Array, code: string) {
  try {
    verifyAssemblyBundle(bytes);
    throw new Error("Expected bundle verification to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AssemblyBundleVerificationError);
    expect((error as AssemblyBundleVerificationError).code).toBe(code);
  }
}

describe("independent assembly export verification", () => {
  test("checks actual ZIP bytes, canonical declaration, quantities and every STL", async () => {
    const original = await bundle();
    const result = verifyAssemblyBundle(original.zip);
    expect(result.status).toBe("PASS");
    expect(result.archiveSha256).toBe(original.sha256);
    expect(result.specificationSha256).toBe(original.manifest.specificationSha256);
    expect(result.partCount).toBe(2);
    expect(result.instanceCount).toBe(3);
    expect(result.parts.find(part => part.id === "lid")?.quantity).toBe(2);
    expect(result.contractCurrent).toBeNull();
    expect(result.limitations.join(" ")).toContain("not establish fit");
  });

  test("supports purchased parts without inventing a purchased STL", async () => {
    const original = await bundle(true);
    const result = verifyAssemblyBundle(original.zip);
    expect(result.parts).toEqual([
      { id: "base", source: "generated", quantity: 1, triangleCount: 12 },
      { id: "lid", source: "purchased", quantity: 2, triangleCount: null },
    ]);
  });

  test("rejects a modified STL, even when the ZIP format remains valid", async () => {
    const original = await bundle();
    const altered = edit(original.zip, files => {
      files["base.stl"] = files["base.stl"].slice();
      files["base.stl"][100] ^= 1;
    });
    expectFailure(altered, "HASH_MISMATCH");
  });

  test("rejects an altered specification, even when it is valid JSON", async () => {
    const original = await bundle();
    const altered = edit(original.zip, files => {
      const declaration = JSON.parse(strFromU8(files["specification.json"]));
      declaration.parts[0].name = "Different";
      files["specification.json"] = strToU8(JSON.stringify(declaration));
    });
    expectFailure(altered, "HASH_MISMATCH");
  });

  test("rejects manifest part quantity drift and mismatched instance transforms", async () => {
    const original = await bundle();
    expectFailure(edit(original.zip, files => mutateManifest(files, manifest => {
      manifest.parts[1].quantity = 1;
    })), "PART_MISMATCH");
    expectFailure(edit(original.zip, files => mutateManifest(files, manifest => {
      manifest.instances[0].transform[3] = 99;
    })), "SPECIFICATION_MISMATCH");
  });

  test("rejects missing, unexpected and path-traversal entries", async () => {
    const original = await bundle();
    expectFailure(edit(original.zip, files => { delete files["lid.stl"]; }), "MISSING_ENTRY");
    expectFailure(edit(original.zip, files => { files["rogue.stl"] = files["base.stl"]; }), "UNEXPECTED_ENTRY");
    expectFailure(edit(original.zip, files => { files["../base.stl"] = files["base.stl"]; }), "UNEXPECTED_ENTRY");
  });

  test("does not allow purchased parts to claim an STL artifact", async () => {
    const original = await bundle(true);
    const altered = edit(original.zip, files => mutateManifest(files, manifest => {
      manifest.parts[1].fileName = "lid.stl";
    }));
    expectFailure(altered, "PART_MISMATCH");
  });

  test("fails closed on malformed archives", () => {
    expectFailure(strToU8("not a zip"), "INVALID_ZIP");
    expectFailure(new Uint8Array(), "ARCHIVE_SIZE");
  });
});
