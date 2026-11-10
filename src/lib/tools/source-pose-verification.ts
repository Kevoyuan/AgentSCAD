import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { validateAssemblySpec, validateRigidTransform } from "../assembly/assembly-spec";
import { checkReconstructedMesh } from "../assembly/reconstructed-mesh-check";
import { renderAssemblyParts } from "./assembly-part-renderer";
import { checkAssemblyReconstruction } from "./assembly-reconstruction";
import { isRepairableScadCompileError } from "./scad-compile-error";
import type { ScadExecutionOptions } from "./scad-renderer";
import { compareSurfaceCover, findSurfaceDifference } from "../geometry/surface-cover";
type Parameters = Record<string, number | string | boolean>;
export interface SourcePoseArtifact {
    phase: "manufacturing" | "pose" | "assembly";
    caseId: string | null;
    partId: string;
    parameters: Parameters;
    stl: Buffer;
    sha256: string;
}
const SURFACE_TOLERANCE_MM = 1e-4;
type PoseChange = { status: "REFERENCE" | "OBSERVED" | "NOT_RUN"; reason: string;
    comparison?: ReturnType<typeof checkReconstructedMesh>; witness?: ReturnType<typeof findSurfaceDifference> };
/** Caller-supplied expected poses are a test protocol, not observations from the model. */
export async function verifySourcePoses(input: {
    scadSource: string;
    spec: unknown;
    poseSelectors: Record<string, string>;
    manufacturingParameters: Parameters;
    poseParameters: Parameters;
    cases: Array<{
        id: string;
        parameters: Parameters;
        transforms: Record<string, number[]>;
        /** Seed-derived additional pose, held to the same surface comparison as fixed poses. */
        challenge?: boolean;
    }>;
    budgetMs?: number;
    surfaceComparison?: "triangles" | "bounded-cover";
    options?: ScadExecutionOptions;
    render?: typeof renderAssemblyParts;
    onArtifact?: (artifact: SourcePoseArtifact) => void | Promise<void>;
}) {
    const spec = validateAssemblySpec(input.spec);
    if (!spec.success)
        throw new Error("Invalid assembly specification");
    const scadSource = input.scadSource;
    const setup = structuredClone({
        spec: spec.data, poseSelectors: input.poseSelectors,
        manufacturingParameters: input.manufacturingParameters, poseParameters: input.poseParameters, cases: input.cases,
        surfaceComparison: input.surfaceComparison ?? "triangles"
    });
    const ids = setup.spec.instances.map(instance => instance.id).sort();
    const sameIds = (value: object) => Object.keys(value).sort().join(",") === ids.join(",");
    const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
    const parametersValid = (parameters: Parameters) => parameters && typeof parameters === "object" && !Array.isArray(parameters)
        && Object.keys(parameters).length <= 64 && Object.entries(parameters).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key !== "agentscad_part"
        && (typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))));
    if (ids.length < 1 || ids.length > 8 || !sameIds(setup.poseSelectors)
        || Object.values(setup.poseSelectors).some(selector => !identifier.test(selector))
        || new Set(Object.values(setup.poseSelectors)).size !== ids.length)
        throw new Error("Expected one distinct pose selector per instance");
    if (setup.cases.length < 2 || setup.cases.length > 64 || setup.cases.length * ids.length > 256
        || !["triangles", "bounded-cover"].includes(setup.surfaceComparison)
        || new Set(setup.cases.map(item => item.id)).size !== setup.cases.length
        || setup.cases.some(item => !identifier.test(item.id) || !parametersValid(item.parameters) || !sameIds(item.transforms)
            || Object.values(item.transforms).some(matrix => !validateRigidTransform(matrix).success))
        || !parametersValid(setup.manufacturingParameters) || !parametersValid(setup.poseParameters))
        throw new Error("Invalid source pose protocol");
    const first = setup.cases[0];
    if (!setup.cases.some(item => canonicalJson(item.transforms) !== canonicalJson(first.transforms)))
        throw new Error("A static expected pose is not a motion protocol");
    const budgetMs = input.budgetMs ?? 60000;
    if (!Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 300000)
        throw new Error("Invalid source pose budget");
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    const signal = input.options?.signal ? AbortSignal.any([input.options.signal, controller.signal]) : controller.signal;
    const render = input.render ?? renderAssemblyParts;
    const onArtifact = input.onArtifact;
    const retain = async (parts: Awaited<ReturnType<typeof renderAssemblyParts>>, phase: SourcePoseArtifact["phase"], caseId: string | null, parameters: Parameters) => {
        if (!onArtifact) return;
        for (const part of parts) {
            const stl = Buffer.from(part.stl);
            await onArtifact({ phase, caseId, partId: part.partId, parameters: structuredClone(parameters),
                stl, sha256: createHash("sha256").update(stl).digest("hex") });
        }
    };
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const results: Array<{
        id: string;
        status: string;
        reason: string;
        comparisons?: Array<{
            instanceId: string;
            result: { status: string; [key: string]: unknown };
            observability?: PoseChange;
        }>;
        assembly?: Awaited<ReturnType<typeof checkAssemblyReconstruction>>;
    }> = [];
    const base = {
        method: "source-pose-correspondence/v6", sourceSha256: sha(scadSource), protocolSha256: sha(canonicalJson(setup)),
        protocol: setup, budgetMs, coverage: "Fixed cases compare listed pose-selector surfaces with caller-provided rigid poses by bidirectional convex cover, then union of these already world-placed source meshes with the complete assembly at the same inputs. Seed-derived challenge cases require the same complete surface correspondence as fixed cases. Changed expected orientations additionally need a surface-change witness against reference orientation at the current instance origin. This excludes certified reference-shape invariance but does not establish unique pose or physical phase. Per-view tolerance and reconstruction kernel/boundary limitations remain separate. Retessellation may remain NOT_RUN. No full requirement coverage, continuous trajectory, collision, forces or physical qualification."
    };
    try {
        if (setup.spec.parts.some(part => part.source === "purchased")) {
            results.push({ id: "execution", status: "NOT_RUN", reason: "Purchased geometry is not available to this source renderer" });
            return {
                ...base, status: "NOT_RUN", timedOut: false, hasObservableChange: false,
                durationMs: Date.now() - started, results
            };
        }
        const local = await render({
            scadSource, parts: setup.spec.parts.filter(part => part.source === "generated")
                .map(part => ({
                partId: part.id, selector: part.selector
            })), parameters: setup.manufacturingParameters, options: {
                ...input.options, signal
            }
        });
        await retain(local, "manufacturing", null, setup.manufacturingParameters);
        const references = new Map<string, { stl: Buffer; transform: number[] }>();
        for (const item of setup.cases) {
            input.options?.signal?.throwIfAborted();
            if (signal.aborted)
                break;
            const posed = await render({
                scadSource, parts: setup.spec.instances.map(instance => ({
                    partId: instance.id, selector: setup.poseSelectors[instance.id]
                })),
                parameters: {
                    ...setup.poseParameters, ...item.parameters
                }, options: {
                    ...input.options, signal
                }
            });
            await retain(posed, "pose", item.id, { ...setup.poseParameters, ...item.parameters });
            const comparisons = setup.spec.instances.map(instance => {
                const part = local.find(part => part.partId === instance.partId);
                const actual = posed.find(part => part.partId === instance.id);
                if (!part || !actual)
                    throw new Error(`Required local or posed mesh missing for ${instance.id}; purchased parts need actual geometry`);
                const meshInput = { local: part.stl, posed: actual.stl, transform: item.transforms[instance.id], toleranceMm: SURFACE_TOLERANCE_MM };
                const triangles = checkReconstructedMesh(meshInput);
                const result = triangles.status === "NOT_RUN" && setup.surfaceComparison === "bounded-cover"
                    ? { ...compareSurfaceCover(meshInput), triangleComparison: triangles } : triangles;
                const matrix = item.transforms[instance.id];
                const reference = references.get(instance.id);
                let observability: PoseChange = { status: "REFERENCE", reason: "Reference or unchanged expected rigid transform" };
                if (!reference) references.set(instance.id, { stl: Buffer.from(actual.stl), transform: [...matrix] });
                else if (matrix.some((value, k) => Math.abs(value - reference.transform[k]) > 1e-8)) {
                    const rotated = [0,1,2,4,5,6,8,9,10].some(k => Math.abs(matrix[k] - reference.transform[k]) > 1e-8);
                    // Remove expected origin translation when testing orientation visibility.
                    // Translation alone must not make an invariant rotation look observable.
                    const nullTransform = [1,0,0,rotated ? matrix[3] - reference.transform[3] : 0,
                        0,1,0,rotated ? matrix[7] - reference.transform[7] : 0,
                        0,0,1,rotated ? matrix[11] - reference.transform[11] : 0,0,0,0,1];
                    // Two matched outputs may each differ from expectation by one
                    // surface tolerance. Require three before inferring a change.
                    const changeInput = { local: reference.stl, posed: actual.stl, transform: nullTransform,
                        toleranceMm: 3 * SURFACE_TOLERANCE_MM };
                    const comparison = checkReconstructedMesh(changeInput);
                    const witness = result.status === "PASS" && comparison.status === "NOT_RUN"
                        ? findSurfaceDifference(changeInput) : undefined;
                    observability = result.status === "PASS" && (comparison.status === "FAIL" || witness?.status === "DIFFERENT")
                        ? { status: "OBSERVED", reason: "A surface-difference witness distinguishes this pose from the reference null motion", comparison, witness }
                        : { status: "NOT_RUN", reason: comparison.status === "PASS"
                            ? "Expected motion leaves the observed reference surface invariant. Its phase cannot be established from these meshes."
                            : "No independent surface-difference witness was established for the expected motion", comparison, witness };
                }
                return { instanceId: instance.id, result, observability };
            });
            let assembly: Awaited<ReturnType<typeof checkAssemblyReconstruction>> | undefined;
            if (!comparisons.some(item => item.result.status === "FAIL") && !signal.aborted) {
                const [whole] = await render({
                    scadSource, parts: [{ partId: "assembly", selector: "all" }],
                    parameters: { ...setup.poseParameters, ...item.parameters }, options: { ...input.options, signal }
                });
                if (!whole) throw new Error("Complete source assembly mesh is missing");
                await retain([whole], "assembly", item.id, { ...setup.poseParameters, ...item.parameters });
                const remainingMs = Math.floor(budgetMs - (Date.now() - started));
                if (remainingMs > 0) assembly = await checkAssemblyReconstruction({
                    // Geometry-only identity placement: posed exports are already in world coordinates.
                    // Expected transforms were checked independently above, without reapplying them here.
                    spec: {
                        schemaVersion: 1, units: setup.spec.units, coordinateSystem: setup.spec.coordinateSystem,
                        parts: setup.spec.instances.map(instance => ({ id: instance.id, name: instance.id,
                            selector: setup.poseSelectors[instance.id], source: "generated", material: null })),
                        instances: setup.spec.instances.map(instance => ({ id: instance.id, partId: instance.id,
                            subassemblyId: null, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })),
                        subassemblies: [], groundedInstanceId: setup.spec.groundedInstanceId,
                        connections: [], motions: [], operations: [], manufacturing: null,
                        assumptions: ["Posed meshes already occupy assembly coordinates"], unknowns: []
                    },
                    meshes: Object.fromEntries(posed.map(part => [part.partId, part.stl])), assemblyMesh: whole.stl,
                    options: { ...input.options, signal }, budgetMs: Math.min(15000, remainingMs)
                });
            }
            const status = comparisons.some(item => item.result.status === "FAIL") || assembly?.status === "FAIL" ? "FAIL"
                : assembly?.status === "ERROR" ? "ERROR"
                : comparisons.every(item => item.result.status === "PASS" && item.observability.status !== "NOT_RUN") && assembly?.status === "PASS" ? "PASS" : "NOT_RUN";
            results.push({
                id: item.id, status,
                reason: comparisons.some(row => row.observability.status === "NOT_RUN")
                    ? comparisons.filter(row => row.observability.status === "NOT_RUN").map(row => `${row.instanceId}: ${row.observability.reason}`).join(" ")
                    : assembly ? `Complete assembly at the same input: ${assembly.reason}`
                    : "Assembly reconstruction was not executed after a view failure or deadline",
                comparisons, assembly
            });
        }
    }
    catch (error) {
        input.options?.signal?.throwIfAborted();
        results.push({
            id: "execution", status: controller.signal.aborted ? "NOT_RUN" : isRepairableScadCompileError(error) ? "FAIL" : "ERROR", reason: String(error)
        });
    }
    finally {
        clearTimeout(timer);
    }
    const timedOut = Date.now() - started >= budgetMs || controller.signal.aborted;
    const hasObservableChange = results.some(item => item.comparisons?.some(row => row.observability?.status === "OBSERVED"));
    const status = results.some(item => item.status === "FAIL") ? "FAIL" : results.some(item => item.status === "ERROR") ? "ERROR"
        : timedOut || !hasObservableChange || results.length !== setup.cases.length || results.some(item => item.status !== "PASS") ? "NOT_RUN" : "PASS";
    return {
        ...base, status, timedOut, hasObservableChange, durationMs: Date.now() - started, results
    };
}
