import { describe, expect, spyOn, test } from "bun:test";
import { createHash } from "crypto";
import { strFromU8, unzipSync } from "fflate";
import { AssemblyIdentityError, buildAssemblyBundle, mechanismDimensionLines } from "./assembly-bundle";
import { prismStl } from "../geometry/__tests__/prism";
import { boxStl as solidBox, mergeStl, tubeStl } from "../geometry/__tests__/solids";

const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A valid binary STL box: two quads, so bounds are real and counts are non-zero. */
function boxStl(size: number[], offset: number[] = [0, 0, 0]): Buffer {
  const [x, y, z] = size;
  const [ox, oy, oz] = offset;
  const p = (dx: number, dy: number, dz: number) => [ox + dx, oy + dy, oz + dz];
  const triangles = [
    [p(0, 0, 0), p(x, 0, 0), p(x, y, 0)], [p(0, 0, 0), p(x, y, 0), p(0, y, 0)],
    [p(0, 0, z), p(x, y, z), p(x, 0, z)], [p(0, 0, z), p(0, y, z), p(x, y, z)],
  ];
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    const start = 84 + 50 * index + 12;
    triangle.forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, start + v * 12 + k * 4)));
  });
  return buffer;
}

const spec = (parts: Array<{ id: string; selector: string; source: "generated" | "purchased" }>) => ({
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: parts.map((part) => ({ ...part, name: part.id, material: null })),
  instances: parts.map((part) => ({ id: `${part.id}-1`, partId: part.id, subassemblyId: null, transform: pose })),
  subassemblies: [], connections: [], groundedInstanceId: `${parts[0].id}-1`,
  motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
});

const renderWith = (meshes: Record<string, Buffer>) => async () => ({
  parts: Object.entries(meshes).map(([partId, stl]) => ({ partId, stl, sha256: createHash("sha256").update(stl).digest("hex"), triangleCount: stl.readUInt32LE(80), diagnostics: "" })),
  purchasedPartIds: [] as string[],
});

describe("assembly part bundle", () => {
  test("automatic hinge checks require a current confirmed contract and one explicitly role-bound joint",async()=>{
    const request="两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆";
    const contract=deriveRequirementContract({request});
    const joint={id:"joint",type:"revolute",a:"bore-1",b:"shaft-1",frameA:{origin:[0,0,0],direction:[0,0,1]},frameB:{origin:[0,0,0],direction:[0,0,1]},range:{min:-45,max:45,unit:"deg"},pitchMm:null,ratio:null,allowedContact:[],boreInstanceId:"bore-1"};
    const declaration={...spec([{id:"bore",selector:"bore",source:"generated"},{id:"shaft",selector:"shaft",source:"generated"}]),connections:[joint]};
    const parts={bore:tubeStl({innerRadius:3.2,outerRadius:5,height:10,segments:64}),shaft:prismStl({radius:3,height:12,z0:-1,segments:64})};
    const run=(currentSpec:unknown,confirmed:boolean,currentRequest=request)=>buildAssemblyBundle({scadSource:"cube(1);",spec:currentSpec,render:renderWith(parts),contractSnapshot:{contract,request:currentRequest},contractGate:{evidenceCurrent:confirmed}});
    expect((await run(declaration,true)).manifest.fits).toHaveLength(1);
    expect((await run(declaration,false)).manifest.fits).toHaveLength(0);
    expect((await run(declaration,true,"a different request")).manifest.fits).toHaveLength(0);
    const missingRole=structuredClone(declaration) as {connections:Array<{boreInstanceId?:string}>};
    delete missingRole.connections[0].boreInstanceId;
    expect((await run(missingRole,true)).manifest.fits).toHaveLength(0);
    const several={...declaration,connections:[joint,{...joint,id:"second"}]};
    expect((await run(several,true)).manifest.fits).toHaveLength(0);
  });
  const meshes = { base: boxStl([10, 10, 2]), lid: boxStl([10, 10, 2], [0, 0, 4]) };

  test("archives every generated part with a manifest that binds the exact bytes", async () => {
    const bundle = await buildAssemblyBundle({
      scadSource: "cube(1);", spec: spec([{ id: "base", selector: "base", source: "generated" }, { id: "lid", selector: "lid", source: "generated" }]),
      render: renderWith(meshes), modifiedAt: new Date("2020-01-01T00:00:00Z"),
    });
    const entries = unzipSync(new Uint8Array(bundle.zip));
    expect(Object.keys(entries).sort()).toEqual(["README.txt", "base.stl", "lid.stl", "manifest.json", "specification.json"]);
    expect(Buffer.from(entries["base.stl"]).equals(meshes.base)).toBe(true);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.sourceSha256).toBe(createHash("sha256").update("cube(1);").digest("hex"));
    expect(manifest.parts.map((part: { id: string }) => part.id)).toEqual(["base", "lid"]);
    expect(manifest.parts[0].fileName).toBe("base.stl");
    expect(manifest.parts[0].artifactSha256).toBe(createHash("sha256").update(meshes.base).digest("hex"));
    expect(manifest.parts[0].triangleCount).toBe(4);
    expect(manifest.evidence.identity.status).toBe("NOT_RUN");
    expect(manifest.evidence.motion.status).toBe("NOT_RUN");
    expect(manifest.bundleSchemaVersion).toBe(1);
    const specificationBytes = Buffer.from(entries["specification.json"]);
    expect(createHash("sha256").update(specificationBytes).digest("hex")).toBe(manifest.specificationSha256);
    expect(JSON.parse(specificationBytes.toString()).parts.map((part: { id: string }) => part.id)).toEqual(["base", "lid"]);
    // The README is generated from the recorded evidence, not from fixed claims.
    const readme = strFromU8(entries["README.txt"]);
    expect(readme).toContain("- identity: NOT_RUN");
    expect(readme).toContain("- assembly: NOT_RUN");
    expect(readme).toContain("Each PASS covers its recorded method and sampled conditions");
    expect(readme).toContain("physical operation");
    expect(readme).toContain("Digital evidence only");
    expect(readme).toContain("reconstruction timeout is an execution budget");
    expect(readme).toContain("- sourceMotion: NOT_RUN");
    expect(readme).toContain("- rigidMotion: NOT_RUN");
    // No contract was supplied, so the archive says so rather than implying approval.
    expect(readme).toContain("confirmation not evaluated");
    expect(readme).toContain("contract binding: unavailable");
    expect(manifest.contract.evidenceCurrent).toBeNull();
  });

  test("reused parts export one mesh with explicit manufacturing quantity", async () => {
    const repeated = spec([{ id: "base", selector: "base", source: "generated" }, { id: "lid", selector: "lid", source: "generated" }]);
    repeated.instances.push({ ...repeated.instances[1], id: "lid-2", transform: [...pose] });
    const bundle = await buildAssemblyBundle({ scadSource: "cube(1);", spec: repeated, render: renderWith(meshes) });
    const files = unzipSync(bundle.zip);
    expect(Object.keys(files).filter(name => name.endsWith(".stl"))).toHaveLength(2);
    expect(bundle.manifest.parts.find(p => p.id === "lid")?.quantity).toBe(2);
    expect(bundle.manifest.instances).toHaveLength(3);
    expect(strFromU8(files["README.txt"])).toContain("lid: 2 (generated)");
  });

  test("an unconfirmed contract is printed on the archive instead of being hidden", async () => {
    const bundle = await buildAssemblyBundle({
      scadSource: "cube(1);",
      spec: spec([{ id: "base", selector: "base", source: "generated" }, { id: "lid", selector: "lid", source: "generated" }]),
      render: renderWith(meshes), modifiedAt: new Date("2020-01-01T00:00:00Z"),
      contractGate: { evidenceCurrent: false, reason: "The contract has not been confirmed." },
    });
    const entries = unzipSync(new Uint8Array(bundle.zip));
    const readme = strFromU8(entries["README.txt"]);
    expect(readme).toContain("Requirement contract:");
    expect(readme).toContain("- NOT CONFIRMED");
    expect(readme).toContain("The contract has not been confirmed.");
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.contract.evidenceCurrent).toBe(false);
    // The archive must not resurrect a PASS the manifest had downgraded.
    expect(manifest.evidence.identity.status).toBe("NOT_RUN");
    expect(manifest.evidence.identity.distinctness).toBeDefined();
  });

  test("the export statement is generated from the fit evidence that was measured", async () => {
    const jointSpec = {
      ...spec([{ id: "bore", selector: "bore", source: "generated" }, { id: "shaft", selector: "shaft", source: "generated" }]),
      connections: [{
        id: "joint", type: "revolute", a: "bore-1", b: "shaft-1",
        frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
        range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
      }],
    };
    const meshes = {
      bore: tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
      shaft: prismStl({ radius: 3, height: 12, segments: 64, z0: -1 }),
    };
    const bundle = await buildAssemblyBundle({
      scadSource: "cube(1);", spec: jointSpec, render: renderWith(meshes),
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-1", diametralClearanceMm: { min: 0.35, max: 0.45 } }],
      modifiedAt: new Date("2020-01-01T00:00:00Z"),
    });
    const entries = unzipSync(new Uint8Array(bundle.zip));
    const readme = strFromU8(entries["README.txt"]);
    expect(readme).toContain("- assembly: NOT_RUN");
    expect(readme).toContain("- reconstruction: NOT_RUN");
    expect(bundle.manifest.fits[0].measuredStatus).toBe("PASS");
    expect(readme).toContain("diametral clearance");
    expect(readme).toContain("- motion: NOT_RUN");
    expect(bundle.manifest.fits[0].status).toBe("PASS");
  });

  test("the same inputs produce the same archive bytes", async () => {
    const input = { scadSource: "cube(1);", spec: spec([{ id: "base", selector: "base", source: "generated" }, { id: "lid", selector: "lid", source: "generated" }]), render: renderWith(meshes), modifiedAt: new Date("2020-01-01T00:00:00Z") };
    const first = await buildAssemblyBundle(input);
    const second = await buildAssemblyBundle(input);
    expect(first.sha256).toBe(second.sha256);
  });

  test("an ignored selector refuses to produce a bundle", async () => {
    const same = boxStl([10, 10, 2]);
    await expect(buildAssemblyBundle({
      scadSource: "cube(1);", spec: spec([{ id: "base", selector: "base", source: "generated" }, { id: "lid", selector: "lid", source: "generated" }]),
      render: renderWith({ base: same, lid: same }),
    })).rejects.toThrow(AssemblyIdentityError);
  });

  test("purchased parts are listed but not invented as files", async () => {
    const bundle = await buildAssemblyBundle({
      scadSource: "cube(1);", spec: spec([{ id: "base", selector: "base", source: "generated" }, { id: "screw", selector: "screw", source: "purchased" }]),
      render: async () => ({ parts: [{ partId: "base", stl: meshes.base, sha256: createHash("sha256").update(meshes.base).digest("hex"), triangleCount: 4, diagnostics: "" }], purchasedPartIds: ["screw"] }),
    });
    const entries = unzipSync(new Uint8Array(bundle.zip));
    expect(Object.keys(entries).sort()).toEqual(["README.txt", "base.stl", "manifest.json", "specification.json"]);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.parts[1]).toMatchObject({ id: "screw", source: "purchased", fileName: null, artifactSha256: null });
  });

  test("a missing generated part fails the whole bundle instead of shipping a partial one", async () => {
    await expect(buildAssemblyBundle({
      scadSource: "cube(1);", spec: spec([{ id: "base", selector: "base", source: "generated" }, { id: "lid", selector: "lid", source: "generated" }]),
      render: renderWith({ base: meshes.base }),
    })).rejects.toThrow("Missing generated part artifact");
  });
});

describe("declared disassembly in the archive", () => {
  const lift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2.5, 0, 0, 0, 1];
  const spec = () => ({
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "plate", name: "Plate", selector: "plate", source: "generated", material: null },
      { id: "lid", name: "Lid", selector: "lid", source: "generated", material: null },
    ],
    instances: [
      { id: "plate1", partId: "plate", subassemblyId: null, transform: pose },
      { id: "lid1", partId: "lid", subassemblyId: null, transform: lift },
    ],
    subassemblies: [], connections: [], groundedInstanceId: "plate1", motions: [],
    operations: [{ id: "remove_lid", action: "disassemble", instanceId: "lid1", tools: [],
      waypoints: [lift, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 22.5, 0, 0, 0, 1]] }],
    manufacturing: null, assumptions: [], unknowns: [],
  });
  const meshes = { plate: solidBox([0, 0, 0], [10, 10, 2]), lid: solidBox([0, 0, 0], [4, 4, 4]) };

  test("archive preserves a parameterized trajectory and its contract-gated sampled evidence", async () => {
    const original=spec();
    const trajectory={axis:{origin:[0,0,0],direction:[0,0,1]},hand:"right",leadMm:20,startAngleDeg:0,endAngleDeg:360};
    const declared={...original,operations:[{...original.operations[0],waypoints:[],screwTrajectory:trajectory}]};
    const args={scadSource:"cube(1);",spec:declared,render:renderWith(meshes),modifiedAt:new Date("2020-01-01T00:00:00Z")};
    const confirmed=await buildAssemblyBundle({...args,contractGate:{evidenceCurrent:true}});
    const archive=unzipSync(confirmed.zip);
    const manifest=JSON.parse(strFromU8(archive["manifest.json"]));
    const declaration=JSON.parse(strFromU8(archive["specification.json"]));
    expect(declaration.operations[0].screwTrajectory).toEqual(trajectory);
    expect(createHash("sha256").update(archive["specification.json"]).digest("hex")).toBe(manifest.specificationSha256);
    expect(manifest.declaredDisassembly.measuredStatus).toBe("PASS");
    expect(manifest.evidence.disassembly.status).toBe("PASS");
    expect(manifest.declaredDisassembly.results[0].path.posesEvaluated).toBeGreaterThan(72);
    expect(manifest.declaredDisassembly.specificationSha256).toBe(manifest.specificationSha256);
    const unconfirmed=await buildAssemblyBundle({...args,contractGate:{evidenceCurrent:false,reason:"Not confirmed."}});
    const gated=JSON.parse(strFromU8(unzipSync(unconfirmed.zip)["manifest.json"]));
    expect(gated.evidence.disassembly.status).toBe("NOT_RUN");
    expect(gated.declaredDisassembly.measuredStatus).toBe("PASS");
  });

  test("the same declared removal produces identical archive bytes", async () => {
    const input = { scadSource: "cube(1);", spec: spec(), render: renderWith(meshes),
      contractGate: { evidenceCurrent: true }, modifiedAt: new Date("2020-01-01T00:00:00Z") };
    const first = await buildAssemblyBundle(input);
    const second = await buildAssemblyBundle(input);
    expect(first.manifest.evidence.disassembly.status).toBe("PASS");
    expect(second.manifest.evidence.disassembly.status).toBe("PASS");
    expect(first.sha256).toBe(second.sha256);
    expect(first.zip.equals(second.zip)).toBe(true);
    const manifest = JSON.parse(strFromU8(unzipSync(first.zip)["manifest.json"]));
    expect(manifest.declaredDisassembly.budgetMs).toBe(5000);
    expect(manifest.declaredDisassembly.elapsedMs).toBeUndefined();
    expect(manifest.declaredDisassembly.results[0].path.budgetMs).toBeUndefined();
    expect(manifest.declaredDisassembly.results[0].path.posesEvaluated).toBeGreaterThan(2);
  });

  test("an exhausted sampling budget stays NOT_RUN in the archive", async () => {
    let now = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => { now += 1000; return now; });
    try {
      const bundle = await buildAssemblyBundle({ scadSource: "cube(1);", spec: spec(), render: renderWith(meshes),
        contractGate: { evidenceCurrent: true } });
      const manifest = JSON.parse(strFromU8(unzipSync(bundle.zip)["manifest.json"]));
      expect(manifest.evidence.disassembly.status).toBe("NOT_RUN");
      expect(manifest.declaredDisassembly.measuredStatus).toBe("NOT_RUN");
      expect(manifest.declaredDisassembly.results[0].status).toBe("NOT_RUN");
      expect(manifest.declaredDisassembly.results[0].reason).toBe("Path exceeded its remaining sequence evaluation budget");
      expect(manifest.declaredDisassembly.results[0].path.reason).toBe("Path exceeded its remaining sequence evaluation budget");
      expect(manifest.declaredDisassembly.results[0].path.budgetMs).toBeUndefined();
      expect(manifest.declaredDisassembly.budgetMs).toBe(5000);
    } finally {
      clock.mockRestore();
    }
  });

  test("the archive carries the gated verdict and keeps the raw measurement beside it", async () => {
    const confirmed = await buildAssemblyBundle({ scadSource: "cube(1);", spec: spec(), render: renderWith(meshes), contractGate: { evidenceCurrent: true } });
    const entries = unzipSync(new Uint8Array(confirmed.zip));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.evidence.disassembly.status).toBe("PASS");
    expect(manifest.declaredDisassembly.measuredStatus).toBe("PASS");
    // The path evidence names the declaration it was measured against, so a
    // later spec edit cannot silently inherit this verdict.
    expect(manifest.declaredDisassembly.specificationSha256).toBe(manifest.specificationSha256);
    expect(strFromU8(entries["README.txt"])).toContain("- disassembly: PASS");

    const unconfirmed = await buildAssemblyBundle({ scadSource: "cube(1);", spec: spec(), render: renderWith(meshes), contractGate: { evidenceCurrent: false, reason: "Not confirmed." } });
    const gatedEntries = unzipSync(new Uint8Array(unconfirmed.zip));
    const gated = JSON.parse(strFromU8(gatedEntries["manifest.json"]));
    expect(gated.evidence.disassembly.status).toBe("NOT_RUN");
    expect(gated.declaredDisassembly.status).toBe("NOT_RUN");
    expect(gated.declaredDisassembly.measuredStatus).toBe("PASS");
    const readme = strFromU8(gatedEntries["README.txt"]);
    expect(readme).toContain("NOT CONFIRMED");
    expect(readme).toContain("- disassembly: NOT_RUN");
    expect(readme).not.toContain("- disassembly: PASS");
  });

  test("a blocked removal is archived as a failure, not as an unverified one", async () => {
    const blocked = await buildAssemblyBundle({ scadSource: "cube(1);", spec: spec(), render: renderWith({ ...meshes, plate: mergeStl(meshes.plate, solidBox([0, 0, 7], [4, 4, 9])) }), contractGate: { evidenceCurrent: false } });
    const entries = unzipSync(new Uint8Array(blocked.zip));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.evidence.disassembly.status).toBe("FAIL");
    expect(strFromU8(entries["README.txt"])).toContain("- disassembly: FAIL");
  });
});


describe("bundle README mechanism dimensions", () => {
  test("prints only measured dimensions and labels the digital basis", () => {
    expect(mechanismDimensionLines(undefined)).toEqual([]);
    expect(mechanismDimensionLines({ status: "NOT_RUN", crankRadiusMm: null, rodLengthMm: null })).toEqual([]);
    const lines = mechanismDimensionLines({ status: "MEASURED", crankRadiusMm: 8, rodLengthMm: 28 });
    expect(lines[0]).toContain("digital mesh sections");
    expect(lines[1]).toBe("- crank radius: 8.000 mm");
    expect(lines[2]).toBe("- rod length: 28.000 mm");
  });
});
