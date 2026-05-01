import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

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

  mock.module("@/lib/harness/skill-runner", () => ({
    detectPartFamily: mock(() => "electronics_enclosure"),
    getParameterSchema: mock(async () => []),
    generateMockScadCode: mock(async () => ({
      part_type: "electronics_enclosure",
      summary: "Generated test enclosure (mock)",
      units: "mm",
      features: [],
      constraints: {
        dimensions: {},
        assumptions: [],
        manufacturing: { min_wall_thickness: 2, printable: true },
        geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
        code: { use_parameters: true, use_library_modules: true, avoid_magic_numbers: true, top_level_module: "generated_part" },
      },
      modeling_plan: [],
      design_rationale: [],
      validation_targets: {
        expected_bbox: [],
        required_feature_checks: [],
        forbidden_failure_modes: [],
      },
      parameters: [
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
      ],
      scad_source: "wall_thickness = 2; cube([10, 10, 10]);",
    })),
    runScadGenerationSkill: mock(async () => ({
      part_type: "electronics_enclosure",
      summary: "Generated test enclosure",
      units: "mm",
      features: [
        { name: "enclosure body", type: "enclosure", required: true, parameters: {}, description: "Test" },
      ],
      constraints: {
        dimensions: {},
        assumptions: [],
        manufacturing: { min_wall_thickness: 2, printable: true },
        geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
        code: { use_parameters: true, use_library_modules: true, avoid_magic_numbers: true, top_level_module: "generated_part" },
      },
      modeling_plan: [],
      design_rationale: [],
      validation_targets: {
        expected_bbox: [],
        required_feature_checks: [],
        forbidden_failure_modes: [],
      },
      parameters: [
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
      ],
      scad_source: "wall_thickness = 2; cube([10, 10, 10]);",
    })),
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
                ? value
                  ? "true"
                  : "false"
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
    renderScadArtifacts: mock(async () => {
      throw new Error("openscad failed");
    }),
  }));

  mock.module("@/lib/tools/validation-tool", () => ({
    clearValidationCache: mock(() => undefined),
    getCriticalValidationFailures: mock(() => []),
    validateRenderedArtifacts: mock(async () => []),
  }));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  updates.length = 0;
  currentJob = {
    id: "job-pipeline",
    inputRequest: "electronics enclosure",
    parameterValues: JSON.stringify({ wall_thickness: 2 }),
    executionLogs: null,
    modelId: "test-model",
  };
});

describe("executeCadJob", () => {
  test("marks the job as GEOMETRY_FAILED and emits render_failed when OpenSCAD rendering fails", async () => {
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(updates.map((update) => update.data.state)).toContain("SCAD_GENERATED");
    expect(updates.at(-1)?.data.state).toBe("GEOMETRY_FAILED");
    expect(JSON.parse(updates.at(-1)?.data.renderLog as string).warnings[0]).toContain("openscad failed");
    expect(events.at(-1)).toMatchObject({
      state: "GEOMETRY_FAILED",
      step: "render_failed",
    });
  });
});
