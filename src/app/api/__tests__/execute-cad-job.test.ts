import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ModelRequestError } from "@/lib/model-runtime";

const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
let currentJob: Record<string, unknown>;
let generationCalls = 0;
let templateCalls = 0;
let renderCalls = 0;
let intakeCalls = 0;
let modelIntakeResult: Record<string, unknown>;
let modelIntakeError: Error | null = null;
const generationRequests: string[] = [];
const generationFamilies: string[] = [];
let generationError: Error | null = null;

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
    detectPartFamily: mock((request: string) =>
      request.toLowerCase().includes("electronics enclosure")
        ? "electronics_enclosure"
        : "unknown"),
    getParameterSchema: mock(async () => []),
    generateMockScadCode: mock(async () => {
      templateCalls += 1;
      return ({
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
      });
    }),
    runScadGenerationSkill: mock(async (
      request: string,
      _parameters: Record<string, unknown>,
      _model?: string | null,
      familyOverride?: string,
    ) => {
      generationCalls += 1;
      generationRequests.push(request);
      generationFamilies.push(familyOverride || "unset");
      if (generationError) throw generationError;
      return {
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
      };
    }),
  }));

  mock.module("@/lib/intake/model-intake", () => ({
    runModelCadIntake: mock(async () => {
      intakeCalls += 1;
      if (modelIntakeError) throw modelIntakeError;
      return modelIntakeResult;
    }),
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
      renderCalls += 1;
      throw new Error("openscad failed");
    }),
  }));

  mock.module("@/lib/tools/validation-tool", () => ({
    buildValidationReport: (results: Array<{ passed: boolean; is_critical: boolean; message: string }>) => ({
      ok: results.every((result) => result.passed),
      score: results.length ? results.filter((result) => result.passed).length / results.length : 0,
      checks: results,
      summary: {
        total: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
        skipped: results.filter((result) => result.message.toLowerCase().startsWith("skipped")).length,
        critical_failures: results.filter((result) => !result.passed && result.is_critical).length,
      },
    }),
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
  generationCalls = 0;
  templateCalls = 0;
  renderCalls = 0;
  intakeCalls = 0;
  modelIntakeError = null;
  generationRequests.length = 0;
  generationFamilies.length = 0;
  generationError = null;
  modelIntakeResult = {
    version: 1,
    rawRequest: "electronics enclosure",
    normalizedRequest: "electronics enclosure",
    language: "en",
    status: "MATCHED",
    concepts: [{ id: "enclosure", label: "electronics enclosure", evidence: ["electronics enclosure"], source: "llm" }],
    interpretations: [{
      id: "electronics_enclosure",
      label: "electronics enclosure",
      domain: "product",
      objectKind: "enclosure",
      probability: 1,
      score: 100,
      evidence: ["electronics enclosure"],
      conflicts: [],
    }],
    clarificationQuestion: null,
    requiresClarification: false,
    confidence: 0.9,
    assumptions: [],
    suggestedMode: "unknown",
    matchedGroupId: null,
    brief: {
      summary: "electronics enclosure",
      intendedUse: "unknown",
      requiredFeatures: [],
      explicitConstraints: [],
      acceptanceCriteria: [],
    },
  };
  currentJob = {
    id: "job-pipeline",
    inputRequest: "electronics enclosure",
    parameterValues: JSON.stringify({ wall_thickness: 2 }),
    executionLogs: null,
    modelId: "test-model",
    stlPath: "/artifacts/job-pipeline/old.stl",
    pngPath: "/artifacts/job-pipeline/old.png",
    renderLog: "{\"openscad_version\":\"old\"}",
  };
});

describe("executeCadJob", () => {
  test("demo delays default to zero and are bounded when explicitly enabled", async () => {
    const { getDemoDelayMs, isTemplateFallbackEnabled } = await import("@/lib/pipeline/execute-cad-job");
    expect(getDemoDelayMs({})).toBe(0);
    expect(getDemoDelayMs({ AGENTSCAD_DEMO_DELAY_MS: "250" })).toBe(250);
    expect(getDemoDelayMs({ AGENTSCAD_DEMO_DELAY_MS: "99999" })).toBe(5_000);
    expect(getDemoDelayMs({ AGENTSCAD_DEMO_DELAY_MS: "not-a-number" })).toBe(0);
    expect(isTemplateFallbackEnabled({})).toBe(false);
    expect(isTemplateFallbackEnabled({ AGENTSCAD_TEMPLATE_FALLBACK: "true" })).toBe(true);
  });

  test("marks the job as GEOMETRY_FAILED and emits render_failed when OpenSCAD rendering fails", async () => {
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(updates.map((update) => update.data.state)).toContain("SCAD_GENERATED");
    expect(intakeCalls).toBe(1);
    expect(updates.at(-1)?.data.state).toBe("GEOMETRY_FAILED");
    expect(updates.at(-1)?.data.stlPath).toBeNull();
    expect(updates.at(-1)?.data.pngPath).toBeNull();
    expect(JSON.parse(updates.at(-1)?.data.renderLog as string).warnings[0]).toContain("openscad failed");
    expect(events.at(-1)).toMatchObject({
      state: "GEOMETRY_FAILED",
      step: "render_failed",
    });
  });

  test("pauses ambiguous requests before any LLM generation or OpenSCAD render", async () => {
    currentJob = {
      ...currentJob,
      inputRequest: "行星发动机模型",
    };
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(generationCalls).toBe(0);
    expect(renderCalls).toBe(0);
    expect(intakeCalls).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data).toMatchObject({
      state: "HUMAN_REVIEW",
      generationPath: "intent_clarification",
      scadSource: null,
      stlPath: null,
      pngPath: null,
      validationResults: null,
      completedAt: null,
    });
    expect(JSON.parse(updates[0]?.data.intentResult as string)).toMatchObject({
      status: "AMBIGUOUS",
      requiresClarification: true,
      assumptions: [],
    });
    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_REVIEW",
      step: "intent_clarification_required",
      reviewReason: "intent_ambiguous",
      message: "你指的是行星推进用的科幻巨型发动机，还是行星齿轮电机/减速机构？",
    });
  });

  test("continues only after a valid interpretation approval is persisted", async () => {
    const { approveCadRequestInterpretation } = await import("@/lib/intake/request-approval");
    currentJob = {
      ...currentJob,
      inputRequest: "行星发动机模型",
      intentResult: JSON.stringify(approveCadRequestInterpretation(
        "行星发动机模型",
        "planetary_gear_motor",
      )),
    };
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(generationCalls).toBe(1);
    expect(renderCalls).toBe(1);
    expect(intakeCalls).toBe(0);
    expect(generationFamilies).toEqual(["unknown"]);
    expect(updates.map((update) => update.data.state)).toContain("SCAD_GENERATED");
    expect(updates.find((update) => update.data.state === "SCAD_GENERATED")?.data).toMatchObject({
      generationPath: "llm_freeform_parametric",
      builderName: "AgentSCAD-LLM-freeform",
      partFamily: "unknown",
    });
    expect(events.some((event) => event.step === "intent_clarification_required")).toBe(false);
    const generatedIntent = JSON.parse(
      updates.find((update) => update.data.state === "SCAD_GENERATED")?.data.cadIntentJson as string,
    );
    expect(generatedIntent.request_intelligence.approval).toMatchObject({
      source: "user",
      selectedInterpretationId: "planetary_gear_motor",
    });
    const persistedApproval = JSON.parse(
      updates.find((update) => update.data.state === "SCAD_GENERATED")?.data.intentResult as string,
    );
    expect(persistedApproval).toMatchObject({
      status: "MATCHED",
      approval: {
        source: "user",
        selectedInterpretationId: "planetary_gear_motor",
      },
    });
  });

  test("persists a model-derived ambiguity and stops before generation", async () => {
    currentJob = { ...currentJob, inputRequest: "做一个火星基地接口" };
    modelIntakeResult = {
      ...modelIntakeResult,
      rawRequest: currentJob.inputRequest,
      normalizedRequest: currentJob.inputRequest,
      status: "AMBIGUOUS",
      interpretations: [
        { id: "display_model", label: "科幻展示模型", domain: "concept", objectKind: "diorama", probability: 0.5, score: 50, evidence: ["火星基地"], conflicts: [] },
        { id: "mechanical_interface", label: "机械连接接口", domain: "mechanical", objectKind: "adapter", probability: 0.5, score: 50, evidence: ["接口"], conflicts: [] },
      ],
      clarificationQuestion: "你要科幻展示模型，还是带尺寸约束的机械连接接口？",
      requiresClarification: true,
    };
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(intakeCalls).toBe(1);
    expect(generationCalls).toBe(0);
    expect(renderCalls).toBe(0);
    expect(updates.at(-1)?.data.state).toBe("HUMAN_REVIEW");
    expect(events.at(-1)).toMatchObject({
      step: "intent_clarification_required",
      message: "你要科幻展示模型，还是带尺寸约束的机械连接接口？",
    });
  });

  test("does not replace an approved unsupported assembly with an unrelated template", async () => {
    const { approveCadRequestInterpretation } = await import("@/lib/intake/request-approval");
    currentJob = {
      ...currentJob,
      inputRequest: "行星发动机模型",
      intentResult: JSON.stringify(approveCadRequestInterpretation(
        "行星发动机模型",
        "planetary_gear_motor",
      )),
    };
    generationError = new Error("provider unavailable");
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(generationFamilies).toEqual(["unknown"]);
    expect(renderCalls).toBe(0);
    expect(updates.at(-1)?.data.state).toBe("GEOMETRY_FAILED");
    expect(events.some((event) => event.step === "generating_mock")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      errorCode: "CAD_GENERATION_FAILED",
      failureStage: "generate",
      retryable: true,
    });
    expect(templateCalls).toBe(0);
  });

  test("does not silently replace a known family with a template in the normal product path", async () => {
    generationError = new Error("provider unavailable");
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(generationFamilies).toEqual(["electronics_enclosure"]);
    expect(templateCalls).toBe(0);
    expect(renderCalls).toBe(0);
    expect(events.some((event) => event.step === "generating_mock")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      state: "GEOMETRY_FAILED",
      errorCode: "CAD_GENERATION_FAILED",
      retryable: true,
    });
  });

  test("keeps the legacy template generator behind an explicit demo-only switch", async () => {
    const previous = process.env.AGENTSCAD_TEMPLATE_FALLBACK;
    process.env.AGENTSCAD_TEMPLATE_FALLBACK = "true";
    generationError = new Error("provider unavailable");
    spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
      const events: Record<string, unknown>[] = [];

      await executeCadJob("job-pipeline", (event) => events.push(event));

      expect(templateCalls).toBe(1);
      expect(events.some((event) => event.step === "generating_mock")).toBe(true);
      expect(updates.find((update) => update.data.state === "SCAD_GENERATED")?.data).toMatchObject({
        generationPath: "template_demo_fallback",
        builderName: "AgentSCAD-DemoTemplate-electronics_enclosure",
      });
    } finally {
      if (previous === undefined) delete process.env.AGENTSCAD_TEMPLATE_FALLBACK;
      else process.env.AGENTSCAD_TEMPLATE_FALLBACK = previous;
    }
  });

  test("surfaces model timeouts as retryable LLM errors instead of template failures", async () => {
    generationError = new ModelRequestError(
      "LLM_TIMEOUT",
      "Model generation timed out after 90 seconds. Retry or choose a faster model.",
      true,
    );
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(templateCalls).toBe(0);
    expect(renderCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      state: "GEOMETRY_FAILED",
      errorCode: "LLM_TIMEOUT",
      failureStage: "generate",
      retryable: true,
      message: "Processing failed: Model generation timed out after 90 seconds. Retry or choose a faster model.",
    });
    expect(updates.at(-1)?.data.executionLogs).toContain("LLM_TIMEOUT");
    expect(updates.at(-1)?.data.executionLogs).not.toContain("no safe template");
  });

  test("reuses a persisted model-derived match without another intake call", async () => {
    currentJob = {
      ...currentJob,
      intentResult: JSON.stringify(modelIntakeResult),
    };
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");

    await executeCadJob("job-pipeline", () => undefined);

    expect(intakeCalls).toBe(0);
    expect(generationCalls).toBe(1);
    expect(renderCalls).toBe(1);
  });

  test("degrades UNKNOWN model intake to the original request and still attempts rendering", async () => {
    modelIntakeResult = {
      ...modelIntakeResult,
      status: "UNKNOWN",
      interpretations: [],
      concepts: [],
      confidence: 0,
    };
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(events.some((event) => event.step === "intent_analysis_degraded")).toBe(true);
    expect(generationRequests[0]).toBe(currentJob.inputRequest as string);
    expect(renderCalls).toBe(1);
    expect(updates.some((update) => update.data.generationPath === "intent_clarification")).toBe(false);
  });

  test("degrades failed model intake to the original request and still attempts rendering", async () => {
    modelIntakeError = new Error("provider unavailable");
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(events.some((event) => event.step === "intent_analysis_degraded")).toBe(true);
    expect(generationRequests[0]).toBe(currentJob.inputRequest as string);
    expect(renderCalls).toBe(1);
    expect(updates.some((update) => update.data.generationPath === "intent_clarification")).toBe(false);
  });
});
