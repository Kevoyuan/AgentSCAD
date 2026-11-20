import { describe, expect, test } from "bun:test";
import { sanitizeGeneratedScadSource, stripProtocolMarkup } from "./scad-sanitizer";

describe("provider protocol markup in generated SCAD", () => {
  test("strips leaked tool-call tags outside comments and strings", () => {
    const source = "cube(1);\n</｜｜DSML｜｜parameter>\nsphere(2);\n<｜｜DSML｜｜tool_calls>";
    expect(stripProtocolMarkup(source)).toBe("cube(1);\n\nsphere(2);\n");
    expect(sanitizeGeneratedScadSource(source)).toBe("cube(1);\n\nsphere(2);\n");
  });

  test("keeps protocol-looking text inside comments and strings", () => {
    const source = '// </｜｜DSML｜｜parameter>\ncube(1);\nmsg = "</｜｜DSML｜｜parameter>";';
    expect(stripProtocolMarkup(source)).toBe(source);
  });

  test("still renames a reserved module variable", () => {
    expect(sanitizeGeneratedScadSource("module = 3; cube(module);").trim()).toBe("tooth_module = 3; cube(tooth_module);");
  });

  test("does not turn a non-tag angle bracket run into a deletion", () => {
    const source = "a = 1 < 2 ? 3 : 4; cube(a);";
    expect(stripProtocolMarkup(source)).toBe(source);
  });
});
