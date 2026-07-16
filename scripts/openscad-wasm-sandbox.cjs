"use strict";

// OpenSCAD's Emscripten runtime exposes host-backed filesystem adapters. CAD
// source is intentionally stdin-only, so deny host path access in the child.
const fs = require("node:fs");
const path = require("node:path");
const runtimePath = path.resolve(process.argv[1]);
const sandboxRoot = path.resolve(process.cwd());

const guard = (operation, original) =>
  function guardHostFilesystemAccess(candidate, ...args) {
    const requestedPath =
      candidate instanceof URL ? candidate.pathname : String(candidate);
    const resolvedPath = path.resolve(requestedPath);
    const isWrite = /^(append|chmod|chown|copy|mkdir|rename|rm|rmdir|symlink|truncate|unlink|utimes|write)/.test(
      operation
    );
    if (
      resolvedPath === runtimePath ||
      (!isWrite &&
        (resolvedPath === sandboxRoot ||
          resolvedPath.startsWith(`${sandboxRoot}${path.sep}`)))
    ) {
      return original.call(fs, candidate, ...args);
    }
    if (process.env.AGENTSCAD_SANDBOX_DEBUG === "1") {
      console.error(`[openscad-sandbox] denied ${operation}: ${requestedPath}`);
    }
    if (operation === "existsSync") return false;
    const error = new Error(
      `OpenSCAD WASM sandbox denied host filesystem ${operation}`
    );
    error.code = isWrite ? "EACCES" : "ENOENT";
    error.path = requestedPath;
    throw error;
  };

for (const operation of [
  "accessSync",
  "appendFileSync",
  "chmodSync",
  "chownSync",
  "copyFileSync",
  "existsSync",
  "lstatSync",
  "mkdirSync",
  "openSync",
  "readFileSync",
  "readdirSync",
  "readlinkSync",
  "realpathSync",
  "renameSync",
  "rmSync",
  "rmdirSync",
  "statSync",
  "symlinkSync",
  "truncateSync",
  "unlinkSync",
  "utimesSync",
  "writeFileSync",
]) {
  if (typeof fs[operation] === "function") {
    fs[operation] = guard(operation, fs[operation]);
  }
}
