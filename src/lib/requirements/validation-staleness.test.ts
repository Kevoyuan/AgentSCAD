import { expect, test } from "bun:test";
import { staleAssemblyValidation } from "./validation-staleness";

test("a changed contract masks the previous A001 verdict and retains its evidence", () => {
  const hash = "a".repeat(64);
  const old = [{ rule_id: "A001", status: "FAIL", passed: false, message: "collision at 20°", assemblyEvidence: { sourceSha256: "old" } },
    { rule_id: "C001", status: "PASS", passed: true, message: "compiled" }];
  const first = JSON.parse(staleAssemblyValidation(JSON.stringify(old), hash)!);
  expect(first[0].status).toBe("NOT_RUN");
  expect(first[0].passed).toBe(false);
  expect(first[0].staleAssemblyValidation).toMatchObject({ status: "FAIL", message: "collision at 20°" });
  expect(first[0].assemblyEvidence).toEqual(old[0].assemblyEvidence);
  expect(first[1]).toEqual(old[1]);
  const second = JSON.parse(staleAssemblyValidation(JSON.stringify(first), "b".repeat(64))!);
  expect(second[0].staleAssemblyValidation.message).toBe("collision at 20°");
  expect(staleAssemblyValidation("not json", hash)).toBeNull();
  expect(staleAssemblyValidation(JSON.stringify([old[1]]), hash)).toBeNull();
});
