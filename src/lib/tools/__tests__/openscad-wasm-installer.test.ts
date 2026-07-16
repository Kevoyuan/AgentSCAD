import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { zipSync } from "fflate";
import {
  download,
  installOpenScadWasm,
  sha256,
} from "../../../../scripts/install-openscad-wasm.mjs";

function policyFor(runtime: Uint8Array, archive: Uint8Array, copying: Uint8Array) {
  return {
    component: "test",
    version: "test",
    license: "GPL-2.0-or-later",
    archive_name: "runtime.zip",
    archive_url: "https://example.test/runtime.zip",
    archive_sha256: sha256(archive),
    runtime_filename: "openscad.js",
    runtime_sha256: sha256(runtime),
    copying_filename: "COPYING",
    copying_url: "https://example.test/COPYING",
    copying_sha256: sha256(copying),
    source_commit: "source",
    corresponding_source: "https://example.test/source",
    build_system_commit: "build",
    build_system_source: "https://example.test/build",
  };
}

describe("OpenSCAD WASM installer", () => {
  test("uses verified cached files without making a network request", async () => {
    const runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-installer-cache-")
    );
    const runtime = new TextEncoder().encode("runtime");
    const copying = new TextEncoder().encode("license");
    const archive = zipSync({ "openscad.js": runtime });
    const policy = policyFor(runtime, archive, copying);
    try {
      await fs.writeFile(path.join(runtimeDir, "openscad.js"), runtime);
      await fs.writeFile(path.join(runtimeDir, "COPYING"), copying);
      await installOpenScadWasm({
        policy,
        runtimeDir,
        fetchImpl: async () => {
          throw new Error("network should not be called");
        },
      });
      await expect(
        fs.readFile(path.join(runtimeDir, "metadata.json"), "utf8")
      ).resolves.toContain('"version": "test"');
    } finally {
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("retries a transient response and installs verified runtime and license", async () => {
    const runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-installer-retry-")
    );
    const runtime = new TextEncoder().encode("runtime");
    const copying = new TextEncoder().encode("license");
    const archive = zipSync({ "openscad.js": runtime });
    const policy = policyFor(runtime, archive, copying);
    let calls = 0;
    try {
      await installOpenScadWasm({
        policy,
        runtimeDir,
        sleep: async () => {},
        fetchImpl: async (url: string | URL | Request) => {
          calls += 1;
          if (calls === 1) return new Response("temporary", { status: 503 });
          return new Response(
            Buffer.from(
              String(url).endsWith("COPYING") ? copying : archive
            ),
            { status: 200 }
          );
        },
      });
      expect(calls).toBe(3);
      await expect(
        fs.readFile(path.join(runtimeDir, "openscad.js"))
      ).resolves.toEqual(Buffer.from(runtime));
      await expect(
        fs.readFile(path.join(runtimeDir, "COPYING"))
      ).resolves.toEqual(Buffer.from(copying));
    } finally {
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("rejects exhausted downloads and checksum mismatches", async () => {
    await expect(
      download("https://example.test/fail", {
        attempts: 2,
        sleep: async () => {},
        fetchImpl: async () => new Response("no", { status: 503 }),
      })
    ).rejects.toThrow("Download failed (503)");

    const runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-installer-checksum-")
    );
    const runtime = new TextEncoder().encode("runtime");
    const copying = new TextEncoder().encode("license");
    const archive = zipSync({ "openscad.js": runtime });
    const policy = {
      ...policyFor(runtime, archive, copying),
      archive_sha256: "0".repeat(64),
    };
    try {
      await expect(
        installOpenScadWasm({
          policy,
          runtimeDir,
          fetchImpl: async () => new Response(Buffer.from(archive)),
          sleep: async () => {},
        })
      ).rejects.toThrow("archive checksum mismatch");
    } finally {
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("rejects an archive without the reviewed runtime and a changed license", async () => {
    const runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-installer-content-")
    );
    const runtime = new TextEncoder().encode("runtime");
    const copying = new TextEncoder().encode("license");
    const missingRuntimeArchive = zipSync({ "other.js": runtime });
    const missingRuntimePolicy = policyFor(
      runtime,
      missingRuntimeArchive,
      copying
    );
    try {
      await expect(
        installOpenScadWasm({
          policy: missingRuntimePolicy,
          runtimeDir,
          fetchImpl: async () =>
            new Response(Buffer.from(missingRuntimeArchive)),
          sleep: async () => {},
        })
      ).rejects.toThrow("runtime checksum mismatch");

      const validArchive = zipSync({ "openscad.js": runtime });
      const licensePolicy = policyFor(runtime, validArchive, copying);
      let calls = 0;
      await expect(
        installOpenScadWasm({
          policy: licensePolicy,
          runtimeDir,
          fetchImpl: async () => {
            calls += 1;
            return new Response(
              Buffer.from(
                calls === 1
                  ? validArchive
                  : new TextEncoder().encode("changed license")
              )
            );
          },
          sleep: async () => {},
        })
      ).rejects.toThrow("license checksum mismatch");
    } finally {
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });
});
