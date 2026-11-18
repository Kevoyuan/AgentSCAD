/**
 * A small, model-agnostic benchmark for functional CAD assemblies.
 *
 * The measured question is narrow on purpose: given one natural-language
 * request, can a model emit OpenSCAD that renders as two separate parts which
 * actually fit, turn and come apart around a declared axis?
 *
 * Two design rules follow from that, and both are load-bearing:
 *
 * 1. The task owns the geometry contract. The submission owns geometry only.
 *    A model never declares its own joint, clearance band or motion range, so
 *    it cannot widen the acceptance window to whatever it happened to draw.
 * 2. The submission is one `.scad` file. That is the entire model-facing
 *    interface: nothing here imports a product pipeline, a chat client or a
 *    provider SDK, so any system that can write a file can be scored.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type EvidenceStatus = "PASS" | "FAIL" | "SKIP" | "ERROR" | "NOT_RUN";
export type Layer = "parts" | "assembly" | "motion" | "physical";

/** Mirrors the frozen-contract shape already used by the product. */
export type Expected =
  | { kind: "equals"; value: string | boolean | number }
  | { kind: "range"; min: number; max: number; unit: string }
  | { kind: "atLeast"; min: number; unit: string };

export interface BenchRequirement {
  id: string;
  layer: Layer;
  required: boolean;
  applicable: boolean;
  expected: Expected;
}

export interface BenchTask {
  schemaVersion: 1;
  id: string;
  prompt: string;
  /** Each part is rendered from the submission by passing `-D agentscad_part=<selector>`. */
  parts: Array<{ id: string; selector: string }>;
  joint: {
    type: "revolute" | "prismatic";
    /** Axis in assembly coordinates shared by every rendered part. */
    axisOrigin: [number, number, number];
    axisDirection: [number, number, number];
    /** The part that carries the bore; the other part carries the shaft. */
    borePartId: string;
    /**
     * The part that moves under the joint. For a hinge this is the bore part;
     * for a piston in a barrel it is the shaft part. Keeping it separate is
     * what lets one scorer cover both without assuming the bore is the mover.
     */
    movingPartId: string;
  };
  requirements: BenchRequirement[];
  /**
   * A revolute joint sweeps an angle; a prismatic joint sweeps a distance from
   * the assembled pose. Exactly one of the two ranges is present, selected by
   * `joint.type`, so a task cannot silently describe a motion the scorer will
   * not sample.
   */
  motion:
    | { kind: "revolute"; rangeDeg: [number, number]; steps: number }
    | { kind: "prismatic"; strokeMm: [number, number]; steps: number };
  disassembly: { travelMm: number; steps: number };
  /**
   * Optional: the submission must expose its own pose control so the *source*
   * can be re-rendered at each value. Without this the benchmark only rotates
   * a mesh it holds itself, which never tests whether the model's own model is
   * actually kinematic.
   */
  pose?: {
    /** SCAD variable the submission must honour. Reserved controls are refused. */
    parameter: string;
    unit: "deg" | "mm";
    values: number[];
    /** Allowed centroid error between the measured and the expected pose. */
    toleranceMm: number;
  };
  /**
   * Optional: the moving part must be captured, so pulling it along the axis is
   * blocked by a retention feature. Mutually exclusive with a required
   * `disassembly-path`, because a captured part cannot also slide off.
   */
  retention?: { pullMm: number };
  /** Informational only. Present so a task can state an intent it does not gate on. */
  expectedAssemblyBboxMm?: { min: [number, number, number]; max: [number, number, number]; toleranceMm: number };
  notes?: string[];
}

export interface Submission {
  taskId: string;
  /** File name without the `.scad` suffix. `reference` must pass; `adversarial-*` must fail. */
  id: string;
  sourcePath: string;
  source: string;
}

const STATUS_ORDER: EvidenceStatus[] = ["PASS", "FAIL", "SKIP", "ERROR", "NOT_RUN"];

export function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return typeof value === "string" && (STATUS_ORDER as string[]).includes(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function vec3(value: unknown, field: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    fail(`${field} must be three finite numbers`);
  }
  return [value[0], value[1], value[2]];
}

/**
 * Validates a task. A malformed task must fail loudly: a benchmark that
 * silently accepts an unmeasurable requirement reports a pass nobody earned.
 */
export function validateTask(value: unknown): BenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("task.schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("task.id must be a lowercase kebab-case id");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("task.prompt must be a non-trivial string");

  if (!Array.isArray(raw.parts) || raw.parts.length < 2 || raw.parts.length > 8) fail("task.parts must contain 2 to 8 parts");
  const parts = raw.parts.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.parts[${index}] must be an object`);
    const part = entry as Record<string, unknown>;
    if (typeof part.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(part.id)) fail(`task.parts[${index}].id is invalid`);
    if (typeof part.selector !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(part.selector)) fail(`task.parts[${index}].selector is invalid`);
    return { id: part.id, selector: part.selector };
  });
  if (new Set(parts.map((part) => part.id)).size !== parts.length) fail("task.parts ids must be unique");
  if (new Set(parts.map((part) => part.selector)).size !== parts.length) fail("task.parts selectors must be unique");

  if (!raw.joint || typeof raw.joint !== "object") fail("task.joint must be an object");
  const joint = raw.joint as Record<string, unknown>;
  if (joint.type !== "revolute" && joint.type !== "prismatic") fail("task.joint.type must be revolute or prismatic");
  const axisOrigin = vec3(joint.axisOrigin, "task.joint.axisOrigin");
  const axisDirection = vec3(joint.axisDirection, "task.joint.axisDirection");
  if (Math.hypot(...axisDirection) < 1e-9) fail("task.joint.axisDirection must be non-zero");
  if (typeof joint.borePartId !== "string" || !parts.some((part) => part.id === joint.borePartId)) {
    fail("task.joint.borePartId must name one of task.parts");
  }
  if (typeof joint.movingPartId !== "string" || !parts.some((part) => part.id === joint.movingPartId)) {
    fail("task.joint.movingPartId must name one of task.parts");
  }

  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("task.requirements must be a non-empty array");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.requirements[${index}] must be an object`);
    const requirement = entry as Record<string, unknown>;
    if (typeof requirement.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(requirement.id)) fail(`task.requirements[${index}].id is invalid`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(requirement.layer))) fail(`task.requirements[${index}].layer is invalid`);
    if (typeof requirement.required !== "boolean") fail(`task.requirements[${index}].required must be boolean`);
    if (typeof requirement.applicable !== "boolean") fail(`task.requirements[${index}].applicable must be boolean`);
    const expected = requirement.expected as Record<string, unknown> | undefined;
    if (!expected || typeof expected !== "object") fail(`task.requirements[${index}].expected must be an object`);
    if (expected.kind === "equals") {
      const type = typeof expected.value;
      if (!["string", "boolean", "number"].includes(type)) fail(`task.requirements[${index}].expected.value has an unsupported type`);
      if (type === "number" && !Number.isFinite(expected.value as number)) fail(`task.requirements[${index}].expected.value must be finite`);
    } else if (expected.kind === "range") {
      if (typeof expected.min !== "number" || typeof expected.max !== "number" || !Number.isFinite(expected.min) || !Number.isFinite(expected.max) || expected.min > expected.max) {
        fail(`task.requirements[${index}].expected range is invalid`);
      }
      if (typeof expected.unit !== "string" || !expected.unit.trim()) fail(`task.requirements[${index}].expected.unit is required`);
    } else if (expected.kind === "atLeast") {
      if (typeof expected.min !== "number" || !Number.isFinite(expected.min)) fail(`task.requirements[${index}].expected.min must be finite`);
      if (typeof expected.unit !== "string" || !expected.unit.trim()) fail(`task.requirements[${index}].expected.unit is required`);
    } else {
      fail(`task.requirements[${index}].expected.kind is unsupported`);
    }
    return {
      id: requirement.id,
      layer: requirement.layer as Layer,
      required: requirement.required,
      applicable: requirement.applicable,
      expected: expected as Expected,
    };
  });
  if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) fail("task.requirements ids must be unique");

  if (!raw.motion || typeof raw.motion !== "object") fail("task.motion must be an object");
  const motion = raw.motion as Record<string, unknown>;
  const steps = motion.steps;
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 3 || steps > 361) fail("task.motion.steps must be an integer from 3 to 361");
  let resolvedMotion: BenchTask["motion"];
  if (joint.type === "revolute") {
    const rangeDeg = motion.rangeDeg;
    if (!Array.isArray(rangeDeg) || rangeDeg.length !== 2 || !rangeDeg.every((item) => typeof item === "number" && Number.isFinite(item))) {
      fail("task.motion.rangeDeg must be two finite numbers for a revolute joint");
    }
    if (rangeDeg[0] > 0 || rangeDeg[1] < 0) fail("task.motion.rangeDeg must straddle zero so the assembled pose is sampled");
    if (motion.strokeMm !== undefined) fail("task.motion.strokeMm is meaningless for a revolute joint");
    resolvedMotion = { kind: "revolute", rangeDeg: [rangeDeg[0], rangeDeg[1]], steps };
  } else {
    const strokeMm = motion.strokeMm;
    if (!Array.isArray(strokeMm) || strokeMm.length !== 2 || !strokeMm.every((item) => typeof item === "number" && Number.isFinite(item))) {
      fail("task.motion.strokeMm must be two finite numbers for a prismatic joint");
    }
    // The assembled pose is the start of the stroke; a stroke that starts
    // elsewhere would never measure the configuration that ships.
    if (strokeMm[0] !== 0) fail("task.motion.strokeMm must start at 0 so the assembled pose is sampled");
    if (!(strokeMm[1] > 0)) fail("task.motion.strokeMm must travel a positive distance");
    if (motion.rangeDeg !== undefined) fail("task.motion.rangeDeg is meaningless for a prismatic joint");
    resolvedMotion = { kind: "prismatic", strokeMm: [strokeMm[0], strokeMm[1]], steps };
  }

  if (!raw.disassembly || typeof raw.disassembly !== "object") fail("task.disassembly must be an object");
  const disassembly = raw.disassembly as Record<string, unknown>;
  if (typeof disassembly.travelMm !== "number" || !Number.isFinite(disassembly.travelMm) || disassembly.travelMm <= 0) {
    fail("task.disassembly.travelMm must be a positive number");
  }
  if (typeof disassembly.steps !== "number" || !Number.isInteger(disassembly.steps) || disassembly.steps < 2 || disassembly.steps > 128) {
    fail("task.disassembly.steps must be an integer from 2 to 128");
  }

  let pose: BenchTask["pose"];
  if (raw.pose !== undefined) {
    const value = raw.pose as Record<string, unknown>;
    if (!value || typeof value !== "object") fail("task.pose must be an object");
    if (typeof value.parameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value.parameter)) {
      fail("task.pose.parameter must be a SCAD identifier");
    }
    if (["agentscad_part", "agentscad_pose"].includes(value.parameter)) fail("task.pose.parameter must not be a reserved control");
    const unit = value.unit;
    if (unit !== "deg" && unit !== "mm") fail("task.pose.unit must be deg or mm");
    if (unit !== (joint.type === "revolute" ? "deg" : "mm")) fail("task.pose.unit must match the joint type");
    if (!Array.isArray(value.values) || value.values.length < 3 || value.values.length > 9) fail("task.pose.values must have 3 to 9 entries");
    const values = value.values.map((item) => {
      if (typeof item !== "number" || !Number.isFinite(item)) fail("task.pose.values must be finite numbers");
      return item;
    });
    if (!values.includes(0)) fail("task.pose.values must include 0, the declared assembly pose");
    if (new Set(values).size !== values.length) fail("task.pose.values must be distinct");
    const toleranceMm = typeof value.toleranceMm === "number" && Number.isFinite(value.toleranceMm) && value.toleranceMm > 0 ? value.toleranceMm : 0.5;
    pose = { parameter: value.parameter, unit, values, toleranceMm };
  }

  let retention: BenchTask["retention"];
  if (raw.retention !== undefined) {
    const value = raw.retention as Record<string, unknown>;
    if (!value || typeof value !== "object") fail("task.retention must be an object");
    if (typeof value.pullMm !== "number" || !Number.isFinite(value.pullMm) || value.pullMm <= 0) {
      fail("task.retention.pullMm must be a positive number");
    }
    retention = { pullMm: value.pullMm };
  }

  const task: BenchTask = {
    schemaVersion: 1,
    id: raw.id,
    prompt: raw.prompt,
    parts,
    joint: { type: joint.type, axisOrigin, axisDirection, borePartId: joint.borePartId, movingPartId: joint.movingPartId },
    requirements,
    motion: resolvedMotion,
    disassembly: { travelMm: disassembly.travelMm, steps: disassembly.steps },
    ...(pose ? { pose } : {}),
    ...(retention ? { retention } : {}),
    ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}),
  };

  // A captured part cannot slide off, so requiring both would make the task
  // unsatisfiable by construction.
  const requiredIds = new Set(requirements.filter((requirement) => requirement.required && requirement.applicable).map((requirement) => requirement.id));
  if (retention && requiredIds.has("disassembly-path")) {
    fail("task.retention and a required task.requirements disassembly-path are mutually exclusive");
  }
  if (requiredIds.has("axial-retention") && !retention) fail("a required axial-retention needs task.retention");
  if (requiredIds.has("source-motion") && !pose) fail("a required source-motion needs task.pose");

  if (raw.expectedAssemblyBboxMm !== undefined) {
    const bbox = raw.expectedAssemblyBboxMm as Record<string, unknown>;
    if (!bbox || typeof bbox !== "object") fail("task.expectedAssemblyBboxMm must be an object");
    task.expectedAssemblyBboxMm = {
      min: vec3(bbox.min, "task.expectedAssemblyBboxMm.min"),
      max: vec3(bbox.max, "task.expectedAssemblyBboxMm.max"),
      toleranceMm: typeof bbox.toleranceMm === "number" && Number.isFinite(bbox.toleranceMm) && bbox.toleranceMm >= 0 ? bbox.toleranceMm : 2,
    };
  }

  // Only requirements this scorer can actually observe are accepted. A typo in
  // an id would otherwise become an unmet requirement forever, or worse, a pass.
  const observable = new Set([
    "distinct-exported-parts",
    "diametral-clearance",
    "sampled-motion",
    "disassembly-path",
    "axial-retention",
    "source-motion",
  ]);
  for (const requirement of requirements) {
    if (!observable.has(requirement.id)) fail(`task.requirements id "${requirement.id}" has no observer in this benchmark`);
  }
  return task;
}

export function tasksDirectory(): string {
  return path.join(import.meta.dir, "tasks");
}

export function submissionsDirectory(): string {
  return path.join(import.meta.dir, "submissions");
}

export async function loadTasks(root = tasksDirectory()): Promise<BenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: BenchTask[] = [];
  for (const name of names) {
    const raw = await readFile(path.join(root, name), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(`${name}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      tasks.push(validateTask(parsed));
    } catch (error) {
      fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (tasks.length === 0) fail(`no tasks found under ${root}`);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) fail("task ids must be unique across the task set");
  return tasks;
}

export async function loadSubmissions(taskId: string, root = submissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort();
  } catch {
    return [];
  }
  const submissions: Submission[] = [];
  for (const name of names) {
    const sourcePath = path.join(directory, name);
    submissions.push({
      taskId,
      id: name.replace(/\.scad$/, ""),
      sourcePath,
      source: await readFile(sourcePath, "utf8"),
    });
  }
  return submissions;
}

/**
 * `reference` must pass everything; `adversarial-*` must fail at least one
 * required check; `model-*` is a recorded model attempt and carries no
 * expectation, so the self-check neither rewards nor punishes it.
 */
export type ExpectedOutcome = "pass" | "fail" | "unscored";

export function expectedOutcome(submissionId: string): ExpectedOutcome {
  if (submissionId === "reference") return "pass";
  if (submissionId.startsWith("adversarial-")) return "fail";
  if (submissionId.startsWith("model-")) return "unscored";
  fail(`submission "${submissionId}" must be "reference", start with "adversarial-", or start with "model-" so its expected outcome is stated`);
}

export function aggregateStatus(statuses: Array<{ status: EvidenceStatus; required: boolean }>): EvidenceStatus {
  const required = statuses.filter((entry) => entry.required);
  if (required.length === 0) return "ERROR";
  if (required.some((entry) => entry.status === "ERROR")) return "ERROR";
  if (required.some((entry) => entry.status === "FAIL")) return "FAIL";
  if (required.some((entry) => entry.status === "NOT_RUN")) return "NOT_RUN";
  if (required.some((entry) => entry.status === "SKIP")) return "SKIP";
  return required.every((entry) => entry.status === "PASS") ? "PASS" : "ERROR";
}
