#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultFetch = (url, options) => fetch(url, options);
const defaultSleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function matches(filePath, expected) {
  try {
    return sha256(await fs.readFile(filePath)) === expected;
  } catch {
    return false;
  }
}

export async function download(
  url,
  {
    attempts = 3,
    fetchImpl = defaultFetch,
    sleep = defaultSleep,
  } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}) for ${url}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(attempt * 500);
      }
    }
  }
  throw lastError;
}

export async function installOpenScadWasm({
  policy,
  runtimeDir,
  fetchImpl = defaultFetch,
  sleep = defaultSleep,
}) {
  const runtimePath = path.join(runtimeDir, policy.runtime_filename);
  const licensePath = path.join(runtimeDir, policy.copying_filename);
  const metadataPath = path.join(runtimeDir, "metadata.json");
  const downloadOptions = { fetchImpl, sleep };

  await fs.mkdir(runtimeDir, { recursive: true });

  if (!(await matches(runtimePath, policy.runtime_sha256))) {
    const archive = await download(policy.archive_url, downloadOptions);
    if (sha256(archive) !== policy.archive_sha256) {
      throw new Error("OpenSCAD WASM archive checksum mismatch");
    }
    const files = unzipSync(archive);
    const runtime = files[policy.runtime_filename];
    if (!runtime || sha256(runtime) !== policy.runtime_sha256) {
      throw new Error("OpenSCAD WASM runtime checksum mismatch");
    }
    await fs.writeFile(runtimePath, runtime, { mode: 0o755 });
  }

  if (!(await matches(licensePath, policy.copying_sha256))) {
    const license = await download(policy.copying_url, downloadOptions);
    if (sha256(license) !== policy.copying_sha256) {
      throw new Error("OpenSCAD license checksum mismatch");
    }
    await fs.writeFile(licensePath, license);
  }

  await fs.writeFile(metadataPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  return { runtimePath, licensePath, metadataPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const policy = JSON.parse(
    await fs.readFile(
      path.join(root, "config", "openscad-wasm-runtime.json"),
      "utf8"
    )
  );
  await installOpenScadWasm({
    policy,
    runtimeDir: path.join(root, ".openscad-runtime"),
  });
  console.log(`OpenSCAD WASM ${policy.version} runtime verified.`);
}
