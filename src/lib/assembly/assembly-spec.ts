import { z } from "zod";

/**
 * An assembly specification is an intent contract, not proof that the source
 * geometry satisfies it. All coordinates are millimetres in a right-handed
 * system. A transform is row-major and maps part-local coordinates to the
 * assembly frame, with translation in entries 3, 7 and 11.
 */
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const text = z.string().trim().min(1).max(500);
const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const axis = vec3.refine((v) => Math.hypot(...v) > 1e-9, "Axis direction must be nonzero");
const transform = z.tuple([
  finite, finite, finite, finite,
  finite, finite, finite, finite,
  finite, finite, finite, finite,
  finite, finite, finite, finite,
]).superRefine((m, ctx) => {
  const eps = 1e-6;
  const err = (message: string) => ctx.addIssue({ code: "custom", message });
  if (Math.abs(m[12]) > eps || Math.abs(m[13]) > eps || Math.abs(m[14]) > eps || Math.abs(m[15] - 1) > eps) {
    err("Transform must have homogeneous last row [0, 0, 0, 1]");
  }
  const columns = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
  for (let i = 0; i < 3; i++) {
    for (let j = i; j < 3; j++) {
      const dot = columns[i].reduce((sum, n, k) => sum + n * columns[j][k], 0);
      if (Math.abs(dot - (i === j ? 1 : 0)) > eps) err("Transform rotation must be orthonormal");
    }
  }
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  if (Math.abs(det - 1) > eps) err("Transform must preserve handedness");
});
export function validateRigidTransform(input: unknown) {
  return transform.safeParse(input);
}

const range = z.object({ min: finite, max: finite, unit: z.enum(["mm", "deg"]) }).strict()
  .refine((r) => r.min <= r.max, "Range min must not exceed max");
const frame = z.object({ origin: vec3, direction: axis }).strict();

const part = z.object({
  id, name: text,
  /** Export selector is an identifier, never executable SCAD or a path. */
  selector: id,
  source: z.enum(["generated", "purchased"]),
  material: text.nullable(),
}).strict();
const instance = z.object({ id, partId: id, subassemblyId: id.nullable(), transform }).strict();
const subassembly = z.object({ id, name: text, parentId: id.nullable() }).strict();
const connection = z.object({
  id,
  type: z.enum(["fixed", "revolute", "prismatic", "screw", "gear", "other"]),
  a: id, b: id,
  /** Axes are expressed in each corresponding instance's local frame. */
  frameA: frame.nullable(), frameB: frame.nullable(),
  range: range.nullable(),
  // Unknown values are null; they must never be interpreted as zero.
  pitchMm: finite.positive().nullable(),
  ratio: finite.refine((n) => n !== 0, "Ratio must be nonzero").nullable(),
  /**
   * Which instance carries the bore. Optional so existing declarations keep
   * their exact hash; without it a fit measurement must be told the role.
   */
  boreInstanceId: id.optional(),
  allowedContact: z.array(text).max(100),
}).strict();
const motion = z.object({ id, inputConnectionId: id, range }).strict();
const manufacturing = z.object({
  process: text.nullable(), material: text.nullable(), machine: text.nullable(),
  notes: z.array(text).max(100),
}).strict();
const operation = z.object({
  id, action: z.enum(["assemble", "disassemble"]), instanceId: id,
  /** Waypoints are poses in the assembly frame, not an automatic collision proof. */
  waypoints: z.array(transform).max(200), tools: z.array(text).max(30),
  /** Ideal screw motion in world coordinates, starting at the instance's declared pose.
   * An optional field preserves the exact canonical form of earlier declarations. */
  screwTrajectory: z.object({
    axis: frame, hand: z.enum(["right", "left"]), leadMm: finite.positive(),
    startAngleDeg: finite, endAngleDeg: finite,
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.screwTrajectory && value.waypoints.length !== 0)
    ctx.addIssue({ code: "custom", path: ["waypoints"], message: "Screw trajectories require an empty waypoint array" });
  if (value.screwTrajectory && value.screwTrajectory.startAngleDeg === value.screwTrajectory.endAngleDeg)
    ctx.addIssue({ code: "custom", path: ["screwTrajectory"], message: "Screw trajectory must have nonzero travel" });
});

export const AssemblySpecSchema = z.object({
  schemaVersion: z.literal(1),
  units: z.literal("mm"),
  coordinateSystem: z.literal("right-handed"),
  parts: z.array(part).min(1).max(200),
  instances: z.array(instance).min(1).max(500),
  subassemblies: z.array(subassembly).max(200),
  connections: z.array(connection).max(1000),
  groundedInstanceId: id.nullable(),
  motions: z.array(motion).max(100),
  operations: z.array(operation).max(1000),
  manufacturing: manufacturing.nullable(),
  assumptions: z.array(text).max(100),
  unknowns: z.array(text).max(100),
}).strict().superRefine((spec, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const checkUnique = (items: {id: string}[], path: string) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id)) issue([path, i, "id"], `Duplicate ${path} ID: ${item.id}`);
      seen.add(item.id);
    });
    return seen;
  };
  const parts = checkUnique(spec.parts, "parts");
  const instances = checkUnique(spec.instances, "instances");
  const groups = checkUnique(spec.subassemblies, "subassemblies");
  const connections = checkUnique(spec.connections, "connections");
  checkUnique(spec.motions, "motions");
  checkUnique(spec.operations, "operations");
  const selectors = new Set<string>();
  spec.parts.forEach((p, i) => {
    if (selectors.has(p.selector)) issue(["parts", i, "selector"], `Duplicate selector: ${p.selector}`);
    selectors.add(p.selector);
  });
  spec.instances.forEach((v, i) => {
    if (!parts.has(v.partId)) issue(["instances", i, "partId"], "Unknown part ID");
    if (v.subassemblyId !== null && !groups.has(v.subassemblyId)) issue(["instances", i, "subassemblyId"], "Unknown subassembly ID");
  });
  const parent = new Map(spec.subassemblies.map((g) => [g.id, g.parentId]));
  spec.subassemblies.forEach((g, i) => {
    if (g.parentId !== null && !groups.has(g.parentId)) issue(["subassemblies", i, "parentId"], "Unknown parent subassembly ID");
    const visited = new Set<string>();
    let current: string | null | undefined = g.id;
    while (current != null) {
      if (visited.has(current)) { issue(["subassemblies", i, "parentId"], "Subassembly hierarchy contains a cycle"); break; }
      visited.add(current); current = parent.get(current);
    }
  });
  if (spec.groundedInstanceId !== null && !instances.has(spec.groundedInstanceId)) issue(["groundedInstanceId"], "Unknown grounded instance");
  spec.connections.forEach((c, i) => {
    if (!instances.has(c.a)) issue(["connections", i, "a"], "Unknown instance ID");
    if (!instances.has(c.b)) issue(["connections", i, "b"], "Unknown instance ID");
    if (c.a === c.b) issue(["connections", i], "A connection requires two distinct instances");
    if (c.boreInstanceId !== undefined && c.boreInstanceId !== c.a && c.boreInstanceId !== c.b) {
      issue(["connections", i, "boreInstanceId"], "Bore instance must be one of the connection's instances");
    }
  });
  spec.motions.forEach((m, i) => {
    if (!connections.has(m.inputConnectionId)) issue(["motions", i, "inputConnectionId"], "Unknown input connection ID");
  });
  spec.operations.forEach((o, i) => {
    if (!instances.has(o.instanceId)) issue(["operations", i, "instanceId"], "Unknown instance ID");
  });
});

export type AssemblySpec = z.infer<typeof AssemblySpecSchema>;
export function validateAssemblySpec(input: unknown) {
  return AssemblySpecSchema.safeParse(input);
}
