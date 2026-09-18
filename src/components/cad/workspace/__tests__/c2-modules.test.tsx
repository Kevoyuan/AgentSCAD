import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Module } from '../Module'
import { Verdict, Stepper, RevCell, OutputRow } from '../instrument'
import { resolveParameterSchema, effectiveParameterValues, parameterBoundingBox, parameterWallThickness, isInternalParameter } from '../parameter-schema'
import { readRenderLog, measuredBoundingBox, measuredWallThickness } from '../mesh-facts'
import { Job, ValidationResult } from '@/components/cad/types'

/*
 * Regression cover for the C2 modules, aimed at the failures this project has
 * already shipped once: hardcoded readings, an invented triangle count, a check
 * that could not run rendered as a warning, and user parameters dropped.
 */

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    state: 'DELIVERED',
    inputRequest: '做一个 iphone 17 pro max 手机壳',
    customerId: null,
    modelId: null,
    partFamily: 'phone_case',
    builderName: null,
    generationPath: null,
    scadSource: 'body_length = 158;\nbody_width = 78;\nbody_depth = 8;\nwall_thickness = 2;',
    parameterSchema: JSON.stringify([
      { key: 'body_length', label: 'Body Length', kind: 'integer', unit: 'mm', value: 158, min: 0, max: 316, step: 1, source: 'user', editable: true, description: '', group: 'Parameters' },
      { key: 'body_width', label: 'Body Width', kind: 'integer', unit: 'mm', value: 78, min: 0, max: 156, step: 1, source: 'user', editable: true, description: '', group: 'Parameters' },
      { key: 'body_depth', label: 'Body Depth', kind: 'integer', unit: 'mm', value: 8, min: 0, max: 18, step: 1, source: 'user', editable: true, description: '', group: 'Parameters' },
      { key: 'wall_thickness', label: 'Wall Thickness', kind: 'integer', unit: 'mm', value: 2, min: 0, max: 12, step: 1, source: 'user', editable: true, description: '', group: 'Parameters' },
      { key: 'merge_tol', label: 'Merge Tol', kind: 'float', unit: 'mm', value: 0.2, min: 0, max: 10.2, step: 0.1, source: 'design_derived', editable: true, description: '', group: 'Parameters' },
      { key: '$fn', label: '$Fn', kind: 'integer', unit: 'mm', value: 64, min: 0, max: 128, step: 1, source: 'inferred', editable: true, description: '', group: 'Parameters' },
    ]),
    parameterValues: JSON.stringify({ body_length: 158, body_width: 78, body_depth: 8, wall_thickness: 2, merge_tol: 0.2, $fn: 64 }),
    researchResult: null,
    intentResult: null,
    designResult: null,
    stlPath: '/artifacts/job-1/model.stl',
    pngPath: null,
    renderLog: JSON.stringify({ openscad_version: '2026.01.12-wasm', render_time_ms: 6552, stl_triangles: 816, stl_vertices: 0 }),
    validationResults: JSON.stringify([
      { rule_id: 'R001', rule_name: 'Minimum Wall Thickness', level: 'ENGINEERING', passed: true, status: 'PASS', is_critical: true, message: 'Min wall: 2.01mm (threshold: 1.2mm, avg: 8.85mm)' },
      { rule_id: 'R002', rule_name: 'Maximum Dimensions', level: 'MANUFACTURING', passed: true, status: 'PASS', is_critical: false, message: 'Within bounds: 82.0x162.0x10.0mm' },
      { rule_id: 'R003', rule_name: 'Manifold Geometry', level: 'ENGINEERING', passed: true, status: 'PASS', is_critical: true, message: 'Watertight mesh, 816 faces' },
      { rule_id: 'S001', rule_name: 'Semantic Geometry Match', level: 'ENGINEERING', passed: true, status: 'SKIP', is_critical: true, message: 'Skipped — requires LLM reasoning (not yet implemented)' },
      { rule_id: 'B001', rule_name: 'Bounding Box Match', level: 'INFO', passed: true, status: 'SKIP', is_critical: false, message: 'Skipped — no expected bounding box specified' },
    ] as ValidationResult[]),
    executionLogs: null,
    notes: null,
    parentId: null,
    retryCount: 0,
    maxRetries: 3,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

describe('C2 · parameter schema resolver', () => {
  test('engine special variables are hidden, named user parameters are kept', () => {
    expect(isInternalParameter('$fn')).toBe(true)
    expect(isInternalParameter('_merge_tol')).toBe(true)
    expect(isInternalParameter('merge_tol')).toBe(false)
    expect(isInternalParameter('body_length')).toBe(false)
  })

  test('resolves the real generated schema and drops only engine internals', () => {
    const schema = resolveParameterSchema(job())
    expect(schema).not.toBeNull()
    const keys = schema!.parameters.map(p => p.key)
    expect(keys).toEqual(['body_length', 'body_width', 'body_depth', 'wall_thickness', 'merge_tol'])
    // $fn is not a dimension the user thinks in
    expect(keys).not.toContain('$fn')
  })

  test('falls back to parsing top-level SCAD assignments when the schema is missing', () => {
    const schema = resolveParameterSchema(job({ parameterSchema: null }))
    expect(schema).not.toBeNull()
    const keys = schema!.parameters.map(p => p.key)
    expect(keys).toContain('body_length')
    expect(keys).toContain('wall_thickness')
  })

  test('returns null instead of inventing parameters for an empty design', () => {
    expect(resolveParameterSchema(job({ parameterSchema: null, scadSource: null }))).toBeNull()
    expect(resolveParameterSchema(null)).toBeNull()
  })

  test('draft values win over stored values, and untouched keys still resolve', () => {
    const values = effectiveParameterValues(job(), { body_length: 170 })
    expect(values.body_length).toBe(170)
    expect(values.body_width).toBe(78)
  })

  test('bounding box requires all three axes, and uses real axis keys', () => {
    expect(parameterBoundingBox({ body_length: 158, body_width: 78, body_depth: 8 })).toEqual([158, 78, 8])
    // a half-known box is no box
    expect(parameterBoundingBox({ body_length: 158, body_width: 78 })).toBeNull()
    expect(parameterWallThickness({ wall_thickness: 2 })).toBe(2)
    expect(parameterWallThickness({})).toBeNull()
  })
})

describe('C2 · mesh facts come from evidence, never from guesses', () => {
  test('triangle count comes from the JSON render log', () => {
    expect(readRenderLog(job()).triangles).toBe(816)
  })

  test('a missing or malformed render log yields null, not a plausible number', () => {
    expect(readRenderLog(job({ renderLog: null })).triangles).toBeNull()
    expect(readRenderLog(job({ renderLog: 'not json' })).triangles).toBeNull()
    expect(readRenderLog(null).triangles).toBeNull()
  })

  test('measured bounding box is recovered from the dimension verdict message', () => {
    expect(measuredBoundingBox(job())).toEqual([82.0, 162.0, 10.0])
  })

  test('measured wall thickness is recovered from the wall verdict message', () => {
    expect(measuredWallThickness(job())).toBeCloseTo(2.01, 2)
  })

  test('with no measurements, both stay null so the readout prints a dash', () => {
    const bare = job({ validationResults: null })
    expect(measuredBoundingBox(bare)).toBeNull()
    expect(measuredWallThickness(bare)).toBeNull()
  })
})

describe('C2 · instrument primitives', () => {
  test('a verdict always carries a word, never colour alone', () => {
    const html = renderToStaticMarkup(<Verdict label="流形几何" word="通过" tone="pass" />)
    expect(html).toContain('流形几何')
    expect(html).toContain('通过')
  })

  test('a check that could not run renders as a hollow, dim verdict', () => {
    const html = renderToStaticMarkup(<Verdict label="语义检查" word="未运行" tone="mute" />)
    expect(html).toContain('未运行')
    // hollow square: a border rather than a filled background
    expect(html).toContain('border border-current')
  })

  test('stepper renders minus, value and plus, and shows the value even when disabled', () => {
    const html = renderToStaticMarkup(
      <Stepper label="壁厚" value={2.4} min={0} max={12} step={0.1} disabled />
    )
    expect(html).toContain('−')
    expect(html).toContain('＋')
    expect(html).toContain('2.4')
    expect(html).toContain('aria-label="壁厚"')
    expect(html).toContain('disabled')
  })

  test('revision cell states build and stale differently, and always in words', () => {
    const built = renderToStaticMarkup(<RevCell dots={3} text="REV 3 · 已构建" state="built" />)
    expect(built).toContain('REV 3 · 已构建')
    const stale = renderToStaticMarkup(<RevCell dots={0} text="REV 4 · 待构建" state="stale" />)
    expect(stale).toContain('REV 4 · 待构建')
    expect(stale).toContain('animate-pulse')
  })

  test('an output row with no artifact is disabled rather than silently clickable', () => {
    const html = renderToStaticMarkup(<OutputRow label="导出 STL" disabled />)
    expect(html).toContain('disabled')
    expect(html).toContain('cursor-not-allowed')
  })

  test('module in flow mode is not absolutely positioned, so columns can re-stack', () => {
    const html = renderToStaticMarkup(
      <Module id="checks" title="检验" flow badge="5 / 5 通过">
        <div>verdicts</div>
      </Module>
    )
    expect(html).toContain('relative shrink-0')
    expect(html).not.toContain('class="mod group select-none transition-[box-shadow,border-color] duration-200 pointer-events-auto absolute')
  })
})
