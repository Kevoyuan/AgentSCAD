import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateAssemblySpec } from "../assembly/assembly-spec";
import { assemblySpecificationHash } from "../assembly/spec-hash";
import { readBinaryStl, type TriangleMesh } from "../geometry/stl-mesh";
import { collectOpenScadWarnings, renderStl, type ScadExecutionOptions } from "./scad-renderer";

const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const MAX_TRIANGLES = 50_000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const DEFAULT_BUDGET_MS = 15_000;

export interface ReconstructionEvidence {
  status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN";
  reason: string;
  method: "placed-oriented-triangles-or-boolean/v1";
  comparison: "exact-oriented-triangles" | "mesh-symmetric-difference" | null;
  coverage: string;
  specificationSha256: string | null;
  assemblySha256: string | null;
  partSha256: Record<string, string>;
  instanceIds: string[];
  budgetMs: number;
  residualTriangles: number | null;
  residualVolumeMm3: number | null;
  differenceSha256: string | null;
  diagnostics: string;
}

/** Topological admission only; it does not detect self-intersection or certify CAD semantics. */
function boundaryFailure(mesh: TriangleMesh): string | null {
  const edges = new Map<string, { count: number; orientation: number }>();
  const { coordinates: c } = mesh;
  for (let i = 0; i < c.length; i += 9) {
    const ids = [0, 3, 6].map(j => `${c[i+j]},${c[i+j+1]},${c[i+j+2]}`);
    const u = [c[i+3]-c[i], c[i+4]-c[i+1], c[i+5]-c[i+2]];
    const v = [c[i+6]-c[i], c[i+7]-c[i+1], c[i+8]-c[i+2]];
    if (Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) <= 1e-12) return `Triangle ${i/9} is degenerate at the admitted numerical precision`;
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j+1)%3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const edge = edges.get(key) ?? { count: 0, orientation: 0 };
      edge.count++; edge.orientation += a < b ? 1 : -1;
      if (edge.count > 2) return "An edge has more than two incident triangles";
      edges.set(key, edge);
    }
  }
  const bad = [...edges.values()].filter(edge => edge.count !== 2 || edge.orientation !== 0);
  return bad.length ? `${bad.length} edges are open or inconsistently oriented` : null;
}

/** Preserve exact mesh coordinates. OpenSCAD polyhedron faces use inward winding. */
function polyhedron(mesh: TriangleMesh): string {
  const points: number[][] = [], faces: number[][] = [], indices = new Map<string, number>();
  for (let i = 0; i < mesh.coordinates.length; i += 9) {
    const face: number[] = [];
    for (let j = 0; j < 9; j += 3) {
      const point = Array.from(mesh.coordinates.subarray(i+j, i+j+3));
      const key = point.join(",");
      let index = indices.get(key);
      if (index === undefined) { index = points.length; indices.set(key, index); points.push(point); }
      face.push(index);
    }
    faces.push(face.reverse());
  }
  return `polyhedron(points=${JSON.stringify(points)},faces=${JSON.stringify(faces)},convexity=10);`;
}

function volume(mesh: TriangleMesh, origin: number[]): number {
  let sum = 0;
  const c = mesh.coordinates;
  for (let i = 0; i < c.length; i += 9) {
    const a = [c[i]-origin[0],c[i+1]-origin[1],c[i+2]-origin[2]];
    const b = [c[i+3]-origin[0],c[i+4]-origin[1],c[i+5]-origin[2]];
    const d = [c[i+6]-origin[0],c[i+7]-origin[1],c[i+8]-origin[2]];
    sum += (a[0]*(b[1]*d[2]-b[2]*d[1])+a[1]*(b[2]*d[0]-b[0]*d[2])+a[2]*(b[0]*d[1]-b[1]*d[0]))/6;
  }
  return sum;
}

/**
 * Compare the complete delivered mesh with a union of EVERY declared instance.
 * A disjoint unit cube keeps even an empty symmetric difference renderable on
 * native and WASM backends. PASS requires only that verified sentinel remains;
 * a nonempty zero-volume residue is NOT_RUN, never accepted as equal.
 *
 * This is mesh Boolean equality at one pose and kernel precision, not a proof
 * of identity, joint constraints, continuous motion, or physical function.
 */
export async function checkAssemblyReconstruction(input: {
  spec: unknown;
  meshes: Record<string, Buffer>;
  assemblyMesh?: Buffer | null;
  options?: ScadExecutionOptions;
  budgetMs?: number;
  /** Test seam; normal calls always use the product OpenSCAD executor. */
  render?: typeof renderStl;
}): Promise<ReconstructionEvidence> {
  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS;
  const result: ReconstructionEvidence = {
    status: "NOT_RUN", reason: "", method: "placed-oriented-triangles-or-boolean/v1", comparison:null,
    coverage: "Union of all declared local meshes placed by their rigid instance transforms versus the complete delivered mesh at one pose. Exact-empty Boolean residue at kernel precision; no geometric error bound, self-intersection certification, semantic identity, motion or physical claim.",
    specificationSha256: null, assemblySha256: null, partSha256: {}, instanceIds: [], budgetMs,
    residualTriangles: null, residualVolumeMm3: null, differenceSha256: null, diagnostics: "",
  };
  const finish = (status: ReconstructionEvidence["status"], reason: string) => ({ ...result, status, reason });
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000) return finish("ERROR", "Invalid reconstruction time budget.");
  input.options?.signal?.throwIfAborted();
  const started = Date.now();
  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, budgetMs);
  const signal = input.options?.signal ? AbortSignal.any([input.options.signal, controller.signal]) : controller.signal;
  let workspace: string | null = null;
  try {
    const parsed = validateAssemblySpec(input.spec);
    if (!parsed.success) return finish("ERROR", "Invalid assembly specification.");
    const spec = parsed.data;
    result.specificationSha256 = assemblySpecificationHash(spec);
    result.instanceIds = spec.instances.map(instance => instance.id);
    if (!input.assemblyMesh) return finish("NOT_RUN", "No complete-assembly mesh is available for reconstruction comparison.");
    result.assemblySha256 = hash(input.assemblyMesh);
    const required = new Set(spec.instances.map(instance => instance.partId));
    const missing = [...required].filter(id => !input.meshes[id]);
    if (missing.length) return finish("NOT_RUN", `No mesh for declared part(s): ${missing.join(", ")}; purchased parts cannot be silently omitted.`);
    const triangleCount = (buffer:Buffer) => {
      if(!Buffer.isBuffer(buffer)||buffer.length<84)throw new Error("Invalid binary STL header");
      const count=buffer.readUInt32LE(80);
      if(!count||84+50*count!==buffer.length)throw new Error("Invalid binary STL triangle table");
      return count;
    };
    const total=triangleCount(input.assemblyMesh)+spec.instances.reduce((sum,instance)=>sum+triangleCount(input.meshes[instance.partId]),0);
    if (total > MAX_TRIANGLES) return finish("NOT_RUN", `Reconstruction exceeds the ${MAX_TRIANGLES} placed-triangle budget.`);
    const complete = readBinaryStl(input.assemblyMesh);
    const meshes = new Map([...required].map(id => {
      result.partSha256[id] = hash(input.meshes[id]);
      return [id, readBinaryStl(input.meshes[id])] as const;
    }));
    for (const [id,mesh] of [["delivered assembly",complete],...[...meshes]] as Array<[string,TriangleMesh]>) {
      const failure = boundaryFailure(mesh);
      if (failure) return finish("ERROR", `Invalid reconstruction boundary (${id}): ${failure}.`);
      if (!(volume(mesh,Array.from(mesh.coordinates.subarray(0,3))) > 1e-9)) return finish("ERROR", `Input boundary (${id}) has no resolved positive signed volume.`);
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const include = (x: number, y: number, z: number) => {
      for (const [k, value] of [x,y,z].entries()) { min[k] = Math.min(min[k], value); max[k] = Math.max(max[k], value); }
    };
    for (let i = 0; i < complete.coordinates.length; i += 3) include(complete.coordinates[i],complete.coordinates[i+1],complete.coordinates[i+2]);
    for (const instance of spec.instances) {
      const c = meshes.get(instance.partId)!.coordinates, m = instance.transform;
      for (let i = 0; i < c.length; i += 3) include(m[0]*c[i]+m[1]*c[i+1]+m[2]*c[i+2]+m[3],m[4]*c[i]+m[5]*c[i+1]+m[6]*c[i+2]+m[7],m[8]*c[i]+m[9]*c[i+1]+m[10]*c[i+2]+m[11]);
    }
    if ([...min,...max].some(value => !Number.isFinite(value) || Math.abs(value) > 100_000)) return finish("NOT_RUN", "Coordinates exceed the admitted ±100000 mm Boolean domain.");
    // Exact oriented triangle multisets certify the same placed mesh without
    // rerunning CGAL. There is no rounding, centroid sampling, bbox shortcut or
    // winding reversal here. Retessellated unions fall through to the Boolean.
    const key=(vertices:number[][])=>[0,1,2].map(i=>[vertices[i],vertices[(i+1)%3],vertices[(i+2)%3]].flat().join(",")).sort()[0];
    const expectedCount=total-complete.triangleCount;
    if(expectedCount===complete.triangleCount) {
      const counts=new Map<string,number>();
      for(let i=0;i<complete.coordinates.length;i+=9) {
        const k=key([0,3,6].map(j=>Array.from(complete.coordinates.subarray(i+j,i+j+3))));counts.set(k,(counts.get(k)??0)+1);
      }
      let equal=true;
      outer:for(const instance of spec.instances) {
        const c=meshes.get(instance.partId)!.coordinates,m=instance.transform;
        for(let i=0;i<c.length;i+=9) {
          const k=key([0,3,6].map(j=>[m[0]*c[i+j]+m[1]*c[i+j+1]+m[2]*c[i+j+2]+m[3],m[4]*c[i+j]+m[5]*c[i+j+1]+m[6]*c[i+j+2]+m[7],m[8]*c[i+j]+m[9]*c[i+j+1]+m[10]*c[i+j+2]+m[11]]));
          const count=counts.get(k)??0;if(!count){equal=false;break outer;}counts.set(k,count-1);
        }
      }
      if(equal) {
        if(Date.now()-started>=budgetMs)return finish("NOT_RUN","Reconstruction exhausted its time budget during exact triangle comparison.");
        result.comparison="exact-oriented-triangles";result.residualTriangles=0;
        // No Boolean volume was measured in this branch.
        return finish("PASS","Every placed exported triangle has an exactly equal, equally oriented delivered triangle, including multiplicity, at this pose.");
      }
    }
    result.comparison="mesh-symmetric-difference";
    const sentinel = [Math.floor(min[0])-4, Math.floor(min[1])-4, Math.floor(min[2])-4];
    const indices = new Map([...meshes.keys()].map((id,i) => [id,i]));
    const source = [
      ...[...meshes].map(([id,mesh]) => `module part_${indices.get(id)}(){${polyhedron(mesh)}}`),
      `module delivered(){${polyhedron(complete)}}`,
      "module rebuilt(){union(){",
      ...spec.instances.map(instance => `multmatrix(${JSON.stringify([0,1,2,3].map(row=>instance.transform.slice(row*4,row*4+4)))}) part_${indices.get(instance.partId)}();`),
      "}}",
      `union(){translate(${JSON.stringify(sentinel)}) cube(1); difference(){rebuilt();delivered();} difference(){delivered();rebuilt();}}`,
    ].join("\n");
    if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) return finish("NOT_RUN", "Reconstruction source exceeds its 12 MiB budget.");
    // Synchronous admission/serialization also consumes the overall budget.
    if (Date.now()-started >= budgetMs) return finish("NOT_RUN", "Reconstruction exhausted its time budget before rendering.");
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentscad-reconstruction-"));
    const sourcePath = path.join(workspace, "difference.scad"), outputPath = path.join(workspace, "difference.stl");
    await fs.writeFile(sourcePath, source);
    result.diagnostics = await (input.render ?? renderStl)(sourcePath, outputPath, undefined, { ...input.options, signal });
    signal.throwIfAborted();
    if (collectOpenScadWarnings(result.diagnostics).length) return finish("ERROR", "OpenSCAD reported diagnostics that prevent an equality certificate.");
    if ((await fs.stat(outputPath)).size > 64*1024*1024) return finish("NOT_RUN", "Boolean output exceeds its 64 MiB budget.");
    const output = await fs.readFile(outputPath);
    result.differenceSha256 = hash(output);
    const mesh = readBinaryStl(output), marker: number[] = [], residue: number[] = [];
    for (let i = 0; i < mesh.coordinates.length; i += 9) {
      let inside = 0;
      for (let j = 0; j < 9; j += 3) if ([0,1,2].every(k => mesh.coordinates[i+j+k] >= sentinel[k]-1e-7 && mesh.coordinates[i+j+k] <= sentinel[k]+1+1e-7)) inside++;
      if (inside && inside !== 3) return finish("ERROR", "Boolean output crosses the isolated sentinel boundary.");
      (inside ? marker : residue).push(...mesh.coordinates.subarray(i,i+9));
    }
    const markerMesh = { coordinates: new Float64Array(marker), triangleCount: marker.length/9 };
    if (markerMesh.triangleCount !== 12 || boundaryFailure(markerMesh) || Math.abs(volume(markerMesh,sentinel)-1) > 1e-6) return finish("ERROR", "Boolean output did not preserve the closed unit sentinel.");
    result.residualTriangles = residue.length/9;
    if (!residue.length) {
      result.residualVolumeMm3 = 0;
      return finish("PASS", "The complete delivered mesh equals the union of all placed exported instances under the mesh Boolean comparison at this pose.");
    }
    const residual = { coordinates: new Float64Array(residue), triangleCount: residue.length/9 };
    if (boundaryFailure(residual)) return finish("NOT_RUN", "A nonempty Boolean residue is not a closed boundary; equality and positive-volume mismatch are unresolved.");
    const measuredVolume = volume(residual,min);
    if (!Number.isFinite(measuredVolume) || measuredVolume <= 1e-9) return finish("NOT_RUN", "A nonempty Boolean residue has no resolved positive signed volume; equality is not established.");
    result.residualVolumeMm3 = measuredVolume;
    return finish("FAIL", `Placed exported instances and the delivered assembly differ by ${measuredVolume.toPrecision(8)} mm³ of symmetric-difference mesh volume.`);
  } catch (error) {
    input.options?.signal?.throwIfAborted();
    if (timedOut || Date.now()-started >= budgetMs) return finish("NOT_RUN", `Reconstruction exceeded its ${budgetMs} ms budget.`);
    return finish("ERROR", `Reconstruction could not be measured: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    if (workspace) await fs.rm(workspace, { recursive: true, force: true });
  }
}
