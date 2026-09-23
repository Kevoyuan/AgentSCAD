import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "fs/promises";
import path from "path";

import manifest from "../../skills/manifest.json";

const skillsRoot = path.join(process.cwd(), "skills");
const modelStageSkills = [
  "scad-intake",
  "scad-planning",
  "scad-coding",
  "scad-generation",
  "scad-repair",
  "scad-visual-validate",
  "scad-chat",
];

describe("skill registry", () => {
  test("lists every skill exactly once and points to matching frontmatter", async () => {
    const declared = manifest.skills.map((skill) => skill.name);
    expect(new Set(declared).size).toBe(declared.length);

    const dirs = await readdir(skillsRoot, { withFileTypes: true });
    const onDisk = await Promise.all(dirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          await readFile(path.join(skillsRoot, entry.name, "SKILL.md"), "utf8");
          return entry.name;
        } catch {
          return null;
        }
      }));
    expect([...declared].sort()).toEqual(onDisk.filter((name): name is string => name !== null).sort());

    for (const skill of manifest.skills) {
      expect(skill.path).toBe(`${skill.name}/SKILL.md`);
      const source = await readFile(path.join(skillsRoot, skill.path), "utf8");
      expect(source).toMatch(new RegExp(`^---\\r?\\nname: ${skill.name}\\r?\\n`));
      expect(source).toMatch(/^description: .+/m);
    }
  });

  test("model-stage skills declare use, exclusion, input, and version boundaries", async () => {
    for (const name of modelStageSkills) {
      const source = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
      const frontmatter = source.split(/^---\s*$/m)[1];
      expect(frontmatter).toMatch(/^version: 1$/m);
      expect(frontmatter).toMatch(/^when_to_use: .+/m);
      expect(frontmatter).toMatch(/^when_not_to_use: .+/m);
      expect(frontmatter).toMatch(/^required_inputs: \[.+\]$/m);
    }
  });
});
