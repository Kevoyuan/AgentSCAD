import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { boxStl } from "../geometry/__tests__/solids";
import { observeSourcePoses } from "./source-pose-observer";
import { translationMatrix } from "./path-and-motion";

const id = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const scadSource = "cube([1,2,3]);";
const sourceHash = createHash("sha256").update(scadSource).digest("hex");
const spec = {
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: [{ id: "block", name: "Block", selector: "block", source: "generated", material: null }],
  instances: [{ id: "b1", partId: "block", subassemblyId: null, transform: id }],
  subassemblies: [], groundedInstanceId: "b1",
  connections: [], motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
};
const local = boxStl([0,0,0],[1,2,3]);
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const rendered = { parts: [{partId: "block", stl: local, sha256: sha(local), triangleCount: local.readUInt32LE(80), diagnostics: ""}], purchasedPartIds: [] };
const samples = [0, 4].map(shiftX => ({
  id: "offset-" + shiftX,
  parameters: { shiftX },
  transforms: { b1: translationMatrix([shiftX,0,0]) },
}));

describe("explicit native source-pose reference orchestration", () => {
  test("independent matching reference STLs PASS at two genuine translated poses, with immutable byte hashes", async () => {
    const renderedParams: number[] = [];
    const report = await observeSourcePoses({
      scadSource, spec, referenceSelector: "all", samples,
      expectedSourceSha256: sourceHash,
      renderLocal: async () => rendered,
      renderReference: async (_, selector, params) => {
        expect(selector).toBe("all");
        renderedParams.push(params.shiftX);
        const stl = boxStl([params.shiftX,0,0],[1+params.shiftX,2,3]);
        return { stl, sha256: sha(stl) };
      },
    });
    expect(renderedParams).toEqual([0, 4]);
    expect(report.status).toBe("PASS");
    expect(report.samples.map(sample => sample.status)).toEqual(["PASS","PASS"]);
    expect(report.samples.map(sample => sample.matchedTriangles)).toEqual([12,12]);
    expect(report.samples[0].posedSpecificationSha256).not.toBe(report.samples[1].posedSpecificationSha256);
    expect(report.samples.every(sample => sample.sourceSha256 === sourceHash)).toBe(true);
    expect(report.samples.every(sample => sample.localPartSha256.block === sha(local))).toBe(true);
    expect(report.reason).toContain("not product motion approval");
  });

  test("wrong source-parameter binding does not turn a mismatch into PASS", async () => {
    const report = await observeSourcePoses({
      scadSource, spec, referenceSelector: "all", samples,
      renderLocal: async () => rendered,
      // Reference stays in its original position even though the declaration
      // moves the block, so the second pose must fail measured geometry.
      renderReference: async () => ({stl: local, sha256: sha(local)}),
    });
    expect(report.samples[0].status).toBe("PASS");
    expect(report.samples[1].status).toBe("FAIL");
    expect(report.samples[1].bboxErrorMm).toBeGreaterThan(3);
    expect(report.status).toBe("FAIL");
  });

  test("a fake reference hash, changed source or missing purchased geometry is refused", async () => {
    let calls = 0;
    const rendering = async () => { calls++; return rendered; };
    await expect(observeSourcePoses({
      scadSource: scadSource + " //changed", spec, referenceSelector: "all", samples,
      expectedSourceSha256: sourceHash, renderLocal: rendering,
    })).rejects.toThrow("source has changed");
    expect(calls).toBe(0);
    await expect(observeSourcePoses({
      scadSource, spec, referenceSelector: "all", samples,
      renderLocal: rendering, renderReference: async () => ({ stl: local, sha256: "f".repeat(64) }),
    })).rejects.toThrow("incorrect STL SHA-256");
    const purchased = { ...spec, parts: spec.parts.map(part => ({ ...part, source: "purchased" })) };
    await expect(observeSourcePoses({
      scadSource, spec: purchased, referenceSelector: "all", samples, renderLocal: rendering,
    })).rejects.toThrow("Complete generated-part geometry");
  });
});
