import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test } from "bun:test";

describe("mesh validator serverless storage", () => {
  test("does not install a managed virtualenv under HOME on Vercel", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscad-mesh-serverless-test-")
    );
    const sentinelHome = path.join(root, "home-must-not-be-created");

    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          [
            'delete process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON;',
            'const mod = await import("./src/lib/mesh-validator.ts");',
            "console.log(JSON.stringify(await mod.getMeshValidatorStatus()));",
          ].join(" "),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            VERCEL: "1",
            HOME: sentinelHome,
          },
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(stdout.trim())).toMatchObject({
        available: false,
        pythonPath: null,
        managed: false,
      });
      await expect(fs.stat(sentinelHome)).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
