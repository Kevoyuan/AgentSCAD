import { expect, test } from "bun:test";
import { verifySourcePoses } from "../source-pose-verification";
import fixture from "../../../../scripts/eval/assembly-fixtures/axial-hinge.spec.json";
import { boxStl, translation } from "../../geometry/__tests__/solids";
import { readBinaryStl } from "../../geometry/stl-mesh";
const spec = {
    ...fixture, parts: fixture.parts.slice(0, 1), instances: fixture.instances.slice(0, 1), connections: [], motions: []
};
const id = spec.instances[0].id, selector = spec.parts[0].selector;
const setup = {
    scadSource: "cube(1);", spec, poseSelectors: { [id]: selector }, manufacturingParameters: { agentscad_pose: false }, poseParameters: { agentscad_pose: true },
    cases: [
        {
            id: "zero", parameters: { travel: 0 }, transforms: { [id]: translation(0, 0, 0) }
        }, {
            id: "moved", parameters: { travel: 4 }, transforms: { [id]: translation(4, 0, 0) }
        }
    ]
};
function renderer(factor = 1): NonNullable<Parameters<typeof verifySourcePoses>[0]["render"]> {
    return async (input) => input.parts.map(item => {
        const x = input.parameters?.agentscad_pose ? Number(input.parameters.travel) * factor : 0;
        return {
            partId: item.partId, stl: boxStl([x, 0, 0], [x + 2, 3, 4]), sha256: "test", triangleCount: 12, diagnostics: ""
        };
    });
}
test("source inputs are rendered and wrong or idle motion cannot pass", async () => {
    expect((await verifySourcePoses({
        ...setup, render: renderer()
    })).status).toBe("PASS");
    expect((await verifySourcePoses({
        ...setup, render: renderer(0)
    })).status).toBe("FAIL");
    expect((await verifySourcePoses({
        ...setup, render: renderer(2)
    })).status).toBe("FAIL");
});
test("invalid protocols are refused before rendering", async () => {
    for (const change of [
        { poseSelectors: {} }, { cases: [setup.cases[0]] }, { cases: [
                setup.cases[0], {
                    ...setup.cases[1], transforms: setup.cases[0].transforms
                }
            ] },
        { cases: [
                setup.cases[0], {
                    ...setup.cases[1], parameters: { agentscad_part: "all" }
                }
            ] }
    ]) {
        await expect(verifySourcePoses({
            ...setup, ...change, render: renderer()
        })).rejects.toThrow();
    }
});
test("missing meshes and render faults remain errors; deadlines remain unexecuted", async () => {
    const empty = await verifySourcePoses({
        ...setup, render: async () => []
    });
    expect(empty.status).toBe("ERROR");
    const failed = await verifySourcePoses({
        ...setup, render: async () => { throw new Error("renderer unavailable"); }
    });
    expect(failed.status).toBe("ERROR");
    const slow = await verifySourcePoses({
        ...setup, budgetMs: 1, render: async (input) => { await new Promise(resolve => setTimeout(resolve, 10)); return renderer()(input); }
    });
    expect(slow.status).toBe("NOT_RUN");
    expect(slow.timedOut).toBe(true);
});

test("source and protocol remain bound to the initial inputs during rendering", async () => {
    const request: Parameters<typeof verifySourcePoses>[0] = structuredClone(setup);
    const sources: string[] = [];
    request.render = async input => {
        sources.push(input.scadSource);
        request.scadSource = "sphere(50);";
        request.cases[1].transforms[id][3] = 99;
        return renderer()(input);
    };
    const result = await verifySourcePoses(request);
    expect(result.status).toBe("PASS");
    expect(sources).toEqual(Array(5).fill(setup.scadSource));
    const purchased = { ...spec, parts: spec.parts.map(part => ({ ...part, source: "purchased" })) };
    expect((await verifySourcePoses({ ...setup, spec: purchased, render: renderer() })).status).toBe("NOT_RUN");
});

test("fractional translations use world-placed meshes for assembly consistency", async () => {
    const request = structuredClone(setup);
    request.cases[1].parameters.travel = 0.9;
    request.cases[1].transforms[id] = translation(0.9, 0, 0);
    const result = await verifySourcePoses({ ...request, render: renderer() });
    expect(result.status).toBe("PASS");
    expect(result.results[1].assembly?.comparison).toBe("exact-oriented-triangles");
    expect(result.results[1].assembly?.residualTriangles).toBe(0);
});

test("retessellation requires explicit bounded-cover protocol and preserves the strict comparison", async () => {
    const render: NonNullable<Parameters<typeof verifySourcePoses>[0]["render"]> = async input => {
        const parts = await renderer()(input);
        if (!input.parameters?.agentscad_pose) return parts;
        return parts.map(part => {
            const mesh = readBinaryStl(part.stl);
            const buffer = Buffer.alloc(84 + mesh.triangleCount * 3 * 50);
            buffer.writeUInt32LE(mesh.triangleCount * 3, 80);
            for (let i = 0; i < mesh.triangleCount; i++) {
                const vertices = [0,3,6].map(offset => Array.from(mesh.coordinates.slice(i * 9 + offset, i * 9 + offset + 3)));
                const center = [0,1,2].map(k => vertices.reduce((sum, vertex) => sum + vertex[k], 0) / 3);
                for (let edge = 0; edge < 3; edge++) {
                    const values = [...vertices[edge], ...vertices[(edge + 1) % 3], ...center];
                    values.forEach((value, k) => buffer.writeFloatLE(value, 96 + (i * 3 + edge) * 50 + k * 4));
                }
            }
            return { ...part, stl: buffer, triangleCount: mesh.triangleCount * 3 };
        });
    };
    expect((await verifySourcePoses({ ...setup, render })).status).toBe("NOT_RUN");
    const result = await verifySourcePoses({ ...setup, render, surfaceComparison: "bounded-cover" });
    expect(result.status).toBe("PASS");
    expect(result.protocol.surfaceComparison).toBe("bounded-cover");
    const comparison = result.results[1].comparisons![0].result;
    expect(comparison.method).toBe("bidirectional-convex-triangle-cover/v1");
    expect(comparison).toHaveProperty("triangleComparison.status", "NOT_RUN");
});

test("reference-invariant rotation remains unverified and translation cannot conceal it", async () => {
    const rotate90 = [0,-1,0,0,1,0,0,0,0,0,1,0,0,0,0,1];
    for (const travel of [0, 4]) {
        const matrix = [...rotate90];
        matrix[11] = travel;
        const render: NonNullable<Parameters<typeof verifySourcePoses>[0]["render"]> = async input => input.parts.map(part => {
            const z = input.parameters?.agentscad_pose ? Number(input.parameters.travel) : 0;
            return { partId: part.partId, stl: boxStl([-1,-1,z], [1,1,z+2]), sha256: "test", triangleCount: 12, diagnostics: "" };
        });
        const result = await verifySourcePoses({ ...setup, render, surfaceComparison: "bounded-cover",
            cases: [{ ...setup.cases[0], parameters: { travel: 0 } },
                { ...setup.cases[1], parameters: { travel }, transforms: { [id]: matrix } }] });
        expect(result.status).toBe("NOT_RUN");
        expect(result.hasObservableChange).toBe(false);
        expect(result.results[1].comparisons![0].result.status).toBe("PASS");
        expect(result.results[1].comparisons![0].observability?.status).toBe("NOT_RUN");
        expect(result.results[1].reason).toContain("invariant");
    }
});

test("a complete-turn endpoint supplies no observed motion between endpoints", async () => {
    const c = Math.cos(2*Math.PI), s = Math.sin(2*Math.PI);
    const result = await verifySourcePoses({ ...setup, render: renderer(0),
        cases: [setup.cases[0], { ...setup.cases[1], transforms: { [id]: [c,-s,0,0,s,c,0,0,0,0,1,0,0,0,0,1] } }] });
    expect(result.status).toBe("NOT_RUN");
    expect(result.hasObservableChange).toBe(false);
});

test("matching-error noise cannot establish a rotational change in an invariant body", async () => {
    const render: NonNullable<Parameters<typeof verifySourcePoses>[0]["render"]> = async input => input.parts.map(part => {
        const dx = input.parameters?.agentscad_pose ? (Number(input.parameters.angle) === 0 ? -0.00009 : 0.00009) : 0;
        return { partId: part.partId, stl: boxStl([-1+dx,-1,0], [1+dx,1,2]), sha256: "test", triangleCount: 12, diagnostics: "" };
    });
    const result = await verifySourcePoses({ ...setup, render, surfaceComparison: "bounded-cover",
        cases: [{ ...setup.cases[0], parameters: { angle: 0 } },
            { ...setup.cases[1], parameters: { angle: 180 }, transforms: { [id]: [-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1] } }] });
    expect(result.status).toBe("NOT_RUN");
    expect(result.results.every(item => item.comparisons?.[0].result.status === "PASS")).toBe(true);
    expect(result.hasObservableChange).toBe(false);
});
