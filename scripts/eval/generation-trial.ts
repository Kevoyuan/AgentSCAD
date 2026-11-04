#!/usr/bin/env bun
/**
 * The generation trial: does the model actually produce an assembly that passes
 * the checks this repository built?
 *
 * Everything else in `scripts/eval` measures code that already exists. This is
 * the only place a paid model call could happen, so it is built backwards from
 * that fact:
 *
 * 1. **A frozen task set.** The prompts are data with a recorded hash; editing a
 *    prompt without re-freezing is a hard error, because a pass rate against a
 *    set that quietly changed is not a measurement.
 * 2. **A budget that is checked before the first call.** Worst-case calls are
 *    tasks × (1 + repairs). If the ceiling cannot cover the worst case, the plan
 *    is refused instead of being discovered to be over budget halfway through.
 * 3. **Plan and replay cost nothing.** `--plan` prints what would be spent;
 *    `--replay` runs the whole evaluation against recorded sources. Only `--run`
 *    spends money, and only with an explicit authorization.
 * 4. **The contract is derived, never confirmed.** A trial has no user in it, so
 *    it cannot manufacture consent. The report says `contractProvenance:
 *    "derived"` and the pass rate means "met the machine reading of the
 *    request", which is a weaker claim than "met the user's requirement".
 *
 * Usage:
 *   bun scripts/eval/generation-trial.ts --plan [--price 0.002]
 *   bun scripts/eval/generation-trial.ts --replay <dir>
 *   AGENTSCAD_ALLOW_PAID=1 bun scripts/eval/generation-trial.ts --run \
 *     --max-calls 12 --max-usd 0.05 --price 0.002 --model <id>
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { judgeAssemblyCandidate } from "./judge-assembly";

export type TrialStatus = "PASS" | "FAIL" | "NOT_RUN" | "ERROR";

export interface TrialTask {
  id: string;
  prompt: string;
  /** What the request is asking for, in the pipeline's own vocabulary. */
  intentKind: "revolute-hinge" | "bolted-joint" | "sliding-joint";
  /** Repair proposals allowed after the first generation. */
  maxRepairs: number;
  /** What a wrong result would look like, so a failure is interpretable. */
  failureMode: string;
}

export interface TaskSet {
  schemaVersion: 1;
  frozenAt: string;
  tasks: TrialTask[];
  /** sha256 of the canonical task list; recomputed and compared on load. */
  taskSetSha256: string;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};

export const taskSetSha256 = (tasks: TrialTask[]): string =>
  createHash("sha256").update(canonical(tasks)).digest("hex");

/** Every task generates once, then may repair up to its own allowance. */
export const worstCaseCalls = (taskSet: TaskSet): number =>
  taskSet.tasks.reduce((sum, task) => sum + 1 + task.maxRepairs, 0);

/** Loads a frozen set and refuses one whose declared hash does not match its content. */
export function loadTaskSet(raw: unknown): TaskSet {
  const value = raw as Partial<TaskSet> | null;
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.tasks)) {
    throw new Error("The task set is malformed: expected schemaVersion 1 and a tasks array.");
  }
  if (typeof value.taskSetSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.taskSetSha256)) {
    throw new Error("The task set has no frozen hash, so it cannot be treated as frozen.");
  }
  const ids = new Set<string>();
  value.tasks.forEach((task, index) => {
    if (!task || typeof task.id !== "string" || !task.id.trim()) throw new Error(`Task ${index} has no id.`);
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (typeof task.prompt !== "string" || !task.prompt.trim()) throw new Error(`Task ${task.id} has no prompt.`);
    if (!Number.isInteger(task.maxRepairs) || task.maxRepairs < 0 || task.maxRepairs > 5) {
      throw new Error(`Task ${task.id} must allow 0 to 5 repairs.`);
    }
  });
  const actual = taskSetSha256(value.tasks);
  if (actual !== value.taskSetSha256) {
    throw new Error(`The task set changed without being re-frozen: recorded ${value.taskSetSha256.slice(0, 12)}, actual ${actual.slice(0, 12)}. A pass rate against a set that moved is not a measurement.`);
  }
  return { schemaVersion: 1, frozenAt: value.frozenAt ?? "unknown", tasks: value.tasks, taskSetSha256: value.taskSetSha256 };
}

export interface TrialPlan {
  taskSetSha256: string;
  tasks: number;
  maxRepairs: number;
  /** Every task generates once, then may repair up to its own allowance. */
  worstCaseCalls: number;
  pricePerCallUsd: number;
  worstCaseUsd: number;
  maxCalls: number;
  maxUsd: number;
  stopConditions: string[];
}

/**
 * Refuses a budget that cannot cover the worst case. Finding out halfway through
 * that the ceiling is too low leaves a half-measured trial, which is worse than
 * not starting.
 */
export function planTrial(input: {
  taskSet: TaskSet;
  pricePerCallUsd: number;
  maxCalls: number;
  maxUsd: number;
}): TrialPlan {
  if (!(input.pricePerCallUsd >= 0) || !Number.isFinite(input.pricePerCallUsd)) throw new Error("A finite, non-negative price per call is required.");
  if (!Number.isInteger(input.maxCalls) || input.maxCalls < 1) throw new Error("A call ceiling of at least 1 is required.");
  if (!(input.maxUsd >= 0) || !Number.isFinite(input.maxUsd)) throw new Error("A finite, non-negative cost ceiling is required.");

  const worstCase = worstCaseCalls(input.taskSet);
  const worstCaseUsd = worstCase * input.pricePerCallUsd;
  const maxRepairs = Math.max(0, ...input.taskSet.tasks.map((task) => task.maxRepairs));

  if (worstCase > input.maxCalls) {
    throw new Error(`The call ceiling (${input.maxCalls}) cannot cover the worst case (${worstCase} calls for ${input.taskSet.tasks.length} tasks). Raise --max-calls or lower the repair allowance.`);
  }
  if (worstCaseUsd > input.maxUsd) {
    throw new Error(`The cost ceiling ($${input.maxUsd}) cannot cover the worst case ($${worstCaseUsd.toFixed(4)} for ${worstCase} calls at $${input.pricePerCallUsd}/call). Raise --max-usd or reduce the task set.`);
  }

  return {
    taskSetSha256: input.taskSet.taskSetSha256,
    tasks: input.taskSet.tasks.length,
    maxRepairs,
    worstCaseCalls: worstCase,
    pricePerCallUsd: input.pricePerCallUsd,
    worstCaseUsd,
    maxCalls: input.maxCalls,
    maxUsd: input.maxUsd,
    stopConditions: [
      `stops before call ${input.maxCalls + 1}`,
      `stops before spending $${input.maxUsd.toFixed(4)}`,
      "stops after 2 consecutive tasks that fail every attempt",
      "stops if the derived contract cannot be evaluated (no observations)",
    ],
  };
}

export interface TrialTaskResult {
  id: string;
  prompt: string;
  status: TrialStatus;
  attempts: number;
  calls: number;
  usd: number;
  contractSha256: string | null;
  evidence: Array<{ id: string; status: string }>;
  findings: string[];
  stoppedBecause: string;
  reason: string;
}

export interface TrialReport {
  schemaVersion: 1;
  mode: "plan" | "replay" | "paid";
  taskSetSha256: string;
  model: string | null;
  startedAt: string;
  durationMs: number;
  /** A trial has no user, so nothing in it can be confirmed. */
  contractProvenance: "derived";
  budget: { maxCalls: number; maxUsd: number; calls: number; usd: number; pricePerCallUsd: number };
  tasks: TrialTaskResult[];
  summary: { tasks: number; passed: number; failed: number; notRun: number; passRate: number | null; stoppedBecause: string };
}

export interface TrialDeps {
  /** The only step that may cost money. Returns the cost it actually incurred. */
  generate: (task: TrialTask, attempt: number, repairPrompt: string | null) => Promise<{ scad: string; calls: number; usd: number }>;
  /**
   * Renders, measures and judges one candidate against the task's derived
   * contract. Never costs money; may throw, which is recorded as ERROR.
   */
  judge: (task: TrialTask, scad: string) => Promise<{
    passed: boolean;
    contractSha256: string;
    evidence: Array<{ id: string; status: string }>;
    findings: string[];
  }>;
}

export class TrialRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrialRefused";
  }
}

/**
 * Runs the trial. `deps` is injected so the harness can be exercised with a fake
 * generator — the same code path, no money.
 */
export async function runTrial(input: {
  taskSet: TaskSet;
  plan: TrialPlan;
  mode: "replay" | "paid";
  model?: string | null;
  deps: TrialDeps;
  maxConsecutiveFailures?: number;
  now?: () => number;
}): Promise<TrialReport> {
  const now = input.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const started = now();
  const maxConsecutiveFailures = input.maxConsecutiveFailures ?? 2;

  let calls = 0;
  let usd = 0;
  let consecutiveFailures = 0;
  let stoppedBecause = "task-set-exhausted";
  const results: TrialTaskResult[] = [];

  const exhausted = (): string | null => {
    if (calls >= input.plan.maxCalls) return "call-ceiling";
    if (usd >= input.plan.maxUsd) return "cost-ceiling";
    return null;
  };

  for (const task of input.taskSet.tasks) {
    const stop = exhausted();
    if (stop) {
      stoppedBecause = stop;
      results.push({
        id: task.id, prompt: task.prompt, status: "NOT_RUN", attempts: 0, calls: 0, usd: 0,
        contractSha256: null, evidence: [], findings: [], stoppedBecause: stop,
        reason: `Not started: the run stopped at the ${stop === "call-ceiling" ? "call" : "cost"} ceiling.`,
      });
      continue;
    }

    let attempts = 0;
    let taskCalls = 0;
    let taskUsd = 0;
    let last: Awaited<ReturnType<TrialDeps["judge"]>> | null = null;
    let repairPrompt: string | null = null;
    let stopped = "attempts-exhausted";

    for (let attempt = 0; attempt <= task.maxRepairs; attempt++) {
      if (exhausted()) { stopped = "budget"; break; }
      let generated: Awaited<ReturnType<TrialDeps["generate"]>>;
      try {
        generated = await input.deps.generate(task, attempt, repairPrompt);
      } catch (error) {
        // A refusal is the harness declining to run this task, which is not the
        // same as a generator failure: one is NOT_RUN, the other is ERROR.
        if (error instanceof TrialRefused) {
          results.push({
            id: task.id, prompt: task.prompt, status: "NOT_RUN", attempts: 0, calls: 0, usd: 0,
            contractSha256: null, evidence: [], findings: [], stoppedBecause: "declined",
            reason: error.message,
          });
          break;
        }
        stopped = "generate-failed";
        last = null;
        attempts += 1;
        results.push({
          id: task.id, prompt: task.prompt, status: "ERROR", attempts, calls: taskCalls, usd: taskUsd,
          contractSha256: null, evidence: [], findings: [], stoppedBecause: stopped,
          reason: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        break;
      }
      calls += generated.calls;
      usd += generated.usd;
      taskCalls += generated.calls;
      taskUsd += generated.usd;
      attempts += 1;

      try {
        last = await input.deps.judge(task, generated.scad);
      } catch (error) {
        stopped = "judge-failed";
        last = null;
        results.push({
          id: task.id, prompt: task.prompt, status: "ERROR", attempts, calls: taskCalls, usd: taskUsd,
          contractSha256: null, evidence: [], findings: [], stoppedBecause: stopped,
          reason: `The candidate could not be measured: ${error instanceof Error ? error.message : String(error)}`,
        });
        break;
      }
      if (last.passed) { stopped = "passed"; break; }
      // The next attempt is a repair of this measured failure, not a fresh try.
      repairPrompt = last.findings.join("\n");
    }

    if (last && !results.some((result) => result.id === task.id && result.status === "ERROR")) {
      const passed = stopped === "passed";
      results.push({
        id: task.id, prompt: task.prompt, status: passed ? "PASS" : "FAIL",
        attempts, calls: taskCalls, usd: taskUsd,
        contractSha256: last.contractSha256, evidence: last.evidence, findings: last.findings,
        stoppedBecause: stopped,
        reason: passed
          ? `Passed the derived contract after ${attempts} generation(s).`
          : `Did not pass the derived contract after ${attempts} generation(s).`,
      });
    }

    const finished = results.find((result) => result.id === task.id);
    if (finished && (finished.status === "PASS" || finished.status === "FAIL")) {
      consecutiveFailures = finished.status === "FAIL" ? consecutiveFailures + 1 : 0;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        stoppedBecause = "consecutive-failures";
        break;
      }
    }
  }

  for (const task of input.taskSet.tasks) {
    if (!results.some((result) => result.id === task.id)) {
      results.push({
        id: task.id, prompt: task.prompt, status: "NOT_RUN", attempts: 0, calls: 0, usd: 0,
        contractSha256: null, evidence: [], findings: [], stoppedBecause,
        reason: `Not started: the run stopped earlier (${stoppedBecause}).`,
      });
    }
  }

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL" || result.status === "ERROR").length;
  const notRun = results.filter((result) => result.status === "NOT_RUN").length;

  return {
    schemaVersion: 1,
    mode: input.mode,
    taskSetSha256: input.taskSet.taskSetSha256,
    model: input.model ?? null,
    startedAt,
    durationMs: now() - started,
    contractProvenance: "derived",
    budget: { maxCalls: input.plan.maxCalls, maxUsd: input.plan.maxUsd, calls, usd, pricePerCallUsd: input.plan.pricePerCallUsd },
    tasks: results,
    summary: {
      tasks: results.length,
      passed,
      failed,
      notRun,
      // A rate computed over tasks that never ran would be a fiction.
      passRate: passed + failed === 0 ? null : passed / (passed + failed),
      stoppedBecause,
    },
  };
}

/** A plan is not a result: everything is NOT_RUN because nothing was attempted. */
export function planReport(plan: TrialPlan, model: string | null): TrialReport {
  return {
    schemaVersion: 1, mode: "plan", taskSetSha256: plan.taskSetSha256, model,
    startedAt: new Date().toISOString(), durationMs: 0, contractProvenance: "derived",
    budget: { maxCalls: plan.maxCalls, maxUsd: plan.maxUsd, calls: 0, usd: 0, pricePerCallUsd: plan.pricePerCallUsd },
    tasks: [], summary: { tasks: plan.tasks, passed: 0, failed: 0, notRun: plan.tasks, passRate: null, stoppedBecause: "not-started" },
  };
}

export function formatTrial(report: TrialReport, plan?: TrialPlan): string {
  const lines: string[] = [];
  lines.push(`Generation trial (${report.mode}) — task set ${report.taskSetSha256.slice(0, 12)}`);
  if (plan) {
    lines.push(`  tasks: ${plan.tasks}, worst case ${plan.worstCaseCalls} calls / $${plan.worstCaseUsd.toFixed(4)} at $${plan.pricePerCallUsd}/call`);
    for (const condition of plan.stopConditions) lines.push(`  stop: ${condition}`);
  }
  lines.push(`  contract provenance: ${report.contractProvenance} (no user confirmed anything in this run)`);
  lines.push(`  spent: ${report.budget.calls} calls / $${report.budget.usd.toFixed(4)} of $${report.budget.maxUsd.toFixed(4)} and ${report.budget.maxCalls} calls`);
  for (const task of report.tasks) {
    lines.push("");
    lines.push(`  [${task.status}] ${task.id} — ${task.attempts} generation(s), ${task.stoppedBecause}`);
    lines.push(`    ${task.reason}`);
    for (const item of task.evidence) lines.push(`    ${item.id}: ${item.status}`);
    for (const finding of task.findings) lines.push(`    ! ${finding}`);
  }
  lines.push("");
  lines.push(`  ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.notRun} not run (stopped: ${report.summary.stoppedBecause})`);
  const judged = report.summary.passed + report.summary.failed;
  lines.push(`  pass rate: ${report.summary.passRate === null ? "not measured" : `${(report.summary.passRate * 100).toFixed(0)}% of ${judged} judged`}${report.summary.notRun > 0 ? `; ${report.summary.notRun} task(s) were never judged` : ""}`);
  return lines.join("\n");
}

export interface TrialArgs {
  mode: "plan" | "replay" | "run";
  replayDir: string | null;
  price: number;
  maxCalls: number;
  maxUsd: number;
  model: string | null;
  taskSetPath: string;
}

/**
 * Parses the CLI. `--run` is refused unless the operator supplied both ceilings
 * and the environment opt-in, because the default must never spend money.
 */
export function parseTrialArgs(args: string[], env: Readonly<Record<string, string | undefined>> = process.env): TrialArgs {
  const flag = (name: string) => args.includes(name);
  const value = (name: string): string | null => {
    const inline = args.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? null : null;
  };
  const modes = ["--plan", "--replay", "--run"].filter(flag);
  if (modes.length > 1) throw new TrialRefused("Choose one of --plan, --replay or --run.");
  const mode = modes[0] === "--run" ? "run" : modes[0] === "--replay" ? "replay" : "plan";

  const price = Number(value("--price") ?? "0");
  if (!Number.isFinite(price) || price < 0) throw new TrialRefused("--price must be a non-negative number.");
  const maxCalls = Number(value("--max-calls") ?? "0");
  const maxUsd = Number(value("--max-usd") ?? "0");

  if (mode === "run") {
    if (env.AGENTSCAD_ALLOW_PAID !== "1") {
      throw new TrialRefused("--run makes paid model calls and AGENTSCAD_ALLOW_PAID is not set to 1. Use --plan or --replay to run without spending.");
    }
    if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new TrialRefused("--run requires --max-calls so the number of paid calls is bounded.");
    if (!(maxUsd > 0)) throw new TrialRefused("--run requires --max-usd so the spend is bounded.");
    if (!(price > 0)) throw new TrialRefused("--run requires --price per call, so the ceiling can be compared with the worst case.");
    if (!value("--model")) throw new TrialRefused("--run requires --model so the result is attributable to a specific model.");
  }

  return {
    mode,
    replayDir: mode === "replay" ? value("--replay") : null,
    price, maxCalls, maxUsd,
    model: value("--model"),
    taskSetPath: value("--tasks") ?? path.join("scripts", "eval", "assembly-generation", "tasks.json"),
  };
}

async function main(argv: string[]): Promise<number> {
  let options: TrialArgs;
  try {
    options = parseTrialArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const taskSet = loadTaskSet(JSON.parse(await fs.readFile(options.taskSetPath, "utf8")));

  if (options.mode === "plan") {
    // Without an explicit ceiling the plan is printed for the worst case, so the
    // operator sees the number to authorize instead of a refusal.
    const plan = planTrial({
      taskSet,
      pricePerCallUsd: options.price,
      maxCalls: options.maxCalls || worstCaseCalls(taskSet),
      maxUsd: options.maxUsd || worstCaseCalls(taskSet) * options.price,
    });
    const report = planReport(plan, options.model);
    console.log(formatTrial(report, plan));
    console.log("\nNo model was called and no evidence was produced. Use --replay with recorded sources, or --run with a budget.");
    return 0;
  }

  if (options.mode === "replay") {
    if (!options.replayDir) throw new TrialRefused("--replay needs a directory of recorded sources.");
    const report = await runTrial({
      taskSet,
      // Replay costs nothing, so the ceilings only have to be wide enough not to
      // truncate the run.
      plan: planTrial({ taskSet, pricePerCallUsd: 0, maxCalls: worstCaseCalls(taskSet), maxUsd: 1 }),
      mode: "replay",
      deps: {
        generate: async (task) => {
          // A replay is a recorded reply, so it costs nothing and never changes.
          const file = path.join(options.replayDir!, `${task.id}.json`);
          let recorded: { scad?: unknown };
          try {
            recorded = JSON.parse(await fs.readFile(file, "utf8"));
          } catch {
            throw new TrialRefused(`No recorded source at ${file}, so this task was not replayed.`);
          }
          if (typeof recorded.scad !== "string" || !recorded.scad.trim()) {
            throw new TrialRefused(`The recorded source for ${task.id} is empty.`);
          }
          return { scad: recorded.scad, calls: 0, usd: 0 };
        },
        judge: async (task, scad) => judgeAssemblyCandidate({ prompt: task.prompt, scad }),
      },
    });
    console.log(formatTrial(report));
    const reportPath = path.join(process.cwd(), "generation-trial-report.json");
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nJSON evidence report: ${reportPath}`);
    return 0;
  }

  throw new TrialRefused(
    "The paid generation adapter is not wired yet. The plan, the frozen task set and the budget gate are in place; wiring the adapter is the next step and requires a frozen model version and a price per call.",
  );
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
