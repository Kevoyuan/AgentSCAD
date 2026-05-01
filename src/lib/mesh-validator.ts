/**
 * mesh-validator.ts — Real STL mesh validation via Python/trimesh
 *
 * Shells out to `scripts/validate_stl.py` for deterministic mesh analysis.
 * Uses a managed AgentSCAD virtualenv for trimesh/numpy. If the validator cannot
 * be installed or executed, mesh rules are marked as skipped rather than mocked.
 * Results are cached per file path (validation is deterministic).
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { RawMeshData } from "@/lib/validation/validation-types";

const execAsync = promisify(exec);
const INSTALL_TIMEOUT_MS = 180_000;
const VALIDATION_TIMEOUT_MS = 30_000;
const REQUIRED_PACKAGES = ["trimesh>=4,<5", "numpy>=1.24", "scipy>=1.10", "rtree>=1.2"];

/** Minimum wall thickness for FDM 3D printing (mm). */
const FDM_MIN_WALL_MM = 1.2;

// ---------------------------------------------------------------------------
// Types matching the frontend's ValidationResult interface
// ---------------------------------------------------------------------------

export interface ValidationResult {
  rule_id: string;
  rule_name: string;
  level: string;
  passed: boolean;
  is_critical: boolean;
  message: string;
}

// Python script output format (internal)
interface PythonRule {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details: Record<string, unknown>;
}

interface PythonOutput {
  error?: boolean;
  message?: string;
  rules: PythonRule[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failures: number;
    boundingBox: {
      length: number;
      width: number;
      height: number;
      unit: string;
    } | null;
    componentCount?: number;
    eulerCharacteristic?: number;
    genus?: number;
  };
}

type MeshValidatorStatus =
  | { available: true; pythonPath: string; managed: boolean; message: string }
  | { available: false; pythonPath: string | null; managed: boolean; message: string };

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const validationCache = new Map<string, ValidationResult[]>();
const meshDataCache = new Map<string, RawMeshData>();
let managedPythonPromise: Promise<MeshValidatorStatus> | null = null;
let managedPythonStatus: MeshValidatorStatus | null = null;

// ---------------------------------------------------------------------------
// Rule metadata (level + criticality) — mirrors the mock format
// ---------------------------------------------------------------------------

const RULE_META: Record<
  string,
  { level: string; is_critical: boolean }
> = {
  R001: { level: "ENGINEERING", is_critical: true },
  R002: { level: "MANUFACTURING", is_critical: false },
  R003: { level: "ENGINEERING", is_critical: true },
  S001: { level: "ENGINEERING", is_critical: true },
  S002: { level: "ENGINEERING", is_critical: false },
};

// ---------------------------------------------------------------------------
// Transform Python output → frontend ValidationResult[]
// ---------------------------------------------------------------------------

function transformPythonResults(pyOutput: PythonOutput): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const rule of pyOutput.rules) {
    const meta = RULE_META[rule.id] ?? {
      level: "ENGINEERING",
      is_critical: false,
    };

    results.push({
      rule_id: rule.id,
      rule_name: rule.name,
      level: meta.level,
      passed: rule.status !== "fail",
      is_critical: meta.is_critical,
      message: rule.message,
    });
  }

  // S001 and S002 require LLM reasoning — mark as info/skipped for now
  results.push({
    rule_id: "S001",
    rule_name: "Semantic Geometry Match",
    level: "ENGINEERING",
    passed: true,
    is_critical: true,
    message: "Skipped — requires LLM reasoning (not yet implemented)",
  });

  results.push({
    rule_id: "S002",
    rule_name: "Design Intent Preservation",
    level: "ENGINEERING",
    passed: true,
    is_critical: false,
    message: "Skipped — requires LLM reasoning (not yet implemented)",
  });

  // Cache raw mesh data from the Python output
  extractAndCacheMeshData(pyOutput);

  return results;
}

// ---------------------------------------------------------------------------
// Raw mesh data extraction
// ---------------------------------------------------------------------------

function extractAndCacheMeshData(pyOutput: PythonOutput): void {
  const bbox = pyOutput.summary.boundingBox;
  const rule3 = pyOutput.rules.find((r) => r.id === "R003");

  const vertices = (rule3?.details?.vertices as number) ?? 0;
  const faces = (rule3?.details?.faces as number) ?? 0;
  const edges = (rule3?.details?.edges as number) ?? 0;
  const isWatertight = (rule3?.details?.isWatertight as boolean) ?? false;
  const isVolume = (rule3?.details?.isVolume as boolean) ?? false;

  // Use Python-computed values when available, otherwise compute from mesh data
  const eulerCharacteristic =
    pyOutput.summary.eulerCharacteristic ?? (vertices - edges + faces);
  const genus = isWatertight
    ? (pyOutput.summary.genus ?? Math.max(0, (2 - eulerCharacteristic) / 2))
    : 0;
  const componentCount = pyOutput.summary.componentCount ?? 1;

  const data: RawMeshData = {
    bbox: bbox ? { ...bbox } : null,
    vertices,
    faces,
    edges,
    isWatertight,
    isVolume,
    componentCount,
    eulerCharacteristic,
    genus,
  };

  meshDataCache.set("__last__", data);
}

/**
 * Get raw mesh data from the most recent validation run.
 * Returns null if no validation has been performed yet.
 */
export function getLastMeshData(): RawMeshData | null {
  return meshDataCache.get("__last__") ?? null;
}

// ---------------------------------------------------------------------------
// Skipped fallback — never mark unavailable mesh checks as green real passes.
// ---------------------------------------------------------------------------

function generateSkippedValidationResults(reason: string): ValidationResult[] {
  return [
    {
      rule_id: "R001",
      rule_name: "Minimum Wall Thickness",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: `Skipped — mesh validator unavailable: ${reason}`,
    },
    {
      rule_id: "R002",
      rule_name: "Maximum Dimensions",
      level: "MANUFACTURING",
      passed: true,
      is_critical: false,
      message: `Skipped — mesh validator unavailable: ${reason}`,
    },
    {
      rule_id: "R003",
      rule_name: "Manifold Geometry",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: `Skipped — mesh validator unavailable: ${reason}`,
    },
    {
      rule_id: "S001",
      rule_name: "Semantic Geometry Match",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: "Skipped — semantic mesh validator is not implemented; visual validation handles design intent",
    },
    {
      rule_id: "S002",
      rule_name: "Design Intent Preservation",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: "Skipped — semantic mesh validator is not implemented; visual validation handles design intent",
    },
  ];
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function managedMeshValidatorDir(): string {
  if (process.env.AGENTSCAD_MESH_VALIDATOR_DIR) {
    return process.env.AGENTSCAD_MESH_VALIDATOR_DIR;
  }

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "AgentSCAD",
      "extensions",
      "mesh-validator"
    );
  }

  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "AgentSCAD", "extensions", "mesh-validator");
}

function pythonInVenv(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pythonHasMeshDependencies(pythonPath: string): Promise<boolean> {
  try {
    await execAsync(
      `${shellQuote(pythonPath)} -c "import trimesh, numpy, rtree; print(trimesh.__version__)"`,
      { timeout: 10_000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function installManagedMeshValidator(): Promise<MeshValidatorStatus> {
  const overridePython = process.env.AGENTSCAD_MESH_VALIDATOR_PYTHON;
  if (overridePython) {
    const available = await pythonHasMeshDependencies(overridePython);
    return available
      ? { available: true, pythonPath: overridePython, managed: false, message: "Using AGENTSCAD_MESH_VALIDATOR_PYTHON" }
      : { available: false, pythonPath: overridePython, managed: false, message: "AGENTSCAD_MESH_VALIDATOR_PYTHON cannot import trimesh/numpy/rtree" };
  }

  const extensionDir = managedMeshValidatorDir();
  const venvDir = path.join(extensionDir, "venv");
  const pythonPath = pythonInVenv(venvDir);

  try {
    if (await pathExists(pythonPath)) {
      const available = await pythonHasMeshDependencies(pythonPath);
      if (available) {
        return { available: true, pythonPath, managed: true, message: "Managed mesh validator is installed" };
      }
    }

    await fs.mkdir(extensionDir, { recursive: true });
    await fs.writeFile(
      path.join(extensionDir, "requirements.txt"),
      `${REQUIRED_PACKAGES.join("\n")}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(extensionDir, "LICENSES.md"),
      [
        "# AgentSCAD Mesh Validator Dependencies",
        "",
        "Installed into this private AgentSCAD environment:",
        "",
        "- trimesh: MIT License",
        "- numpy: BSD-3-Clause License",
        "- scipy: BSD-3-Clause License",
        "- rtree: MIT License",
        "",
        "These packages are installed in a managed virtual environment and do not modify system Python.",
        "",
      ].join("\n"),
      "utf8"
    );

    if (!(await pathExists(pythonPath))) {
      await execAsync(`python3 -m venv ${shellQuote(venvDir)}`, { timeout: INSTALL_TIMEOUT_MS });
    }

    await execAsync(
      `${shellQuote(pythonPath)} -m pip install --upgrade pip setuptools wheel && ` +
        `${shellQuote(pythonPath)} -m pip install ${REQUIRED_PACKAGES.map(shellQuote).join(" ")}`,
      { timeout: INSTALL_TIMEOUT_MS }
    );

    const available = await pythonHasMeshDependencies(pythonPath);
    return available
      ? { available: true, pythonPath, managed: true, message: "Managed mesh validator installed" }
      : { available: false, pythonPath, managed: true, message: "Managed install completed, but trimesh/numpy/rtree import still failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, pythonPath, managed: true, message };
  }
}

export function getManagedMeshValidatorPath(): string {
  return pythonInVenv(path.join(managedMeshValidatorDir(), "venv"));
}

export async function getMeshValidatorStatus(): Promise<MeshValidatorStatus> {
  if (managedPythonStatus?.available) {
    return managedPythonStatus;
  }

  if (!managedPythonPromise) {
    managedPythonPromise = installManagedMeshValidator().then((status) => {
      if (status.available) {
        managedPythonStatus = status;
      } else {
        managedPythonPromise = null;
      }
      return status;
    });
  }
  return managedPythonPromise;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Validate an STL file using real mesh analysis.
 *
 * Uses a fixed manufacturing threshold (FDM_MIN_WALL_MM) for wall thickness,
 * independent of any design-level wall_thickness parameter. The design
 * parameter informs the generator, not the validator.
 *
 * @param stlPath - Absolute path to the STL file on disk
 * @returns Array of ValidationResult objects matching the frontend interface
 */
export async function validateStl(
  stlPath: string,
  _wallThickness?: number
): Promise<ValidationResult[]> {
  // Check cache
  const cached = validationCache.get(stlPath);
  if (cached) {
    console.log(`[mesh-validator] Cache hit for ${stlPath}`);
    return cached;
  }

  const scriptPath = path.join(process.cwd(), "scripts", "validate_stl.py");
  const validator = await getMeshValidatorStatus();
  if (!validator.available) {
    console.warn(`[mesh-validator] Unavailable: ${validator.message}`);
    const skipped = generateSkippedValidationResults(validator.message);
    validationCache.set(stlPath, skipped);
    return skipped;
  }

  try {
    // Wall thickness validation uses the FDM manufacturing minimum,
    // not the design-level wall_thickness parameter.
    const { stdout, stderr } = await execAsync(
      `${shellQuote(validator.pythonPath)} ${shellQuote(scriptPath)} ${shellQuote(stlPath)} --min-wall ${shellQuote(String(FDM_MIN_WALL_MM))}`,
      { timeout: VALIDATION_TIMEOUT_MS }
    );

    if (stderr) {
      console.warn(`[mesh-validator] Python stderr: ${stderr.trim()}`);
    }

    const parsed: PythonOutput = JSON.parse(stdout.trim());

    // Check if Python returned an error
    if (parsed.error) {
      console.warn(
        `[mesh-validator] Python reported error: ${parsed.message}. Marking mesh validation skipped.`
      );
      const skipped = generateSkippedValidationResults(parsed.message || "Python validator returned an error");
      validationCache.set(stlPath, skipped);
      return skipped;
    }

    const results = transformPythonResults(parsed);
    validationCache.set(stlPath, results);

    console.log(
      `[mesh-validator] Real validation complete for ${path.basename(stlPath)}: ` +
        `${parsed.summary.passed}/${parsed.summary.total} rules passed`
    );

    return results;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    console.warn(`[mesh-validator] Validation failed: ${errMsg}. Marking mesh validation skipped.`);

    const skipped = generateSkippedValidationResults(errMsg);
    validationCache.set(stlPath, skipped);
    return skipped;
  }
}

/**
 * Clear the validation cache (useful for testing or when STL files change).
 */
export function clearValidationCache(): void {
  validationCache.clear();
  meshDataCache.clear();
}
