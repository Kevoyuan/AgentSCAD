import { expect, test } from "bun:test";
import setup from "../../../../scripts/eval/assembly-fixtures/threaded-fastener-exit.json";
import { sampleThreadedFastener } from "../thread-measurement";

test("invalid thread contracts and sampling plans never invoke the renderer", async () => {
  const cases: Array<{name: string; change: (config: any) => void; message: RegExp}> = [
    {name:"external pitch",change:c=>{c.geometry.external.pitchMm=Infinity;},message:/geometry contract/},
    {name:"internal hand",change:c=>{c.geometry.internal.hand="unknown";},message:/geometry contract/},
    {name:"diameter bounds",change:c=>{c.geometry.internal.minorDiameterMm.min=100;},message:/geometry contract/},
    {name:"axial window",change:c=>{c.geometry.external.threadRangeMm.max=c.geometry.external.threadRangeMm.min;},message:/geometry contract/},
    {name:"motion corner radius",change:c=>{c.motion.cornerRadiusMm=NaN;},message:/motion contract/},
    {name:"motion hand",change:c=>{c.motion.hand="unknown";},message:/motion contract/},
    {name:"decreasing angles",change:c=>{[c.turns[1],c.turns[2]]=[c.turns[2],c.turns[1]];},message:/strictly increase/},
    {name:"exit max step",change:c=>{c.exit.maxStepDeg=0;},message:/exit contract/},
    {name:"exit turn bound",change:c=>{c.exit.minExitTurns=2;c.exit.maxExitTurns=1;},message:/exit contract/},
    {name:"start angle mismatch",change:c=>{c.exit.startAngleDeg=10;},message:/start angle/},
    {name:"invalid start angle",change:c=>{c.exit.startAngleDeg=Infinity;},message:/exit contract/},
    {name:"invalid optional exit bound",change:c=>{c.exit.minExitTurns=Infinity;},message:/exit contract/},
    {name:"exit sampling gap",change:c=>{c.turns.splice(1,1);},message:/gap/},
  ];
  for (const item of cases) {
    const config=structuredClone(setup);
    item.change(config);
    let renders=0, artifacts=0;
    const render=async()=>{renders++;throw new Error("unexpected render");};
    await expect(sampleThreadedFastener({ ...config, scadSource:"cube(1);", render, onArtifacts:async()=>{artifacts++;} } as unknown as Parameters<typeof sampleThreadedFastener>[0]),item.name).rejects.toThrow(item.message);
    expect(renders,item.name).toBe(0);
    expect(artifacts,item.name).toBe(0);
  }
});

test("a valid frozen plan reaches the render adapter", async () => {
  let renders=0;
  const render=async()=>{renders++;throw new Error("render reached");};
  await expect(sampleThreadedFastener({...structuredClone(setup),scadSource:"cube(1);",render} as unknown as Parameters<typeof sampleThreadedFastener>[0])).rejects.toThrow("render reached");
  expect(renders).toBe(1);
});

test("a short but valid negative fixture still reaches rendering for an evidence verdict", async () => {
  let renders=0;
  const render=async()=>{renders++;throw new Error("render reached");};
  const short={...structuredClone(setup),turns:setup.turns.slice(0,3)};
  await expect(sampleThreadedFastener({...short,scadSource:"cube(1);",render} as unknown as Parameters<typeof sampleThreadedFastener>[0])).rejects.toThrow("render reached");
  expect(renders).toBe(1);
});
