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

  test("freezes and reloads a gear-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-gear-"));
    try {
      await cp("bench/gear/tasks/gear-12-24.json", path.join(root, "tasks", "gear-12-24.json"), { recursive: true });
      await cp("bench/gear/submissions/gear-12-24/reference.scad", path.join(root, "submissions", "gear-12-24", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-gear-test", maintainer: "local unit test", independent: false, family: "gear", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("gear");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("gear");
      expect(loaded.tasks[0].id).toBe("gear-12-24");
      expect(loaded.submissions.get("gear-12-24")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes an L4 set with its specs directory outside the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-l4-"));
    try {
      await cp("bench/l4/tasks/slider-shaft-keyed-7x9.json", path.join(root, "tasks", "slider-shaft-keyed-7x9.json"), { recursive: true });
      await cp("bench/l4/specs/slider-shaft-keyed.spec.json", path.join(root, "specs", "slider-shaft-keyed.spec.json"), { recursive: true });
      await cp("bench/l4/submissions/slider-shaft-keyed-7x9/reference.scad", path.join(root, "submissions", "slider-shaft-keyed-7x9", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-l4-test", maintainer: "local unit test", independent: false, family: "l4", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("l4");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("l4");
      expect(loaded.tasks[0].id).toBe("slider-shaft-keyed-7x9");
      const l4 = loaded.tasks[0] as { spec?: { parts?: unknown[] } };
      expect(l4.spec?.parts).toHaveLength(7);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a twin-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-twin-"));
    try {
      await cp("bench/twin/tasks/twin-inline-8-28.json", path.join(root, "tasks", "twin-inline-8-28.json"), { recursive: true });
      await cp("bench/twin/submissions/twin-inline-8-28/reference.scad", path.join(root, "submissions", "twin-inline-8-28", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-twin-test", maintainer: "local unit test", independent: false, family: "twin", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("twin");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("twin");
      expect(loaded.tasks[0].id).toBe("twin-inline-8-28");
      expect(loaded.submissions.get("twin-inline-8-28")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a vtwin-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-vtwin-"));
    try {
      await cp("bench/vtwin/tasks/v-twin-8-28.json", path.join(root, "tasks", "v-twin-8-28.json"), { recursive: true });
      await cp("bench/vtwin/submissions/v-twin-8-28/reference.scad", path.join(root, "submissions", "v-twin-8-28", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-vtwin-test", maintainer: "local unit test", independent: false, family: "vtwin", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("vtwin");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("vtwin");
      expect(loaded.tasks[0].id).toBe("v-twin-8-28");
      expect(loaded.submissions.get("v-twin-8-28")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a declaration-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-declaration-"));
    try {
      await cp("bench/declaration/tasks/guided-declaration-8-28.json", path.join(root, "tasks", "guided-declaration-8-28.json"), { recursive: true });
      await cp("bench/declaration/submissions/guided-declaration-8-28/reference.scad", path.join(root, "submissions", "guided-declaration-8-28", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-declaration-test", maintainer: "local unit test", independent: false, family: "declaration", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("declaration");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("declaration");
      expect(loaded.tasks[0].id).toBe("guided-declaration-8-28");
      expect(loaded.submissions.get("guided-declaration-8-28")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a V8-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-v8-"));
    try {
      await cp("bench/v8/tasks/v8-phase-8.json", path.join(root, "tasks", "v8-phase-8.json"), { recursive: true });
      await cp("bench/v8/submissions/v8-phase-8/reference.scad", path.join(root, "submissions", "v8-phase-8", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-v8-test", maintainer: "local unit test", independent: false, family: "v8", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("v8");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("v8");
      expect(loaded.tasks[0].id).toBe("v8-phase-8");
      expect(loaded.submissions.get("v8-phase-8")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a planetary-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-planetary-"));
    try {
      await cp("bench/planetary/tasks/planetary-12-12-36.json", path.join(root, "tasks", "planetary-12-12-36.json"), { recursive: true });
      await cp("bench/planetary/submissions/planetary-12-12-36/reference.scad", path.join(root, "submissions", "planetary-12-12-36", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-planetary-test", maintainer: "local unit test", independent: false, family: "planetary", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("planetary");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("planetary");
      expect(loaded.tasks[0].id).toBe("planetary-12-12-36");
      expect(loaded.submissions.get("planetary-12-12-36")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a planetary3-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-planetary3-"));
    try {
      await cp("bench/planetary3/tasks/planetary-3x-12-12-36.json", path.join(root, "tasks", "planetary-3x-12-12-36.json"), { recursive: true });
      await cp("bench/planetary3/submissions/planetary-3x-12-12-36/reference.scad", path.join(root, "submissions", "planetary-3x-12-12-36", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-planetary3-test", maintainer: "local unit test", independent: false, family: "planetary3", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("planetary3");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("planetary3");
      expect(loaded.tasks[0].id).toBe("planetary-3x-12-12-36");
      expect(loaded.submissions.get("planetary-3x-12-12-36")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a product-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-product-"));
    try {
      await cp("bench/product/tasks/guided-product-8-28.json", path.join(root, "tasks", "guided-product-8-28.json"), { recursive: true });
      await cp("bench/product/submissions/guided-product-8-28/reference.scad", path.join(root, "submissions", "guided-product-8-28", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-product-test", maintainer: "local unit test", independent: false, family: "product", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("product");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("product");
      expect(loaded.tasks[0].id).toBe("guided-product-8-28");
      expect(loaded.submissions.get("guided-product-8-28")?.[0].id).toBe("reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("freezes and reloads a thread-family hidden set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentscad-hidden-thread-"));
    try {
      await cp("bench/thread/tasks/threaded-fastener-1.5.json", path.join(root, "tasks", "threaded-fastener-1.5.json"), { recursive: true });
      await cp("bench/thread/submissions/threaded-fastener-1-5/reference.scad", path.join(root, "submissions", "threaded-fastener-1-5", "reference.scad"), { recursive: true });
      const manifest = await freezeHiddenSet({ directory: root, id: "hidden-thread-test", maintainer: "local unit test", independent: false, family: "thread", frozenAt: "2026-11-19T00:00:00Z" });
      expect(manifest.family).toBe("thread");
      const loaded = await loadHiddenSet(root);
      expect(loaded.manifest.family).toBe("thread");
      expect(loaded.tasks[0].id).toBe("threaded-fastener-1-5");
      expect(loaded.submissions.get("threaded-fastener-1-5")?.[0].id).toBe("reference");
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
