import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { validateAssemblySpec } from "./assembly-spec";
import { canonicalJson } from "../canonical-json";
import { readBinaryStl } from "../geometry/stl-mesh";

/**
 * Offline, independent check of the bytes delivered by the assembly exporter.
 * This checks internal consistency, NOT the authenticity of the producer or
 * any mechanical, physical or functional property claimed in the manifest.
 */
const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 203; // 200 possible parts + 3 metadata files
const SHA256 = /^[a-f0-9]{64}$/;
const PART_FILE = /^[A-Za-z][A-Za-z0-9_-]{0,63}\.stl$/;

export class AssemblyBundleVerificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AssemblyBundleVerificationError";
  }
}

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new AssemblyBundleVerificationError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_METADATA", label + " must be an object");
  return value as Record<string, unknown>;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    return record(JSON.parse(strFromU8(bytes)), label);
  } catch (error) {
    if (error instanceof AssemblyBundleVerificationError) throw error;
    throw new AssemblyBundleVerificationError("INVALID_METADATA", label + " is not valid JSON");
  }
}

export interface VerifiedAssemblyBundle {
  status: "PASS";
  /** Hash of the entire ZIP as received, not an authenticity signature. */
  archiveSha256: string;
  sourceSha256: string;
  specificationSha256: string;
  partCount: number;
  instanceCount: number;
  parts: Array<{ id: string; source: "generated" | "purchased"; quantity: number; triangleCount: number | null }>;
  /** A manifest's assertions are never converted to validation evidence here. */
  contractCurrent: boolean | null;
  limitations: string[];
}

export function verifyAssemblyBundle(bytes: Uint8Array): VerifiedAssemblyBundle {
  requireValue(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_ZIP_BYTES,
    "ARCHIVE_SIZE", "Assembly ZIP is empty or exceeds the 256 MiB verification limit");

  // Apply limits BEFORE inflation. The filter also sees duplicate and
  // unexpected entry names; silently overwriting a duplicate would be unsafe.
  const seen = new Set<string>();
  let declaredTotal = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        const name = entry.name;
        requireValue(name === "manifest.json" || name === "specification.json" ||
          name === "README.txt" || PART_FILE.test(name),
          "UNEXPECTED_ENTRY", "Unexpected ZIP entry: " + name);
        requireValue(!seen.has(name), "DUPLICATE_ENTRY", "Duplicate ZIP entry: " + name);
        seen.add(name);
        requireValue(seen.size <= MAX_ENTRIES, "TOO_MANY_ENTRIES", "Too many ZIP entries");
        requireValue(Number.isSafeInteger(entry.originalSize) && entry.originalSize >= 0 &&
          entry.originalSize <= MAX_ENTRY_BYTES, "ENTRY_SIZE", "ZIP entry exceeds size limit: " + name);
        declaredTotal += entry.originalSize;
        requireValue(declaredTotal <= MAX_TOTAL_UNPACKED_BYTES, "ARCHIVE_SIZE",
          "Uncompressed archive exceeds the 512 MiB verification limit");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AssemblyBundleVerificationError) throw error;
    throw new AssemblyBundleVerificationError("INVALID_ZIP", "Could not read assembly ZIP");
  }

  const requiredFiles = ["manifest.json", "specification.json", "README.txt"];
  for (const filename of requiredFiles) {
    requireValue(files[filename] !== undefined, "MISSING_ENTRY", "Missing " + filename);
  }
  const actualTotal = Object.values(files).reduce((sum, file) => sum + file.length, 0);
  requireValue(actualTotal <= MAX_TOTAL_UNPACKED_BYTES &&
    Object.values(files).every(file => file.length <= MAX_ENTRY_BYTES),
    "ARCHIVE_SIZE", "Extracted data exceeds verification limits");

  const manifest = readJson(files["manifest.json"], "manifest.json");
  requireValue(manifest.schemaVersion === 1 && manifest.bundleSchemaVersion === 1,
    "UNSUPPORTED_VERSION", "Unsupported assembly bundle or manifest schema version");
  requireValue(typeof manifest.sourceSha256 === "string" && SHA256.test(manifest.sourceSha256),
    "INVALID_METADATA", "Missing or invalid source SHA-256");
  requireValue(typeof manifest.specificationSha256 === "string" && SHA256.test(manifest.specificationSha256),
    "INVALID_METADATA", "Missing or invalid specification SHA-256");

  const specificationBytes = files["specification.json"];
  requireValue(sha256(specificationBytes) === manifest.specificationSha256,
    "HASH_MISMATCH", "specification.json SHA-256 does not match manifest");
  const specification = readJson(specificationBytes, "specification.json");
  const parsed = validateAssemblySpec(specification);
  requireValue(parsed.success, "INVALID_SPECIFICATION",
    parsed.success ? "" : "Invalid assembly specification: " + parsed.error.message);
  const spec = parsed.data;
  requireValue(strFromU8(specificationBytes) === canonicalJson(spec),
    "NONCANONICAL_SPECIFICATION", "specification.json is not the canonical validated declaration");
  requireValue(manifest.units === spec.units && manifest.coordinateSystem === spec.coordinateSystem,
    "SPECIFICATION_MISMATCH", "Manifest units or coordinate system differ from specification");
  requireValue(canonicalJson(manifest.instances) === canonicalJson(spec.instances) &&
    canonicalJson(manifest.subassemblies) === canonicalJson(spec.subassemblies),
    "SPECIFICATION_MISMATCH", "Manifest instances or subassemblies differ from specification");

  requireValue(Array.isArray(manifest.parts) && manifest.parts.length === spec.parts.length,
    "PART_MISMATCH", "Manifest part inventory does not match specification");
  const expectedNames = new Set(requiredFiles);
  const verifiedParts: VerifiedAssemblyBundle["parts"] = [];
  for (let i = 0; i < spec.parts.length; i++) {
    const declaration = spec.parts[i];
    const part = record(manifest.parts[i], "manifest part");
    const quantity = spec.instances.filter(instance => instance.partId === declaration.id).length;
    requireValue(part.id === declaration.id && part.name === declaration.name &&
      part.selector === declaration.selector && part.source === declaration.source &&
      part.quantity === quantity,
      "PART_MISMATCH", "Part identity or instance quantity differs: " + declaration.id);
    if (declaration.source === "purchased") {
      requireValue(part.fileName === null && part.artifactSha256 === null && part.triangleCount === null,
        "PART_MISMATCH", "Purchased part must not claim an exported STL: " + declaration.id);
      verifiedParts.push({ id: declaration.id, source: "purchased", quantity, triangleCount: null });
      continue;
    }
    const filename = declaration.id + ".stl";
    expectedNames.add(filename);
    requireValue(part.fileName === filename, "PART_MISMATCH", "Incorrect STL filename: " + declaration.id);
    requireValue(typeof part.artifactSha256 === "string" && SHA256.test(part.artifactSha256),
      "INVALID_METADATA", "Missing generated-part hash: " + declaration.id);
    const stl = files[filename];
    requireValue(stl !== undefined, "MISSING_ENTRY", "Missing part STL: " + filename);
    requireValue(sha256(stl) === part.artifactSha256,
      "HASH_MISMATCH", "Part STL hash mismatch: " + filename);
    let triangles: number;
    try {
      triangles = readBinaryStl(Buffer.from(stl)).triangleCount;
    } catch {
      throw new AssemblyBundleVerificationError("INVALID_STL", "Invalid binary STL: " + filename);
    }
    requireValue(part.triangleCount === triangles, "PART_MISMATCH",
      "Part triangle count differs: " + filename);
    verifiedParts.push({ id: declaration.id, source: "generated", quantity, triangleCount: triangles });
  }
  requireValue(Object.keys(files).length === expectedNames.size &&
    Object.keys(files).every(name => expectedNames.has(name)),
    "UNEXPECTED_ENTRY", "ZIP contains entries outside the declared part inventory");

  const contract = record(manifest.contract, "manifest contract");
  requireValue(contract.evidenceCurrent === null || typeof contract.evidenceCurrent === "boolean",
    "INVALID_METADATA", "Invalid contract confirmation state");
  return {
    status: "PASS",
    archiveSha256: sha256(bytes),
    sourceSha256: manifest.sourceSha256 as string,
    specificationSha256: manifest.specificationSha256 as string,
    partCount: verifiedParts.length,
    instanceCount: spec.instances.length,
    parts: verifiedParts,
    contractCurrent: contract.evidenceCurrent as boolean | null,
    limitations: [
      "Internal consistency only: anyone can modify an archive and recompute hashes; no signature or origin authentication.",
      "Source SCAD is absent, so sourceSha256 cannot be independently checked.",
      "Declared poses and manifest evidence were not recomputed from assembly geometry.",
      "This check does not establish fit, collision clearance, motion, manufacturability or physical function.",
    ],
  };
}
