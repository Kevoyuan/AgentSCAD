import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  aggregateHiddenReport,
  assertExternalHiddenDirectory,
  defaultHiddenReportPath,
  hiddenTaskSetSha256,
  loadHiddenSet,
  validateHiddenManifest,
} from "./hidden";
import { loadTasks } from "./bench";

const manifest = {
  schemaVersion: 1,
  id: "hidden-dev",
  frozenAt: "2026-11-19T00:00:00Z",
  independent: false,
  maintainer: "local harness test",
  taskSetSha256: "a".repeat(64),
};

describe("hidden-set harness", () => {
  test("validates the manifest and refuses repo-internal paths", () => {
    expect(validateHiddenManifest(manifest).id).toBe("hidden-dev");
    expect(() => validateHiddenManifest({ ...manifest, independent: "yes" })).toThrow(/independent/);
    expect(() => validateHiddenManifest({ ...manifest, maintainer: "x" })).toThrow(/maintainer/);
    expect(() => assertExternalHiddenDirectory(path.join(process.cwd(), "bench"))).toThrow(/outside the repository/);
    expect(() => assertExternalHiddenDirectory(os.tmpdir())).not.toThrow();
    expect(path.isAbsolute(defaultHiddenReportPath())).toBe(true);
  });

  test("hashes the validated task set stably and detects a prompt change", async () => {
    const tasks = await loadTasks("bench/assembly/tasks");
    const first = hiddenTaskSetSha256(tasks);
    expect(hiddenTaskSetSha256([...tasks].reverse())).toBe(first);
    const tampered = tasks.map((task) => task.id === "hinge-45-loose" ? { ...task, prompt: `${task.prompt} (changed)` } : task);
    expect(hiddenTaskSetSha256(tampered)).not.toBe(first);
  });

  test("loads an external set only when its frozen hash matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-test-"));
    try {
      await cp("bench/assembly/tasks", path.join(root, "tasks"), { recursive: true });
      await cp("bench/assembly/submissions", path.join(root, "submissions"), { recursive: true });
      const tasks = await loadTasks(path.join(root, "tasks"));
      const frozen = { ...manifest, taskSetSha256: hiddenTaskSetSha256(tasks) };
      await writeFile(path.join(root, "hidden.json"), JSON.stringify(frozen));
      const loaded = await loadHiddenSet(root);
      expect(loaded.tasks.length).toBe(tasks.length);
      expect(loaded.submissions.get("hinge-45-loose")?.some((submission) => submission.id === "reference")).toBe(true);

      // Changing the task after freezing must fail the hash check.
      const taskPath = path.join(root, "tasks", "hinge-45-loose.json");
      const changed = JSON.parse(await readFile(taskPath, "utf8"));
      changed.prompt = `${changed.prompt} changed`;
      await writeFile(taskPath, JSON.stringify(changed));
      await expect(loadHiddenSet(root)).rejects.toThrow(/changed without re-freezing/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("aggregates without copying prompts, sources or per-case measurements", async () => {
    const report = aggregateHiddenReport(validateHiddenManifest({ ...manifest, independent: true }), []);
    expect(report.schemaVersion).toBe("assembly-bench.hidden.v1");
    expect(report.independent).toBe(true);
    expect(report.independentHiddenEvaluation).toBe("DECLARED_NOT_VERIFIED");
    expect(report.summary.cases).toBe(0);
    expect(JSON.stringify(report)).not.toContain("prompt");
    expect(JSON.stringify(report)).not.toContain("sourcePath");
  });
});
