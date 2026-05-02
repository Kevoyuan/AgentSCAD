import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
let currentJob: Record<string, unknown>;

beforeAll(() => {
  mock.module("@/lib/db", () => ({
    db: {
      job: {
        findUnique: mock(async () => currentJob),
        update: mock(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push(args);
          currentJob = { ...currentJob, ...args.data };
          return currentJob;
        }),
      },
    },
  }));

  mock.module("@/lib/version-tracker", () => ({
    trackVersion: mock(async () => undefined),
  }));

  mock.module("@/lib/tools/scad-renderer", () => ({
    buildOpenScadDefineArgs: (definitions?: Record<string, unknown>) =>
      Object.entries(definitions ?? {})
        .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        .map(([key, value]) => {
          const formatted =
            typeof value === "number" && Number.isFinite(value)
              ? String(value)
              : typeof value === "boolean"
                ? value ? "true" : "false"
                : typeof value === "string"
                  ? JSON.stringify(value)
                  : null;
          return formatted ? `-D "${`${key}=${formatted}`.replace(/(["\\$`])/g, "\\$1")}"` : null;
        })
        .filter(Boolean)
        .join(" "),
    buildRenderFailureLog: (_renderTime = 0, warnings: string[] = []) => ({
      openscad_version: "error",
      render_time_ms: 0,
      stl_triangles: 0,
      stl_vertices: 0,
      png_resolution: null,
      warnings,
    }),
    renderScadArtifacts: mock(async (jobId: string) => ({
      artifactsDir: `/tmp/${jobId}`,
      scadFilePath: `/tmp/${jobId}/model.scad`,
      stlFilePath: `/tmp/${jobId}/model.stl`,
      pngFilePath: `/tmp/${jobId}/preview.png`,
      stlPath: `/artifacts/${jobId}/model.stl`,
      pngPath: `/artifacts/${jobId}/preview.png`,
      renderLog: {
        openscad_version: "test",
        render_time_ms: 12,
        stl_triangles: 0,
        stl_vertices: 0,
        png_resolution: "800x600",
        warnings: [],
      },
    })),
  }));

  mock.module("@/lib/tools/validation-tool", () => ({
    clearValidationCache: mock(() => undefined),
    getCriticalValidationFailures: mock(() => []),
    validateRenderedArtifacts: mock(async () => [
      {
        rule_id: "R001",
        rule_name: "Wall Thickness",
        level: "ENGINEERING",
        passed: true,
        is_critical: true,
        message: "ok",
      },
    ]),
  }));
});

afterAll(() => {
  mock.restore();
});

async function readSseEvents(response: Response) {
  const body = await response.text();
  return body
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
}

beforeEach(() => {
  updates.length = 0;
  currentJob = {
    id: "job-apply",
    inputRequest: "phone case",
    partFamily: "phone_case",
    scadSource: "old_width = 1;",
    parameterSchema: JSON.stringify([
      {
        key: "wall_thickness",
        label: "Wall Thickness",
        kind: "float",
        unit: "mm",
        value: 2,
        min: 1,
        max: 6,
        step: 0.1,
        source: "user",
        editable: true,
        description: "Wall",
        group: "Dimensions",
      },
    ]),
    parameterValues: JSON.stringify({ wall_thickness: 2 }),
    executionLogs: null,
  };
});

describe("manual SCAD apply route", () => {
  test("streams render and validation states and delivers applied SCAD", async () => {
    const { POST } = await import("@/app/api/jobs/[id]/scad/apply/route");
    const request = new Request("http://localhost/api/jobs/job-apply/scad/apply", {
      method: "POST",
      body: JSON.stringify({
        scadSource: "wall_thickness = 3;\nmodule part() { cube([1,1,1]); }\npart();",
      }),
    });

    const response = await POST(request as never, { params: Promise.resolve({ id: "job-apply" }) });
    const events = await readSseEvents(response);

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(events.map((event) => event.step)).toContain("scad_applied");
    expect(events.map((event) => event.step)).toContain("rendered");
    expect(events.map((event) => event.step)).toContain("validated");
    expect(events.at(-1)).toMatchObject({ state: "DELIVERED", step: "delivered" });
    expect(updates.map((update) => update.data.state)).toEqual([
      "SCAD_GENERATED",
      "RENDERED",
      "VALIDATED",
      "DELIVERED",
    ]);
  });
});
