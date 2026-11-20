import { z } from "zod";

export const ASSEMBLY_VERIFICATION_FIELD="__assembly_verification_record";
export const ASSEMBLY_VERIFICATION_POINTER_FIELD="__assembly_verification_current";
export const ASSEMBLY_EVIDENCE_LAYERS=["requirements","identity","geometry","reconstruction","jointFrames","assembly","assemblyPath","disassembly","rigidMotion","sourceMotion","motion","physical"] as const;
export const ASSEMBLY_VERIFIER_SOURCES=[
  "src/lib/assembly/verification-types.ts","src/lib/assembly/prepare-assembly.ts","src/lib/assembly/prepare-contract-assembly.ts","src/lib/assembly/automatic-hinge-kinematics.ts",
  "src/lib/assembly/assembly-bundle.ts","src/lib/assembly/assembly-spec.ts","src/lib/assembly/fit-measurement.ts",
  "src/lib/assembly/embedded-spec.ts",
  "src/lib/assembly/source-diagnostics.ts",
  "src/lib/assembly/measured-joint-frame.ts","src/lib/assembly/part-identity-check.ts","src/lib/assembly/part-connectivity.ts","src/lib/assembly/path-and-motion.ts",
  "src/lib/assembly/declared-pose-disassembly.ts","src/lib/assembly/declared-pose-assembly.ts","src/lib/assembly/rigid-pose-path.ts","src/lib/geometry/cylindrical-feature.ts",
  "src/lib/assembly/declared-translation-probes.ts","src/lib/assembly/translation-probe.ts",
  "src/lib/assembly/rigid-trajectory.ts",
  "src/lib/assembly/source-motion-protocol.ts","src/lib/tools/source-pose-verification.ts","src/lib/assembly/reconstructed-mesh-check.ts","src/lib/geometry/surface-cover.ts",
  "src/lib/assembly/source-pose-archive.ts",
  "src/lib/tools/scad-compile-error.ts","src/lib/tools/scad-sanitizer.ts",
  "src/lib/geometry/stl-mesh.ts","src/lib/geometry/mesh-collision.ts","src/lib/tools/assembly-reconstruction.ts",
  "src/lib/requirements/contract-bridge.ts","src/lib/requirements/requirement-contract.ts","src/lib/requirements/extract-requirements.ts","src/lib/tools/scad-renderer.ts","src/lib/tools/assembly-part-renderer.ts",
  "src/lib/assembly/verification-fingerprint.ts","src/lib/pipeline/assembly-verification-record.ts","src/lib/pipeline/assembly-export-guard.ts",
  "config/openscad-wasm-runtime.json","skills/scad-library-policy/manifest.json",
] as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const VerificationBindingSchema=z.object({sourceSha256:hash,specSha256:hash,requestSha256:hash,contractSha256:hash,
  requirementVersionToken:hash,assemblyVersionToken:hash,artifactVersionId:z.string().nullable(),verifierFingerprint:hash.nullable()}).strict();
export const EvidenceResultSchema=z.object({status:z.enum(["PASS","FAIL","ERROR","SKIP","NOT_RUN"]),reason:z.string().max(100000).optional()}).passthrough();
export const VerificationManifestSchema=z.object({sourceSha256:hash,specificationSha256:hash,evidence:z.record(z.string(),EvidenceResultSchema)}).passthrough();
export const StoredAssemblyVerificationSchema=z.object({schemaVersion:z.literal(1),id:z.string().min(1).max(200),binding:VerificationBindingSchema,
  startedAt:z.string().datetime(),completedAt:z.string().datetime(),durationMs:z.number().int().nonnegative(),producer:z.enum(["check","bundle"]),
  execution:z.object({status:z.enum(["COMPLETED","ERROR"]),message:z.string().max(2000).nullable()}).strict(),
  inputs:z.object({source:z.string(),request:z.string(),specification:z.unknown(),requirements:z.unknown()}).strict(),
  manifest:VerificationManifestSchema.nullable(),originalMeshesRetained:z.literal(false),
  verifier:z.object({fingerprint:hash.nullable(),backend:z.string(),engineVersion:z.string().nullable(),scope:z.string()}).strict(),
}).strict();
export type StoredAssemblyVerification=z.infer<typeof StoredAssemblyVerificationSchema>;
export type VerificationBinding=z.infer<typeof VerificationBindingSchema>;
export type VerificationEvidence=Record<string,{status:string;reason?:string}>;
export interface AssemblyVerificationView {
  status:"CURRENT"|"STALE"|"ABSENT"|"UNAVAILABLE";
  id?:string;completedAt?:string;durationMs?:number;reason?:string;
  executionStatus?:"COMPLETED"|"ERROR";executionMessage?:string|null;
  reportSha256?:string;originalMeshesRetained?:false;
}
export const unexecutedAssemblyEvidence=():VerificationEvidence=>Object.fromEntries(ASSEMBLY_EVIDENCE_LAYERS.map(key=>[key,{status:"NOT_RUN"}]));
