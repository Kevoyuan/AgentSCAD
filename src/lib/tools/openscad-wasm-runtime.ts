import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import openScadPolicy from "../../../config/openscad-wasm-runtime.json";
import { getOpenScadDefinitionEntries } from "@/lib/tools/scad-definitions";
import { enforceServerlessRenderCapacity } from "@/lib/tools/render-capacity";
const MAX_SCAD_BYTES = 2 * 1024 * 1024;
const MAX_STL_BYTES = 6 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const WASM_TIMEOUT_MS = 120_000;
const WASM_QUEUE_TIMEOUT_MS = 30_000;
const MAX_PENDING_WASM_RENDERS = 2;
const NODE_BIN =
  process.env.AGENTSCAD_NODE_BIN ||
  (process.versions.bun ? process.execPath : "node");
const SANDBOX_PRELOAD_PATH = path.join(
  process.cwd(),
  "scripts",
  "openscad-wasm-sandbox.cjs"
);

let verifiedRuntimePath: string | null = null;
let wasmQueue: Promise<void> = Promise.resolve();
let pendingWasmRenders = 0;

function runtimePath(): string {
  return (
    process.env.AGENTSCAD_OPENSCAD_WASM_PATH ||
    path.join(
      process.cwd(),
      ".openscad-runtime",
      openScadPolicy.runtime_filename
    )
  );
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureVerifiedRuntime(): Promise<string> {
  const candidate = runtimePath();
  if (verifiedRuntimePath === candidate) return candidate;

  const runtime = process.env.AGENTSCAD_OPENSCAD_WASM_PATH
    ? await fs.readFile(
        /* turbopackIgnore: true */ process.env.AGENTSCAD_OPENSCAD_WASM_PATH
      )
    : await fs.readFile(
        path.join(process.cwd(), ".openscad-runtime", "openscad.js")
      );
  if (sha256(runtime) !== openScadPolicy.runtime_sha256) {
    throw new Error(
      "Bundled OpenSCAD WASM failed its integrity check; refusing to execute it"
    );
  }
  verifiedRuntimePath = candidate;
  return candidate;
}

function definitionArgs(definitions?: Record<string, unknown>): string[] {
  return getOpenScadDefinitionEntries(definitions).flatMap(([key, value]) => [
    "-D",
    `${key}=${value}`,
  ]);
}

export function buildOpenScadWasmEnv(
  sandboxRoot = os.tmpdir()
): NodeJS.ProcessEnv {
  return {
    HOME: sandboxRoot,
    LANG: "C.UTF-8",
    NODE_ENV: "production",
    PATH: process.env.PATH,
    TMPDIR: sandboxRoot,
    TZ: "UTC",
    OPENSCADPATH: "",
  };
}

function maskScadCommentsAndStrings(source: string): string {
  let result = "";
  let index = 0;
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (state === "code" && current === "/" && next === "/") {
      result += "  ";
      index += 2;
      state = "line-comment";
      continue;
    }
    if (state === "code" && current === "/" && next === "*") {
      result += "  ";
      index += 2;
      state = "block-comment";
      continue;
    }
    if (state === "code" && current === '"') {
      result += " ";
      index += 1;
      state = "string";
      continue;
    }
    if (state === "line-comment") {
      result += current === "\n" ? "\n" : " ";
      index += 1;
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        result += "  ";
        index += 2;
        state = "code";
      } else {
        result += current === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (state === "string") {
      if (current === "\\") {
        result += next === "\n" ? " \n" : "  ";
        index += Math.min(2, source.length - index);
      } else {
        result += current === "\n" ? "\n" : " ";
        index += 1;
        if (current === '"') state = "code";
      }
      continue;
    }

    result += current;
    index += 1;
  }

  return result;
}

export async function prepareScadForWasm(scadSource: string): Promise<string> {
  if (Buffer.byteLength(scadSource, "utf8") > MAX_SCAD_BYTES) {
    throw new Error("SCAD source exceeds the 2 MB serverless render limit");
  }

  const maskedSource = maskScadCommentsAndStrings(scadSource);
  const directives = Array.from(
    maskedSource.matchAll(/\b(?:include|use)\s*<([^>\r\n]+)>\s*;?/gi)
  );
  const unresolvedIncludes = directives
    .map((match) => match[1].trim())
    .filter((library) => library !== "agentscad_std.scad");
  if (unresolvedIncludes.length > 0) {
    throw new Error(
      `OpenSCAD WASM cannot resolve external libraries: ${unresolvedIncludes.join(", ")}`
    );
  }

  const standardDirectives = directives.filter(
    (match) => match[1].trim() === "agentscad_std.scad"
  );
  const usesStandardLibrary = standardDirectives.length > 0;
  let prepared = scadSource;
  for (const directive of standardDirectives.reverse()) {
    const start = directive.index ?? 0;
    prepared =
      prepared.slice(0, start) +
      " ".repeat(directive[0].length) +
      prepared.slice(start + directive[0].length);
  }
  if (usesStandardLibrary) {
    const standardLibrary = await fs.readFile(
      path.join(process.cwd(), "openscad_lib", "agentscad_std.scad"),
      "utf8"
    );
    prepared = `${standardLibrary}\n\n${prepared}`;
  }

  const executableSource = maskScadCommentsAndStrings(prepared);
  const unsupportedPrimitives = Array.from(
    executableSource.matchAll(/\b(import|surface|text)\s*\(/g),
    (match) => match[1]
  );
  if (unsupportedPrimitives.length > 0) {
    throw new Error(
      `OpenSCAD WASM does not support external files or fonts: ${Array.from(
        new Set(unsupportedPrimitives)
      ).join(", ")}`
    );
  }

  return prepared;
}

async function withWasmSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (pendingWasmRenders >= MAX_PENDING_WASM_RENDERS) {
    throw new Error("OpenSCAD WASM renderer is busy; retry this render shortly");
  }
  pendingWasmRenders += 1;
  const previous = wasmQueue;
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  wasmQueue = previous.then(() => current);
  try {
    let queueTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        queueTimer = setTimeout(
          () =>
            reject(
              new Error(
                "OpenSCAD WASM renderer queue wait exceeded 30 seconds"
              )
            ),
          WASM_QUEUE_TIMEOUT_MS
        );
      }),
    ]).finally(() => {
      if (queueTimer) clearTimeout(queueTimer);
    });
    return await operation();
  } finally {
    release();
    pendingWasmRenders -= 1;
  }
}

async function executeWasm(
  scadSource: string,
  definitions?: Record<string, unknown>
): Promise<Buffer> {
  const executable = await ensureVerifiedRuntime();
  const prepared = await prepareScadForWasm(scadSource);

  return withWasmSlot(async () => {
    await enforceServerlessRenderCapacity();
    const sandboxRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-openscad-sandbox-")
    );
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const child = spawn(
          NODE_BIN,
          [
            "--max-old-space-size=384",
            "--wasm-max-mem-pages=4096",
            "--wasm-max-committed-code-mb=128",
            "--require",
            SANDBOX_PRELOAD_PATH,
            executable,
            ...definitionArgs(definitions),
            "--export-format",
            "binstl",
            "-o",
            "-",
            "-",
          ],
          {
            cwd: sandboxRoot,
            env: buildOpenScadWasmEnv(sandboxRoot),
            stdio: ["pipe", "pipe", "pipe"],
          }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;

        const finish = (error?: Error, output?: Buffer) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(output ?? Buffer.alloc(0));
        };

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(new Error("OpenSCAD WASM render timed out after 120 seconds"));
        }, WASM_TIMEOUT_MS);

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes > MAX_STL_BYTES) {
            child.kill("SIGKILL");
            finish(new Error("OpenSCAD WASM output exceeded the 6 MB limit"));
            return;
          }
          stdout.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (stderrBytes >= MAX_STDERR_BYTES) return;
          const remaining = MAX_STDERR_BYTES - stderrBytes;
          const retained = chunk.subarray(0, remaining);
          stderr.push(retained);
          stderrBytes += retained.length;
        });
        child.on("error", (error) => finish(error));
        child.on("close", (code, signal) => {
          if (settled) return;
          if (code !== 0) {
            const detail = Buffer.concat(stderr)
              .toString("utf8")
              .trim()
              .slice(-4000);
            finish(
              new Error(
                `OpenSCAD WASM failed (${signal ?? `exit ${code}`}): ${
                  detail || "no diagnostic output"
                }`
              )
            );
            return;
          }
          const output = Buffer.concat(stdout);
          if (output.length < 84) {
            finish(new Error("OpenSCAD WASM produced an empty STL"));
            return;
          }
          finish(undefined, output);
        });

        child.stdin.on("error", (error) => finish(error));
        child.stdin.end(prepared, "utf8");
      });
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
  });
}

export async function renderScadToStlWasm(
  scadSource: string,
  definitions?: Record<string, unknown>
): Promise<Buffer> {
  return executeWasm(scadSource, definitions);
}

export function resetOpenScadWasmRuntimeForTests(): void {
  verifiedRuntimePath = null;
  wasmQueue = Promise.resolve();
  pendingWasmRenders = 0;
}
