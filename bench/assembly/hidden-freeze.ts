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
import { loadGearSubmissions, loadGearTasks } from "../gear/bench";
import { loadSliderSubmissions, loadSliderTasks } from "../slider/bench";
import { loadL4Submissions, loadL4Tasks } from "../l4/bench";
import { loadTwinSubmissions, loadTwinTasks } from "../twin/bench";
import { loadVTwinSubmissions, loadVTwinTasks } from "../vtwin/bench";
import { loadDeclarationSubmissions, loadDeclarationTasks } from "../declaration/bench";
import { loadV8Submissions, loadV8Tasks } from "../v8/bench";
import { loadPlanetarySubmissions, loadPlanetaryTasks } from "../planetary/bench";
import { loadPlanetary3Submissions, loadPlanetary3Tasks } from "../planetary3/bench";
import {
  assertExternalHiddenDirectory,
  hiddenTaskSetSha256,
  validateHiddenManifest,
  type HiddenFamily,
  type HiddenManifest,
  type HiddenTask,
} from "./hidden";

export async function freezeHiddenSet(input: {
  directory: string;
  id: string;
  maintainer: string;
  independent: boolean;
  /** Defaults to assembly for compatibility with existing dev sets. */
  family?: HiddenFamily;
  frozenAt?: string;
  force?: boolean;
}): Promise<HiddenManifest> {
  const root = assertExternalHiddenDirectory(input.directory);
  const family = input.family ?? "assembly";
  if (!["assembly", "gear", "slider", "l4", "twin", "vtwin", "declaration", "v8", "planetary", "planetary3"].includes(family)) throw new Error(`Unknown hidden family "${family}"`);
  const tasks: HiddenTask[] = family === "assembly"
    ? await loadTasks(path.join(root, "tasks"))
    : family === "gear"
      ? await loadGearTasks(path.join(root, "tasks"))
      : family === "slider"
        ? await loadSliderTasks(path.join(root, "tasks"))
        : family === "l4"
          ? await loadL4Tasks(path.join(root, "tasks"), path.join(root, "specs"))
          : family === "twin"
            ? await loadTwinTasks(path.join(root, "tasks"))
            : family === "vtwin"
              ? await loadVTwinTasks(path.join(root, "tasks"))
              : family === "declaration"
                ? await loadDeclarationTasks(path.join(root, "tasks"))
                : family === "v8"
                  ? await loadV8Tasks(path.join(root, "tasks"))
                  : family === "planetary"
                    ? await loadPlanetaryTasks(path.join(root, "tasks"))
                    : await loadPlanetary3Tasks(path.join(root, "tasks"));
  for (const task of tasks) {
    const submissions = family === "assembly"
      ? await loadSubmissions(task.id, path.join(root, "submissions"))
      : family === "gear"
        ? await loadGearSubmissions(task.id, path.join(root, "submissions"))
        : family === "slider"
          ? await loadSliderSubmissions(task.id, path.join(root, "submissions"))
          : family === "l4"
            ? await loadL4Submissions(task.id, path.join(root, "submissions"))
            : family === "twin"
              ? await loadTwinSubmissions(task.id, path.join(root, "submissions"))
              : family === "vtwin"
                ? await loadVTwinSubmissions(task.id, path.join(root, "submissions"))
                : family === "declaration"
                  ? await loadDeclarationSubmissions(task.id, path.join(root, "submissions"))
                  : family === "v8"
                    ? await loadV8Submissions(task.id, path.join(root, "submissions"))
                    : family === "planetary"
                      ? await loadPlanetarySubmissions(task.id, path.join(root, "submissions"))
                      : await loadPlanetary3Submissions(task.id, path.join(root, "submissions"));
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
    family,
    independent: input.independent,
    maintainer: input.maintainer,
    taskSetSha256: hiddenTaskSetSha256(tasks, family),
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
    throw new Error("Usage: bun run bench:hidden:freeze -- --hidden <external-dir> --id <id> --maintainer <name> [--family assembly|gear|slider|l4|twin|vtwin|declaration|v8|planetary|planetary3] [--independent] [--force] [--frozen-at <ISO>]");
  }
  const family = (argument("--family") ?? "assembly") as HiddenFamily;
  const manifest = await freezeHiddenSet({
    directory,
    id,
    maintainer,
    family,
    independent: process.argv.includes("--independent"),
    force: process.argv.includes("--force"),
    ...(argument("--frozen-at") ? { frozenAt: argument("--frozen-at")! } : {}),
  });
  console.log(`frozen ${manifest.id} [${manifest.family}]: ${manifest.taskSetSha256}`);
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
