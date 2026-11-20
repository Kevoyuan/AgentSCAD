import { test, expect } from "bun:test";
import { boxStl } from "../geometry/__tests__/solids";
import { checkTranslationProbe } from "./translation-probe";
import { rotationAboutAxis, translationMatrix, multiplyMatrices } from "./path-and-motion";
const moving=boxStl([0,0,0],[1,1,1]);
const obstacles={wall:boxStl([2,-1,-1],[3,2,2])};
test("blocking constraint requires a clear assembled pose and a later collision",()=>{
  const probe={moving,obstacles,translationMm:[4,0,0] as [number,number,number],samples:17};
  expect(checkTranslationProbe({...probe,expected:"blocked"}).status).toBe("PASS");
  expect(checkTranslationProbe({...probe,expected:"clear"}).status).toBe("FAIL");
  expect(checkTranslationProbe({...probe,obstacles:{bad:moving},expected:"blocked"}).status).toBe("FAIL");
});
test("a free direction cannot masquerade as retention",()=>{
  const probe={moving,obstacles,translationMm:[0,4,0] as [number,number,number],samples:17};
  expect(checkTranslationProbe({...probe,expected:"blocked"}).status).toBe("FAIL");
  expect(checkTranslationProbe({...probe,expected:"clear"}).status).toBe("PASS");
});
test("invalid and vacuous probes are refused",()=>{
  expect(()=>checkTranslationProbe({moving,obstacles:{},translationMm:[1,0,0],samples:4,expected:"clear"})).toThrow();
  expect(()=>checkTranslationProbe({moving,obstacles,translationMm:[1,0,0],samples:NaN,expected:"clear"})).toThrow();
});

test("retention carried by a moving body must collide with the fixed support",()=>{
  const body=boxStl([0,0,0],[1,1,1]);
  const key=boxStl([0,2,0],[1,3,1]);
  const support={stop:boxStl([2,2,0],[3,3,1])};
  const input={moving:body,obstacles:support,translationMm:[4,0,0] as [number,number,number],samples:17,expected:"blocked" as const};
  expect(checkTranslationProbe(input).status).toBe("FAIL");
  const carried=checkTranslationProbe({...input,companions:{key}});
  expect(carried.status).toBe("PASS");
  expect("blockedAt" in carried && carried.blockedAt.movingId).toBe("key");
});

test("placed meshes are probed along world displacement, not the rotated local axis", () => {
  const pose = multiplyMatrices(translationMatrix([10,4,0]), rotationAboutAxis([0,0,0],[0,0,1], Math.PI/2));
  const input = { moving, obstacles, movingTransform: pose, obstacleTransforms: { wall: pose }, samples: 17, expected: "blocked" as const };
  const blocked = checkTranslationProbe({ ...input, translationMm: [0,4,0] });
  expect(blocked.status).toBe("PASS");
  expect([...blocked.movingTransform]).toEqual(pose);
  expect([...blocked.obstacleTransforms.wall]).toEqual(pose);
  expect(checkTranslationProbe({ ...input, translationMm: [4,0,0] }).status).toBe("FAIL");
  expect(checkTranslationProbe({ ...input, obstacleTransforms: {}, translationMm: [0,4,0] }).status).toBe("FAIL");
});

test("invalid placements cannot produce retained evidence", () => {
  const input = { moving, obstacles, translationMm: [4,0,0] as [number,number,number], samples: 17, expected: "blocked" as const };
  expect(() => checkTranslationProbe({ ...input, movingTransform: [1,2] })).toThrow();
  const scaled = translationMatrix([0,0,0]); scaled[0] = 2;
  expect(() => checkTranslationProbe({ ...input, obstacleTransforms: { wall: scaled } })).toThrow();
  expect(() => checkTranslationProbe({ ...input, obstacleTransforms: { missing: translationMatrix([0,0,0]) } })).toThrow();
});
