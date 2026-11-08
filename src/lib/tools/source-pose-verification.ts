import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { validateAssemblySpec, validateRigidTransform } from "../assembly/assembly-spec";
import { checkReconstructedMesh } from "../assembly/reconstructed-mesh-check";
import { renderAssemblyParts } from "./assembly-part-renderer";
import { isRepairableScadCompileError } from "./scad-compile-error";
import type { ScadExecutionOptions } from "./scad-renderer";
type Parameters = Record<string, number | string | boolean>;
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
    }>;
    budgetMs?: number;
    options?: ScadExecutionOptions;
    render?: typeof renderAssemblyParts;
}) {
    const spec = validateAssemblySpec(input.spec);
    if (!spec.success)
        throw new Error("Invalid assembly specification");
    const scadSource = input.scadSource;
    const setup = structuredClone({
        spec: spec.data, poseSelectors: input.poseSelectors,
        manufacturingParameters: input.manufacturingParameters, poseParameters: input.poseParameters, cases: input.cases
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
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const results: Array<{
        id: string;
        status: string;
        reason: string;
        comparisons?: Array<{
            instanceId: string;
            result: ReturnType<typeof checkReconstructedMesh>;
        }>;
    }> = [];
    const base = {
        method: "source-pose-correspondence/v1", sourceSha256: sha(scadSource), protocolSha256: sha(canonicalJson(setup)),
        protocol: setup, budgetMs, coverage: "Only listed source inputs and pose-selector surfaces compared with caller-provided expected rigid poses. Correspondence of pose-selector views to the complete source assembly view is unverified. Retessellation may remain NOT_RUN. No full requirement coverage, continuous trajectory, collision, observable joint phase for symmetric bodies, forces or physical qualification."
    };
    try {
        if (setup.spec.parts.some(part => part.source === "purchased"))
            return {
                ...base, status: "NOT_RUN", timedOut: false,
                durationMs: Date.now() - started, results: [
                    {
                        id: "execution", status: "NOT_RUN", reason: "Purchased geometry is not available to this source renderer"
                    }
                ]
            };
        const local = await render({
            scadSource, parts: setup.spec.parts.filter(part => part.source === "generated")
                .map(part => ({
                partId: part.id, selector: part.selector
            })), parameters: setup.manufacturingParameters, options: {
                ...input.options, signal
            }
        });
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
            const comparisons = setup.spec.instances.map(instance => {
                const part = local.find(part => part.partId === instance.partId);
                const actual = posed.find(part => part.partId === instance.id);
                if (!part || !actual)
                    throw new Error(`Required local or posed mesh missing for ${instance.id}; purchased parts need actual geometry`);
                return {
                    instanceId: instance.id, result: checkReconstructedMesh({
                        local: part.stl, posed: actual.stl, transform: item.transforms[instance.id]
                    })
                };
            });
            const status = comparisons.some(item => item.result.status === "FAIL") ? "FAIL"
                : comparisons.every(item => item.result.status === "PASS") ? "PASS" : "NOT_RUN";
            results.push({
                id: item.id, status, reason: "Per-instance surface comparisons at this source input", comparisons
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
    const status = results.some(item => item.status === "FAIL") ? "FAIL" : results.some(item => item.status === "ERROR") ? "ERROR"
        : timedOut || results.length !== setup.cases.length || results.some(item => item.status !== "PASS") ? "NOT_RUN" : "PASS";
    return {
        ...base, status, timedOut, durationMs: Date.now() - started, results
    };
}
