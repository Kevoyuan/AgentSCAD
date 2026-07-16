import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  renderStl,
  renderStlPreview,
  renderScadArtifacts,
  validateGeneratedScadSource,
} from "@/lib/tools/scad-renderer";
import {
  buildOpenScadWasmEnv,
  prepareScadForWasm,
  renderScadToStlWasm,
  resetOpenScadWasmRuntimeForTests,
} from "@/lib/tools/openscad-wasm-runtime";
import { inspectBinaryStl } from "@/lib/tools/stl-preview";

const previousBackend = process.env.AGENTSCAD_OPENSCAD_BACKEND;

beforeAll(() => {
  process.env.AGENTSCAD_OPENSCAD_BACKEND = "wasm";
});

afterAll(() => {
  if (previousBackend === undefined) {
    delete process.env.AGENTSCAD_OPENSCAD_BACKEND;
  } else {
    process.env.AGENTSCAD_OPENSCAD_BACKEND = previousBackend;
  }
});

describe("OpenSCAD WASM renderer", () => {
  test("renders bundled-library SCAD to a binary STL and real PNG preview", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-wasm-render-test-")
    );
    const scadPath = path.join(tempDir, "custom-input.scad");
    const stlPath = path.join(tempDir, "custom-output.stl");
    const pngPath = path.join(tempDir, "preview.png");
    const source = [
      "include <agentscad_std.scad>;",
      "width = 30;",
      "mounting_plate(width, 20, 3, hole_d = 3);",
    ].join("\n");

    try {
      await fs.writeFile(scadPath, source, "utf8");
      await validateGeneratedScadSource(source);
      await renderStl(scadPath, stlPath, { width: 36 });
      await renderStlPreview(stlPath, pngPath);

      const stl = await fs.readFile(stlPath);
      const metadata = await sharp(pngPath).metadata();
      expect(inspectBinaryStl(stl).triangleCount).toBeGreaterThan(100);
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(800);
      expect(metadata.height).toBe(600);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("runs the complete artifact renderer with stable paths and render metadata", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-wasm-artifacts-test-")
    );
    const previousWorkDir = process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
    const previousPersistence = process.env.AGENTSCAD_PERSIST_ARTIFACTS;
    try {
      process.env.AGENTSCAD_ARTIFACT_WORK_DIR = tempDir;
      delete process.env.AGENTSCAD_PERSIST_ARTIFACTS;
      const artifacts = await renderScadArtifacts(
        "job_wasm_complete",
        "include <agentscad_std.scad>;\nmounting_plate(20, 14, 2);"
      );
      expect(artifacts.stlPath).toBe(
        "/artifacts/job_wasm_complete/model.stl"
      );
      expect(artifacts.pngPath).toBe(
        "/artifacts/job_wasm_complete/preview.png"
      );
      expect(artifacts.renderLog.openscad_version).toBe("2026.01.12-wasm");
      expect(artifacts.renderLog.stl_triangles).toBeGreaterThan(0);
      expect((await sharp(artifacts.pngFilePath).metadata()).format).toBe("png");
    } finally {
      if (previousWorkDir === undefined) {
        delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
      } else {
        process.env.AGENTSCAD_ARTIFACT_WORK_DIR = previousWorkDir;
      }
      if (previousPersistence === undefined) {
        delete process.env.AGENTSCAD_PERSIST_ARTIFACTS;
      } else {
        process.env.AGENTSCAD_PERSIST_ARTIFACTS = previousPersistence;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects unresolved external libraries instead of rendering the wrong model", async () => {
    await expect(
      prepareScadForWasm("include <unknown-library.scad>;\ncube(10);")
    ).rejects.toThrow("cannot resolve external libraries");
    await expect(
      prepareScadForWasm("cube(1); include </etc/passwd>")
    ).rejects.toThrow("cannot resolve external libraries");
    await expect(
      prepareScadForWasm("cube(1); /* gap */ use <../private.scad>")
    ).rejects.toThrow("cannot resolve external libraries");
  });

  test("ignores file primitives in comments and strings but rejects executable ones", async () => {
    await expect(
      prepareScadForWasm(
        '// import("/etc/passwd");\nlabel = "surface(file=secret)";\ncube(1);'
      )
    ).resolves.toContain("cube(1)");
    for (const primitive of [
      'import("/etc/passwd");',
      'surface(file="/etc/passwd");',
      'text("secret");',
    ]) {
      await expect(prepareScadForWasm(primitive)).rejects.toThrow(
        "does not support external files or fonts"
      );
    }
  });

  test("rejects oversized SCAD before starting the renderer", async () => {
    await expect(prepareScadForWasm("x".repeat(2 * 1024 * 1024 + 1))).rejects.toThrow(
      "exceeds the 2 MB"
    );
  });

  test("compile validation rejects malformed generated SCAD", async () => {
    await expect(validateGeneratedScadSource("cube(")).rejects.toThrow(
      "OpenSCAD WASM failed"
    );
  });

  test("refuses a tampered runtime before executing it", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-wasm-integrity-test-")
    );
    const tamperedRuntime = path.join(tempDir, "openscad.js");
    const originalRuntimePath = process.env.AGENTSCAD_OPENSCAD_WASM_PATH;
    try {
      await fs.writeFile(tamperedRuntime, "console.log('tampered')");
      process.env.AGENTSCAD_OPENSCAD_WASM_PATH = tamperedRuntime;
      resetOpenScadWasmRuntimeForTests();
      await expect(renderScadToStlWasm("cube(10);")).rejects.toThrow(
        "failed its integrity check"
      );
    } finally {
      if (originalRuntimePath === undefined) {
        delete process.env.AGENTSCAD_OPENSCAD_WASM_PATH;
      } else {
        process.env.AGENTSCAD_OPENSCAD_WASM_PATH = originalRuntimePath;
      }
      resetOpenScadWasmRuntimeForTests();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("releases the serialized renderer slot after a failed render", async () => {
    await expect(renderScadToStlWasm("cube(0);")).rejects.toThrow();
    await expect(renderScadToStlWasm("cube(2);")).resolves.toBeInstanceOf(Buffer);
  });

  test("does not pass application secrets into the renderer child process", () => {
    const originalOpenRouter = process.env.OPENROUTER_API_KEY;
    const originalBlob = process.env.BLOB_READ_WRITE_TOKEN;
    try {
      process.env.OPENROUTER_API_KEY = "must-not-cross-process-boundary";
      process.env.BLOB_READ_WRITE_TOKEN = "must-not-cross-process-boundary";
      const rendererEnv = buildOpenScadWasmEnv();
      expect(rendererEnv.OPENROUTER_API_KEY).toBeUndefined();
      expect(rendererEnv.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    } finally {
      if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalOpenRouter;
      if (originalBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = originalBlob;
    }
  });
});
