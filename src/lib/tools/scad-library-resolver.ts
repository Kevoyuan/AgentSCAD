import fs from "fs/promises";
import path from "path";
import { usesOpenScadWasm } from "@/lib/tools/openscad-backend";

export interface ScadLibraryInfo {
  name: string;
  includeExample: string;
  available: boolean;
  searchPaths: string[];
  skillName: string;
  guidance: string | null;
  license: string;
  licenseGate: string;
}

interface ScadLibraryManifest {
  managed_library_dir_env: string;
  legacy_managed_library_dir_env?: string;
  default_managed_library_dir: string;
  libraries: ScadLibraryManifestEntry[];
}

interface ScadLibraryManifestEntry {
  name: string;
  license: string;
  license_gate: string;
  skill_name: string;
  detection_files: string[];
  include_examples: string[];
}

function splitConfiguredPaths(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,:]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultOpenScadLibraryPaths(): string[] {
  if (usesOpenScadWasm()) return [];
  const home = process.env.HOME;
  return [
    ...(process.env.AGENTSCAD_OPENSCAD_LIBRARY_DIR ? [process.env.AGENTSCAD_OPENSCAD_LIBRARY_DIR] : []),
    ...(process.env.CADCAD_OPENSCAD_LIBRARY_DIR ? [process.env.CADCAD_OPENSCAD_LIBRARY_DIR] : []),
    ...(home ? [path.join(home, ".agentscad", "openscad-libraries")] : []),
    ...(home ? [path.join(home, ".cadcad", "openscad-libraries")] : []),
    ...splitConfiguredPaths(process.env.OPENSCAD_LIBRARY_PATHS),
    ...splitConfiguredPaths(process.env.OPENSCADPATH),
    ...(home ? [path.join(home, "Documents", "OpenSCAD", "libraries")] : []),
    "/Applications/OpenSCAD-2021.01.app/Contents/Resources/libraries",
    "/Applications/OpenSCAD.app/Contents/Resources/libraries",
  ];
}

function scadLibraryManifestPath(): string {
  return path.join(process.cwd(), "skills", "scad-library-policy", "manifest.json");
}

async function loadScadLibraryManifest(): Promise<ScadLibraryManifest | null> {
  try {
    const raw = await fs.readFile(scadLibraryManifestPath(), "utf8");
    return JSON.parse(raw) as ScadLibraryManifest;
  } catch {
    return null;
  }
}

function uniqueExistingParentPaths(paths: string[]) {
  return Array.from(new Set(paths.map((item) => path.resolve(item))));
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readLibraryGuidance(skillName: string): Promise<string | null> {
  try {
    const filePath = path.join(process.cwd(), "skills", skillName, "SKILL.md");
    const content = await fs.readFile(filePath, "utf8");
    return content
      .replace(/^---[\s\S]*?---\s*/, "")
      .trim();
  } catch {
    return null;
  }
}

export async function resolveOpenScadLibraryPaths(): Promise<string[]> {
  const candidates = uniqueExistingParentPaths(defaultOpenScadLibraryPaths());
  const existing = await Promise.all(
    candidates.map(async (candidate) => ((await pathExists(candidate)) ? candidate : null))
  );
  return existing.filter((item): item is string => Boolean(item));
}

export async function getAvailableScadLibraries(): Promise<ScadLibraryInfo[]> {
  const manifest = await loadScadLibraryManifest();
  const libraries = manifest?.libraries ?? [];
  const searchPaths = await resolveOpenScadLibraryPaths();
  return Promise.all(
    libraries.map(async (library) => {
      const match = await Promise.any(
        library.detection_files.flatMap((candidateFile, index) =>
          searchPaths.map(async (searchPath) => {
            const available = await pathExists(path.join(searchPath, candidateFile));
            return available
              ? { file: candidateFile, includeExample: library.include_examples[index] ?? library.include_examples[0] }
              : Promise.reject(new Error("library not found"));
          })
        )
      ).catch(() => null);

      return {
        name: library.name,
        skillName: library.skill_name,
        includeExample: match?.includeExample ?? library.include_examples[0],
        available: Boolean(match),
        searchPaths,
        guidance: match ? await readLibraryGuidance(library.skill_name) : null,
        license: library.license,
        licenseGate: library.license_gate,
      };
    })
  );
}

export async function buildScadLibraryPrompt(): Promise<string> {
  const libraries = await getAvailableScadLibraries();
  const available = libraries.filter((library) => library.available);

  if (available.length === 0) {
    return [
      "## Runtime OpenSCAD Libraries",
      "",
      "No optional OpenSCAD libraries are currently available in the renderer search path.",
      "Generate portable OpenSCAD using built-in primitives only.",
      "Do not include BOSL, BOSL2, MCAD, or other libraries unless they are listed here as available.",
      ...(usesOpenScadWasm()
        ? [
            "The serverless OpenSCAD WASM renderer supports agentscad_std.scad, which is inlined by the runtime.",
            "Do not use text(), surface(), import(), or other features that require external files or fonts.",
          ]
        : []),
    ].join("\n");
  }

  return [
    "## Runtime OpenSCAD Libraries",
    "",
    "The renderer can resolve these optional OpenSCAD libraries:",
    ...available.map((library) => `- ${library.name}: ${library.includeExample} (${library.license})`),
    "",
    "Prefer these libraries when they improve general CAD quality, but keep the model exportable and parameterized.",
    "Do not copy library source code into the generated SCAD.",
    "",
    "## Available Library Skills",
    ...available.flatMap((library) => [
      "",
      `### ${library.name}`,
      library.guidance ?? `Use ${library.name} only via ${library.includeExample}. Keep editable parameters top-level.`,
    ]),
  ].join("\n");
}

export async function buildOpenScadExecEnv(): Promise<NodeJS.ProcessEnv> {
  const paths = await resolveOpenScadLibraryPaths();
  const existing = splitConfiguredPaths(process.env.OPENSCADPATH);
  const nextOpenScadPath = Array.from(new Set([...paths, ...existing])).join(path.delimiter);

  return {
    ...process.env,
    ...(nextOpenScadPath ? { OPENSCADPATH: nextOpenScadPath } : {}),
  };
}
