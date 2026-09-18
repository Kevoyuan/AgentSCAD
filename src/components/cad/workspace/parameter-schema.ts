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
  parameters: '尺寸',
  dimensions: '尺寸',
  geometry: '几何',
  general: '尺寸',
  engineering: '工程',
  device: '器件',
  fit: '配合',
  mounting: '安装',
  holes: '孔位',
  features: '特征',
  head: '头部',
  thread: '螺纹',
  shaft: '杆身',
  body: '机身',
  enclosure: '壳体',
  shell: '壳体',
  quality: '质量',
  manufacturing: '制造',
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
