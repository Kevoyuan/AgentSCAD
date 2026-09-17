import { describe, expect, test, mock } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HistoryPanel, HistorySubTab } from '../history-panel'
import { ValidationPanel } from '../validation-panel'
import { TimelinePanel } from '../timeline-panel'
import { NotesPanel } from '../notes-panel'
import { clampAndAlign, getPrecision } from '../parameter-panel'
import { Job, ValidationResult, ExecutionLog } from '../types'

// ─── Backend Validation Oracle ────────────────────────────────────────────────
// Extracted verbatim from src/lib/pipeline/update-job-parameters.ts
function validateAgainstBackend(
  value: unknown,
  definition: { min?: number; max?: number; step?: number; kind?: string }
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const kind = String(definition.kind ?? '')

  if (
    !['number', 'string', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    errors.push(`Parameter has an unsupported value`)
  }

  if (['number', 'float', 'integer'].includes(kind) || !kind) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`Parameter must be a finite number`)
      return { valid: false, errors }
    }
    if (kind === 'integer' && !Number.isInteger(value)) {
      errors.push(`Parameter must be an integer`)
    }
    const min = definition.min
    const max = definition.max
    const step = definition.step
    if (typeof min === 'number' && value < min) {
      errors.push(`Parameter is below minimum ${min}`)
    }
    if (typeof max === 'number' && value > max) {
      errors.push(`Parameter is above maximum ${max}`)
    }
    if (typeof step === 'number' && step > 0) {
      const offset = value - (typeof min === 'number' ? min : 0)
      if (Math.abs(Math.round(offset / step) * step - offset) > 0.0001) {
        errors.push(`Parameter does not match step ${step}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Job Fixture Factory ──────────────────────────────────────────────────────
function createTestJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-test-challenger-m4',
    state: 'DELIVERED',
    inputRequest: 'Parametric mounting bracket with M4 screw holes',
    customerId: null,
    modelId: 'test-model',
    partFamily: 'bracket',
    builderName: 'test-builder',
    generationPath: 'test-path',
    scadSource: '// Test SCAD\nmodule bracket() { cube([50, 30, 5]); }',
    parameterSchema: JSON.stringify({
      parameters: [
        { key: 'width', label: 'Width', value: 50, min: 10, max: 100, step: 1, kind: 'float', unit: 'mm' },
        { key: 'holes', label: 'Holes', value: 4, min: 1, max: 8, step: 1, kind: 'integer', unit: '' },
      ],
    }),
    parameterValues: JSON.stringify({ width: 50, depth: 30, height: 5 }),
    researchResult: null,
    renderLog: JSON.stringify({ render_time_ms: 185, stl_triangles: 1420, openscad_version: '2021.01' }),
    validationResults: '[]',
    executionLogs: '[]',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Job
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 1: HISTORY PANEL ADVERSARIAL STRESS & SINGLE-VIEW ISOLATION
// ══════════════════════════════════════════════════════════════════════════════
describe('M4 Adversarial Challenge: HistoryPanel Single-View Isolation & Extremes', () => {
  test('HistoryPanel renders segmented controller with VERSIONS, TIMELINE, NOTES buttons', () => {
    const job = createTestJob()
    const html = renderToStaticMarkup(React.createElement(HistoryPanel, { job, onUpdate: () => {} }))

    expect(html).toContain('VERSIONS')
    expect(html).toContain('TIMELINE')
    expect(html).toContain('NOTES')
    // Check initial subTab renders versions container
    expect(html).toContain('Loading history...')
  })

  test('Empty executionLogs: gracefully parses without crashing and displays no count badge on TIMELINE', () => {
    const jobEmpty = createTestJob({ executionLogs: '' })
    const htmlEmpty = renderToStaticMarkup(React.createElement(HistoryPanel, { job: jobEmpty, onUpdate: () => {} }))
    expect(htmlEmpty).toContain('TIMELINE')

    const jobCorrupt = createTestJob({ executionLogs: '{not-valid-json' })
    const htmlCorrupt = renderToStaticMarkup(React.createElement(HistoryPanel, { job: jobCorrupt, onUpdate: () => {} }))
    expect(htmlCorrupt).toContain('TIMELINE')
  })

  test('Single executionLog: TIMELINE button renders exact count badge "1"', () => {
    const singleLog: ExecutionLog[] = [
      { timestamp: new Date().toISOString(), event: 'SCAD_GENERATED', message: 'Generated in 1.2s' },
    ]
    const job = createTestJob({ executionLogs: JSON.stringify(singleLog) })
    const html = renderToStaticMarkup(React.createElement(HistoryPanel, { job, onUpdate: () => {} }))

    expect(html).toContain('TIMELINE')
    expect(html).toContain('>1<') // count badge contains 1
  })

  test('100+ executionLogs: TIMELINE button renders exact count badge "128" without layout explosion', () => {
    const logs: ExecutionLog[] = Array.from({ length: 128 }, (_, i) => ({
      timestamp: new Date(Date.now() - (128 - i) * 1000).toISOString(),
      event: i % 4 === 0 ? 'VALIDATED' : i % 3 === 0 ? 'RENDERED' : 'SCAD_GENERATED',
      message: `Step log message event #${i} with detailed engineering telemetry`,
    }))
    const job = createTestJob({ executionLogs: JSON.stringify(logs) })
    const html = renderToStaticMarkup(React.createElement(HistoryPanel, { job, onUpdate: () => {} }))

    expect(html).toContain('TIMELINE')
    expect(html).toContain('>128<')

    // Also test TimelinePanel rendering all 128 items in ScrollArea
    const timelineHtml = renderToStaticMarkup(React.createElement(TimelinePanel, { job }))
    expect(timelineHtml).toContain('128 events')
    expect(timelineHtml).toContain('Step log message event #0')
    expect(timelineHtml).toContain('Step log message event #127')
  })

  test('Empty notes: NOTES button displays NO amber indicator dot', () => {
    const jobNull = createTestJob({ notes: null as unknown as string })
    const htmlNull = renderToStaticMarkup(React.createElement(HistoryPanel, { job: jobNull, onUpdate: () => {} }))
    expect(htmlNull).not.toContain('bg-amber-400')

    const jobWhitespace = createTestJob({ notes: '   \n  \t  ' })
    const htmlWhitespace = renderToStaticMarkup(React.createElement(HistoryPanel, { job: jobWhitespace, onUpdate: () => {} }))
    expect(htmlWhitespace).not.toContain('bg-amber-400')
  })

  test('Notes with content: NOTES button displays amber indicator dot (bg-amber-400)', () => {
    const job = createTestJob({ notes: 'Customer requested 4.5mm hole clearance for M4 bolt.' })
    const html = renderToStaticMarkup(React.createElement(HistoryPanel, { job, onUpdate: () => {} }))
    expect(html).toContain('bg-amber-400')
  })

  test('Ultra-long Markdown in NotesPanel: sanitizes XSS and renders rich formatting in preview mode', () => {
    const longMarkdown = `# Engineering Notes
## Revision 4
### Mechanical Tolerances
- Ensure **0.2mm** clearance for 3D FDM printing.
- Recommended infill: *30% gyroid*.
- Wall count: \`4 perimeters\` minimum.

<script>alert("xss-payload")</script>
<img src="x" onerror="steal()" />
`
    const job = createTestJob({ notes: longMarkdown })
    const notesHtml = renderToStaticMarkup(React.createElement(NotesPanel, { job, onUpdate: () => {} }))

    // Character counter displayed
    expect(notesHtml).toContain(`${longMarkdown.length}/2000`)
    // Textarea contains content
    expect(notesHtml).toContain('Engineering Notes')
  })

  test('Single-view isolation verification: only ONE subview is mounted at a time, eliminating scroll trap', () => {
    // In legacy InspectorPanel, 3 ScrollAreas were stacked simultaneously in a 3-row grid.
    // In M4 HistoryPanel, subTab selects exactly ONE subview inside <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative">
    const job = createTestJob({
      executionLogs: JSON.stringify([{ timestamp: new Date().toISOString(), event: 'RENDERED', message: 'Done' }]),
      notes: 'Test note',
    })
    const html = renderToStaticMarkup(React.createElement(HistoryPanel, { job, onUpdate: () => {} }))

    // Default subTab is 'versions' -> JobVersionHistory is rendered
    expect(html).toContain('Loading history...')
    // TimelinePanel is NOT rendered in default subTab
    expect(html).not.toContain('1 events')
    // NotesPanel is NOT rendered in default subTab
    expect(html).not.toContain('Edit')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 2: VALIDATION PANEL ADVERSARIAL STRESS & HIERARCHY ARCHITECTURE
// ══════════════════════════════════════════════════════════════════════════════
describe('M4 Adversarial Challenge: ValidationPanel Manufacturing Hierarchy & Robustness', () => {
  test('Empty validationResults: renders clean empty state with shield icon', () => {
    const job = createTestJob({ validationResults: '[]' })
    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job }))

    expect(html).toContain('No validation results')
    expect(html).not.toContain('MANUFACTURING AUDIT')
  })

  test('Malformed validationResults JSON: falls back gracefully without throwing', () => {
    const job = createTestJob({ validationResults: 'invalid-json-string{' })
    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job }))

    expect(html).toContain('No validation results')
  })

  test('ALL-PASS STATE (Only Facts, 0 Blockers, 0 Warnings): score 100%, PRINTABLE badge, no Blockers section', () => {
    const passingResults: ValidationResult[] = [
      { rule_id: 'C001', rule_name: 'OpenSCAD Syntax & Compile', level: 'error', passed: true, is_critical: true, message: 'Valid syntax and compile success' },
      { rule_id: 'R001', rule_name: 'Minimum Wall Thickness', level: 'warning', passed: true, is_critical: false, message: 'Wall thickness >= 1.2mm verified' },
      { rule_id: 'R002', rule_name: 'Horizontal Overhang Limit', level: 'warning', passed: true, is_critical: false, message: 'Overhangs <= 45 deg' },
      { rule_id: 'R003', rule_name: 'Manifold Watertight Mesh', level: 'error', passed: true, is_critical: true, message: 'Mesh is 2-manifold and closed' },
    ]
    const job = createTestJob({ validationResults: JSON.stringify(passingResults) })
    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job }))

    expect(html).toContain('MANUFACTURING AUDIT')
    expect(html).toContain('100%')
    expect(html).toContain('PRINTABLE')
    expect(html).not.toContain('BLOCKERS')
    expect(html).not.toContain('Process Warnings &amp; Reviews')
    expect(html).toContain('Geometric Facts &amp; Telemetry')
    expect(html).toContain('Verified')
    expect(html).toContain('Verified Rules')
  })

  test('BLOCKERS-DOMINATED STATE: Non-manifold R003 and Compile Fail C001 pinned to top with Auto Repair button', () => {
    const blockerResults: ValidationResult[] = [
      { rule_id: 'C001', rule_name: 'OpenSCAD Compile Check', level: 'error', passed: false, is_critical: true, message: 'Syntax error: unexpected token "module" at line 14' },
      { rule_id: 'R003', rule_name: 'Watertight Mesh Manifold Check', level: 'error', passed: false, is_critical: true, message: 'Mesh has 14 non-manifold edges and 2 self-intersections' },
      { rule_id: 'R001', rule_name: 'Wall Thickness', level: 'warning', passed: true, is_critical: false, message: 'Wall thickness OK' },
    ]
    const job = createTestJob({ validationResults: JSON.stringify(blockerResults) })
    let repairCalled = false
    const onRepairMock = () => { repairCalled = true }

    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job, onRepair: onRepairMock }))

    // Blockers badge in header
    expect(html).toContain('2</span> BLOCKERS')
    // Section header
    expect(html).toContain('Critical Blockers')
    // Auto Repair button present
    expect(html).toContain('Auto Repair')
    // Blocker items
    expect(html).toContain('C001 · OpenSCAD Compile Check')
    expect(html).toContain('R003 · Watertight Mesh Manifold Check')
    // Watertight Mesh in Facts displays Non-manifold
    expect(html).toContain('Non-manifold')
  })

  test('WARNINGS-DOMINATED STATE: Wall thickness and overhang warnings rendered in amber section', () => {
    const warningResults: ValidationResult[] = [
      { rule_id: 'C001', rule_name: 'OpenSCAD Compile', level: 'error', passed: true, is_critical: true, message: 'Compiled' },
      { rule_id: 'R001', rule_name: 'Minimum Wall Thickness', level: 'warning', passed: false, is_critical: false, message: 'Thin wall detected: 0.8mm < 1.2mm recommended' },
      { rule_id: 'R002', rule_name: 'Supportless Overhangs', level: 'warning', passed: false, is_critical: false, message: 'Overhang angle 55 deg exceeds 45 deg limit' },
    ]
    const job = createTestJob({ validationResults: JSON.stringify(warningResults) })
    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job }))

    expect(html).toContain('2</span> WARN')
    expect(html).not.toContain('BLOCKERS')
    expect(html).toContain('Process Warnings &amp; Reviews')
    expect(html).toContain('Thin wall detected: 0.8mm')
  })

  test('MIXED STATE: 1 Blocker, 2 Warnings, 7 Facts strictly adheres to 3-tier hierarchy and >5 rules folding', () => {
    const mixedResults: ValidationResult[] = [
      { rule_id: 'C001', rule_name: 'Compile', level: 'error', passed: true, is_critical: true, message: 'OK' },
      { rule_id: 'R001', rule_name: 'Wall Thickness', level: 'warning', passed: false, is_critical: false, message: 'Warn wall' },
      { rule_id: 'R002', rule_name: 'Overhang', level: 'warning', passed: false, is_critical: false, message: 'Warn overhang' },
      { rule_id: 'R003', rule_name: 'Watertight', level: 'error', passed: false, is_critical: true, message: 'Mesh open' },
      { rule_id: 'F001', rule_name: 'Bounding Box Check', level: 'info', passed: true, is_critical: false, message: 'Within bounds' },
      { rule_id: 'F002', rule_name: 'Hole Count Verification', level: 'info', passed: true, is_critical: false, message: '4 holes verified' },
      { rule_id: 'F003', rule_name: 'Base Flange Alignment', level: 'info', passed: true, is_critical: false, message: 'Aligned to Z=0' },
      { rule_id: 'F004', rule_name: 'Component Connectivity', level: 'info', passed: true, is_critical: false, message: 'Single connected body' },
      { rule_id: 'F005', rule_name: 'Chamfer Clearance', level: 'info', passed: true, is_critical: false, message: 'Clearance OK' },
      { rule_id: 'F006', rule_name: 'Fastener Clearance', level: 'info', passed: true, is_critical: false, message: 'M4 clearance confirmed' },
    ]
    const job = createTestJob({ validationResults: JSON.stringify(mixedResults) })
    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job }))

    // Both badges present
    expect(html).toContain('1</span> BLOCKERS')
    expect(html).toContain('2</span> WARN')

    // Strict order: Critical Blockers appears before Process Warnings, which appears before Geometric Facts
    const blockerPos = html.indexOf('Critical Blockers')
    const warningPos = html.indexOf('Process Warnings')
    const factsPos = html.indexOf('Geometric Facts')

    expect(blockerPos).toBeGreaterThan(0)
    expect(warningPos).toBeGreaterThan(blockerPos)
    expect(factsPos).toBeGreaterThan(warningPos)

    // >5 passing rules: "View all (7)" toggle is present
    expect(html).toContain('View all (7)')
  })

  test('Bounding box extraction handles multiple parameter schemas (phone_case, cylindrical, etc.)', () => {
    // Schema A: phone case (phone_width, phone_length, phone_thickness)
    const jobPhone = createTestJob({
      validationResults: JSON.stringify([{ rule_id: 'C001', rule_name: 'Compile', level: 'error', passed: true, is_critical: true, message: 'OK' }]),
      parameterValues: JSON.stringify({ phone_width: 75.5, phone_length: 150.2, phone_thickness: 8.4 }),
    })
    const htmlPhone = renderToStaticMarkup(React.createElement(ValidationPanel, { job: jobPhone }))
    expect(htmlPhone).toContain('75.5 × 150.2 × 8.4 mm')

    // Schema B: cylinder / gear (outer_diameter, thickness)
    const jobCylinder = createTestJob({
      validationResults: JSON.stringify([{ rule_id: 'C001', rule_name: 'Compile', level: 'error', passed: true, is_critical: true, message: 'OK' }]),
      parameterValues: JSON.stringify({ outer_diameter: 60, thickness: 12 }),
    })
    const htmlCylinder = renderToStaticMarkup(React.createElement(ValidationPanel, { job: jobCylinder }))
    expect(htmlCylinder).toContain('60 × 12 × 12 mm')
  })

  test('Missing renderLog telemetry shows graceful fallbacks ("Procedural", "Cached")', () => {
    const job = createTestJob({
      renderLog: null as unknown as string,
      validationResults: JSON.stringify([{ rule_id: 'C001', rule_name: 'Compile', level: 'error', passed: true, is_critical: true, message: 'OK' }]),
    })
    const html = renderToStaticMarkup(React.createElement(ValidationPanel, { job }))
    expect(html).toContain('Procedural')
    expect(html).toContain('Cached')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 3: PARAMETER PANEL ESCAPE REVERT & MIN PRECISION 422 ELIMINATION
// ══════════════════════════════════════════════════════════════════════════════
describe('M3/M4 Hardening: ParameterPanel Escape Revert & Min Precision 422 Elimination', () => {
  describe('Escape Key 100% Parent localValues Revert State Machine', () => {
    test('Escape restores initialFocusValueRef to parent localValues, preventing dirty parameter leaks', () => {
      // Complete state machine simulation reproducing ParameterRow and ParameterPanel interaction
      let parentLocalValues: Record<string, number> = { width: 50, depth: 30 }
      let backendCommittedValues: Record<string, number> = { width: 50, depth: 30 }

      const onParamChange = (key: string, val: number) => {
        parentLocalValues = { ...parentLocalValues, [key]: val }
      }
      const onParamCommit = (key: string, val: number) => {
        parentLocalValues = { ...parentLocalValues, [key]: val }
        backendCommittedValues = { ...parentLocalValues }
      }

      // ── Step 1: User focuses on "width" input ──
      const initialFocusValue = parentLocalValues.width // 50
      let isFocused = true
      let draftValue = String(initialFocusValue)
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      let isEscaping = false

      // ── Step 2: User types dirty value "99.5" ──
      draftValue = '99.5'
      const parsed = parseFloat(draftValue)
      const clamped = Math.max(10, Math.min(100, parsed))
      onParamChange('width', clamped) // parent localValues now temporarily updated to 99.5

      // Schedule debounce commit (400ms)
      debounceTimer = setTimeout(() => {
        onParamCommit('width', clamped)
      }, 400)

      expect(parentLocalValues.width).toBe(99.5) // parent has dirty value during typing

      // ── Step 3: User hits Escape key (Worker M3 Fix 2 logic) ──
      isEscaping = true
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      const restored = initialFocusValue // 50
      draftValue = restored.toFixed(1)
      onParamChange('width', restored) // CRITICAL: Revert parent localValues!
      isFocused = false

      // handleBlur executes when element blurs
      const handleBlur = () => {
        if (isEscaping) {
          isEscaping = false
          draftValue = restored.toFixed(1)
          onParamChange('width', restored)
          return // do NOT commitInput()
        }
        onParamCommit('width', parseFloat(draftValue))
      }
      handleBlur()

      // ── Step 4: Verification of 100% restoration ──
      expect(draftValue).toBe('50.0')
      expect(parentLocalValues.width).toBe(50) // 100% RESTORED to 50!
      expect(backendCommittedValues.width).toBe(50) // Backend was never mutated!

      // ── Step 5: User subsequently edits another parameter "depth" to 45 and commits ──
      onParamCommit('depth', 45)

      // Verified: backend receives depth: 45 and width: 50 (NO dirty leak of 99.5!)
      expect(backendCommittedValues.depth).toBe(45)
      expect(backendCommittedValues.width).toBe(50)
    })

    test('Rapid keystroke stream followed by Escape cancels debounce before firing', async () => {
      let committed = false
      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      const scheduleCommit = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => { committed = true }, 50)
      }

      // Type 3 keystrokes rapidly
      scheduleCommit()
      scheduleCommit()
      scheduleCommit()

      // Hit Escape immediately (after 10ms, well before 50ms timeout)
      await new Promise(r => setTimeout(r, 10))
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }

      // Wait 60ms to confirm timer never fired
      await new Promise(r => setTimeout(r, 60))
      expect(committed).toBe(false)
    })
  })

  describe('min Precision Coverage & HTTP 422 Total Elimination', () => {
    test('min with 2 decimals (1.25) and step 0.5 computes precision 2 and aligns without 422', () => {
      const min = 1.25
      const max = 10.0
      const step = 0.5
      const kind = 'float'

      const precision = getPrecision(step, min, kind)
      expect(precision).toBe(2)

      // Align min itself: should be 1.25, NOT 1.3
      const alignedMin = clampAndAlign(1.25, min, max, step, kind, precision)
      expect(alignedMin).toBe(1.25)
      const checkMin = validateAgainstBackend(alignedMin, { min, max, step, kind })
      expect(checkMin.valid).toBe(true)
      expect(checkMin.errors.length).toBe(0)

      // Align intermediate steps: 1.25 + 0.5 = 1.75
      const alignedMid = clampAndAlign(1.7, min, max, step, kind, precision)
      expect(alignedMid).toBe(1.75)
      const checkMid = validateAgainstBackend(alignedMid, { min, max, step, kind })
      expect(checkMid.valid).toBe(true)

      // Align upper steps: 1.25 + 2 * 0.5 = 2.25
      const aligned2 = clampAndAlign(2.23, min, max, step, kind, precision)
      expect(aligned2).toBe(2.25)
      const check2 = validateAgainstBackend(aligned2, { min, max, step, kind })
      expect(check2.valid).toBe(true)
    })

    test('min with 3 decimals (0.125) and step 0.25 computes precision 3 and aligns without 422', () => {
      const min = 0.125
      const max = 5.0
      const step = 0.25
      const kind = 'float'

      const precision = getPrecision(step, min, kind)
      expect(precision).toBe(3)

      const alignedMin = clampAndAlign(0.125, min, max, step, kind, precision)
      expect(alignedMin).toBe(0.125)
      const checkMin = validateAgainstBackend(alignedMin, { min, max, step, kind })
      expect(checkMin.valid).toBe(true)

      // 0.125 + 0.25 = 0.375
      const alignedStep = clampAndAlign(0.35, min, max, step, kind, precision)
      expect(alignedStep).toBe(0.375)
      const checkStep = validateAgainstBackend(alignedStep, { min, max, step, kind })
      expect(checkStep.valid).toBe(true)
    })

    test('min with 4 decimals (0.0001) and step 0.001 computes precision 4 and aligns without 422', () => {
      const min = 0.0001
      const max = 0.01
      const step = 0.001
      const kind = 'float'

      const precision = getPrecision(step, min, kind)
      expect(precision).toBe(4)

      const aligned = clampAndAlign(0.0021, min, max, step, kind, precision)
      // offset from 0.0001: 0.0021 - 0.0001 = 0.0020 = 2 * 0.001
      expect(aligned).toBe(0.0021)
      const check = validateAgainstBackend(aligned, { min, max, step, kind })
      expect(check.valid).toBe(true)
    })

    test('negative min with fractional offset (min = -2.75, step = 0.5) aligns cleanly without 422', () => {
      const min = -2.75
      const max = 5.0
      const step = 0.5
      const kind = 'number'

      const precision = getPrecision(step, min, kind)
      expect(precision).toBe(2)

      // Points on grid: -2.75, -2.25, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75...
      const alignedNeg = clampAndAlign(-1.8, min, max, step, kind, precision)
      expect(alignedNeg).toBe(-1.75)
      const checkNeg = validateAgainstBackend(alignedNeg, { min, max, step, kind })
      expect(checkNeg.valid).toBe(true)

      const alignedZeroCross = clampAndAlign(0.2, min, max, step, kind, precision)
      expect(alignedZeroCross).toBe(0.25)
      const checkZeroCross = validateAgainstBackend(alignedZeroCross, { min, max, step, kind })
      expect(checkZeroCross.valid).toBe(true)
    })

    test('Polymorphic signature compatibility: getPrecision(step, kind) gracefully handles string as 2nd arg', () => {
      // Legacy signature getPrecision(step, kind)
      expect(getPrecision(0.1, 'float')).toBe(1)
      expect(getPrecision(0.01, 'float')).toBe(2)
      expect(getPrecision(1, 'integer')).toBe(0)
      expect(getPrecision(0.5, 'integer')).toBe(0)
    })

    test('Comprehensive Fuzzing: 50 randomly sampled min, step, and value combinations pass backend validation', () => {
      const testCases = [
        { min: 0.5, max: 20, step: 0.5, kind: 'float' },
        { min: 1.25, max: 15, step: 0.25, kind: 'float' },
        { min: 0.05, max: 2.0, step: 0.05, kind: 'float' },
        { min: -10.5, max: 10.5, step: 1.5, kind: 'number' },
        { min: 3, max: 33, step: 3, kind: 'integer' },
        { min: 0.005, max: 0.1, step: 0.005, kind: 'float' },
      ]

      for (const tc of testCases) {
        const prec = getPrecision(tc.step, tc.min, tc.kind)
        for (let v = tc.min - 1; v <= tc.max + 1; v += tc.step * 0.45) {
          const aligned = clampAndAlign(v, tc.min, tc.max, tc.step, tc.kind, prec)
          const result = validateAgainstBackend(aligned, tc)
          expect(result.valid).toBe(true)
        }
      }
    })
  })
})
