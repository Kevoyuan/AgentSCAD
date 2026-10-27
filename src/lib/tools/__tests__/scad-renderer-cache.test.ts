import { expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

test("native validation STL and diagnostics are reused, but parameter overrides recompile", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentscad-cache-test-"));
  try {
    const bin = path.join(dir, "fake-openscad");
    const count = path.join(dir, "calls");
    await writeFile(bin, `#!${process.execPath}\n
import {writeFileSync,appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(count)}, 'compile\\n');
const args=process.argv.slice(2);
if (!args.includes('binstl')) process.exit(2);
const stl=Buffer.alloc(134); stl.writeUInt32LE(1,80);
stl.writeFloatLE(1,108); stl.writeFloatLE(1,124);
writeFileSync(args[args.indexOf('-o')+1],stl);
console.error('WARNING: Ignoring unknown module missing_feature');
`);
    await chmod(bin, 0o755);
    const renderer = path.resolve("src/lib/tools/scad-renderer.ts");
    const result = spawnSync(process.execPath, ["-e", `
import {writeFile,stat} from 'node:fs/promises';
import {validateGeneratedScadSource,renderStl,renderStlPreview} from ${JSON.stringify(renderer)};
const dir=${JSON.stringify(dir)};
const source='cube(10);';
await writeFile(dir+'/source.scad',source);
await validateGeneratedScadSource(source);
const diagnostics=await renderStl(dir+'/source.scad',dir+'/mesh.stl');
const preview=await renderStlPreview(dir+'/mesh.stl',dir+'/preview.png');
await renderStl(dir+'/source.scad',dir+'/override.stl',{width:20});
console.log(JSON.stringify({diagnostics,triangles:preview.triangleCount,pngBytes:(await stat(dir+'/preview.png')).size}));
`], { encoding: "utf8", timeout: 10000, env: { ...process.env, OPENSCAD_BIN: bin, AGENTSCAD_OPENSCAD_BACKEND: "native" } });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.diagnostics).toContain("WARNING: Ignoring unknown module");
    expect(output.triangles).toBe(1);
    expect(output.pngBytes).toBeGreaterThan(0);
    expect(await readFile(count, "utf8")).toBe("compile\ncompile\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("native exec timeout with empty stderr becomes a typed actionable validation timeout", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentscad-timeout-test-"));
  try {
    const bin = path.join(dir, "slow-openscad");
    await writeFile(bin, `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`);
    await chmod(bin, 0o755);
    const result = spawnSync(process.execPath, ["-e", `
import {validateGeneratedScadSource} from ${JSON.stringify(path.resolve("src/lib/tools/scad-renderer.ts"))};
try { await validateGeneratedScadSource('cube(1);'); process.exit(2); }
catch (error) { console.log(JSON.stringify({name:error.name,stage:error.stage,timeoutMs:error.timeoutMs,elapsedMs:error.elapsedMs,message:error.message})); }
`], { encoding: "utf8", timeout: 9000, env: { ...process.env, OPENSCAD_BIN: bin, AGENTSCAD_OPENSCAD_BACKEND: "native", AGENTSCAD_OPENSCAD_TIMEOUT_MS: "5000" } });
    expect(result.status, result.stderr).toBe(0);
    const error = JSON.parse(result.stdout.trim());
    expect(error).toMatchObject({ name: "OpenScadTimeoutError", stage: "validation", timeoutMs: 5000 });
    expect(error.elapsedMs).toBeGreaterThanOrEqual(4900);
    expect(error.message).toContain("Simplify");
    expect(error.message).toContain("signal=SIGTERM");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test("dense native meshes fall back to OpenSCAD PNG when mesh projection is too large", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentscad-preview-fallback-test-"));
  try {
    const bin = path.join(dir, "fake-openscad");
    const count = path.join(dir, "calls");
    // 1x1 PNG: the fallback path only needs a file; the OpenSCAD renderer is
    // represented by the fake binary, not by sharp.
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await writeFile(bin, `#!${process.execPath}\n
import {writeFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
const out=args[args.indexOf('-o')+1];
if (args.includes('binstl')) {
  appendFileSync(${JSON.stringify(count)}, 'stl\\n');
  const triangles=100001;
  const stl=Buffer.alloc(84+triangles*50);
  stl.writeUInt32LE(triangles,80);
  writeFileSync(out,stl);
} else {
  appendFileSync(${JSON.stringify(count)}, 'png\\n');
  writeFileSync(out,Buffer.from(${JSON.stringify(pngBase64)},'base64'));
}
`);
    await chmod(bin, 0o755);
    const result = spawnSync(process.execPath, ["-e", `
import {renderScadArtifacts} from ${JSON.stringify(path.resolve("src/lib/tools/scad-renderer.ts"))};
import {stat} from 'node:fs/promises';
const artifacts=await renderScadArtifacts('job_preview_fallback','cube(10);');
console.log(JSON.stringify({triangles:artifacts.renderLog.stl_triangles,pngBytes:(await stat(artifacts.pngFilePath)).size}));
`], { encoding: "utf8", timeout: 15000, env: { ...process.env, OPENSCAD_BIN: bin, AGENTSCAD_OPENSCAD_BACKEND: "native", AGENTSCAD_ARTIFACT_WORK_DIR: dir } });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.triangles).toBe(100001);
    expect(output.pngBytes).toBeGreaterThan(0);
    expect(await readFile(count, "utf8")).toBe("stl\npng\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test("cancelling native compilation kills its child without waiting for the timeout budget", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentscad-abort-test-"));
  try {
    const bin = path.join(dir, "slow-openscad");
    await writeFile(bin, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(path.join(dir, "pid"))},String(process.pid)); setTimeout(() => {},60000);\n`);
    await chmod(bin, 0o755);
    const result = spawnSync(process.execPath, ["-e", `
import {readFile} from 'node:fs/promises';
import {validateGeneratedScadSource} from ${JSON.stringify(path.resolve("src/lib/tools/scad-renderer.ts"))};
const control=new AbortController();
const pending=validateGeneratedScadSource('cube(1);',{signal:control.signal});
let pid;
for(let i=0;i<100;i++){try{pid=Number(await readFile(${JSON.stringify(path.join(dir,"pid"))},'utf8'));break;}catch{await Bun.sleep(20);}}
if(!pid) throw new Error('Child never started');
control.abort(new Error('user cancelled'));
try{await pending;throw new Error('Unexpected success');}catch(e){if(e.message!=='user cancelled')throw e;}
for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{console.log('child stopped');process.exit(0);}await Bun.sleep(20);}
throw new Error('Orphan child remains');
`], { encoding:"utf8", timeout:8000, env:{...process.env,OPENSCAD_BIN:bin,AGENTSCAD_OPENSCAD_BACKEND:"native",AGENTSCAD_OPENSCAD_TIMEOUT_MS:"3000000"} });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('child stopped');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("colored native sources use the OpenSCAD PNG renderer so color() survives", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentscad-color-preview-test-"));
  try {
    const bin = path.join(dir, "fake-openscad");
    const count = path.join(dir, "calls");
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await writeFile(bin, `#!${process.execPath}\n
import {writeFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
const out=args[args.indexOf('-o')+1];
if (args.includes('binstl')) {
  appendFileSync(${JSON.stringify(count)}, 'stl\\n');
  const stl=Buffer.alloc(134); stl.writeUInt32LE(1,80);
  writeFileSync(out,stl);
} else {
  appendFileSync(${JSON.stringify(count)}, 'png\\n');
  writeFileSync(out,Buffer.from(${JSON.stringify(pngBase64)},'base64'));
}
`);
    await chmod(bin, 0o755);
    const result = spawnSync(process.execPath, ["-e", `
import {renderScadArtifacts} from ${JSON.stringify(path.resolve("src/lib/tools/scad-renderer.ts"))};
import {stat} from 'node:fs/promises';
const artifacts=await renderScadArtifacts('job_colored_preview', 'color("red") cube(10);');
console.log(JSON.stringify({triangles:artifacts.renderLog.stl_triangles,pngBytes:(await stat(artifacts.pngFilePath)).size}));
`], { encoding: "utf8", timeout: 15000, env: { ...process.env, OPENSCAD_BIN: bin, AGENTSCAD_OPENSCAD_BACKEND: "native", AGENTSCAD_ARTIFACT_WORK_DIR: dir } });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.triangles).toBe(1);
    expect(output.pngBytes).toBeGreaterThan(0);
    // STL compile followed by the OpenSCAD PNG render (not the mesh projection).
    expect(await readFile(count, "utf8")).toBe("stl\npng\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
