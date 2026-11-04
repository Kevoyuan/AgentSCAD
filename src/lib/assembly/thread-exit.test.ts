import { expect,test } from "bun:test";
import { boxStl } from "../geometry/__tests__/solids";
import { checkThreadExit } from "./thread-exit";
const bolt=boxStl([-1,-1,0],[1,1,18]);
const make=(turns:number)=>Array.from({length:turns*4+1},(_,i)=>({turnDeg:i*90,bolt,nut:boxStl([-2,-2,0.6+i*0.375],[2,2,6.6+i*0.375]),collision:"SEPARATED" as const}));
const contract={minTurns:12,maxStepDeg:90,clearanceMm:0.1,minExitTurns:11.5,maxExitTurns:12};
test("exit requires actual separated meshes over the full angle range",()=>{
  const result=checkThreadExit({...contract,poses:make(12)});
  expect(result.status).toBe("PASS");
  expect("exitTurnDeg" in result && result.exitTurnDeg).toBe(4230);
  expect(checkThreadExit({...contract,poses:make(2)}).status).toBe("FAIL");
});
test("collision and unavailable evidence cannot pass",()=>{
  const intersect=make(12);intersect[2].collision="INTERSECT" as never;
  expect(checkThreadExit({...contract,poses:intersect}).status).toBe("FAIL");
  const unknown=make(12);unknown[3].collision="UNKNOWN" as never;
  expect(checkThreadExit({...contract,poses:unknown}).status).toBe("NOT_RUN");
  const error=make(12);error[3].collision="ERROR" as never;
  expect(checkThreadExit({...contract,poses:error}).status).toBe("ERROR");
});
test("cannot skip angles or start already beyond the bolt",()=>{
  expect(()=>checkThreadExit({...contract,poses:make(12).filter((_,i)=>i!==2)})).toThrow();
  const invalid=make(12);invalid[3].collision="invalid" as never;
  expect(()=>checkThreadExit({...contract,poses:invalid})).toThrow();
  const poses=make(12);poses[0].nut=boxStl([-2,-2,19],[2,2,25]);
  expect(checkThreadExit({...contract,poses}).status).toBe("FAIL");
});

test("early axial separation and unrelated XY parts are rejected",()=>{
  const early=make(12);
  early.forEach((p,i)=>{p.nut=boxStl([-2,-2,17.9+i*0.4],[2,2,23.9+i*0.4]);});
  const result=checkThreadExit({...contract,poses:early});
  expect(result.status).toBe("FAIL");
  expect(result.reason).toContain("turn range");
  const unrelated=make(12);
  unrelated.forEach((p,i)=>{p.nut=boxStl([100,100,0.6+i*0.375],[104,104,6.6+i*0.375]);});
  expect(checkThreadExit({...contract,poses:unrelated}).status).toBe("FAIL");
});

test("initial Z separation and a later sideways departure are rejected",()=>{
  const initial=make(12);initial[0].nut=boxStl([-2,-2,-12],[2,2,-6]);
  expect(checkThreadExit({...contract,poses:initial}).status).toBe("FAIL");
  const drifting=make(12);drifting[4].nut=boxStl([100,100,2],[104,104,8]);
  expect(checkThreadExit({...contract,poses:drifting}).status).toBe("FAIL");
  expect(()=>checkThreadExit({...contract,startAngleDeg:5,poses:make(12)})).toThrow("Initial angle");
});
test("a sampled exit interval crossing the minimum is uncertain",()=>{
  const result=checkThreadExit({...contract,minExitTurns:11.6,poses:make(12)});
  expect(result.status).toBe("NOT_RUN");
});

test("a sampled transition crossing the maximum is uncertain, not a definite failure",()=>{
  expect(checkThreadExit({...contract,maxExitTurns:11.6,poses:make(12)}).status).toBe("NOT_RUN");
  expect(checkThreadExit({...contract,maxExitTurns:11.5,poses:make(12)}).status).toBe("FAIL");
});
