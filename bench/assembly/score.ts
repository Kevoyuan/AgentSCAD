/**
 * The measuring half of the benchmark.
 *
 * One submission in, one evidence record out. Every verdict below names the
 * tool that produced it and the coverage it had, because a score whose method
 * is unknown is not a score.
 *
 * Reused from the product, because these are geometry primitives rather than
 * policy: `readBinaryStl`, `extentAlongAxis`, `meshesIntersect` and
 * `measureCylindricalFeature`. The fit verdict is *not* borrowed — the product's
 * own fit check is revolute-only, and importing it would narrow this benchmark
 * and bind it to a module the product keeps refactoring. The band comparison is
 * `evaluateRequirement`'s range semantics, which are already tri-state.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { meshesIntersect, transformPoint } from "../../src/lib/geometry/mesh-collision";
import { extentAlongAxis, meshBounds, normalize, readBinaryStl, type TriangleMesh, type Vec3 } from "../../src/lib/geometry/stl-mesh";
import { measureCylindricalFeature } from "../../src/lib/geometry/cylindrical-feature";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";

import { scoreEvidence } from "../layers";
import {
  aggregateStatus,
  expectedOutcome,
  type BenchTask,
  type EvidenceStatus,
  type Submission,
} from "./bench";

const IDENTITY: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface PartMeasurement {
  partId: string;
  sha256: string;
  triangleCount: number;
  volumeMm3: number;
  bounds: { min: Vec3; max: Vec3 };
}

export interface CaseReport {
  schemaVersion: "assembly-bench.case.v1";
  taskId: string;
  submission: string;
  expected: "pass" | "fail" | "unscored";
  sourcePath: string;
  sourceSha256: string;
  status: EvidenceStatus;
  gatePassed: boolean;
  results: Result[];
  /**
   * The same evidence, folded into the shared layer model. `status` above is the
   * delivery gate for this case; this block is the progress metric that can move
   * one layer at a time. Both come from one evidence list, so they cannot drift.
   */
  layers: {
    coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] };
    byLayer: Array<{ layer: string; status: string | null; blockers: string[] }>;
  };
  measurements: {
    parts: PartMeasurement[];
    clearanceMm: { min: number; max: number } | null;
    fitStatus: "MEASURED" | "ERROR" | "NOT_RUN";
    fitReason: string;
    stationsMm: number[];
    motion: { kind: "revolute" | "prismatic"; sampled: number; separated: number; firstCollisionAt: number | null };
    disassembly: { travelMm: number; steps: number; separatedAtEveryStep: boolean };
    assemblyBbox: { min: Vec3; max: Vec3 } | null;
  };
  timingsMs: Record<string, number>;
  provenance: {
    createdAt: string;
    backend: string;
    openscad: string;
    runtime: string;
    platform: string;
  };
  unknowns: string[];
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Order-independent triangle hash, so a reshuffled STL cannot fake a distinct part. */
function canonicalMeshHash(mesh: TriangleMesh): string {
  const triangles: string[] = [];
  for (let index = 0; index < mesh.triangleCount; index += 1) {
    const corners: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const base = index * 9 + corner * 3;
      corners.push(`${mesh.coordinates[base].toFixed(4)},${mesh.coordinates[base + 1].toFixed(4)},${mesh.coordinates[base + 2].toFixed(4)}`);
    }
    triangles.push(corners.sort().join("|"));
  }
  return sha256(triangles.sort().join("\n"));
}

/** Signed volume by the divergence theorem. Tessellation error is not corrected. */
function meshVolume(mesh: TriangleMesh): number {
  let volume = 0;
  for (let index = 0; index < mesh.triangleCount; index += 1) {
    const base = index * 9;
    const ax = mesh.coordinates[base], ay = mesh.coordinates[base + 1], az = mesh.coordinates[base + 2];
    const bx = mesh.coordinates[base + 3], by = mesh.coordinates[base + 4], bz = mesh.coordinates[base + 5];
    const cx = mesh.coordinates[base + 6], cy = mesh.coordinates[base + 7], cz = mesh.coordinates[base + 8];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

/** Row-major 16-value transform, matching `transformPoint` in `mesh-collision.ts`. */
function rotationAboutAxis(origin: Vec3, direction: Vec3, angleDeg: number): number[] {
  const [x, y, z] = normalize(direction);
  const radians = (angleDeg * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const C = 1 - c;
  const r00 = c + x * x * C, r01 = x * y * C - z * s, r02 = x * z * C + y * s;
  const r10 = y * x * C + z * s, r11 = c + y * y * C, r12 = y * z * C - x * s;
  const r20 = z * x * C - y * s, r21 = z * y * C + x * s, r22 = c + z * z * C;
  const tx = origin[0] - (r00 * origin[0] + r01 * origin[1] + r02 * origin[2]);
  const ty = origin[1] - (r10 * origin[0] + r11 * origin[1] + r12 * origin[2]);
  const tz = origin[2] - (r20 * origin[0] + r21 * origin[1] + r22 * origin[2]);
  return [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz, 0, 0, 0, 1];
}

function translationAlong(direction: Vec3, distanceMm: number): number[] {
  const [x, y, z] = normalize(direction);
  return [1, 0, 0, x * distanceMm, 0, 1, 0, y * distanceMm, 0, 0, 1, z * distanceMm, 0, 0, 0, 1];
}

/** Unique vertex positions. Triangle corners repeat, and duplicates would bias a Hausdorff distance. */
function vertexPoints(mesh: TriangleMesh): Vec3[] {
  const seen = new Set<string>();
  const points: Vec3[] = [];
  for (let index = 0; index < mesh.triangleCount; index += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const base = index * 9 + corner * 3;
      const point: Vec3 = [mesh.coordinates[base], mesh.coordinates[base + 1], mesh.coordinates[base + 2]];
      const key = `${point[0].toFixed(4)},${point[1].toFixed(4)},${point[2].toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(point);
    }
  }
  return points;
}

const distance3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Directed Hausdorff distance: how far the worst point of `a` is from the
 * nearest point of `b`.
 *
 * A centroid comparison is not usable here. The moving leaf of a hinge is
 * mostly knuckle by vertex count, so its centroid sits near the axis and a 45°
 * rotation moves it by ~0.4 mm — smaller than the tolerance, which would make
 * the check vacuous. Comparing the posed point set against the transformed
 * reference point set is exact for a rigid part and needs no weighting choice.
 */
function directedHausdorff(a: Vec3[], b: Vec3[]): number {
  let worst = 0;
  for (const point of a) {
    let nearest = Infinity;
    for (const candidate of b) {
      const d = distance3(point, candidate);
      if (d < nearest) nearest = d;
      if (nearest === 0) break;
    }
    if (nearest > worst) worst = nearest;
  }
  return worst;
}

interface SourceMotionResult {
  passed: boolean;
  /** `null` when the check could not decide anything, which is not a pass. */
  decided: boolean;
  reason: string;
  residualsMm: number[];
  expectedShiftMm: number;
}

let cachedOpenscadVersion: string | null = null;

function openscadVersion(): string {
  if (cachedOpenscadVersion !== null) return cachedOpenscadVersion;
  try {
    // 2021.01 prints its version to stderr, so both streams are read.
    const probe = spawnSync(process.env.OPENSCAD_BIN ?? "openscad", ["--version"], { encoding: "utf8", timeout: 15_000 });
    const text = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.trim();
    cachedOpenscadVersion = text.split("\n")[0] || "unknown";
  } catch {
    cachedOpenscadVersion = "unavailable";
  }
  return cachedOpenscadVersion;
}

function observation(requirementId: string, value: unknown, extra: Partial<Observation> = {}): Observation {
  return {
    id: requirementId,
    status: "MEASURED",
    value: value as Observation["value"],
    artifactSha256: "0".repeat(64),
    method: "unspecified",
    toolVersion: "unspecified",
    coverage: "unspecified",
    ...extra,
  };
}

export async function scoreSubmission(task: BenchTask, submission: Submission): Promise<CaseReport> {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const unknowns = [
    "A PASS covers the sampled stations and poses only; it is not a proof of physical function, printing or user acceptance.",
    "The submission chooses its own modelling approach; the benchmark measures the geometry, not the reasoning.",
  ];
  const sourceSha256 = sha256(submission.source);
  const movingPart = task.parts.find((part) => part.id === task.joint.movingPartId);
  const groundedPart = task.parts.find((part) => part.id !== task.joint.movingPartId);
  if (!movingPart || !groundedPart) throw new Error(`task ${task.id} declares an unknown movingPartId "${task.joint.movingPartId}"`);

  const baseReport = (
    status: EvidenceStatus,
    results: Result[],
    measurements: CaseReport["measurements"],
    // Evidence that belongs to a layer but is not a task requirement. `compile`
    // is the only current member: it is a precondition, not a contract term.
    layerOnlyEvidence: Array<{ id: string; status: string }> = [],
  ): CaseReport => {
    const scored = scoreEvidence([...results.map((result) => ({ id: result.id, status: result.status })), ...layerOnlyEvidence]);
    return ({
    schemaVersion: "assembly-bench.case.v1",
    taskId: task.id,
    submission: submission.id,
    expected: expectedOutcome(submission.id),
    sourcePath: path.relative(process.cwd(), submission.sourcePath),
    sourceSha256,
    status,
    gatePassed: status === "PASS",
    results,
    layers: {
      coverage: scored.coverage,
      byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })),
    },
    measurements,
    timingsMs: { ...timings, total: Date.now() - startedAt },
    provenance: {
      createdAt: new Date().toISOString(),
      backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native",
      openscad: openscadVersion(),
      runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`,
      platform: process.platform,
    },
    unknowns,
    });
  };

  const emptyMeasurements: CaseReport["measurements"] = {
    parts: [],
    clearanceMm: null,
    fitStatus: "NOT_RUN",
    fitReason: "No part geometry was rendered.",
    stationsMm: [],
    motion: { kind: task.motion.kind, sampled: 0, separated: 0, firstCollisionAt: null },
    disassembly: { travelMm: task.disassembly.travelMm, steps: task.disassembly.steps, separatedAtEveryStep: false },
    assemblyBbox: null,
  };

  // 1. Render. A compile failure is an ERROR on every geometry requirement, not
  //    a FAIL: the submission never produced a candidate to measure.
  const renderStart = Date.now();
  let rendered: Awaited<ReturnType<typeof renderAssemblyParts>>;
  try {
    rendered = await renderAssemblyParts({
      scadSource: submission.source,
      parts: task.parts.map((part) => ({ partId: part.id, selector: part.selector })),
    });
  } catch (error) {
    timings.render = Date.now() - renderStart;
    const reason = error instanceof Error ? error.message : String(error);
    const results: Result[] = task.requirements.map((requirement) => ({
      id: requirement.id,
      layer: requirement.layer,
      required: requirement.required,
      status: requirement.applicable ? "ERROR" : "SKIP",
      reason: `The submission did not render: ${reason}`,
      observation: { id: requirement.id, status: "ERROR", reason },
    }));
    const report = baseReport(aggregateStatus(results), results, { ...emptyMeasurements, fitReason: reason }, [{ id: "compile", status: "ERROR" }]);
    report.unknowns = [...unknowns, `Render error: ${reason}`];
    return report;
  }
  timings.render = Date.now() - renderStart;

  const meshes = new Map<string, TriangleMesh>();
  const parts: PartMeasurement[] = [];
  for (const part of rendered) {
    const mesh = readBinaryStl(part.stl);
    meshes.set(part.partId, mesh);
    const bounds = meshBounds(mesh);
    parts.push({
      partId: part.partId,
      sha256: part.sha256,
      triangleCount: part.triangleCount,
      volumeMm3: Math.round(meshVolume(mesh) * 1000) / 1000,
      bounds: { min: bounds.min, max: bounds.max },
    });
  }
  const stlArtifact = sha256(rendered.map((part) => part.sha256).join(":"));
  const toolVersion = `assembly-bench/1 openscad:${openscadVersion()}`;

  const measurements: CaseReport["measurements"] = { ...emptyMeasurements, parts };

  // 2. Distinct exported parts: two selectors that emit the same solid are one
  //    part wearing two names, which would otherwise pass every downstream check.
  const canonicalHashes = rendered.map((part) => canonicalMeshHash(meshes.get(part.partId)!));
  const distinctCount = new Set(canonicalHashes).size;
  const distinctObservation = observation("distinct-exported-parts", distinctCount, {
    artifactSha256: stlArtifact,
    method: "Canonical order-independent triangle hash per rendered part.",
    toolVersion,
    coverage: `${rendered.length} rendered part(s): ${rendered.map((part) => `${part.partId}=${part.triangleCount} triangles`).join(", ")}.`,
    ...(distinctCount === rendered.length ? {} : { reason: `Only ${distinctCount} distinct solid(s) across ${rendered.length} selectors.` }),
  });

  // 3. Fit. Measured from the mesh by the benchmark itself, for either joint
  //    type: the product's own fit check is revolute-only, and a benchmark that
  //    borrows the measured system's policy inherits its narrowing. The band
  //    comparison is left to `evaluateRequirement`, whose range semantics are
  //    the same tri-state (inside / outside / straddling), so this file does not
  //    reimplement a verdict.
  const fitStart = Date.now();
  const axis = { origin: task.joint.axisOrigin as Vec3, direction: normalize(task.joint.axisDirection) };
  // The bore and the shaft are the two sides of the joint; which one moves is a
  // separate fact. A hinge's bore part is the moving leaf, so taking the moving
  // part as the shaft would measure one mesh against itself.
  const shaftPartId = task.joint.borePartId === movingPart.id ? groundedPart.id : movingPart.id;
  const borePartMesh = rendered.find((part) => part.partId === task.joint.borePartId);
  const shaftPartMesh = rendered.find((part) => part.partId === shaftPartId);
  let clearance: { min: number; max: number } | null = null;
  let fitStatus: CaseReport["measurements"]["fitStatus"] = "NOT_RUN";
  let fitReason = "没有可测量的孔轴。";
  try {
    if (borePartMesh && shaftPartMesh) {
      const boreExtent = extentAlongAxis(readBinaryStl(borePartMesh.stl), axis.origin, axis.direction);
      const shaftExtent = extentAlongAxis(readBinaryStl(shaftPartMesh.stl), axis.origin, axis.direction);
      const overlapMin = Math.max(boreExtent.min, shaftExtent.min);
      const overlapMax = Math.min(boreExtent.max, shaftExtent.max);
      if (!(overlapMax > overlapMin)) {
        fitStatus = "ERROR";
        fitReason = "两件沿声明轴不重叠，无法形成配合。";
      } else {
        const stations = [0.2, 0.5, 0.8].map((fraction) => overlapMin + (overlapMax - overlapMin) * fraction);
        measurements.stationsMm = stations;
        const bore = measureCylindricalFeature({ stl: borePartMesh.stl, axis, role: "bore", stationsMm: stations, rays: 360 });
        const shaft = measureCylindricalFeature({ stl: shaftPartMesh.stl, axis, role: "shaft", stationsMm: stations, rays: 360 });
        if (bore.status !== "MEASURED" || !bore.diameterMm) {
          fitStatus = "ERROR";
          fitReason = `轴孔无法测量：${bore.reason}`;
        } else if (shaft.status !== "MEASURED" || !shaft.diameterMm) {
          fitStatus = "ERROR";
          fitReason = `轴无法测量：${shaft.reason}`;
        } else {
          clearance = {
            min: bore.diameterMm.min - shaft.diameterMm.max,
            max: bore.diameterMm.max - shaft.diameterMm.min,
          };
          fitStatus = "MEASURED";
          fitReason = `在 ${stations.length} 个轴向站位上分别测量孔与轴的直径区间，取两者极值差。`;
        }
      }
    }
  } catch (error) {
    fitStatus = "ERROR";
    fitReason = error instanceof Error ? error.message : String(error);
    unknowns.push(`Fit measurement threw: ${fitReason}`);
  }
  timings.fit = Date.now() - fitStart;

  measurements.clearanceMm = clearance;
  measurements.fitStatus = fitStatus;
  measurements.fitReason = fitReason;
  const clearanceObservation: Observation = clearance
    ? observation("diametral-clearance", (clearance.min + clearance.max) / 2, {
        uncertainty: (clearance.max - clearance.min) / 2,
        unit: "mm",
        artifactSha256: stlArtifact,
        method: "在采样轴向站位上取平面截面，径向射线求交并做正多边形拟合；间隙为孔与轴多边形极值之差。",
        toolVersion,
        coverage: `站位 ${measurements.stationsMm.map((value) => value.toFixed(2)).join(", ")} mm，沿声明轴。`,
      })
    : { id: "diametral-clearance", status: fitStatus === "ERROR" ? "ERROR" : "NOT_RUN", reason: fitReason, toolVersion };

  // 4. Motion. The assembled pose is sampled explicitly, then the declared sweep.
  const motionStart = Date.now();
  const fixedMesh = meshes.get(groundedPart.id)!;
  const movingMesh = meshes.get(movingPart.id)!;
  const poses: Array<{ at: number; matrix: number[] }> = [];
  if (task.motion.kind === "revolute") {
    const [min, max] = task.motion.rangeDeg;
    const angles = [0];
    for (let step = 0; step < task.motion.steps; step += 1) angles.push(min + ((max - min) * step) / (task.motion.steps - 1));
    for (const angle of angles) poses.push({ at: angle, matrix: rotationAboutAxis(task.joint.axisOrigin, task.joint.axisDirection, angle) });
  } else {
    // The stroke starts at the assembled pose, so step 0 is that pose.
    const [, travel] = task.motion.strokeMm;
    for (let step = 0; step < task.motion.steps; step += 1) {
      const distance = (travel * step) / (task.motion.steps - 1);
      poses.push({ at: distance, matrix: translationAlong(task.joint.axisDirection, distance) });
    }
  }
  let separated = 0;
  let firstCollisionAt: number | null = null;
  for (const pose of poses) {
    const result = meshesIntersect(movingMesh, pose.matrix, fixedMesh, IDENTITY);
    if (result.status === "SEPARATED") {
      separated += 1;
    } else if (firstCollisionAt === null) {
      firstCollisionAt = Math.round(pose.at * 1000) / 1000;
    }
  }
  timings.motion = Date.now() - motionStart;
  measurements.motion = { kind: task.motion.kind, sampled: poses.length, separated, firstCollisionAt };
  const motionPassed = separated === poses.length;
  const unit = task.motion.kind === "revolute" ? "°" : " mm";
  const motionObservation = observation("sampled-motion", motionPassed, {
    artifactSha256: stlArtifact,
    method: task.motion.kind === "revolute"
      ? "Exact triangle intersection between the posed parts against a BVH, at the assembled pose and across the declared angular sweep."
      : "Exact triangle intersection between the posed parts against a BVH, at the assembled pose and across the declared linear stroke.",
    toolVersion,
    coverage: `${poses.length} pose(s) from ${Math.min(...poses.map((pose) => pose.at)).toFixed(1)}${unit} to ${Math.max(...poses.map((pose) => pose.at)).toFixed(1)}${unit} along the declared joint.`,
    ...(motionPassed ? {} : { reason: firstCollisionAt === null ? "A sampled pose returned a non-separated result." : `Parts interfere at ${firstCollisionAt}${unit}.` }),
  });

  // 5. Disassembly. Rigid translation along the declared axis, sampled.
  const disassemblyStart = Date.now();
  let separatedAtEveryStep = true;
  for (let step = 0; step < task.disassembly.steps; step += 1) {
    const distance = (task.disassembly.travelMm * step) / (task.disassembly.steps - 1);
    const result = meshesIntersect(movingMesh, translationAlong(task.joint.axisDirection, distance), fixedMesh, IDENTITY);
    if (result.status !== "SEPARATED") separatedAtEveryStep = false;
  }
  timings.disassembly = Date.now() - disassemblyStart;
  measurements.disassembly = { travelMm: task.disassembly.travelMm, steps: task.disassembly.steps, separatedAtEveryStep };
  const disassemblyObservation = observation("disassembly-path", separatedAtEveryStep, {
    artifactSha256: stlArtifact,
    method: "Exact triangle intersection while translating the moving part along the declared axis in equal steps.",
    toolVersion,
    coverage: `${task.disassembly.steps} step(s) over ${task.disassembly.travelMm} mm from the assembled pose.`,
    ...(separatedAtEveryStep ? {} : { reason: "The moving part interferes with the other part somewhere on the withdrawal path." }),
  });

  // 5b. Retention: a captured part must be blocked when pulled along the axis.
  const retentionStart = Date.now();
  let retentionBlocked: boolean | null = null;
  let retentionDetail = "";
  if (task.retention) {
    const assembled = meshesIntersect(movingMesh, IDENTITY, fixedMesh, IDENTITY);
    if (assembled.status !== "SEPARATED") {
      // A part that already interpenetrates cannot demonstrate retention: the
      // pull would "block" for a reason that has nothing to do with a feature.
      retentionDetail = `组装位姿下两件已经相交（${assembled.status}），拉拔结果不能归因于保持件。`;
    } else {
      const pulled = meshesIntersect(movingMesh, translationAlong(task.joint.axisDirection, task.retention.pullMm), fixedMesh, IDENTITY);
      retentionBlocked = pulled.status !== "SEPARATED";
      retentionDetail = retentionBlocked
        ? `沿轴拉拔 ${task.retention.pullMm} mm 时与另一件相交（${pulled.status}），保持件生效。`
        : `沿轴拉拔 ${task.retention.pullMm} mm 后两件仍然分离，没有特征挡住抽出。`;
    }
  }
  timings.retention = Date.now() - retentionStart;
  const retentionObservation: Observation = retentionBlocked === null
    ? { id: "axial-retention", status: task.retention ? "ERROR" : "NOT_RUN", reason: task.retention ? retentionDetail : "任务没有声明保持条件。", toolVersion }
    : observation("axial-retention", retentionBlocked, {
        artifactSha256: stlArtifact,
        method: "组装位姿检查后沿关节轴平移声明的拉拔距离，用精确三角相交判定抽出是否被挡住。",
        toolVersion,
        coverage: `组装位姿 + 一次 ${task.retention?.pullMm} mm 拉拔。`,
        reason: retentionDetail,
      });

  // 5c. Source motion: re-render the submission through its own pose control,
  // so the claim being tested is "the model's source is kinematic", not "the
  // benchmark can rotate a mesh it holds".
  const measureSourceMotion = async (): Promise<SourceMotionResult> => {
    const pose = task.pose!;
    try {
      const pointSets: Vec3[][] = [];
      for (const value of pose.values) {
        const [renderedPose] = await renderAssemblyParts({
          scadSource: submission.source,
          parts: [{ partId: movingPart.id, selector: movingPart.selector }],
          parameters: { [pose.parameter]: value },
        });
        pointSets.push(vertexPoints(readBinaryStl(renderedPose.stl)));
      }
      const referenceIndex = pose.values.indexOf(0);
      const reference = pointSets[referenceIndex];
      const residualsMm: number[] = [];
      let expectedShiftMm = 0;
      for (let index = 0; index < pose.values.length; index += 1) {
        const matrix = task.joint.type === "revolute"
          ? rotationAboutAxis(task.joint.axisOrigin, task.joint.axisDirection, pose.values[index])
          : translationAlong(task.joint.axisDirection, pose.values[index]);
        // How far the part is supposed to have moved at this pose. If this is
        // inside the tolerance, a static source and a moving one are the same
        // measurement and the check must refuse to decide.
        for (const point of reference) expectedShiftMm = Math.max(expectedShiftMm, distance3(transformPoint(matrix, point), point));
        const expected = reference.map((point) => transformPoint(matrix, point));
        // Both directions: the posed mesh must neither lag nor carry extra
        // geometry the reference pose did not have.
        residualsMm.push(Math.max(directedHausdorff(pointSets[index], expected), directedHausdorff(expected, pointSets[index])));
      }
      if (expectedShiftMm <= pose.toleranceMm) {
        return {
          passed: false,
          decided: false,
          reason: `声明的位姿不会让活动件移动超过 ${pose.toleranceMm} mm（最大 ${expectedShiftMm.toFixed(3)} mm），这个检查分不出会动的源码和不会动的源码。`,
          residualsMm,
          expectedShiftMm,
        };
      }
      const fixedHashes: string[] = [];
      for (const value of [pose.values[0], pose.values[pose.values.length - 1]]) {
        const [renderedPose] = await renderAssemblyParts({
          scadSource: submission.source,
          parts: [{ partId: groundedPart.id, selector: groundedPart.selector }],
          parameters: { [pose.parameter]: value },
        });
        // Canonical vertex hash, not the raw file: the STL header is not geometry.
        fixedHashes.push(canonicalMeshHash(readBinaryStl(renderedPose.stl)));
      }
      if (fixedHashes[0] !== fixedHashes[1]) {
        return { passed: false, decided: true, reason: "固定件也随位姿参数变化，说明位姿作用在整机而不是单个活动件。", residualsMm, expectedShiftMm };
      }
      const worst = Math.max(...residualsMm);
      return worst <= pose.toleranceMm
        ? {
            passed: true,
            decided: true,
            reason: `活动件在 ${pose.values.length} 个位姿上与「参考位姿经刚体变换」的最大点偏差 ${worst.toFixed(3)} mm，未超过 ${pose.toleranceMm} mm。`,
            residualsMm,
            expectedShiftMm,
          }
        : {
            passed: false,
            decided: true,
            reason: `活动件与「参考位姿经刚体变换」的最大点偏差 ${worst.toFixed(3)} mm 超过容差 ${pose.toleranceMm} mm：源码没有按声明的位姿运动。`,
            residualsMm,
            expectedShiftMm,
          };
    } catch (error) {
      return {
        passed: false,
        decided: false,
        reason: `按位姿参数重渲染失败：${error instanceof Error ? error.message : String(error)}`,
        residualsMm: [],
        expectedShiftMm: 0,
      };
    }
  };

  const sourceMotionStart = Date.now();
  const sourceMotion = task.pose ? await measureSourceMotion() : null;
  timings.sourceMotion = Date.now() - sourceMotionStart;
  const sourceMotionObservation: Observation = !sourceMotion
    ? { id: "source-motion", status: "NOT_RUN", reason: "任务没有声明源码位姿参数。", toolVersion }
    : sourceMotion.decided
      ? observation("source-motion", sourceMotion.passed, {
          artifactSha256: stlArtifact,
          method: "按任务声明的位姿参数重渲染提交源码，把参考位姿的点集按刚体变换过去，双向比较最近邻最大偏差，并确认固定件的 STL 不随位姿变化。",
          toolVersion,
          coverage: `${task.pose!.values.length} 个位姿（${task.pose!.values.join(", ")} ${task.pose!.unit}），点偏差容差 ${task.pose!.toleranceMm} mm。`,
          reason: sourceMotion.reason,
        })
      : { id: "source-motion", status: "NOT_RUN", reason: sourceMotion.reason, toolVersion };

  // 6. Informational assembly bbox. Reported, never gated.
  const allMin: Vec3 = [Infinity, Infinity, Infinity];
  const allMax: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let axis = 0; axis < 3; axis += 1) {
      allMin[axis] = Math.min(allMin[axis], part.bounds.min[axis]);
      allMax[axis] = Math.max(allMax[axis], part.bounds.max[axis]);
    }
  }
  measurements.assemblyBbox = { min: allMin, max: allMax };

  // 7. Score.
  const observations: Record<string, Observation> = {
    "distinct-exported-parts": distinctObservation,
    "sampled-motion": motionObservation,
    "disassembly-path": disassemblyObservation,
    "diametral-clearance": clearanceObservation,
    "axial-retention": retentionObservation,
    "source-motion": sourceMotionObservation,
  };
  const results: Result[] = task.requirements.map((requirement) => {
    const requirementForEvaluator = {
      id: requirement.id,
      layer: requirement.layer,
      required: requirement.required,
      applicable: requirement.applicable,
      expected: requirement.expected,
    };
    const evaluated = evaluateRequirement(requirementForEvaluator, observations[requirement.id]);
    // `evaluateRequirement` reports an exact comparison generically; the observed
    // value belongs in the record, otherwise a FAIL cannot be acted on.
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") {
      const observed = observations[requirement.id]?.value;
      return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observed)}, expected ${String(requirement.expected.value)}.` };
    }
    return evaluated;
  });

  const status = aggregateStatus(results);
  return baseReport(status, results, measurements, [{ id: "compile", status: "PASS" }]);
}
