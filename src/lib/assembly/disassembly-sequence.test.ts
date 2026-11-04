import { expect, test } from "bun:test";
import { checkDisassemblySequence, type DisassemblySequence } from "./disassembly-sequence";
import { boxStl } from "../geometry/__tests__/solids";

const meshes = {
  base: boxStl([-2, -2, -2], [-1, 2, 2]),
  inside: boxStl([0, 0, 0], [1, 1, 1]),
  lid: boxStl([2, -1, -1], [3, 2, 2]),
};
const step = (instanceId: string) => ({ instanceId, translationMm: [6, 0, 0] as [number, number, number], samples: 25 });
const plan: DisassemblySequence = { groundedInstanceId: "base", steps: [step("lid"), step("inside")] };

test("removal order changes which obstacles remain", () => {
  const good = checkDisassemblySequence({ meshes, plan });
  expect(good.status).toBe("PASS");
  expect(good.results[1].against).toEqual(["base"]);
  expect(good.remainingInstanceIds).toEqual(["base"]);
  expect(good.artifactSha256.inside).toHaveLength(64);
  const bad = checkDisassemblySequence({ meshes, plan: { ...plan, steps: [...plan.steps].reverse() } });
  expect(bad.status).toBe("FAIL");
  expect(bad.results[0].blockedAt?.otherInstanceId).toBe("lid");
  expect(bad.results[1].status).toBe("NOT_RUN");
  expect(bad.remainingInstanceIds).toHaveLength(3);
});

test("a tiny clear displacement is not complete removal", () => {
  const enclosing = { ...meshes, base: boxStl([-2, -2, -2], [4, -1.5, 2]) };
  const short = checkDisassemblySequence({ meshes: enclosing, plan: { ...plan, steps: [{ ...step("lid"), translationMm: [0.1, 0, 0] }, step("inside")] } });
  expect(short.status).toBe("FAIL");
  expect(short.results[0].reason).toContain("Terminal pose");
});

test("missing, duplicate, nonfinite and zero-sample plans cannot pass", () => {
  for (const steps of [[], [step("lid")], [step("lid"), step("lid")], [step("lid"), { ...step("inside"), samples: NaN }], [step("lid"), { ...step("inside"), samples: 0 }]]) {
    expect(() => checkDisassemblySequence({ meshes, plan: { ...plan, steps } })).toThrow();
  }
});
