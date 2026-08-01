#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROVIDER_PRESETS } from "@/lib/provider-catalog";

type DoctorStatus = "PASS" | "WARN" | "FAIL";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  action?: string;
}

interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  checks: DoctorCheck[];
  summary: Record<DoctorStatus, number>;
  durationMs: number;
}

interface OpenScadPolicy {
  version: string;
  runtime_filename: string;
  runtime_sha256: string;
}

interface LibraryManifest {
  managed_library_dir_env: string;
  legacy_managed_library_dir_env?: string;
  default_managed_library_dir: string;
  libraries: Array<{
    name: string;
    default_install: boolean;
    detection_files: string[];
  }>;
}

const PROVIDER_KEY_NAMES = [...new Set(
  PROVIDER_PRESETS.flatMap((preset) => preset.apiKeyEnv ? [preset.apiKeyEnv] : []),
)];

function check(id: string, status: DoctorStatus, message: string, action?: string): DoctorCheck {
  return { id, status, message, ...(action ? { action } : {}) };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  return value.startsWith(`~${path.sep}`)
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

function splitSearchPaths(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replaceAll(",", path.delimiter)
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(expandHome);
}

export function resolveSqliteDatabasePath(databaseUrl: string, projectRoot: string): string | null {
  if (!databaseUrl.startsWith("file:")) return null;
  const withoutScheme = databaseUrl.slice("file:".length).split("?")[0];
  if (!withoutScheme) return null;
  return path.isAbsolute(withoutScheme)
    ? path.normalize(withoutScheme)
    : path.resolve(projectRoot, "prisma", withoutScheme);
}

async function findWritableAncestor(target: string): Promise<string | null> {
  let candidate = path.resolve(target);
  while (true) {
    try {
      await fs.access(candidate, fsConstants.W_OK);
      return candidate;
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function runVersionCommand(command: string, args: string[]): Promise<string | null> {
  try {
    const processHandle = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    const timeout = setTimeout(() => processHandle.kill(), 3_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]).finally(() => clearTimeout(timeout));
    if (exitCode !== 0) return null;
    return `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0] || "available";
  } catch {
    return null;
  }
}

async function checkRuntime(projectRoot: string): Promise<DoctorCheck[]> {
  const results: DoctorCheck[] = [];
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!(await exists(packageJsonPath))) {
    return [check("project", "FAIL", "package.json was not found in the current directory", "Run this command from the AgentSCAD repository root")];
  }
  const packageJson = await readJson<{ name?: string }>(packageJsonPath);
  results.push(packageJson.name === "agentscad"
    ? check("project", "PASS", "AgentSCAD repository detected")
    : check("project", "FAIL", "The current package is not AgentSCAD", "Run this command from the AgentSCAD repository root"));

  results.push(check("bun", "PASS", `Bun ${Bun.version}`));
  const nodeVersion = await runVersionCommand(process.env.AGENTSCAD_NODE_BIN || "node", ["--version"]);
  results.push(nodeVersion
    ? check("node", "PASS", `Node runtime available (${nodeVersion})`)
    : check("node", "FAIL", "Node.js is not available", "Install Node.js 20 or 22 LTS, or set AGENTSCAD_NODE_BIN"));

  results.push(await exists(path.join(projectRoot, "node_modules"))
    ? check("dependencies", "PASS", "Dependencies are installed")
    : check("dependencies", "FAIL", "node_modules is missing", "Run: bun install --frozen-lockfile"));
  results.push(await exists(path.join(projectRoot, "node_modules", ".prisma", "client", "default.js"))
    ? check("prisma-client", "PASS", "Prisma client is generated")
    : check("prisma-client", "FAIL", "Prisma client is missing", "Run: bun run db:generate"));
  return results;
}

async function checkDatabase(projectRoot: string, env: NodeJS.ProcessEnv): Promise<DoctorCheck> {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return check("database", "FAIL", "DATABASE_URL is not configured", "Copy .env.example to .env, then run: bun run db:push");
  }
  const databasePath = resolveSqliteDatabasePath(databaseUrl, projectRoot);
  if (!databasePath) {
    return check("database", "FAIL", "DATABASE_URL is not a SQLite file URL", "This repository currently uses Prisma SQLite; set a file: URL");
  }
  if (!(await exists(databasePath))) {
    const parent = await findWritableAncestor(path.dirname(databasePath));
    return check(
      "database",
      "FAIL",
      parent ? "SQLite database has not been initialized" : "SQLite database path is not writable",
      "Run: bun run db:push",
    );
  }
  try {
    await fs.access(databasePath, fsConstants.R_OK | fsConstants.W_OK);
    return check("database", "PASS", "Local SQLite database is readable and writable");
  } catch {
    return check("database", "FAIL", "Local SQLite database is not readable and writable", "Fix database file permissions, then run: bun run db:push");
  }
}

async function checkProviderSettings(projectRoot: string, env: NodeJS.ProcessEnv): Promise<DoctorCheck[]> {
  const configuredEnvKeys = PROVIDER_KEY_NAMES.filter((name) => Boolean(env[name]?.trim()));
  const providerPath = path.join(projectRoot, ".agentscad", "providers.json");
  let localProviderCount = 0;
  let localCredentialCount = 0;
  let providerFileMode: number | null = null;
  if (await exists(providerPath)) {
    try {
      const payload = await readJson<{ providers?: Array<{ enabled?: boolean; apiKey?: unknown }> }>(providerPath);
      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      localProviderCount = providers.filter((provider) => provider.enabled !== false).length;
      localCredentialCount = providers.filter(
        (provider) => provider.enabled !== false && typeof provider.apiKey === "string" && provider.apiKey.length > 0,
      ).length;
      providerFileMode = (await fs.stat(providerPath)).mode & 0o777;
    } catch {
      return [check("providers", "FAIL", "Local provider settings cannot be parsed", "Open Settings → Providers and save the configuration again")];
    }
  }

  const credentials = configuredEnvKeys.length + localCredentialCount;
  const results = [credentials > 0
    ? check("providers", "PASS", `${credentials} provider credential source(s) detected; secret values were not inspected or printed`)
    : check("providers", "WARN", "No provider credential is configured yet", "Start the app, then use Settings → Providers → Test → Save")];

  if (localProviderCount > 0 && providerFileMode !== null && (providerFileMode & 0o077) !== 0) {
    results.push(check(
      "provider-permissions",
      "WARN",
      "Local provider settings are readable by group or other users",
      "Restrict .agentscad/providers.json to the current user (for example: chmod 600 .agentscad/providers.json)",
    ));
  } else if (localProviderCount > 0) {
    results.push(check("provider-permissions", "PASS", "Local provider settings permissions are restricted"));
  }
  return results;
}

async function checkOpenScad(projectRoot: string, env: NodeJS.ProcessEnv): Promise<DoctorCheck> {
  const backend = env.AGENTSCAD_OPENSCAD_BACKEND?.trim() || "native";
  if (!new Set(["native", "wasm"]).has(backend)) {
    return check("openscad", "FAIL", `Unknown OpenSCAD backend: ${backend}`, "Set AGENTSCAD_OPENSCAD_BACKEND to native or wasm");
  }
  if (backend === "native") {
    const executable = env.OPENSCAD_BIN?.trim() || "openscad";
    const version = await runVersionCommand(executable, ["--version"]);
    return version
      ? check("openscad", "PASS", `Native OpenSCAD is available (${version})`)
      : check("openscad", "FAIL", "Native OpenSCAD is not reachable", "Install OpenSCAD or set AGENTSCAD_OPENSCAD_BACKEND=wasm and run: bun run runtime:openscad:install");
  }

  const policy = await readJson<OpenScadPolicy>(path.join(projectRoot, "config", "openscad-wasm-runtime.json"));
  const runtimePath = env.AGENTSCAD_OPENSCAD_WASM_PATH?.trim()
    ? path.resolve(env.AGENTSCAD_OPENSCAD_WASM_PATH)
    : path.join(projectRoot, ".openscad-runtime", policy.runtime_filename);
  if (!(await exists(runtimePath))) {
    return check("openscad", "FAIL", `OpenSCAD WASM ${policy.version} is not installed`, "Run: bun run runtime:openscad:install");
  }
  const actualHash = await sha256File(runtimePath);
  return actualHash === policy.runtime_sha256
    ? check("openscad", "PASS", `OpenSCAD WASM ${policy.version} passed its checksum check`)
    : check("openscad", "FAIL", "OpenSCAD WASM checksum does not match the pinned runtime", "Run: bun run runtime:openscad:install");
}

async function checkLibraries(projectRoot: string, env: NodeJS.ProcessEnv): Promise<DoctorCheck> {
  const manifest = await readJson<LibraryManifest>(
    path.join(projectRoot, "skills", "scad-library-policy", "manifest.json"),
  );
  const managedOverride = env[manifest.managed_library_dir_env]
    || (manifest.legacy_managed_library_dir_env ? env[manifest.legacy_managed_library_dir_env] : undefined);
  const roots = [
    managedOverride ? expandHome(managedOverride) : expandHome(manifest.default_managed_library_dir),
    ...splitSearchPaths(env.OPENSCAD_LIBRARY_PATHS),
    ...splitSearchPaths(env.OPENSCADPATH),
    path.join(os.homedir(), "Documents", "OpenSCAD", "libraries"),
  ];
  const defaultLibraries = manifest.libraries.filter((library) => library.default_install);
  const available: string[] = [];
  for (const library of defaultLibraries) {
    let found = false;
    for (const root of roots) {
      for (const detectionFile of library.detection_files) {
        if (await exists(path.join(root, detectionFile))) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) available.push(library.name);
  }
  return available.length === defaultLibraries.length
    ? check("scad-libraries", "PASS", `${available.length}/${defaultLibraries.length} default OpenSCAD libraries are available`)
    : check(
        "scad-libraries",
        "WARN",
        `${available.length}/${defaultLibraries.length} default OpenSCAD libraries are available`,
        "Run: bun run scad:libs:install",
      );
}

async function checkStorage(projectRoot: string, env: NodeJS.ProcessEnv): Promise<DoctorCheck[]> {
  const artifactRoot = env.AGENTSCAD_ARTIFACT_WORK_DIR?.trim()
    ? path.resolve(env.AGENTSCAD_ARTIFACT_WORK_DIR)
    : path.join(projectRoot, "public", "artifacts");
  const writable = await findWritableAncestor(artifactRoot);
  const results = [writable
    ? check("artifacts", "PASS", "Local artifact directory is writable or can be created")
    : check("artifacts", "FAIL", "Local artifact directory cannot be created", "Set AGENTSCAD_ARTIFACT_WORK_DIR to a writable local path")];

  const gitignore = await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8").catch(() => "");
  const ignoresSecrets = /(^|\n)\.env(\n|$)/.test(gitignore)
    && /(^|\n)\.agentscad\/?(\n|$)/.test(gitignore);
  results.push(ignoresSecrets
    ? check("local-secrets", "PASS", ".env and .agentscad provider settings are gitignored")
    : check("local-secrets", "FAIL", "Local provider secrets are not fully gitignored", "Add .env and .agentscad/ to .gitignore"));
  return results;
}

export function summarizeDoctorChecks(checks: DoctorCheck[]): DoctorReport["summary"] {
  return checks.reduce<DoctorReport["summary"]>(
    (summary, item) => ({ ...summary, [item.status]: summary[item.status] + 1 }),
    { PASS: 0, WARN: 0, FAIL: 0 },
  );
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ["AgentSCAD doctor", ""];
  for (const item of report.checks) {
    lines.push(`[${item.status}] ${item.message}`);
    if (item.action) lines.push(`       Fix: ${item.action}`);
  }
  lines.push(
    "",
    `Summary: ${report.summary.PASS} passed, ${report.summary.WARN} warnings, ${report.summary.FAIL} failed (${report.durationMs}ms)`,
    report.ok ? "Ready to start AgentSCAD." : "Resolve failed checks before starting AgentSCAD.",
  );
  return lines.join("\n");
}

export async function runDoctor(
  projectRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorReport> {
  const startedAt = performance.now();
  const groups = await Promise.all([
    checkRuntime(projectRoot),
    checkDatabase(projectRoot, env).then((item) => [item]),
    checkProviderSettings(projectRoot, env),
    checkOpenScad(projectRoot, env).then((item) => [item]),
    checkLibraries(projectRoot, env).then((item) => [item]),
    checkStorage(projectRoot, env),
  ]);
  const checks = groups.flat();
  const summary = summarizeDoctorChecks(checks);
  return {
    schemaVersion: 1,
    ok: summary.FAIL === 0,
    checks,
    summary,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

if (import.meta.main) {
  const report = await runDoctor();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatDoctorReport(report)}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}
