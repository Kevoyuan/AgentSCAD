/** Recheck archived meshes with the current original collision verifier. No rendering or generation. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readBinaryStl } from "../../src/lib/geometry/stl-mesh";
import { bvhIntersects, buildBvh, placeBvh } from "../../src/lib/geometry/mesh-collision";
const root = process.cwd();
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const source = readFileSync(`${root}/src/lib/geometry/mesh-collision.ts`);
const base = `${root}/.agentscad/experiments`;
const out = `${base}/collision-shell-recheck-${Date.now()}`;
mkdirSync(out, { recursive: true });
const rows: unknown[] = [];
function check(group: string, a: string, b: string) {
  const ba = readFileSync(`${base}/${a}`), bb = readFileSync(`${base}/${b}`);
  const start = performance.now();
  const result = bvhIntersects(placeBvh(buildBvh(readBinaryStl(ba))), placeBvh(buildBvh(readBinaryStl(bb))), { maxPairTests: 4_000_000 });
  rows.push({ group, a, b, aSha256: sha(ba), bSha256: sha(bb), elapsedMs: performance.now() - start, ...result });
}
for (let angle = 0; angle <= 4320; angle += 90)
  check("thread", `thread-exit-Q5psOX/turn-${angle}-bolt.stl`, `thread-exit-Q5psOX/turn-${angle}-nut.stl`);
const names = ["frame", "crank", "rod", "slider", "eccentric_key", "main_key", "guide_front", "guide_lock_left", "guide_lock_right"];
for (let angle = 0; angle <= 360; angle += 45)
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
    check("slider", `slider-crank-o4zHCT/${angle}-${names[i]}.stl`, `slider-crank-o4zHCT/${angle}-${names[j]}.stl`);
check("quarter-turn", "quarter-turn-9PzhLN/pin.stl", "quarter-turn-9PzhLN/sleeve.stl");
writeFileSync(`${out}/collision-source.ts`, source);
writeFileSync(`${out}/script.ts`, readFileSync(import.meta.path));
writeFileSync(`${out}/report.json`, JSON.stringify({ collisionSourceSha256: sha(source), rows }, null, 2));
console.log(JSON.stringify({out, counts: rows.reduce((acc: Record<string, number>, row: any) => { const k = `${row.group}:${row.status}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})}));
