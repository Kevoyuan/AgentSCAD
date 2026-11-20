import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createSourcePoseArchive } from "./source-pose-archive";
import type { SourcePoseArtifact } from "../tools/source-pose-verification";

const artifact = (partId = "body"): SourcePoseArtifact => {
  const stl = Buffer.from("mesh");
  return { phase: "pose", caseId: "angle-0", partId, parameters: { angle: 45 }, stl,
    sha256: createHash("sha256").update(stl).digest("hex") };
};

test("source-pose archives bind owned bytes and parameters to numeric paths", () => {
  const archive = createSourcePoseArchive(100);
  const input = artifact("../../body");
  archive.collect(input);
  input.stl.fill(0);
  input.parameters.angle = 90;
  const result = archive.finish([input]);
  expect(result.metadata.status).toBe("COMPLETE");
  expect(result.metadata.files[0].path).toBe("evidence/source-poses/0000.stl");
  expect(result.metadata.files[0].parameters.angle).toBe(45);
  expect(result.meshes[0].toString()).toBe("mesh");
  expect(createHash("sha256").update(result.meshes[0]).digest("hex")).toBe(result.metadata.files[0].sha256);
});

test("budget exhaustion discards the entire mesh set without claiming completeness", () => {
  const archive = createSourcePoseArchive(6);
  const first = artifact("first"), second = artifact("second");
  archive.collect(first);
  archive.collect(second);
  archive.collect(first);
  const result = archive.finish([first, second]);
  expect(result.metadata.status).toBe("NOT_RUN");
  expect(result.metadata.byteLength).toBe(0);
  expect(result.metadata.files).toEqual([]);
  expect(result.meshes).toEqual([]);
});

test("missing or duplicate identities cannot label a partial archive complete", () => {
  const first = artifact("first"), second = artifact("second");
  const archive = createSourcePoseArchive(100);
  archive.collect(first);
  expect(archive.finish([first,second]).metadata.status).toBe("PARTIAL");
  archive.collect(first);
  expect(archive.finish([first,second]).metadata.status).toBe("PARTIAL");
  expect(createSourcePoseArchive().finish([]).metadata.status).toBe("NOT_RUN");
  expect(() => createSourcePoseArchive(0)).toThrow();
  expect(() => createSourcePoseArchive().collect({ ...first, sha256: "wrong" })).toThrow();
  expect(() => createSourcePoseArchive().collect({ ...first, stl: Buffer.alloc(0) })).toThrow();
});
