import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freezeHiddenSet } from "./hidden-freeze";
import { hiddenTaskSetSha256, loadHiddenSet, validateHiddenManifest } from "./hidden";
import { loadTasks } from "./bench";

describe("hidden-set freezer", () => {
  test("freezes a valid external set and refuses an accidental re-freeze", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-freeze-"));
    try {
      await cp("bench/assembly/tasks/hinge-45-loose.json", path.join(root, "tasks", "hinge-45-loose.json"), { recursive: true }).catch(async () => {
        // cp of a single file with recursive may fail on some platforms; fall back.
        await cp("bench/assembly/tasks", path.join(root, "tasks"), { recursive: true });
      });
      await cp("bench/assembly/submissions/hinge-45-loose", path.join(root, "submissions", "hinge-45-loose"), { recursive: true });
      const tasks = await loadTasks(path.join(root, "tasks"));
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-freeze-test", maintainer: "local unit test", independent: false, frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.taskSetSha256).toBe(hiddenTaskSetSha256(tasks));
      expect(validateHiddenManifest(JSON.parse(await readFile(path.join(root, "hidden.json"), "utf8"))).id).toBe("hidden-freeze-test");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.id).toBe("hidden-freeze-test");
      await expect(freezeHiddenSet({ directory: root, id: "second", maintainer: "local unit test", independent: false })).rejects.toThrow(/already exists/);
      const forced = await freezeHiddenSet({ directory: root, id: "second", maintainer: "local unit test", independent: false, force: true });
      expect(forced.id).toBe("second");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses a set without submissions and a repo-internal directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-freeze-empty-"));
    try {
      await cp("bench/assembly/tasks/hinge-45-loose.json", path.join(root, "tasks", "hinge-45-loose.json"), { recursive: true });
      await expect(freezeHiddenSet({ directory: root, id: "no-subs", maintainer: "local unit test", independent: false })).rejects.toThrow(/no submissions/);
      await expect(freezeHiddenSet({ directory: path.join(process.cwd(), "bench", "assembly"), id: "inside", maintainer: "local unit test", independent: false })).rejects.toThrow(/outside the repository/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
