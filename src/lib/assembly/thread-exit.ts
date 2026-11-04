import { readBinaryStl, meshBounds } from "../geometry/stl-mesh";
import { createHash } from "crypto";

/** Conservative axial removal evidence for a +Z, fixed-bolt experiment.
 * This is mesh evidence at listed samples; it does not establish a swept path,
 * engagement mechanics or real physical assembly.
 */
export function checkThreadExit(input: {
  poses: Array<{ turnDeg: number; bolt: Buffer; nut: Buffer; collision: "SEPARATED" | "INTERSECT" | "CONTAINED" | "UNKNOWN" | "ERROR" }>;
  minTurns: number;
  maxStepDeg: number;
  clearanceMm: number;
  /** Optional frozen bounds on the measured exit angle, separate from sample coverage. */
  minExitTurns?: number;
  maxExitTurns?: number;
  startAngleDeg?: number;
}) {
  if (!Number.isFinite(input.minTurns) || input.minTurns <= 0 || !Number.isFinite(input.maxStepDeg) || input.maxStepDeg <= 0 ||
      !Number.isFinite(input.clearanceMm) || input.clearanceMm < 0 || !Array.isArray(input.poses) || input.poses.length < 2 || input.poses.length > 64) throw new Error("Invalid thread exit contract or pose count");
  if ((input.minExitTurns !== undefined && (!Number.isFinite(input.minExitTurns) || input.minExitTurns < 0)) ||
      (input.maxExitTurns !== undefined && (!Number.isFinite(input.maxExitTurns) || input.maxExitTurns < 0)) ||
      (input.minExitTurns !== undefined && input.maxExitTurns !== undefined && input.minExitTurns > input.maxExitTurns)) throw new Error("Invalid exit turn bounds");
  if (input.startAngleDeg !== undefined && !Number.isFinite(input.startAngleDeg)) throw new Error("Invalid initial angle");
  const poses = input.poses;
  if (poses.some(p => !Number.isFinite(p.turnDeg) || !["SEPARATED","INTERSECT","CONTAINED","UNKNOWN","ERROR"].includes(p.collision))) throw new Error("Invalid commanded angle or collision status");
  if (input.startAngleDeg !== undefined && Math.abs(poses[0].turnDeg - input.startAngleDeg) > 1e-9) throw new Error("Initial angle does not match contract");
  const intervals = poses.slice(1).map((p,i) => p.turnDeg - poses[i].turnDeg);
  if (intervals.some(step => step <= 0 || step > input.maxStepDeg + 1e-9)) throw new Error("Angles must increase within the declared step bound");
  const coveredTurns = (poses.at(-1)!.turnDeg - poses[0].turnDeg) / 360;
  const snapshots = poses.map(p => {
    const bolt = meshBounds(readBinaryStl(p.bolt));
    const nut = meshBounds(readBinaryStl(p.nut));
    return { turnDeg:p.turnDeg, boltTopMm:bolt.max[2], boltBottomMm:bolt.min[2], nutBottomMm:nut.min[2], nutTopMm:nut.max[2], projectedXYOverlap: [0,1].every(i => bolt.max[i] >= nut.min[i] && nut.max[i] >= bolt.min[i]), collision:p.collision,
      boltSha256:createHash("sha256").update(p.bolt).digest("hex"), nutSha256:createHash("sha256").update(p.nut).digest("hex") };
  });
  const base = { method:"sampled-axial-thread-exit/v1", coveredTurns, maxStepDeg:Math.max(...intervals), clearanceMm:input.clearanceMm, minExitTurns:input.minExitTurns??null, maxExitTurns:input.maxExitTurns??null, snapshots,
    coverage:"Only actual rendered mesh bounds and collision results at listed angles; +Z axial separation is conservative, XY bounding-box overlap is not coaxiality or thread engagement. Collision labels are supplied by the caller. Sampling does not exclude earlier crossing and return between poses; no continuous screw travel, coaxiality, self-propulsion or physical function." };
  if (!snapshots[0].projectedXYOverlap) return {...base,status:"FAIL" as const,reason:"The initial meshes do not even overlap in XY projection"};
  if (snapshots[0].nutTopMm < snapshots[0].boltBottomMm) return {...base,status:"FAIL" as const,reason:"The initial meshes do not overlap in Z projection"};
  if (snapshots[0].nutBottomMm > snapshots[0].boltTopMm + input.clearanceMm) return {...base,status:"FAIL" as const,reason:"The first pose is already axially separated"};
  if (coveredTurns + 1e-9 < input.minTurns) return {...base,status:"FAIL" as const,reason:"Sampled angle range is shorter than the required number of turns"};
  const exitIndex = snapshots.findIndex(p => p.nutBottomMm > p.boltTopMm + input.clearanceMm);
  if (exitIndex < 0) return {...base,status:"FAIL" as const,reason:"No sampled pose clears the measured bolt top"};
  const exitTurns=(snapshots[exitIndex].turnDeg-snapshots[0].turnDeg)/360;
  const priorTurns=(snapshots[exitIndex-1].turnDeg-snapshots[0].turnDeg)/360;
  const sampledExitIntervalTurns={lower:priorTurns,upper:exitTurns};
  if(snapshots.slice(0,exitIndex+1).some(p=>!p.projectedXYOverlap))return {...base,status:"FAIL" as const,reason:"XY projections separated before the axial exit"};
  if (input.minExitTurns !== undefined && exitTurns < input.minExitTurns) return {...base,status:"FAIL" as const,reason:"The sampled exit was earlier than the required turn range",exitTurns,sampledExitIntervalTurns};
  if (input.maxExitTurns !== undefined && priorTurns >= input.maxExitTurns) return {...base,status:"FAIL" as const,reason:"The sampled exit was later than the required turn range",exitTurns,sampledExitIntervalTurns};
  if ((input.minExitTurns !== undefined && priorTurns < input.minExitTurns) || (input.maxExitTurns !== undefined && exitTurns > input.maxExitTurns)) {
    return {...base,status:"NOT_RUN" as const,reason:"The sampled transition straddles a required exit turn boundary",exitTurns,sampledExitIntervalTurns};
  }
  const checked = snapshots.slice(0,exitIndex + 1);
  if (checked.some(p => p.collision === "INTERSECT" || p.collision === "CONTAINED")) return {...base,status:"FAIL" as const,reason:"A sampled pose before exit intersects"};
  if (checked.some(p => p.collision === "ERROR")) return {...base,status:"ERROR" as const,reason:"A collision check failed before exit"};
  if (checked.some(p => p.collision === "UNKNOWN")) return {...base,status:"NOT_RUN" as const,reason:"A collision check was undecided before exit"};
  return {...base,status:"PASS" as const,reason:"Nut bottom clears the measured bolt top; the listed poses cover the required turn range",exitIndex,exitTurns,sampledExitIntervalTurns,exitTurnDeg:snapshots[exitIndex].turnDeg};
}
