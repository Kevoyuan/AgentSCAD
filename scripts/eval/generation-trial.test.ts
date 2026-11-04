import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import {
  TrialRefused,
  formatTrial,
  loadTaskSet,
  parseTrialArgs,
  planReport,
  planTrial,
  runTrial,
  taskSetSha256,
  worstCaseCalls,
  type TaskSet,
  type TrialDeps,
  type TrialTask,
} from "./generation-trial";

const TASKS: TrialTask[] = [
  { id: "a", prompt: "hinge a", intentKind: "revolute-hinge", maxRepairs: 2, failureMode: "x" },
  { id: "b", prompt: "hinge b", intentKind: "revolute-hinge", maxRepairs: 1, failureMode: "y" },
];
const taskSet = (tasks: TrialTask[] = TASKS): TaskSet => ({
  schemaVersion: 1, frozenAt: "2026-10-29", tasks, taskSetSha256: taskSetSha256(tasks),
});

/** A generator that always produces a new source and charges one call per attempt. */
const generator = (options: { failUntil?: number; usd?: number } = {}): TrialDeps => {
  let attempt = 0;
  return {
    generate: async () => {
      attempt += 1;
      return { scad: `cube(${attempt});`, calls: 1, usd: options.usd ?? 0.01 };
    },
    judge: async (task, scad) => {
      const index = Number(scad.replace(/[^0-9]/g, ""));
      const passed = index >= (options.failUntil ?? 1);
      return {
        passed,
        contractSha256: "c".repeat(64),
        evidence: [{ id: "diametral-clearance", status: passed ? "PASS" : "FAIL" }],
        findings: passed ? [] : [`attempt ${index} measured outside the band`],
      };
    },
  };
};

describe("the frozen task set", () => {
  test("the recorded set loads and its hash matches its content", async () => {
    const raw = JSON.parse(await fs.readFile("scripts/eval/assembly-generation/tasks.json", "utf8"));
    const loaded = loadTaskSet(raw);
    expect(loaded.tasks.length).toBeGreaterThan(0);
    expect(loaded.taskSetSha256).toBe(taskSetSha256(loaded.tasks));
    expect(loaded.tasks.every((task) => task.prompt.trim().length > 0)).toBe(true);
  });

  test("editing a prompt without re-freezing is refused", () => {
    const tampered = { ...taskSet(), tasks: [{ ...TASKS[0], prompt: "hinge a, but easier" }, TASKS[1]] };
    expect(() => loadTaskSet(tampered)).toThrow(/changed without being re-frozen/);
  });

  test("a set with no recorded hash is not a frozen set", () => {
    expect(() => loadTaskSet({ schemaVersion: 1, tasks: TASKS })).toThrow(/no frozen hash/);
  });

  test("duplicate ids and impossible repair allowances are refused", () => {
    expect(() => loadTaskSet(taskSet([TASKS[0], { ...TASKS[1], id: "a" }]))).toThrow(/Duplicate task id/);
    expect(() => loadTaskSet(taskSet([{ ...TASKS[0], maxRepairs: 9 }]))).toThrow(/0 to 5 repairs/);
  });
});

describe("the budget gate", () => {
  test("worst case is one call per task plus its repair allowance", () => {
    expect(worstCaseCalls(taskSet())).toBe(5);
  });

  test("a call ceiling below the worst case is refused before anything runs", () => {
    expect(() => planTrial({ taskSet: taskSet(), pricePerCallUsd: 0.01, maxCalls: 4, maxUsd: 1 }))
      .toThrow(/cannot cover the worst case \(5 calls for 2 tasks\)/);
  });

  test("a cost ceiling below the worst case is refused and the numbers are shown", () => {
    expect(() => planTrial({ taskSet: taskSet(), pricePerCallUsd: 0.02, maxCalls: 10, maxUsd: 0.05 }))
      .toThrow(/\$0\.05\) cannot cover the worst case \(\$0\.1000 for 5 calls at \$0\.02\/call\)/);
  });

  test("a plan states what would stop the run", () => {
    const plan = planTrial({ taskSet: taskSet(), pricePerCallUsd: 0.02, maxCalls: 6, maxUsd: 1 });
    expect(plan.worstCaseCalls).toBe(5);
    expect(plan.worstCaseUsd).toBeCloseTo(0.1, 10);
    expect(plan.stopConditions.join(" ")).toContain("stops before call 7");
    expect(plan.stopConditions.join(" ")).toContain("2 consecutive tasks");
  });

  test("a plan claims no results", () => {
    const plan = planTrial({ taskSet: taskSet(), pricePerCallUsd: 0, maxCalls: 5, maxUsd: 1 });
    const report = planReport(plan, "test-model");
    expect(report.mode).toBe("plan");
    expect(report.summary.passed).toBe(0);
    expect(report.summary.notRun).toBe(2);
    expect(report.summary.passRate).toBeNull();
    expect(report.summary.stoppedBecause).toBe("not-started");
    expect(report.budget.calls).toBe(0);
    expect(formatTrial(report, plan)).toContain("pass rate: not measured");
  });
});

describe("running a trial", () => {
  const plan = () => planTrial({ taskSet: taskSet(), pricePerCallUsd: 0.01, maxCalls: 5, maxUsd: 1 });

  test("a task that passes on the first generation costs one call", async () => {
    const report = await runTrial({ taskSet: taskSet(), plan: plan(), mode: "replay", deps: generator() });
    expect(report.tasks.map((task) => task.status)).toEqual(["PASS", "PASS"]);
    expect(report.tasks[0].attempts).toBe(1);
    expect(report.budget.calls).toBe(2);
    expect(report.summary.passRate).toBe(1);
    // Nothing in a trial can be a confirmed contract.
    expect(report.contractProvenance).toBe("derived");
  });

  test("a failure is repaired and the second generation is the one that counts", async () => {
    const report = await runTrial({ taskSet: taskSet([TASKS[0]]), plan: plan(), mode: "replay", deps: generator({ failUntil: 2 }) });
    expect(report.tasks[0].status).toBe("PASS");
    expect(report.tasks[0].attempts).toBe(2);
    expect(report.tasks[0].stoppedBecause).toBe("passed");
  });

  test("a task that never passes is recorded as failed with what was measured", async () => {
    const report = await runTrial({ taskSet: taskSet([TASKS[0]]), plan: plan(), mode: "replay", deps: generator({ failUntil: 99 }) });
    expect(report.tasks[0].status).toBe("FAIL");
    expect(report.tasks[0].attempts).toBe(3); // one generation plus two repairs
    expect(report.tasks[0].stoppedBecause).toBe("attempts-exhausted");
    expect(report.tasks[0].findings[0]).toContain("measured outside the band");
    expect(report.summary.passRate).toBe(0);
  });

  test("the call ceiling stops the run and the remaining tasks are not run", async () => {
    const limited = planTrial({ taskSet: taskSet(), pricePerCallUsd: 0.01, maxCalls: 5, maxUsd: 1 });
    const report = await runTrial({
      taskSet: taskSet(), plan: { ...limited, maxCalls: 1 }, mode: "replay",
      deps: generator({ failUntil: 99 }),
    });
    // The first task used its single allowed call; nothing else could start.
    expect(report.summary.stoppedBecause).toBe("call-ceiling");
    expect(report.tasks[0].status).toBe("FAIL");
    expect(report.tasks.slice(1).every((task) => task.status === "NOT_RUN")).toBe(true);
    expect(report.tasks[1].reason).toContain("call ceiling");
  });

  test("the cost ceiling stops the run", async () => {
    const report = await runTrial({
      taskSet: taskSet(), plan: plan(), mode: "replay",
      deps: generator({ failUntil: 99, usd: 0.6 }),
    });
    expect(report.summary.stoppedBecause).toBe("cost-ceiling");
    expect(report.budget.usd).toBeGreaterThanOrEqual(0.6);
    expect(report.tasks.some((task) => task.status === "NOT_RUN")).toBe(true);
  });

  test("two consecutive failures stop the run instead of burning the budget", async () => {
    const report = await runTrial({
      taskSet: taskSet(), plan: plan(), mode: "replay",
      deps: generator({ failUntil: 99 }), maxConsecutiveFailures: 2,
    });
    expect(report.summary.stoppedBecause).toBe("consecutive-failures");
    expect(report.summary.failed).toBe(2);
  });

  test("a declined task is not run, while a generator that throws is an error", async () => {
    const declined = await runTrial({
      taskSet: taskSet(), plan: plan(), mode: "replay",
      deps: {
        generate: async () => { throw new TrialRefused("no recording"); },
        judge: async () => ({ passed: true, contractSha256: "c".repeat(64), evidence: [], findings: [] }),
      },
    });
    expect(declined.tasks[0].status).toBe("NOT_RUN");
    expect(declined.tasks[0].reason).toBe("no recording");

    const broken = await runTrial({
      taskSet: taskSet(), plan: plan(), mode: "replay",
      deps: {
        generate: async () => { throw new Error("model returned nothing"); },
        judge: async () => ({ passed: true, contractSha256: "c".repeat(64), evidence: [], findings: [] }),
      },
    });
    expect(broken.tasks[0].status).toBe("ERROR");
    expect(broken.tasks[0].reason).toContain("model returned nothing");
  });

  test("a candidate that cannot be measured is an error, not a pass", async () => {
    const report = await runTrial({
      taskSet: taskSet([TASKS[0]]), plan: plan(), mode: "replay",
      deps: {
        generate: async () => ({ scad: "cube(1);", calls: 1, usd: 0.01 }),
        judge: async () => { throw new Error("OpenSCAD failed"); },
      },
    });
    expect(report.tasks[0].status).toBe("ERROR");
    expect(report.tasks[0].reason).toContain("could not be measured");
    expect(report.summary.passRate).toBe(0);
  });
});

describe("the command line", () => {
  const authorized = { AGENTSCAD_ALLOW_PAID: "1" };

  test("plan is the default and spends nothing", () => {
    const args = parseTrialArgs([], {});
    expect(args.mode).toBe("plan");
    expect(args.maxCalls).toBe(0);
  });

  test("--run without the environment opt-in is refused", () => {
    expect(() => parseTrialArgs(["--run", "--model", "m", "--max-calls", "5", "--max-usd", "1", "--price", "0.01"], {}))
      .toThrow(/AGENTSCAD_ALLOW_PAID/);
  });

  test("--run without a call ceiling, a cost ceiling, a price or a model is refused", () => {
    expect(() => parseTrialArgs(["--run", "--model", "m", "--max-usd", "1", "--price", "0.01"], authorized))
      .toThrow(/--max-calls/);
    expect(() => parseTrialArgs(["--run", "--model", "m", "--max-calls", "5", "--price", "0.01"], authorized))
      .toThrow(/--max-usd/);
    expect(() => parseTrialArgs(["--run", "--model", "m", "--max-calls", "5", "--max-usd", "1"], authorized))
      .toThrow(/--price/);
    expect(() => parseTrialArgs(["--run", "--max-calls", "5", "--max-usd", "1", "--price", "0.01"], authorized))
      .toThrow(/--model/);
  });

  test("an authorized run parses into bounded numbers", () => {
    const args = parseTrialArgs(["--run", "--model", "m", "--max-calls=5", "--max-usd=0.05", "--price=0.01"], authorized);
    expect(args).toMatchObject({ mode: "run", maxCalls: 5, maxUsd: 0.05, price: 0.01, model: "m" });
  });

  test("two modes at once is a mistake worth naming", () => {
    expect(() => parseTrialArgs(["--plan", "--replay", "dir"], {})).toThrow(/Choose one of/);
  });
});
