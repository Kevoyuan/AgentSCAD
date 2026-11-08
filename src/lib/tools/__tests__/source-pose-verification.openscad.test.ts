import { renderAssemblyParts, renderAssemblySpecParts } from "../assembly-part-renderer";
import { meshBounds, readBinaryStl } from "../../geometry/stl-mesh";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
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
            }, {
                id: "fractional", parameters: { travel: 0.9 }, transforms: { [id]: translation(0.9, 0, 0) }
            }
        ]
    };
    expect((await verifySourcePoses({
        ...input, scadSource: source
    })).status).toBe("PASS");
    const dishonest = source.replace("if(agentscad_pose)", 'if(agentscad_part == "all") translate([20,0,0]) cube([2,3,4]); else if(agentscad_pose)');
    const inconsistent = await verifySourcePoses({ ...input, scadSource: dishonest });
    expect(inconsistent.status).toBe("FAIL");
    expect(inconsistent.results[0].comparisons?.every(item => item.result.status === "PASS")).toBe(true);
    expect(inconsistent.results[0].assembly?.status).toBe("FAIL");
    for (const replacement of ["0", "2*travel"]) {
        const result = await verifySourcePoses({
            ...input, scadSource: source.replace("[travel,0,0]", `[${replacement},0,0]`)
        });
        expect(result.status).toBe("FAIL");
        expect(result.results.find(item => item.id === "moved")?.status).toBe("FAIL");
    }
}, 60000);

test("retained model pose interface supports axial motion and exposes an idle rotation control", async () => {
    const source = await readFile("scripts/eval/assembly-fixtures/candidates/guided-pose-hinge-2026-11-08.scad", "utf8");
    const extracted = extractEmbeddedAssemblySpec(source);
    if (extracted.status !== "valid") throw new Error("Frozen model interface declaration invalid");
    const identity = translation(0, 0, 0);
    const reference = { id: "reference", parameters: { hinge_angle: 0, axial_offset: 0 }, transforms: { a1: identity, b1: identity } };
    const input = {
        scadSource: source, spec: extracted.spec, poseSelectors: { a1: "supportA", b1: "rotorB" },
        manufacturingParameters: { agentscad_pose: false }, poseParameters: { agentscad_pose: true, show_angle_clamp: false },
        cases: [reference, { id: "drop", parameters: { hinge_angle: 0, axial_offset: -0.9 }, transforms: { a1: identity, b1: translation(0, 0, -0.9) } }]
    };
    expect(createHash("sha256").update(source).digest("hex")).toBe("6363d86e0c2e4f809beb841f1fe1456fb796d7a1cf6722a3d7ea388525d196d9");
    const result = await verifySourcePoses(input);
    expect(result.status).toBe("PASS");
    expect(result.results.every(item => item.assembly?.comparison === "exact-oriented-triangles")).toBe(true);
    const viewDefault = source.replace(/^agentscad_pose\s*=\s*false;/m, "agentscad_pose = true;")
        .replace(/^axial_offset\s*=\s*0;/m, "axial_offset = 10;");
    expect(viewDefault).toMatch(/^agentscad_pose\s*=\s*true;/m);
    expect(viewDefault).toMatch(/^axial_offset\s*=\s*10;/m);
    const [posedRotor] = await renderAssemblyParts({ scadSource: viewDefault, parts: [{ partId: "view", selector: "rotorB" }] });
    expect(meshBounds(readBinaryStl(posedRotor.stl)).min[2]).toBeCloseTo(7, 4);
    const manufactured = await renderAssemblySpecParts(viewDefault, extracted.spec);
    const rotor = manufactured.parts.find(part => part.partId === "rotorB")!;
    expect(meshBounds(readBinaryStl(rotor.stl)).min[2]).toBeCloseTo(-3, 4);

    const c = Math.SQRT1_2;
    const rotated = [c, -c, 0, 0, c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const faulty = source.replace("rotate([0, 0, ang])", "rotate([0, 0, 0])");
    expect(faulty).not.toBe(source);
    const failure = await verifySourcePoses({ ...input, scadSource: faulty,
        cases: [reference, { id: "work45", parameters: { hinge_angle: 45, axial_offset: 0 }, transforms: { a1: identity, b1: rotated } }] });
    expect(failure.status).toBe("FAIL");
    expect(failure.results.find(item => item.id === "work45")?.comparisons?.find(item => item.instanceId === "b1")?.result.status).toBe("FAIL");
}, 90000);

test("retained model source rotations have bounded surface correspondence and matching assembly views", async () => {
    const source = await readFile("scripts/eval/assembly-fixtures/candidates/guided-pose-hinge-2026-11-08.scad", "utf8");
    const extracted = extractEmbeddedAssemblySpec(source);
    if (extracted.status !== "valid") throw new Error("Frozen model interface declaration invalid");
    const identity = translation(0, 0, 0);
    const cases = [["reference", 0, 0], ["drop", 0, -0.9], ["work45", 45, 0], ["release", 90, -0.9]] as const;
    const result = await verifySourcePoses({
        scadSource: source, spec: extracted.spec, poseSelectors: { a1: "supportA", b1: "rotorB" },
        manufacturingParameters: { agentscad_pose: false }, poseParameters: { agentscad_pose: true, show_angle_clamp: false },
        surfaceComparison: "bounded-cover", budgetMs: 120000,
        cases: cases.map(([id, angle, z]) => {
            const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
            return { id, parameters: { hinge_angle: angle, axial_offset: z },
                transforms: { a1: identity, b1: [c,-s,0,0,s,c,0,0,0,0,1,z,0,0,0,1] } };
        })
    });
    expect(result.status).toBe("PASS");
    expect(result.results).toHaveLength(4);
    expect(result.results.every(item => item.assembly?.status === "PASS")).toBe(true);
    for (const id of ["work45", "release"]) {
        const comparison = result.results.find(item => item.id === id)?.comparisons?.find(item => item.instanceId === "b1");
        expect(comparison?.result.status).toBe("PASS");
        expect(comparison?.result.method).toBe("bidirectional-convex-triangle-cover/v1");
    }
}, 150000);
