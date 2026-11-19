/**
 * Hidden-split harness for the assembly benchmark.
 *
 * The public tasks and references live in the repository. A hidden set must
 * live **outside** the repository, carry a frozen manifest and task-set hash,
 * and produce an aggregate-only report: prompts, source paths, sources and
 * per-case measurements are not copied into the report.
 *
 * The harness can verify that a directory is external and that its contents
 * match the frozen hash. It cannot verify that a third party actually maintained
 * the tasks, so `independent: true` is recorded as a declaration, not a proof.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../src/lib/canonical-json";
import { loadSubmissions, loadTasks, type BenchTask, type Submission } from "./bench";
import { loadGearSubmissions, loadGearTasks, type GearBenchTask } from "../gear/bench";
import { loadSliderSubmissions, loadSliderTasks, type SliderBenchTask } from "../slider/bench";
import { loadL4Submissions, loadL4Tasks, type L4BenchTask } from "../l4/bench";
import { loadTwinSubmissions, loadTwinTasks, type TwinBenchTask } from "../twin/bench";
import { loadVTwinSubmissions, loadVTwinTasks, type VTwinBenchTask } from "../vtwin/bench";
import { loadDeclarationSubmissions, loadDeclarationTasks, type DeclarationBenchTask } from "../declaration/bench";
import { loadV8Submissions, loadV8Tasks, type V8BenchTask } from "../v8/bench";
import { loadPlanetarySubmissions, loadPlanetaryTasks, type PlanetaryBenchTask } from "../planetary/bench";

export type HiddenFamily = "assembly" | "gear" | "slider" | "l4" | "twin" | "vtwin" | "declaration" | "v8" | "planetary";
export type HiddenTask = BenchTask | GearBenchTask | SliderBenchTask | L4BenchTask | TwinBenchTask | VTwinBenchTask | DeclarationBenchTask | V8BenchTask | PlanetaryBenchTask;
export interface HiddenCase {
  taskId: string;
  status: string;
  layers: { coverage: { passed: number; observed: number } };
}

export interface HiddenManifest {
  schemaVersion: 1;
  id: string;
  frozenAt: string;
  /** Which public family the hidden tasks use. Omitted legacy manifests mean assembly. */
  family: HiddenFamily;
  /** Declared by the maintainer; the harness cannot verify it. */
  independent: boolean;
  maintainer: string;
  taskSetSha256: string;
}

export interface HiddenSet {
  manifest: HiddenManifest;
  tasks: HiddenTask[];
  submissions: Map<string, Submission[]>;
}

export interface HiddenAggregateReport {
  schemaVersion: "assembly-bench.hidden.v1";
  hiddenId: string;
  family: HiddenFamily;
  maintainer: string;
  independent: boolean;
  independentHiddenEvaluation: "NOT_RUN" | "DECLARED_NOT_VERIFIED";
  independentReason: string;
  taskSetSha256: string;
  evaluatedAt: string;
  backend: string;
  summary: { tasks: number; cases: number; passed: number; failed: number; notRun: number };
  tasks: Array<{
    taskId: string;
    cases: number;
    passed: number;
    failed: number;
    notRun: number;
    layers: { passed: number; observed: number };
  }>;
}

const REPO_ROOT = path.resolve(import.meta.dir, "../..");

export function validateHiddenManifest(value: unknown): HiddenManifest {
  if (!value || typeof value !== "object") throw new Error("hidden.json must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new Error("hidden.json schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(raw.id)) throw new Error("hidden.json id is invalid");
  if (typeof raw.frozenAt !== "string" || !Number.isFinite(Date.parse(raw.frozenAt))) throw new Error("hidden.json frozenAt must be an ISO date");
  const family = raw.family === undefined ? "assembly" : raw.family;
  if (family !== "assembly" && family !== "gear" && family !== "slider" && family !== "l4" && family !== "twin" && family !== "vtwin" && family !== "declaration" && family !== "v8" && family !== "planetary") throw new Error("hidden.json family must be assembly, gear, slider, l4, twin, vtwin, declaration, v8 or planetary");
  if (typeof raw.independent !== "boolean") throw new Error("hidden.json independent must be boolean");
  if (typeof raw.maintainer !== "string" || raw.maintainer.trim().length < 3) throw new Error("hidden.json maintainer must be non-trivial");
  if (typeof raw.taskSetSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.taskSetSha256)) throw new Error("hidden.json taskSetSha256 must be a lowercase SHA-256");
  return {
    schemaVersion: 1,
    id: raw.id,
    frozenAt: raw.frozenAt,
    family,
    independent: raw.independent,
    maintainer: raw.maintainer.trim(),
    taskSetSha256: raw.taskSetSha256,
  };
}

/** Stable hash of the validated task definitions, sorted by task id. */
export function hiddenTaskSetSha256(tasks: HiddenTask[], family: HiddenFamily = "assembly"): string {
  if (family !== "assembly") {
    return sha256Hex(canonicalJson([...tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))));
  }
  const normalized = (tasks as BenchTask[])
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((task) => ({
      schemaVersion: task.schemaVersion,
      id: task.id,
      prompt: task.prompt,
      parts: task.parts,
      joint: task.joint,
      requirements: task.requirements,
      motion: task.motion,
      disassembly: { travelMm: task.disassembly.travelMm, steps: task.disassembly.steps },
      ...(task.pose ? { pose: task.pose } : {}),
      ...(task.retention ? { retention: task.retention } : {}),
      ...(task.expectedAssemblyBboxMm ? { expectedAssemblyBboxMm: task.expectedAssemblyBboxMm } : {}),
    }));
  return sha256Hex(canonicalJson(normalized));
}

/** Refuses a set that is inside the repository, even if it is gitignored. */
export function assertExternalHiddenDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`The hidden set must live outside the repository (${REPO_ROOT}); got ${resolved}`);
  }
  return resolved;
}

export async function loadHiddenSet(directory: string): Promise<HiddenSet> {
  const root = assertExternalHiddenDirectory(directory);
  let manifest: HiddenManifest;
  try {
    manifest = validateHiddenManifest(JSON.parse(await readFile(path.join(root, "hidden.json"), "utf8")));
  } catch (error) {
    throw new Error(`Cannot load ${path.join(root, "hidden.json")}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tasks: HiddenTask[] = manifest.family === "assembly"
    ? await loadTasks(path.join(root, "tasks"))
    : manifest.family === "gear"
      ? await loadGearTasks(path.join(root, "tasks"))
      : manifest.family === "slider"
        ? await loadSliderTasks(path.join(root, "tasks"))
        : manifest.family === "l4"
          ? await loadL4Tasks(path.join(root, "tasks"), path.join(root, "specs"))
          : manifest.family === "twin"
            ? await loadTwinTasks(path.join(root, "tasks"))
            : manifest.family === "vtwin"
              ? await loadVTwinTasks(path.join(root, "tasks"))
              : manifest.family === "declaration"
                ? await loadDeclarationTasks(path.join(root, "tasks"))
                : manifest.family === "v8"
                  ? await loadV8Tasks(path.join(root, "tasks"))
                  : await loadPlanetaryTasks(path.join(root, "tasks"));
  const actual = hiddenTaskSetSha256(tasks, manifest.family);
  if (actual !== manifest.taskSetSha256) {
    throw new Error(`The hidden task set changed without re-freezing: manifest ${manifest.taskSetSha256.slice(0, 12)}, actual ${actual.slice(0, 12)}.`);
  }
  const submissions = new Map<string, Submission[]>();
  for (const task of tasks) {
    const rows = manifest.family === "assembly"
      ? await loadSubmissions(task.id, path.join(root, "submissions"))
      : manifest.family === "gear"
        ? await loadGearSubmissions(task.id, path.join(root, "submissions"))
        : manifest.family === "slider"
          ? await loadSliderSubmissions(task.id, path.join(root, "submissions"))
          : manifest.family === "l4"
            ? await loadL4Submissions(task.id, path.join(root, "submissions"))
            : manifest.family === "twin"
              ? await loadTwinSubmissions(task.id, path.join(root, "submissions"))
              : manifest.family === "vtwin"
                ? await loadVTwinSubmissions(task.id, path.join(root, "submissions"))
                : manifest.family === "declaration"
                  ? await loadDeclarationSubmissions(task.id, path.join(root, "submissions"))
                  : manifest.family === "v8"
                    ? await loadV8Submissions(task.id, path.join(root, "submissions"))
                    : await loadPlanetarySubmissions(task.id, path.join(root, "submissions"));
    if (rows.length === 0) throw new Error(`Hidden task ${task.id} has no submissions.`);
    submissions.set(task.id, rows);
  }
  return { manifest, tasks, submissions };
}

export function aggregateHiddenReport(manifest: HiddenManifest, reports: HiddenCase[], backend = process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native"): HiddenAggregateReport {
  const byTask = new Map<string, HiddenCase[]>();
  for (const report of reports) {
    const list = byTask.get(report.taskId) ?? [];
    list.push(report);
    byTask.set(report.taskId, list);
  }
  const tasks = [...byTask.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([taskId, rows]) => ({
    taskId,
    cases: rows.length,
    passed: rows.filter((row) => row.status === "PASS").length,
    failed: rows.filter((row) => row.status === "FAIL" || row.status === "ERROR").length,
    notRun: rows.filter((row) => row.status === "NOT_RUN").length,
    layers: {
      passed: rows.reduce((sum, row) => sum + row.layers.coverage.passed, 0),
      observed: rows.reduce((sum, row) => sum + row.layers.coverage.observed, 0),
    },
  }));
  return {
    schemaVersion: "assembly-bench.hidden.v1",
    hiddenId: manifest.id,
    family: manifest.family,
    maintainer: manifest.maintainer,
    independent: manifest.independent,
    independentHiddenEvaluation: manifest.independent ? "DECLARED_NOT_VERIFIED" : "NOT_RUN",
    independentReason: manifest.independent
      ? "The maintainer declares this set independent. The harness verified only that it lives outside the repository and matches its frozen task-set hash; it cannot verify who authored or withheld the tasks."
      : "The maintainer did not declare this set independent. This is a development hidden-set run, not an independent hidden evaluation.",
    taskSetSha256: manifest.taskSetSha256,
    evaluatedAt: new Date().toISOString(),
    backend,
    summary: {
      tasks: tasks.length,
      cases: reports.length,
      passed: reports.filter((report) => report.status === "PASS").length,
      failed: reports.filter((report) => report.status === "FAIL" || report.status === "ERROR").length,
      notRun: reports.filter((report) => report.status === "NOT_RUN").length,
    },
    tasks,
  };
}

export function defaultHiddenReportPath(): string {
  return path.join(os.tmpdir(), "agentscad-hidden-report.json");
}
