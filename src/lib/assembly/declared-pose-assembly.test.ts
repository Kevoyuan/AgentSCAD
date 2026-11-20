import { expect, test } from "bun:test";
import { boxStl } from "../geometry/__tests__/solids";
import { translationMatrix } from "./path-and-motion";
import { checkDeclaredPoseAssembly } from "./declared-pose-assembly";

const mesh = boxStl([0, 0, 0], [1, 1, 1]);
function fixture() {
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [{ id: "shared", name: "Repeated block", selector: "shared", source: "generated", material: null }],
    instances: [
      { id: "base", partId: "shared", subassemblyId: null, transform: translationMatrix([0, 3, 0]) },
      { id: "a", partId: "shared", subassemblyId: null, transform: translationMatrix([0, 0, 0]) },
      { id: "b", partId: "shared", subassemblyId: null, transform: translationMatrix([0, 1.5, 0]) },
    ],
    groundedInstanceId: "base", subassemblies: [], connections: [], motions: [],
    manufacturing: null, assumptions: [], unknowns: [],
    // a must go in before b. Once b is installed it blocks a's straight path.
    operations: [
      { id: "insert_a", action: "assemble", instanceId: "a", tools: [], waypoints: [translationMatrix([0, 6, 0]), translationMatrix([0, 0, 0])] },
      { id: "insert_b", action: "assemble", instanceId: "b", tools: [], waypoints: [translationMatrix([0, 6, 0]), translationMatrix([0, 1.5, 0])] },
    ],
  };
}

// A separate grounded instance is required, but must not obstruct this test's
// assembly corridor. Its non-origin pose also exercises local mesh placement.
const clearFixture = () => { const spec = fixture(); spec.instances[0].transform = translationMatrix([3, 3, 0]); return spec; };

test("assembly checks only installed instances and preserves the declared insertion order", () => {
  const spec = clearFixture(), before = JSON.stringify(spec);
  const result = checkDeclaredPoseAssembly({ spec, meshes: { shared: mesh } });
  expect(result.status).toBe("PASS");
  expect(result.declaredOperationOrder).toEqual(["insert_a", "insert_b"]);
  expect("reversedEvaluation" in result && result.reversedEvaluation.results.map(row => row.operationId)).toEqual(["insert_b", "insert_a"]);
  expect(JSON.stringify(spec)).toBe(before);
  spec.operations.reverse();
  const wrong = checkDeclaredPoseAssembly({ spec, meshes: { shared: mesh } });
  expect(wrong.status).toBe("FAIL");
  expect("reversedEvaluation" in wrong && wrong.reversedEvaluation.results[0].path?.posesEvaluated).toBeGreaterThan(1);
});

test("a fixed obstacle between clear endpoints blocks insertion", () => {
  const result = checkDeclaredPoseAssembly({ spec: fixture(), meshes: { shared: mesh } });
  expect(result.status).toBe("FAIL");
});

test("an insertion must start outside the installed scene and reach its declared pose", () => {
  const spec = clearFixture();
  spec.operations[0].waypoints[1] = translationMatrix([0, 0.5, 0]);
  expect(checkDeclaredPoseAssembly({ spec, meshes: { shared: mesh } }).status).toBe("ERROR");
  const incomplete = clearFixture(); incomplete.operations.pop();
  expect(checkDeclaredPoseAssembly({ spec: incomplete, meshes: { shared: mesh } }).status).toBe("ERROR");
  const internal = clearFixture(); internal.operations[0].waypoints[0] = translationMatrix([3.25, 3.25, 0]);
  expect(checkDeclaredPoseAssembly({ spec: internal, meshes: { shared: mesh } }).status).toBe("FAIL");
});

test("disassembly statements, absent meshes and unsupported screw insertion cannot stand in for assembly", () => {
  const spec = clearFixture(); spec.operations = [];
  expect(checkDeclaredPoseAssembly({ spec, meshes: { shared: mesh } }).status).toBe("NOT_RUN");
  expect(checkDeclaredPoseAssembly({ spec: clearFixture(), meshes: {} }).status).toBe("NOT_RUN");
  const screw = clearFixture();
  const operations = screw.operations.map(operation => ({ ...operation, waypoints: [], screwTrajectory: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, hand: "right", leadMm: 1, startAngleDeg: 0, endAngleDeg: 360 } }));
  expect(checkDeclaredPoseAssembly({ spec: { ...screw, operations }, meshes: { shared: mesh } }).status).toBe("NOT_RUN");
});

test("invalid and exhausted evaluation budgets cannot yield assembly PASS", () => {
  expect(checkDeclaredPoseAssembly({ spec: clearFixture(), meshes: { shared: mesh }, budgetMs: 0 }).status).toBe("ERROR");
  expect(checkDeclaredPoseAssembly({ spec: clearFixture(), meshes: { shared: mesh }, budgetMs: 1e-6 }).status).toBe("NOT_RUN");
});
