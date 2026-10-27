import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ModelRequestError } from "@/lib/model-runtime";
import { GeneratedScadCompileError } from "@/lib/harness/generation-errors";

import type { StructuredGenerationResult } from "@/lib/harness/types";
import { OpenScadTimeoutError } from "@/lib/tools/scad-timeout";

import { spawnSync } from "node:child_process";

// Bun module replacements survive mock.restore(). Keep all pipeline mocks in
// a child runner so other suites always import the real modules, in any order.
if (process.env.AGENTSCAD_PIPELINE_TEST_CHILD === "1") {
  registerPipelineTests();
} else {
  test("executeCadJob regression suite runs with isolated module mocks", () => {
    const result = spawnSync(process.execPath, ["test", "--timeout", "10000", import.meta.path], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        AGENTSCAD_PIPELINE_TEST_CHILD: "1",
        AGENTSCAD_WEB_RESEARCH: "off",
      },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 30_000);
}

function registerPipelineTests() {
const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
const isRunMetricsWrite = (data: Record<string, unknown>) =>
  Object.keys(data).length > 0 &&
  Object.keys(data).every((key) => key === "latencyMs" || key === "llmCallCount");
// The pipeline flushes run metrics (latencyMs / llmCallCount) from a `finally`
// block, so every run produces one trailing write that carries no state.
// State-transition assertions have to look past it.
const stateUpdates = () => updates.filter((update) => !isRunMetricsWrite(update.data));
let currentJob: Record<string, unknown>;
let generationCalls = 0;
let templateCalls = 0;
let renderCalls = 0;
let renderError: Error | null = null;
let intakeCalls = 0;
let modelIntakeResult: Record<string, unknown>;
let modelIntakeError: Error | null = null;
const generationRequests: string[] = [];
const generationFamilies: string[] = [];
const generationPlans: Array<Record<string, unknown> | undefined> = [];
let generationError: Error | null = null;
let repairError: Error | null = null;
let repairCalls = 0;
let repairStrategy: string | undefined;
let repairedScad = "cube([12, 12, 12]);";
let repairUsesParameters = false;
let repairValidationResults: Array<{ message: string }> = [];
let cancelDuringRepair = false;
let compileValidationError: Error | null = null;
let renderedArtifactsResult: Record<string, unknown> | null = null;
let renderedValidationQueue: Array<Array<Record<string, unknown>>> = [];
let motionContractResult: Record<string, unknown> | null = null;

function generatedResult(scadSource: string) {
  return {
    part_type: "unknown",
    summary: "Generated test part",
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
    parameters: [],
    scad_source: scadSource,
  };
}

function renderableArtifacts(): Record<string, unknown> {
  return {
    artifactsDir: "/tmp/agentscad-test-artifacts",
    scadFilePath: "/tmp/agentscad-test-artifacts/model.scad",
    stlFilePath: "/tmp/agentscad-test-artifacts/model.stl",
    pngFilePath: "/tmp/agentscad-test-artifacts/preview.png",
    stlPath: "/artifacts/job-pipeline/model.stl",
    pngPath: "/artifacts/job-pipeline/preview.png",
    renderLog: {
      openscad_version: "real",
      render_time_ms: 5,
      stl_triangles: 12,
      stl_vertices: 0,
      png_resolution: "800x600",
      warnings: [],
    },
  };
}

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
        updateMany: mock(async (args: { where: { id: string; state?: string; repairHistory?: unknown }; data: Record<string, unknown> }) => {
          if (args.where.state && currentJob.state !== args.where.state) return { count: 0 };
          if (args.where.repairHistory !== undefined && currentJob.repairHistory !== args.where.repairHistory) return { count: 0 };
          updates.push({ where: { id: args.where.id }, data: args.data });
          currentJob = { ...currentJob, ...args.data };
          return { count: 1 };
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
      generationPlan?: Record<string, unknown>,
      _signal?: AbortSignal,
      _research?: string,
      onSourceReady?: (result: StructuredGenerationResult) => Promise<void>,
    ) => {
      generationCalls += 1;
      generationRequests.push(request);
      generationFamilies.push(familyOverride || "unset");
      generationPlans.push(generationPlan);
      if (generationError) throw generationError;
      const result: StructuredGenerationResult = {
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
      await onSourceReady?.(result);
      return result;
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
    validateGeneratedScadSource: mock(async () => {
      if (compileValidationError) throw compileValidationError;
    }),
    renderScadArtifacts: mock(async () => {
      renderCalls += 1;
      if (renderedArtifactsResult) return renderedArtifactsResult;
      throw renderError ?? new Error("openscad failed");
    }),
  }));

  mock.module("@/lib/repair/repair-controller", () => ({
    runRepair: mock(async (input: { validationResults: Array<{ message: string }>; repairStrategy?: string }) => {
      repairCalls += 1;
      repairStrategy = input.repairStrategy;
      repairValidationResults = input.validationResults;
      if (repairError) throw repairError;
      if (cancelDuringRepair) currentJob = { ...currentJob, state: "CANCELLED" };
      return {
        generationResult: {
          ...generatedResult(repairedScad),
          parameters: repairUsesParameters
            ? [{
                key: "diameter",
                label: "Diameter",
                kind: "float",
                unit: "mm",
                value: 24,
                min: 1,
                max: 100,
                step: 1,
                source: "repair",
                editable: true,
                description: "Repaired diameter",
                group: "geometry",
              }]
            : [],
        },
        repairMeta: {
          scad_source: repairedScad,
          repair_summary: "Replaced degenerate hull geometry",
          risk: "medium",
          requires_rerender: true,
          assumptions: [],
        },
      };
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
    getCriticalValidationFailures: mock((results: Array<{ passed?: boolean; is_critical?: boolean; status?: string }>) =>
      results.filter((result) => result.is_critical && result.passed === false && result.status !== "SKIP"),
    ),
    validateRenderedArtifacts: mock(async () => renderedValidationQueue.shift() ?? []),
  }));

  mock.module("@/lib/validation/motion-contract", () => ({
    evaluateMotionContract: mock(() => motionContractResult),
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
  renderError = null;
  intakeCalls = 0;
  modelIntakeError = null;
  generationRequests.length = 0;
  generationFamilies.length = 0;
  generationPlans.length = 0;
  generationError = null;
  repairError = null;
  repairCalls = 0;
  repairStrategy = undefined;
  repairedScad = "cube([12, 12, 12]);";
  repairUsesParameters = false;
  repairValidationResults = [];
  cancelDuringRepair = false;
  compileValidationError = null;
  renderedArtifactsResult = null;
  renderedValidationQueue = [];
  motionContractResult = null;
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
  test("recognizes only expired repair leases as stale", async () => {
    const {
      getCompileRepairLeaseEntry,
      isStaleRepairLease,
      removeCompileRepairLease,
    } = await import("@/lib/pipeline/execute-cad-job");
    const now = Date.now();
    const priorHistory = JSON.stringify([{ round: 1 }]);
    const compileLeaseHistory = JSON.stringify([
      { round: 1 },
      { type: "compile_repair_lease", token: "lease-1" },
    ]);

    expect(isStaleRepairLease("REPAIRING", new Date(now - 7 * 60_000), compileLeaseHistory, now)).toBe(true);
    expect(isStaleRepairLease("REPAIRING", new Date(now - 60_000), compileLeaseHistory, now)).toBe(false);
    expect(isStaleRepairLease("HUMAN_REVIEW", new Date(now - 7 * 60_000), compileLeaseHistory, now)).toBe(false);
    expect(isStaleRepairLease("REPAIRING", new Date(now - 7 * 60_000), priorHistory, now)).toBe(false);
    expect(getCompileRepairLeaseEntry(compileLeaseHistory)?.token).toBe("lease-1");
    expect(removeCompileRepairLease(compileLeaseHistory)).toBe(priorHistory);
  });
  test("demo delays default to zero and are bounded when explicitly enabled", async () => {
    const { getDemoDelayMs, isTemplateFallbackEnabled } = await import("@/lib/pipeline/execute-cad-job");
    expect(getDemoDelayMs({})).toBe(0);
    expect(getDemoDelayMs({ AGENTSCAD_DEMO_DELAY_MS: "250" })).toBe(250);
    expect(getDemoDelayMs({ AGENTSCAD_DEMO_DELAY_MS: "99999" })).toBe(5_000);
    expect(getDemoDelayMs({ AGENTSCAD_DEMO_DELAY_MS: "not-a-number" })).toBe(0);
    expect(isTemplateFallbackEnabled({})).toBe(false);
    expect(isTemplateFallbackEnabled({ AGENTSCAD_TEMPLATE_FALLBACK: "true" })).toBe(true);
  });

  test("re-extracts editable SCAD parameters instead of persisting a stale generic schema", async () => {
    const { buildScadParameterPersistence } = await import("@/lib/tools/scad-parameter-persistence");
    const refreshed = buildScadParameterPersistence(
      [
        "total_length = 842;",
        "bore = 100.5;",
        "module generated_part() { cylinder(d = bore, h = 10); }",
        "generated_part();",
      ].join("\n"),
      [{
        key: "width",
        label: "Width",
        kind: "float",
        unit: "mm",
        value: 40,
        min: 5,
        max: 500,
        step: 1,
        source: "user",
        editable: true,
        description: "Width of the part",
        group: "geometry",
      }],
    );

    expect(refreshed.parameters.map((parameter) => parameter.key)).toEqual(["total_length", "bore"]);
    expect(JSON.parse(refreshed.parameterSchema)).toHaveLength(2);
    expect(JSON.parse(refreshed.parameterValues)).toMatchObject({ total_length: 842, bore: 100.5 });
  });

  test("marks the job as GEOMETRY_FAILED and emits render_failed when OpenSCAD rendering fails", async () => {
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(updates.map((update) => update.data.state)).toContain("SCAD_GENERATED");
    expect(intakeCalls).toBe(1);
    expect(stateUpdates().at(-1)?.data.state).toBe("GEOMETRY_FAILED");
    expect(stateUpdates().at(-1)?.data.stlPath).toBeNull();
    expect(stateUpdates().at(-1)?.data.pngPath).toBeNull();
    expect(JSON.parse(stateUpdates().at(-1)?.data.renderLog as string).warnings[0]).toContain("openscad failed");
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
    // Research runs before clarification and records its own status on the job (here:
    // DISABLED, explicitly configured by this isolated test runner).
    expect(stateUpdates()).toHaveLength(2);
    expect(updates[0]?.data).toHaveProperty("researchResult");
    expect(JSON.parse(updates[0]?.data.researchResult as string)).toMatchObject({
      status: "DISABLED",
    });
    expect(updates[1]?.data).toMatchObject({
      state: "HUMAN_REVIEW",
      generationPath: "intent_clarification",
      scadSource: null,
      stlPath: null,
      pngPath: null,
      // Targets derived under the interpretation the user is about to reject
      // must not survive into the clarified job, or the new part gets validated
      // against the wrong part's dimensions.
      validationTargetsJson: null,
      validationResults: null,
      completedAt: null,
    });
    expect(JSON.parse(updates[1]?.data.intentResult as string)).toMatchObject({
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
    expect(generationPlans[0]).toMatchObject({
      part_type: "mechanism",
      units: "mm",
    });
    expect(updates.some((update) => update.data.generationPath === "structured_plan_ready")).toBe(true);
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
    expect(stateUpdates().at(-1)?.data.state).toBe("HUMAN_REVIEW");
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
    expect(stateUpdates().at(-1)?.data.state).toBe("GEOMETRY_FAILED");
    expect(events.some((event) => event.step === "generating_mock")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      errorCode: "CAD_GENERATION_FAILED",
      failureStage: "generate",
      retryable: true,
    });
    expect(templateCalls).toBe(0);
  });

  test("timeout makes one simplification attempt and preserves both sources on repeated timeout", async () => {
    const source = "cube(20);";
    generationError = new GeneratedScadCompileError(generatedResult(source),
      new OpenScadTimeoutError({ stage: "validation", timeoutMs: 300000, elapsedMs: 300041 }));
    compileValidationError = new OpenScadTimeoutError({ stage: "validation", timeoutMs: 300000, elapsedMs: 300041 });
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => events.push(event));
    expect(repairCalls).toBe(1);
    expect(repairStrategy).toBe("simplify");
    expect(renderCalls).toBe(0);
    expect(currentJob.state).toBe("HUMAN_REVIEW");
    expect(currentJob.scadSource).toBe(repairedScad);
    expect(String(currentJob.repairHistory)).toContain(source);
    expect(events.at(-1)?.errorCode).toBe("OPENSCAD_COMPILE_TIMEOUT");
    expect(String(events.at(-1)?.message)).toContain("Simplify");
  });

  test("successful simplification proceeds to rendering and retains rejected source", async () => {
    generationError = new GeneratedScadCompileError(generatedResult("cube(20);"),
      new OpenScadTimeoutError({ stage: "validation", timeoutMs: 300000, elapsedMs: 300041 }));
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => events.push(event));
    expect(repairCalls).toBe(1);
    expect(repairStrategy).toBe("simplify");
    expect(renderCalls).toBe(1);
    expect(events.some(event => event.step === "repair_success")).toBe(true);
    expect(currentJob.scadSource).toBe(repairedScad);
    expect(String(currentJob.repairHistory)).toContain("cube(20);");
  });

  test("render timeout retains source and emits the actionable timeout code", async () => {
    renderError = new OpenScadTimeoutError({ stage: "render", timeoutMs: 300000, elapsedMs: 300041 });
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => events.push(event));
    expect(currentJob.scadSource).toBeTruthy();
    expect(events.at(-1)).toMatchObject({ errorCode: "OPENSCAD_RENDER_TIMEOUT", failureStage: "render", retryable: true });
    expect(String(events.at(-1)?.message)).toContain("Simplify");
    expect(String(currentJob.executionLogs)).toContain("OPENSCAD_RENDER_TIMEOUT");
  });

  test("persists model output before compile validation and emits its distinct stage", async () => {
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => {
      events.push(event);
      if (event.step === "compiling_scad") {
        expect(currentJob.scadSource).toBe("wall_thickness = 2; cube([10, 10, 10]);");
        expect(event.executionProgress).toMatchObject({ step: "compiling_scad", backend: "native" });
        expect(renderCalls).toBe(0);
      }
    });
    expect(events.some(event => event.step === "compiling_scad")).toBe(true);
  });

  test("runtime failure preserves generated source without spending a repair call", async () => {
    generationError = new GeneratedScadCompileError(generatedResult("cube(20);"), new Error("spawn openscad ENOENT"));
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => events.push(event));
    expect(repairCalls).toBe(0);
    expect(renderCalls).toBe(0);
    expect(currentJob.state).toBe("HUMAN_REVIEW");
    expect(currentJob.scadSource).toBe("cube(20);");
    expect(events.at(-1)?.errorCode).toBe("OPENSCAD_RUNTIME_UNAVAILABLE");
    expect(JSON.parse(String(currentJob.validationResults))[0].status).toBe("ERROR");
  });

  test("unchanged repaired source still reports a repeated timeout", async () => {
    repairedScad = "cube(20);";
    generationError = new GeneratedScadCompileError(generatedResult(repairedScad),
      new OpenScadTimeoutError({ stage: "validation", timeoutMs: 300000, elapsedMs: 300041 }));
    compileValidationError = new OpenScadTimeoutError({ stage: "validation", timeoutMs: 300000, elapsedMs: 300041 });
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => events.push(event));
    expect(repairCalls).toBe(1);
    expect(events.at(-1)?.errorCode).toBe("OPENSCAD_COMPILE_TIMEOUT");
    expect(String(events.at(-1)?.message)).toContain("still exceeded");
  });

  test("repairs generated SCAD that fails OpenSCAD compilation before rendering", async () => {
    const badScad = "hull() { cube([0, 0, 0]); }";
    generationError = new GeneratedScadCompileError(
      generatedResult(badScad),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(repairCalls).toBe(1);
    expect(renderCalls).toBe(1);
    expect(events.some((event) => event.step === "repairing")).toBe(true);
    expect(events.some((event) => event.step === "repair_success")).toBe(true);
    expect(updates.find((update) => update.data.state === "SCAD_GENERATED")?.data.scadSource).toBe(repairedScad);
  });

  test("preserves the latest SCAD for review when compile repair also fails", async () => {
    const badScad = "hull() { cube([0, 0, 0]); }";
    generationError = new GeneratedScadCompileError(
      generatedResult(badScad),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    compileValidationError = new Error("Current top level object is empty");
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(repairCalls).toBe(1);
    expect(renderCalls).toBe(0);
    expect(stateUpdates().at(-1)?.data).toMatchObject({
      state: "HUMAN_REVIEW",
      generationPath: "llm_compile_repair_failed",
      scadSource: repairedScad,
    });
    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_REVIEW",
      step: "repair_error",
      errorCode: "OPENSCAD_COMPILE_FAILED",
      failureStage: "generate",
    });
    const persistedValidation = JSON.parse(String(stateUpdates().at(-1)?.data.validationResults));
    expect(persistedValidation).toHaveLength(1);
    expect(persistedValidation.every((result: { rule_id: string; status: string }) =>
      result.rule_id === "C001" && result.status === "FAIL"
    )).toBe(true);
    expect(String(stateUpdates().at(-1)?.data.executionLogs)).toContain("OPENSCAD_COMPILE_FAILED");
    expect(String(stateUpdates().at(-1)?.data.renderLog)).toContain("Current top level object is empty");
  });

  test("preserves the original generated SCAD when the compile repair provider fails", async () => {
    const badScad = "hull() { cube([0, 0, 0]); }";
    generationError = new GeneratedScadCompileError(
      generatedResult(badScad),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    repairError = new Error("repair provider unavailable");
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");

    await executeCadJob("job-pipeline", () => undefined);

    expect(renderCalls).toBe(0);
    expect(stateUpdates().at(-1)?.data).toMatchObject({
      state: "HUMAN_REVIEW",
      scadSource: badScad,
    });
    expect(String(stateUpdates().at(-1)?.data.renderLog)).toContain("repair provider unavailable");
  });

  test("bounds compiler diagnostics before sending them to the repair model", async () => {
    generationError = new GeneratedScadCompileError(
      generatedResult("hull() { cube([0, 0, 0]); }"),
      new Error(`CGAL:${"x".repeat(5_000)}`),
    );
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");

    await executeCadJob("job-pipeline", () => undefined);

    expect(repairValidationResults).toHaveLength(1);
    expect(repairValidationResults[0].message.length).toBe(4_001);
    expect(repairValidationResults[0].message.endsWith("…")).toBe(true);
  });

  test("uses parameters returned by a successful compile repair", async () => {
    generationError = new GeneratedScadCompileError(
      generatedResult("hull() { cube([0, 0, 0]); }"),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    repairedScad = "diameter = 24; cylinder(d = diameter, h = 10);";
    repairUsesParameters = true;
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");

    await executeCadJob("job-pipeline", () => undefined);

    const generatedUpdate = updates.find((update) => update.data.state === "SCAD_GENERATED");
    expect(JSON.parse(String(generatedUpdate?.data.parameterSchema))).toMatchObject([
      { key: "diameter", value: 24 },
    ]);
  });

  test("refreshes the editable parameter schema after a validation repair rewrites the SCAD", async () => {
    renderedArtifactsResult = renderableArtifacts();
    renderedValidationQueue = [
      [{
        rule_id: "B001",
        rule_name: "Bounding Box Match",
        level: "ENGINEERING",
        passed: false,
        status: "FAIL",
        is_critical: true,
        message: "Bbox mismatch",
      }],
      [],
    ];
    repairedScad = [
      "total_length = 842;",
      "bore = 100;",
      "module generated_part() { cylinder(d = bore, h = 10); }",
      "generated_part();",
    ].join("\n");
    repairUsesParameters = false;

    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(repairCalls).toBe(1);
    expect(renderCalls).toBe(2);
    expect(currentJob.state).toBe("DELIVERED");
    const schemas = updates
      .map((update) => update.data.parameterSchema)
      .filter((value): value is string => typeof value === "string")
      .map((value) => JSON.parse(value) as Array<{ key: string }>);
    const repairedSchema = schemas.find((schema) =>
      schema.some((parameter) => parameter.key === "total_length"),
    );
    expect(repairedSchema?.map((parameter) => parameter.key)).toEqual(["total_length", "bore"]);
    expect(repairedSchema?.some((parameter) => parameter.key === "width")).toBe(false);
  });

  test("attaches the motion contract result to the persisted validation evidence", async () => {
    renderedArtifactsResult = renderableArtifacts();
    renderedValidationQueue = [[]];
    motionContractResult = {
      rule_id: "M001",
      rule_name: "Motion Contract",
      level: "ENGINEERING",
      passed: false,
      status: "WARN",
      is_critical: false,
      message: "Motion-ready request is not actually movable: missing crank_angle.",
    };

    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    await executeCadJob("job-pipeline", () => undefined);

    const validationPayloads = updates
      .map((update) => update.data.validationResults)
      .filter((value): value is string => typeof value === "string")
      .map((value) => JSON.parse(value) as Array<{ rule_id?: string; status?: string }>);
    const motionResult = validationPayloads.flat().find((result) => result.rule_id === "M001");
    expect(motionResult?.status).toBe("WARN");
    expect(currentJob.state).toBe("DELIVERED");
  });

  test("does not overwrite cancellation that wins during compile repair", async () => {
    generationError = new GeneratedScadCompileError(
      generatedResult("hull() { cube([0, 0, 0]); }"),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    cancelDuringRepair = true;
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");

    await executeCadJob("job-pipeline", () => undefined);

    expect(currentJob.state).toBe("CANCELLED");
    expect(updates.some((update) => update.data.state === "SCAD_GENERATED")).toBe(false);
  });

  test("preserves model-provider error semantics when compile repair is unavailable", async () => {
    generationError = new GeneratedScadCompileError(
      generatedResult("hull() { cube([0, 0, 0]); }"),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    repairError = new ModelRequestError(
      "LLM_RATE_LIMITED",
      "Repair provider rate limited the request.",
      true,
    );
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_REVIEW",
      errorCode: "LLM_RATE_LIMITED",
      failureStage: "repair",
      retryable: true,
    });
    const persistedValidation = JSON.parse(String(stateUpdates().at(-1)?.data.validationResults));
    expect(persistedValidation).toHaveLength(1);
    expect(persistedValidation[0].rule_id).toBe("C001");
  });

  test("reports repaired-source validation infrastructure failures without mislabeling C001", async () => {
    generationError = new GeneratedScadCompileError(
      generatedResult("hull() { cube([0, 0, 0]); }"),
      new Error("CGAL error in applyHull(): assertion violation"),
    );
    compileValidationError = new Error("OpenSCAD WASM renderer is busy; retry this render shortly");
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_REVIEW",
      errorCode: "OPENSCAD_RUNTIME_UNAVAILABLE",
      retryable: true,
    });
    expect(stateUpdates().at(-1)?.data.scadSource).toBe(repairedScad);
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
    expect(stateUpdates().at(-1)?.data.executionLogs).toContain("LLM_TIMEOUT");
    expect(stateUpdates().at(-1)?.data.executionLogs).not.toContain("no safe template");
  });

  test("persists transport diagnostics and includes the same log in the failure event", async () => {
    generationError = new ModelRequestError("LLM_UNAVAILABLE", "Connection interrupted (ECONNRESET)", true, {
      evidence: { model: "test-model", provider: "Test provider", transportCode: "ECONNRESET", elapsedMs: 240000 },
    });
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];
    await executeCadJob("job-pipeline", event => events.push(event));
    const logs = stateUpdates().at(-1)?.data.executionLogs;
    expect(logs).toContain("ECONNRESET");
    expect(logs).toContain("Test provider");
    expect(logs).toContain("request duration: 240s");
    expect(events.at(-1)?.executionLogs).toBe(logs);
    expect(events.at(-1)?.failureStage).toBe("generate");
    expect(updates.some(update => String(update.data.executionLogs).includes("SCAD_GENERATION_STARTED"))).toBe(true);
    expect(renderCalls).toBe(0);
  });

  test("surfaces LLM truncation and format errors with detailed evidence in executionLogs and events", async () => {
    generationError = new ModelRequestError(
      "LLM_OUTPUT_TRUNCATED",
      "LLM output was truncated before completion (length: 4096 chars).",
      true,
      {
        evidence: {
          model: "deepseek-flash",
          finishReason: "length",
          responseLength: 4096,
          rawSnippet: "module generated_part() { ... [truncated 3000 chars] ... cube([10, 10, 10]);",
        },
      },
    );
    spyOn(console, "warn").mockImplementation(() => undefined);
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({
      state: "GEOMETRY_FAILED",
      errorCode: "LLM_OUTPUT_TRUNCATED",
      failureStage: "generate",
      retryable: true,
      evidence: {
        model: "deepseek-flash",
        finishReason: "length",
        responseLength: 4096,
      },
    });
    const logs = stateUpdates().at(-1)?.data.executionLogs;
    expect(logs).toContain("LLM_OUTPUT_TRUNCATED");
    expect(logs).toContain("model: deepseek-flash");
    expect(logs).toContain("finish_reason: length");
    expect(logs).toContain("Raw response preview:");
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

  test("reuses a matching generation plan checkpoint after a coding retry", async () => {
    const { buildGenerationPlan } = await import("@/lib/planning/generation-plan");
    const checkpoint = buildGenerationPlan({
      request: currentJob.inputRequest as string,
      family: "electronics_enclosure",
      parameterValues: { wall_thickness: 2 },
      parameterSchema: [],
      intelligence: modelIntakeResult as never,
    });
    currentJob = {
      ...currentJob,
      intentResult: JSON.stringify(modelIntakeResult),
      cadIntentJson: JSON.stringify({
        request_intelligence: modelIntakeResult,
        generation_plan: checkpoint,
      }),
    };
    const { executeCadJob } = await import("@/lib/pipeline/execute-cad-job");
    const events: Record<string, unknown>[] = [];

    await executeCadJob("job-pipeline", (event) => events.push(event));

    expect(events.some((event) => event.step === "planning_reused")).toBe(true);
    expect(events.some((event) => event.step === "planning_geometry")).toBe(false);
    expect(updates.some((update) => update.data.generationPath === "structured_plan_ready")).toBe(false);
    expect(generationPlans[0]).toEqual(checkpoint.plan);
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

}
