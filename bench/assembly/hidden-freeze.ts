/**
 * Freeze an external hidden set into `hidden.json`.
 *
 * The operator supplies an external directory, an id and a maintainer. The
 * tool validates every task, requires at least one submission per task, hashes
 * the validated task definitions, and writes the manifest the hidden runner
 * will later verify. It does not render geometry and does not run a model.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadSubmissions, loadTasks } from "./bench";
import {
  assertExternalHiddenDirectory,
  hiddenTaskSetSha256,
  validateHiddenManifest,
  type HiddenManifest,
} from "./hidden";

export async function freezeHiddenSet(input: {
  directory: string;
  id: string;
  maintainer: string;
  independent: boolean;
  frozenAt?: string;
  force?: boolean;
}): Promise<HiddenManifest> {
  const root = assertExternalHiddenDirectory(input.directory);
  const tasks = await loadTasks(path.join(root, "tasks"));
  for (const task of tasks) {
    const submissions = await loadSubmissions(task.id, path.join(root, "submissions"));
    if (submissions.length === 0) throw new Error(`Hidden task ${task.id} has no submissions.`);
  }
  const manifestPath = path.join(root, "hidden.json");
  if (!input.force) {
    try {
      await access(manifestPath);
      throw new Error(`${manifestPath} already exists; pass --force to re-freeze after reviewing the task-set change.`);
    } catch (error) {
      // A missing file is the expected first-freeze state. Re-throw any other error.
      if (error instanceof Error && !/ENOENT/.test((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  const manifest = validateHiddenManifest({
    schemaVersion: 1,
    id: input.id,
    frozenAt: input.frozenAt ?? new Date().toISOString(),
    independent: input.independent,
    maintainer: input.maintainer,
    taskSetSha256: hiddenTaskSetSha256(tasks),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const directory = argument("--hidden");
  const id = argument("--id");
  const maintainer = argument("--maintainer");
  if (!directory || !id || !maintainer) {
    throw new Error("Usage: bun run bench:hidden:freeze -- --hidden <external-dir> --id <id> --maintainer <name> [--independent] [--force] [--frozen-at <ISO>]");
  }
  const manifest = await freezeHiddenSet({
    directory,
    id,
    maintainer,
    independent: process.argv.includes("--independent"),
    force: process.argv.includes("--force"),
    ...(argument("--frozen-at") ? { frozenAt: argument("--frozen-at")! } : {}),
  });
  console.log(`frozen ${manifest.id}: ${manifest.taskSetSha256}`);
  console.log(`independent: ${manifest.independent ? "declared true (not verified)" : "false"}; written to ${path.join(directory, "hidden.json")}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
