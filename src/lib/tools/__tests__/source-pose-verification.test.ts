import { expect, test } from "bun:test";
import { verifySourcePoses } from "../source-pose-verification";
import fixture from "../../../../scripts/eval/assembly-fixtures/axial-hinge.spec.json";
import { boxStl, translation } from "../../geometry/__tests__/solids";
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
