import { createHash } from "crypto";
import { measureCircularSections } from "../geometry/circular-section";
import type { Vec3 } from "../geometry/stl-mesh";
import { checkSliderCrank } from "./slider-crank-check";

/**
 * Multi-pose measurement of a slider-crank built from the parts OpenSCAD
 * actually rendered. Every pose is measured from mesh sections; the analytic
 * formula is used only to compare, never to place a contour centre.
 *
 * The crank axis is not assumed to sit at the origin. It is fitted to the
 * circle the crank pin traces across poses, then the measured points are
 * translated by that fitted centre before comparison. This is what lets the
 * check reject a mechanism whose crank turns about the wrong axis or whose
 * radius changed, instead of silently following it.
 */

export interface SliderCrankMotionContract {
  crankRadiusMm: number;
  rodLengthMm: number;
  /** Positional tolerance for closure, radius, rod length and axis checks. */
  toleranceMm: number;
  /** Section plane normal to +Y, at this Y coordinate. */
  sectionYmm: number;
  /** When given, a second slice is measured this far along +Y. */
  axisProbeMm?: number;
  pinRadiusMm: { min: number; max: number };
  rodBoreRadiusMm: { min: number; max: number };
  /** Optional fixed crank axis in the crank plane; compared when supplied. */
  crankCenterXZ?: [number, number];
}

export interface SliderCrankPoseInput {
  angleDegrees: number;
  meshes: { crank: Buffer; rod: Buffer; slider: Buffer };
}

export interface SliderCrankPoseResult {
  angleDegrees: number;
  status: "PASS" | "FAIL" | "ERROR";
  reason: string;
  maxErrorMm: number | null;
  crankPinXZ: [number, number] | null;
  pistonPinXZ: [number, number] | null;
  rodLengthMm: number | null;
  axisDriftMm: number | null;
  contours: { crank: number; rod: number; slider: number };
}

export interface SliderCrankMeasurement {
  id: string;
  value: number;
  unit: "mm";
  uncertainty: number;
  method: string;
  coverage: string;
  artifactSha256: string;
}

/**
 * Endpoint tolerance of the section builder (1e-5 mm) plus float32 STL
 * coordinates. It is deliberately smaller than any geometric tolerance this
 * module compares against, and it is not a substitute for print tolerance.
 */
const SECTION_UNCERTAINTY_MM = 1e-4;

const round = (value: number) => Number(value.toFixed(6));

/** Kasa circle fit in centred coordinates, so the normal equations stay well conditioned. */
export function fitCircleXZ(points: Array<[number, number]>): { centerXZ: [number, number]; radiusMm: number; residualMm: number } | null {
  if (points.length < 3) return null;
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / n;
  const meanZ = points.reduce((sum, point) => sum + point[1], 0) / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, z] of points) {
    const u = x - meanX, v = z - meanZ;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const determinant = suu * svv - suv * suv;
  const scale = Math.max(suu, svv, 1);
  // Collinear poses carry no circle: a straight line has no unique centre.
  if (!(Math.abs(determinant) > 1e-9 * scale * scale)) return null;
  const rhsU = 0.5 * (suuu + suvv);
  const rhsV = 0.5 * (svvv + svuu);
  const uc = (rhsU * svv - rhsV * suv) / determinant;
  const vc = (rhsV * suu - rhsU * suv) / determinant;
  const centerXZ: [number, number] = [uc + meanX, vc + meanZ];
  const radii = points.map(([x, z]) => Math.hypot(x - centerXZ[0], z - centerXZ[1]));
  const radiusMm = radii.reduce((sum, value) => sum + value, 0) / n;
  return { centerXZ, radiusMm, residualMm: Math.max(...radii.map(value => Math.abs(value - radiusMm))) };
}

const distanceXZ = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Measures every pose, then compares the measured motion with the analytic
 * slider-crank and with itself across poses. A single pose is refused: it
 * cannot separate motion from a static assembly, and it cannot fit a circle.
 */
export function measureSliderCrankMotion(input: {
  contract: SliderCrankMotionContract;
  poses: SliderCrankPoseInput[];
}): {
  status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN";
  reason: string;
  poses: SliderCrankPoseResult[];
  crank: { centerXZ: [number, number]; radiusMm: number; residualMm: number } | null;
  rodLengthMm: { min: number; max: number; spread: number } | null;
  axisDriftMm: number | null;
  axisCheck: { performed: boolean; reason: string };
  coverage: { poses: number; anglesDegrees: number[]; stepDeg: number | null; slicesPerPose: number; partsPerPose: number };
  observations: SliderCrankMeasurement[];
  failures: string[];
} {
  const { contract, poses } = input;
  const { toleranceMm } = contract;
  if (![contract.crankRadiusMm, contract.rodLengthMm, toleranceMm, contract.sectionYmm].every(Number.isFinite) ||
      contract.crankRadiusMm <= 0 || contract.rodLengthMm <= contract.crankRadiusMm || toleranceMm < 0) {
    throw new Error("Invalid slider-crank motion contract");
  }
  if (contract.axisProbeMm !== undefined && (!Number.isFinite(contract.axisProbeMm) || Math.abs(contract.axisProbeMm) < 1e-4)) {
    throw new Error("Axis probe must use two distinct finite slices");
  }
  if (!Array.isArray(poses) || poses.length === 0) throw new Error("At least one pose is required");
  const angles = poses.map(pose => pose.angleDegrees);
  if (new Set(angles).size !== angles.length || angles.some(angle => !Number.isFinite(angle))) {
    throw new Error("Pose angles must be finite and unique");
  }

  const slice = (stl: Buffer, radiusMm: { min: number; max: number }, y: number) =>
    measureCircularSections({ stl, origin: [0, y, 0], normal: [0, 1, 0], radiusMm });

  const artifactSha256 = createHash("sha256")
    .update(poses.map(pose => [
      pose.angleDegrees,
      createHash("sha256").update(pose.meshes.crank).digest("hex"),
      createHash("sha256").update(pose.meshes.rod).digest("hex"),
      createHash("sha256").update(pose.meshes.slider).digest("hex"),
    ].join(":")).join("|"))
    .digest("hex");

  const probeY = contract.axisProbeMm === undefined ? null : contract.sectionYmm + contract.axisProbeMm;
  const slicesPerPose = probeY === null ? 1 : 2;
  const sortedAngles = [...angles].sort((a, b) => a - b);
  const intervals = sortedAngles.slice(1).map((a, i) => a - sortedAngles[i]);
  const uniformStep = intervals.length && intervals.every(d => Math.abs(d - intervals[0]) < 1e-8)
    ? round(intervals[0]) : null;
  const coverage = {
    poses: poses.length,
    anglesDegrees: angles,
    stepDeg: uniformStep,
    slicesPerPose,
    partsPerPose: 3,
  };
  const coverageText = `${poses.length} poses from ${Math.min(...angles)}° to ${Math.max(...angles)}°` +
    `${coverage.stepDeg === null ? "" : ` at ${coverage.stepDeg}° steps`}, ${slicesPerPose} Y-slice(s) per pose at y=${contract.sectionYmm}${probeY === null ? "" : ` and y=${probeY}`}, 3 parts per pose`;

  const results: SliderCrankPoseResult[] = [];
  const failures: string[] = [];
  const crankPoints: Array<[number, number]> = [];
  const rodLengths: number[] = [];
  const axisDrifts: number[] = [];

  for (const pose of poses) {
    const contours = { crank: 0, rod: 0, slider: 0 };
    const failPose = (reason: string): SliderCrankPoseResult => ({
      angleDegrees: pose.angleDegrees, status: "ERROR", reason,
      maxErrorMm: null, crankPinXZ: null, pistonPinXZ: null, rodLengthMm: null, axisDriftMm: null, contours,
    });
    let measured;
    try {
      measured = {
        crank: slice(pose.meshes.crank, contract.pinRadiusMm, contract.sectionYmm),
        rod: slice(pose.meshes.rod, contract.rodBoreRadiusMm, contract.sectionYmm),
        slider: slice(pose.meshes.slider, contract.pinRadiusMm, contract.sectionYmm),
      };
    } catch (error) {
      results.push(failPose(`The section at ${pose.angleDegrees}° could not be built: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    contours.crank = measured.crank.circles.length;
    contours.rod = measured.rod.circles.length;
    contours.slider = measured.slider.circles.length;
    if (contours.crank !== 1 || contours.slider !== 1 || contours.rod !== 2) {
      results.push(failPose(
        `At ${pose.angleDegrees}° the slice at y=${contract.sectionYmm} held ${contours.crank} crank pin, ` +
        `${contours.rod} rod bore and ${contours.slider} slider pin contours; one, two and one were expected. ` +
        `A part may be absent, outside its radius window, or off the +Y pin axis.`,
      ));
      continue;
    }

    const crankPin: [number, number] = [measured.crank.circles[0].center[0], measured.crank.circles[0].center[2]];
    const pistonPin: [number, number] = [measured.slider.circles[0].center[0], measured.slider.circles[0].center[2]];
    const bores: Array<[number, number]> = measured.rod.circles.map((circle: { center: Vec3 }) => [circle.center[0], circle.center[2]]);
    const rodLengthMm = distanceXZ(bores[0], bores[1]);

    let axisDriftMm: number | null = null;
    if (probeY !== null) {
      try {
        const probe = {
          crank: slice(pose.meshes.crank, contract.pinRadiusMm, probeY),
          rod: slice(pose.meshes.rod, contract.rodBoreRadiusMm, probeY),
          slider: slice(pose.meshes.slider, contract.pinRadiusMm, probeY),
        };
        if (probe.crank.circles.length !== 1 || probe.slider.circles.length !== 1 || probe.rod.circles.length !== 2) {
          results.push(failPose(
            `At ${pose.angleDegrees}° the second slice at y=${probeY} held ${probe.crank.circles.length} crank pin, ` +
            `${probe.rod.circles.length} rod bore and ${probe.slider.circles.length} slider pin contours; the pins are not parallel to +Y.`,
          ));
          continue;
        }
        const probeCrank: [number, number] = [probe.crank.circles[0].center[0], probe.crank.circles[0].center[2]];
        const probeSlider: [number, number] = [probe.slider.circles[0].center[0], probe.slider.circles[0].center[2]];
        const probeBores: Array<[number, number]> = probe.rod.circles.map((circle: { center: Vec3 }) => [circle.center[0], circle.center[2]]);
        // Contour discovery order is not part of the contract: pair each bore
        // with its nearest counterpart in the second slice.
        const straight = distanceXZ(bores[0], probeBores[0]) + distanceXZ(bores[1], probeBores[1]);
        const crossed = distanceXZ(bores[0], probeBores[1]) + distanceXZ(bores[1], probeBores[0]);
        const rodDrift = straight <= crossed
          ? Math.max(distanceXZ(bores[0], probeBores[0]), distanceXZ(bores[1], probeBores[1]))
          : Math.max(distanceXZ(bores[0], probeBores[1]), distanceXZ(bores[1], probeBores[0]));
        axisDriftMm = Math.max(
          distanceXZ(crankPin, probeCrank),
          distanceXZ(pistonPin, probeSlider),
          rodDrift,
        );
        axisDrifts.push(axisDriftMm);
      } catch (error) {
        results.push(failPose(`The axis probe at ${pose.angleDegrees}° failed: ${error instanceof Error ? error.message : String(error)}`));
        continue;
      }
    }

    crankPoints.push(crankPin);
    rodLengths.push(rodLengthMm);
    results.push({
      angleDegrees: pose.angleDegrees, status: "PASS", reason: "Measured at this pose.",
      maxErrorMm: null, crankPinXZ: crankPin, pistonPinXZ: pistonPin,
      rodLengthMm, axisDriftMm, contours,
    });
  }

  const failedPoses = results.filter(pose => pose.status === "ERROR");
  if (failedPoses.length > 0) {
    return {
      status: "ERROR",
      reason: `${failedPoses.length} of ${poses.length} poses could not be measured; the first is at ${failedPoses[0].angleDegrees}°. ${failedPoses[0].reason}`,
      poses: results, crank: null, rodLengthMm: null, axisDriftMm: axisDrifts.length ? Math.max(...axisDrifts) : null,
      axisCheck: { performed: probeY !== null, reason: probeY === null ? "No second slice was requested, so pin-axis parallelism was not measured." : "Two parallel slices were compared per pose." },
      coverage, observations: [], failures: failedPoses.map(pose => pose.reason),
    };
  }

  if (poses.length < 3) {
    return {
      status: "NOT_RUN",
      reason: `Only ${poses.length} pose(s) were measured. Three non-collinear poses are required to fit the circle the crank pin traces; fewer cannot separate motion from a static assembly.`,
      poses: results, crank: null, rodLengthMm: null, axisDriftMm: axisDrifts.length ? Math.max(...axisDrifts) : null,
      axisCheck: { performed: probeY !== null, reason: probeY === null ? "No second slice was requested." : "Two parallel slices were compared per pose." },
      coverage, observations: [], failures: ["Insufficient poses for a circle fit."],
    };
  }

  const crank = fitCircleXZ(crankPoints);
  if (!crank) {
    return {
      status: "NOT_RUN",
      reason: "The measured crank pin positions are collinear, so they define no unique crank centre or radius. Spread the poses around the circle.",
      poses: results, crank: null, rodLengthMm: null, axisDriftMm: axisDrifts.length ? Math.max(...axisDrifts) : null,
      axisCheck: { performed: probeY !== null, reason: probeY === null ? "No second slice was requested." : "Two parallel slices were compared per pose." },
      coverage, observations: [], failures: ["Collinear crank pin positions."],
    };
  }

  // Compare in a frame whose origin is the measured crank axis, not a declared one.
  const [axisX, axisZ] = crank.centerXZ;
  const translated = results.map((pose) => {
    const crankPin: [number, number] = [pose.crankPinXZ![0] - axisX, pose.crankPinXZ![1] - axisZ];
    const pistonPin: [number, number] = [pose.pistonPinXZ![0] - axisX, pose.pistonPinXZ![1] - axisZ];
    const comparison = checkSliderCrank({
      crankRadiusMm: contract.crankRadiusMm,
      rodLengthMm: contract.rodLengthMm,
      toleranceMm,
      requiredAngles: [pose.angleDegrees],
      samples: [{ angleDegrees: pose.angleDegrees, crankPin, pistonPin }],
    })[0];
    return { pose, crankPin, pistonPin, comparison };
  });

  for (const item of translated) {
    item.pose.maxErrorMm = round(item.comparison.maxErrorMm!);
    if (item.comparison.status === "FAIL") {
      item.pose.status = "FAIL";
      item.pose.reason = `Measured pins differ from the analytic slider-crank by ${item.comparison.maxErrorMm!.toFixed(4)} mm, above the ${toleranceMm} mm tolerance.`;
      failures.push(item.pose.reason);
    }
  }

  if (Math.abs(crank.radiusMm - contract.crankRadiusMm) > toleranceMm) {
    failures.push(`The crank pin traces a circle of ${crank.radiusMm.toFixed(4)} mm, not the required ${contract.crankRadiusMm} mm.`);
  }
  if (crank.residualMm > toleranceMm) {
    failures.push(`The crank pin positions deviate from a circle by up to ${crank.residualMm.toFixed(4)} mm; the pin does not turn about a fixed axis.`);
  }
  if (contract.crankCenterXZ) {
    const offset = distanceXZ(crank.centerXZ, contract.crankCenterXZ);
    if (offset > toleranceMm) {
      failures.push(`The measured crank axis sits ${offset.toFixed(4)} mm from the declared datum.`);
    }
  }

  const rodMin = Math.min(...rodLengths), rodMax = Math.max(...rodLengths);
  const rodSpread = rodMax - rodMin;
  if (rodSpread > toleranceMm) {
    failures.push(`The measured rod length varies by ${rodSpread.toFixed(4)} mm across poses; a rigid rod cannot stretch.`);
  }
  if (Math.abs((rodMin + rodMax) / 2 - contract.rodLengthMm) > toleranceMm) {
    failures.push(`The measured rod length ${rodMin.toFixed(4)}–${rodMax.toFixed(4)} mm does not match the required ${contract.rodLengthMm} mm.`);
  }

  const axisDriftMm = axisDrifts.length ? Math.max(...axisDrifts) : null;
  if (axisDriftMm !== null && axisDriftMm > toleranceMm) {
    failures.push(`The pin centres move ${axisDriftMm.toFixed(4)} mm between two parallel slices; the pin axes are not parallel to +Y.`);
  }

  const maxErrorMm = Math.max(...translated.map(item => item.pose.maxErrorMm!));
  const observations: SliderCrankMeasurement[] = [
    {
      id: "slider-crank-position-error-mm", value: round(maxErrorMm), unit: "mm",
      uncertainty: SECTION_UNCERTAINTY_MM,
      method: "Mesh sections at fixed Y, contour centres, analytic slider-crank comparison in a frame fitted to the measured crank axis.",
      coverage: coverageText, artifactSha256,
    },
    {
      id: "slider-crank-crank-radius-mm", value: round(crank.radiusMm), unit: "mm",
      uncertainty: SECTION_UNCERTAINTY_MM,
      method: "Kasa circle fit to the crank pin centres measured at every pose.",
      coverage: coverageText, artifactSha256,
    },
    {
      id: "slider-crank-rod-length-spread-mm", value: round(rodSpread), unit: "mm",
      uncertainty: 2 * SECTION_UNCERTAINTY_MM,
      method: "Distance between the two measured rod bore centres, compared across poses.",
      coverage: coverageText, artifactSha256,
    },
  ];

  const status = failures.length === 0 ? "PASS" as const : "FAIL" as const;
  return {
    status,
    reason: status === "PASS"
      ? `Every measured pose closes against the analytic slider-crank within ${toleranceMm} mm, the sampled rod bore spacing is constant${probeY === null ? "; pin-axis parallelism was not measured" : " and the two measured pin sections align"}. This covers only the sampled poses and the measured contours.`
      : `${failures.length} check(s) failed: ${failures.join(" ")}`,
    poses: results,
    crank: { centerXZ: crank.centerXZ, radiusMm: crank.radiusMm, residualMm: crank.residualMm },
    rodLengthMm: { min: rodMin, max: rodMax, spread: rodSpread },
    axisDriftMm,
    axisCheck: {
      performed: probeY !== null,
      reason: probeY === null
        ? "No second slice was requested, so pin-axis parallelism was not measured."
        : `Two slices ${contract.axisProbeMm} mm apart were compared at every pose.`,
    },
    coverage, observations, failures,
  };
}
