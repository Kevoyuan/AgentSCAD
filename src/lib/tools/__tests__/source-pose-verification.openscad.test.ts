import { expect, test } from "bun:test";
import { verifySourcePoses } from "../source-pose-verification";
import fixture from "../../../../scripts/eval/assembly-fixtures/axial-hinge.spec.json";
import { translation } from "../../geometry/__tests__/solids";
test("native source motion is observed and incorrect input-to-output coupling is rejected", async () => {
    const spec = {
        ...fixture, parts: fixture.parts.slice(0, 1), instances: fixture.instances.slice(0, 1), connections: [], motions: []
    };
    const id = spec.instances[0].id, selector = spec.parts[0].selector;
    const source = `agentscad_part="${selector}"; agentscad_pose=false; travel=0;
 module generated_part(){ if(agentscad_pose) translate([travel,0,0]) cube([2,3,4]); else cube([2,3,4]); }
 generated_part();`;
    const input = {
        spec, poseSelectors: { [id]: selector }, manufacturingParameters: { agentscad_pose: false }, poseParameters: { agentscad_pose: true },
        cases: [
            {
                id: "zero", parameters: { travel: 0 }, transforms: { [id]: translation(0, 0, 0) }
            }, {
                id: "moved", parameters: { travel: 4 }, transforms: { [id]: translation(4, 0, 0) }
            }
        ]
    };
    expect((await verifySourcePoses({
        ...input, scadSource: source
    })).status).toBe("PASS");
    for (const replacement of ["0", "2*travel"]) {
        const result = await verifySourcePoses({
            ...input, scadSource: source.replace("[travel,0,0]", `[${replacement},0,0]`)
        });
        expect(result.status).toBe("FAIL");
        expect(result.results.find(item => item.id === "moved")?.status).toBe("FAIL");
    }
}, 60000);
