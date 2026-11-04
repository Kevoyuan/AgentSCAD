import { multiplyMatrices, rotationAboutAxis, translationMatrix } from "../../../src/lib/assembly/path-and-motion";

/** Frozen experiment trajectories; independent of the SCAD's construction. */
export function quarterTurnPath(unlockDegrees: number, liftMm = 0) {
  if (![unlockDegrees,liftMm].every(Number.isFinite) || liftMm < 0 || liftMm > 2 || Math.abs(unlockDegrees)>180) throw new Error("Invalid fixture path");
  const rotations = Math.max(1, Math.ceil(Math.abs(unlockDegrees) / 5));
  const poses: number[][] = [];
  const lifts=Math.ceil(liftMm/0.1);
  for(let i=0;i<lifts;i++) poses.push(translationMatrix([0,0,liftMm*i/lifts]));
  for (let i=0;i<=rotations;i++) poses.push(multiplyMatrices(translationMatrix([0,0,liftMm]),rotationAboutAxis([0,0,0],[0,0,1],unlockDegrees*i/rotations*Math.PI/180)));
  const unlocked=poses[poses.length-1];
  const slides=Math.ceil((12+liftMm)/0.15);
  for (let i=1;i<=slides;i++) poses.push(multiplyMatrices(translationMatrix([0,0,-(12+liftMm)*i/slides]),unlocked));
  return poses;
}
