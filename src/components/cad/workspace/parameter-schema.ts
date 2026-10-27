import { Job, ParameterDef, ParameterSchema, parseJSON } from '@/components/cad/types'
import { extractParameterDefsFromScad } from '@/lib/tools/scad-parameter-extractor'

/*
 * One resolver for "what are this design's parameters", shared by the 尺寸 module,
 * the 读数 module and the composer's rebuild action.
 *
 * Artifact-first (AGENTS.md): the source of truth is the generated OpenSCAD, so a
 * job whose parameterSchema is missing or stale still gets a real stepper list by
 * parsing top-level assignments out of the SCAD itself.
 */

export interface ResolvedSchema {
  partFamily: string
  designSummary: string
  parameters: ParameterDef[]
  groups: Array<{ name: string; label: string; parameters: ParameterDef[] }>
}

/** Group names seen in real generated schemas, plus the conventional aliases. */
const GROUP_LABELS: Record<string, string> = {
  parameters: "Dimensions",
  dimensions: "Dimensions",
  geometry: "Geometry",
  general: "Dimensions",
  engineering: "Engineering",
  device: "Device",
  fit: "Fit",
  mounting: "Mounting",
  holes: "Holes",
  features: "Features",
  head: "Head",
  thread: "Thread",
  shaft: "Shaft",
  body: "Body",
  enclosure: "Enclosure",
  shell: "Enclosure",
  quality: "Quality",
  manufacturing: "Manufacturing",
}

export function groupLabel(name: string): string {
  return GROUP_LABELS[name.toLowerCase()] ?? name
}

/*
 * OpenSCAD special variables (`$fn`, `$fa`, `$fs`) and underscore-prefixed keys
 * (`_merge_tol`) are engine controls, not dimensions. DESIGN.md's honesty pass keeps
 * engine internals out of the user's dimension list and they remain inspectable in
 * the 源码 / 记录 sheet. Named parameters that a design genuinely exposes — facet
 * count, boolean overlap — are KEPT: hiding a user-editable parameter would be a
 * worse failure than showing a technical one.
 */
const INTERNAL_PARAMETER_PATTERN = /^[_$]/

export function isInternalParameter(key: string): boolean {
  return INTERNAL_PARAMETER_PATTERN.test(key)
}

export function resolveParameterSchema(job: Job | null): ResolvedSchema | null {
  if (!job) return null

  const raw = parseJSON<ParameterSchema | ParameterDef[] | null>(job.parameterSchema, null)
  let schema: ParameterSchema | null = null

  if (Array.isArray(raw)) {
    schema = { part_family: job.partFamily || 'unknown', design_summary: '', parameters: raw }
  } else if (raw && Array.isArray(raw.parameters)) {
    schema = raw
  }

  if ((!schema || schema.parameters.length === 0) && job.scadSource) {
    const extracted = extractParameterDefsFromScad(job.scadSource) as ParameterDef[]
    if (extracted.length > 0) {
      schema = {
        part_family: job.partFamily || 'unknown',
        design_summary: '',
        parameters: extracted,
      }
    }
  }

  if (!schema || schema.parameters.length === 0) return null

  const parameters = schema.parameters.filter(p => !isInternalParameter(p.key))
  if (parameters.length === 0) return null

  const names = [...new Set(parameters.map(p => p.group || 'general'))]
  return {
    partFamily: schema.part_family || job.partFamily || 'unknown',
    designSummary: schema.design_summary || '',
    parameters,
    groups: names.map(name => ({
      name,
      label: groupLabel(name),
      parameters: parameters.filter(p => (p.group || 'general') === name),
    })),
  }
}

/** Effective parameter values: local edits win over what is stored on the job. */
export function effectiveParameterValues(
  job: Job | null,
  draft: Record<string, number> | null
): Record<string, number> {
  const stored = parseJSON<Record<string, number>>(job?.parameterValues ?? null, {})
  return draft ? { ...stored, ...draft } : stored
}

/*
 * The values the part on screen was actually built from — the ONLY baseline a
 * "changed" comparison may use.
 *
 * A schema's `value` is the default the artifact declares, not the number the
 * build ran with: a part can be built at `edge_length = 30` while its SCAD still
 * declares 20, and the database has such a row. Comparing the built values
 * against the declared default therefore reports "1 parameter changed" the
 * instant the part is opened, before the user has touched anything — a lie that
 * pushes them into an unnecessary rebuild.
 *
 * Stored value wins; the schema default is only the fallback for parameters the
 * build never recorded.
 */
export function builtParameterValues(
  job: Job | null,
  schema: ResolvedSchema | null
): Record<string, number> {
  const stored = parseJSON<Record<string, number>>(job?.parameterValues ?? null, {})
  const baseline: Record<string, number> = {}
  for (const parameter of schema?.parameters ?? []) {
    const storedValue = stored[parameter.key]
    baseline[parameter.key] =
      typeof storedValue === 'number' && Number.isFinite(storedValue)
        ? storedValue
        : parameter.value
  }
  return baseline
}

/*
 * Axis keys, in the order they are printed. The first group is what generated
 * designs actually emit (verified against the local database: body_length /
 * body_width / body_depth / wall_thickness), the rest are the conventional
 * aliases used by other families.
 */
const AXIS_KEYS: string[][] = [
  ['body_length', 'length', 'outerLength', 'outer_length', 'height', 'outerHeight', 'outer_height'],
  ['body_width', 'width', 'outerWidth', 'outer_width', 'diameter'],
  ['body_depth', 'thickness', 'depth', 'outerDepth', 'outer_depth', 'height', 'outerHeight', 'outer_height'],
]

const WALL_KEYS = ['wall_thickness', 'wallThickness', 'wall', 'shellThickness', 'shell_thickness']

/**
 * Bounding box from declared parameters, as `[a, b, c]` in print order.
 * Returns null unless all three axes resolve, so the readout shows "—" rather
 * than a half-invented box.
 */
export function parameterBoundingBox(values: Record<string, number>): [number, number, number] | null {
  const picked: number[] = []
  for (const keys of AXIS_KEYS) {
    let found: number | null = null
    for (const k of keys) {
      const v = values[k]
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        found = v
        break
      }
    }
    if (found === null) return null
    picked.push(found)
  }
  return [picked[0], picked[1], picked[2]]
}

/** The one derived dimension DESIGN.md section 6 keeps in the readout. */
export function parameterWallThickness(values: Record<string, number>): number | null {
  for (const k of WALL_KEYS) {
    const v = values[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return null
}

export function formatMeasure(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(2)))
}

/*
 * A unit is a claim about what a number measures, so a wrong one is not a cosmetic
 * defect - it is the readout lying. `cyl_per_bank` (cylinders per bank) arrived with
 * `unit: "mm"`, because the schema generator defaults the field to the design's
 * length unit, and 尺寸 printed "4 mm" for a count of four.
 *
 * The rule is deliberately narrow. A count is recognised by its NAME, never by its
 * type: an integer can be a 5 mm hole diameter, and stripping that unit would break
 * a real dimension. So a physical unit is removed only when the key is unambiguously
 * a count - it ends in a count noun, it is a `_per_` rate, or it is prefixed
 * `num_` / `count_` / `qty_` - and the parameter is an integer.
 */
const COUNT_SUFFIX =
  /(?:^|_)(count|num|number|qty|quantity|teeth|tooth|segments?|sides?|facets?|steps?|layers?|copies|ribs?|flutes?|banks?|slots?|bolts?|screws?|fins?|blades?|spokes?)$/i
const COUNT_INFIX = /_per_/i
const COUNT_PREFIX = /^(num|count|qty|number)_/i
const PHYSICAL_UNIT = /^(mm|cm|m|in|inch|inches|°|deg|degree|degrees|rad)$/i

export function isCountParameter(param: ParameterDef): boolean {
  if (param.kind !== 'integer') return false
  return COUNT_SUFFIX.test(param.key) || COUNT_INFIX.test(param.key) || COUNT_PREFIX.test(param.key)
}

/** The unit to print next to a parameter's value. */
export function parameterUnit(param: ParameterDef): string {
  const unit = (param.unit ?? '').trim()
  if (!unit) return ''
  if (PHYSICAL_UNIT.test(unit) && isCountParameter(param)) return ''
  return unit
}
