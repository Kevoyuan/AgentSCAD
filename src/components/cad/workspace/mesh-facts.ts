import { Job, ValidationResult, parseJSON } from '@/components/cad/types'

/*
 * Mesh facts, read from the evidence the pipeline actually persists.
 *
 * Verified against the local database, not against intentions:
 *   - `renderLog` is JSON: { openscad_version, render_time_ms, stl_triangles, ... }
 *   - validation `details` objects are NOT stored; only id/name/level/status/
 *     is_critical/message survive. So the measured bounding box is recovered from
 *     the R002 message ("Within bounds: 82.0x162.0x10.0mm").
 *
 * Anything not recoverable stays null and the caller prints "—". A plausible
 * invented number is worse than an honest blank in a metrology instrument.
 */

export interface RenderLogFacts {
  triangles: number | null
  renderTimeMs: number | null
  engine: string | null
}

export function readRenderLog(job: Job | null): RenderLogFacts {
  const empty: RenderLogFacts = { triangles: null, renderTimeMs: null, engine: null }
  if (!job?.renderLog) return empty

  const parsed = parseJSON<Record<string, unknown> | null>(job.renderLog, null)
  if (!parsed || typeof parsed !== 'object') return empty

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  return {
    triangles: num(parsed.stl_triangles),
    renderTimeMs: num(parsed.render_time_ms),
    engine: typeof parsed.openscad_version === 'string' ? parsed.openscad_version : null,
  }
}

const DIMENSION_IN_MESSAGE = /(-?\d+(?:\.\d+)?)\s*[x×]\s*(-?\d+(?:\.\d+)?)\s*[x×]\s*(-?\d+(?:\.\d+)?)\s*mm/i

/**
 * Measured bounding box in `[x, y, z]` order, from the mesh validator's own
 * dimension report. Returns null when the mesh has not been measured: the declared
 * parameters are a target, not evidence, and the caller decides how to mark them
 * (see ReadoutModule).
 */
export function measuredBoundingBox(job: Job | null): [number, number, number] | null {
  const results = parseJSON<ValidationResult[]>(job?.validationResults ?? null, [])
  for (const r of results) {
    if (!/dimension/i.test(r.rule_name)) continue
    const match = r.message?.match(DIMENSION_IN_MESSAGE)
    if (!match) continue
    const dims = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (dims.every(d => Number.isFinite(d) && d > 0)) return dims as [number, number, number]
  }
  return null
}

const WALL_IN_MESSAGE = /min wall:\s*(-?\d+(?:\.\d+)?)\s*mm/i

/** Measured minimum wall thickness, when the mesh validator reported one. */
export function measuredWallThickness(job: Job | null): number | null {
  const results = parseJSON<ValidationResult[]>(job?.validationResults ?? null, [])
  for (const r of results) {
    if (!/wall/i.test(r.rule_name)) continue
    const match = r.message?.match(WALL_IN_MESSAGE)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}
