import { describe, expect, test } from "bun:test";
import { extractEmbeddedAssemblySpec } from "./embedded-spec";

const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const spec = { schemaVersion: 1, units: "mm", coordinateSystem: "right-handed", parts: [
  { id: "body", name: "Body", selector: "body", source: "generated", material: null },
], instances: [{ id: "body1", partId: "body", subassemblyId: null, transform: identity }],
subassemblies: [], connections: [], groundedInstanceId: "body1", motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [] };
const block = (json: string) => `/* AGENTSCAD_ASSEMBLY_V1\n${json}\nEND_AGENTSCAD_ASSEMBLY */`;

describe("untrusted embedded assembly contract", () => {
  test("retains a validated declaration, without making geometry claims", () => {
    const parsed = extractEmbeddedAssemblySpec(`${block(JSON.stringify(spec))}\ncube(1);`);
    expect(parsed.status).toBe("valid");
    if (parsed.status === "valid") expect(JSON.stringify(parsed.spec)).toBe(JSON.stringify(spec));
    expect(extractEmbeddedAssemblySpec("cube(1);")).toEqual({ status: "absent" });
    expect(extractEmbeddedAssemblySpec(`// ${block(JSON.stringify(spec))}\ncube(1);`).status).toBe("absent");
    expect(extractEmbeddedAssemblySpec(`echo(${JSON.stringify(block(JSON.stringify(spec)))});`).status).toBe("absent");
  });
  test("rejects truncated, duplicated, invalid and contradictory input", () => {
    for (const source of ["/* AGENTSCAD_ASSEMBLY_V1 {", block("{"), block(JSON.stringify(spec)) + block(JSON.stringify(spec)), block(JSON.stringify({ ...spec, groundedInstanceId: "missing" }))]) {
      expect(extractEmbeddedAssemblySpec(source).status).toBe("invalid");
    }
  });
});
