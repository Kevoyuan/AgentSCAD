import { describe, expect, test } from "bun:test";
import { extractDeclarationComment, spliceDeclarationComment } from "./declaration-repair";

const comment = `/* AGENTSCAD_ASSEMBLY_V1
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed","parts":[],"instances":[],"subassemblies":[],"connections":[],"groundedInstanceId":null,"motions":[],"operations":[],"manufacturing":null,"assumptions":[],"unknowns":[]}
END_AGENTSCAD_ASSEMBLY */`;

describe("declaration-only repair stage", () => {
  test("extracts the comment from prose or a fenced response", () => {
    expect(extractDeclarationComment(`Here is the declaration:\n${comment}\nDone.`)).toBe(comment);
    expect(extractDeclarationComment(`\`\`\`scad\n${comment}\n\`\`\``)).toBe(comment);
  });

  test("replaces an existing declaration and keeps geometry bytes around it", () => {
    const source = `// header\n/* old */\ncube(1);\n${comment}\nsphere(2);`;
    const replaced = spliceDeclarationComment(source, comment.replace('"parts":[]', '"parts":[{"id":"x"}]'));
    expect(replaced).toContain('"parts":[{"id":"x"}]');
    expect(replaced).toContain("cube(1);");
    expect(replaced).toContain("sphere(2);");
    expect(replaced.match(/AGENTSCAD_ASSEMBLY_V1/g)).toHaveLength(1);
  });

  test("prepends a declaration when the source has none", () => {
    const result = spliceDeclarationComment("cube(1);", comment);
    expect(result.startsWith(comment)).toBe(true);
    expect(result.endsWith("cube(1);")).toBe(true);
  });

  test("refuses an incomplete comment", () => {
    expect(() => spliceDeclarationComment("cube(1);", "/* AGENTSCAD_ASSEMBLY_V1 {")).toThrow();
    expect(extractDeclarationComment("no declaration here")).toBeNull();
  });
});
