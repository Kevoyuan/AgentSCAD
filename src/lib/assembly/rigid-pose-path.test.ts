import { expect, test } from "bun:test";
import { boxStl, mergeStl, tubeStl } from "../geometry/__tests__/solids";
import { checkRigidPosePath } from "./rigid-pose-path";
import { translationMatrix, rotationAboutAxis } from "./path-and-motion";
const base={moving:boxStl([0,0,0],[1,1,1]),obstacles:{wall:boxStl([2,-1,-1],[3,2,2])},maxTranslationStepMm:0.5,maxRotationStepDeg:5};
test("an intermediate collision blocks a path with a clear endpoint",()=>{
  const result=checkRigidPosePath({...base,poses:Array.from({length:9},(_,i)=>translationMatrix([i/2,0,0]))});
  expect(result.status).toBe("FAIL");
  expect("blockedAt" in result && result.blockedAt.poseIndex).toBeGreaterThan(0);
  expect(result.testedTrianglePairs).toBeGreaterThan(0);
  if (!("blockedAt" in result)) throw new Error("Expected an actual collision witness");
  expect(result.blockedAt.obstacleId).toBe("wall");
  expect(result.blockedAt.collision).toBe("INTERSECT");
  expect(result.blockedAt.testedPairs).toBeGreaterThan(0);
  expect(result.blockedAt.trianglePair?.movingTriangleIndex).toBeGreaterThanOrEqual(0);
  expect(result.blockedAt.trianglePair?.obstacleTriangleIndex).toBeGreaterThanOrEqual(0);
  expect(result.blockedAt.witnessCentroidPointMm?.length).toBe(3);
  expect(result.blockedAt.witnessCentroidPointMm?.every(Number.isFinite)).toBe(true);
});
test("a conservative UNKNOWN identifies the exact obstacle and pose instead of reporting clearance", () => {
  const moving = mergeStl(
    tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 4, segments: 48 }),
    boxStl([4, -1, 0], [10, 1, 4]),
  );
  const fixed = mergeStl(
    tubeStl({ outerRadius: 3, innerRadius: 2.5, height: 4, segments: 48 }),
    boxStl([-10, -1, 0], [-8, 1, 4]),
  );
  const result = checkRigidPosePath({
    moving, obstacles: { fixed },
    poses: [translationMatrix([0, 0, 0]), translationMatrix([0, 0, 0.1])],
    maxTranslationStepMm: 0.25, maxRotationStepDeg: 5,
  });
  expect(result.status).toBe("NOT_RUN");
  expect("undecidedAt" in result).toBe(true);
  if (!("undecidedAt" in result)) throw new Error("Expected the inconclusive obstacle witness");
  expect(result.undecidedAt.obstacleId).toBe("fixed");
  expect(result.undecidedAt.poseIndex).toBe(0);
  expect(result.undecidedAt.collision).toBe("UNKNOWN");
  expect(result.undecidedAt.reason).toBeTruthy();
  expect(result.testedTrianglePairs).toBeGreaterThanOrEqual(0);
});

test("skipped samples, static paths and nonrigid poses cannot pass",()=>{
  const identity=translationMatrix([0,0,0]);
  expect(()=>checkRigidPosePath({...base,poses:[identity,translationMatrix([4,0,0])]})).toThrow("gap");
  expect(()=>checkRigidPosePath({...base,poses:[identity,identity]})).toThrow("static");
  for(let angle=1;angle<90;angle++) {
    const rotated=rotationAboutAxis([0,0,0],[0,0,1],angle*Math.PI/180);
    expect(()=>checkRigidPosePath({...base,poses:[rotated,[...rotated]]})).toThrow("static");
  }
  const scaled=[...identity];scaled[0]=2;
  expect(()=>checkRigidPosePath({...base,poses:[identity,scaled]})).toThrow("rigid");
  expect(()=>checkRigidPosePath({...base,poses:[identity],maxTranslationStepMm:NaN})).toThrow();
});
test("a clear outward path and its reverse preserve actual cumulative poses",()=>{
  const poses=Array.from({length:9},(_,i)=>translationMatrix([0,i/2,0]));
  const outward=checkRigidPosePath({...base,poses,requireSeparatedEnd:true});
  expect(outward.status).toBe("PASS");
  expect(outward.posesSha256).toHaveLength(64);
  expect(checkRigidPosePath({...base,poses:[...poses].reverse()}).status).toBe("PASS");
});

test("a final collision check that finishes after the deadline cannot return PASS",()=>{
  const original=performance.now;
  let calls=0;
  Object.defineProperty(performance,"now",{configurable:true,value:()=>++calls<=4?0:100});
  try {
    const result=checkRigidPosePath({...base,poses:[translationMatrix([0,0,0]),translationMatrix([0,0.1,0])],budgetMs:1});
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("budget");
    expect(result.posesEvaluated).toBe(2);
  } finally {Object.defineProperty(performance,"now",{configurable:true,value:original});}
});
