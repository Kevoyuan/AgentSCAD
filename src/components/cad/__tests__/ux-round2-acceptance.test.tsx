import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChecksModule } from '../workspace/ChecksModule'
import { DimensionsModule } from '../workspace/DimensionsModule'
import { engineLabel } from '../workspace/ModelPicker'
import type { Job } from '../types'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'

/*
 * The 2026-10-27 UI review, round two, and its own acceptance list.
 *
 * Round one scored 2.7 and found seventeen hard defects. Round two scored 3.8
 * and, crucially, found that all seventeen were still held - and then spent the
 * whole report on a different class of problem. The first round asked "is
 * anything clipped?"; the second asked "does the interface say anything that
 * is not true?".
 *
 * Every test below is one line of the review's section 7, written so that a
 * future change cannot quietly reintroduce the defect. They are deliberately
 * cheap: source assertions and server-side markup, because the review's own
 * 300ms screenshots need a browser and this suite does not have one.
 */

const root = resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8')

/**
 * Every source file under a directory, recursively — minus the test folders.
 *
 * The tests are excluded on purpose: this file quotes the very patterns it
 * forbids (`cyan-`, `.split(':').pop()`), so a scanner that reads itself
 * reports its own quotes as violations. That is a self-reference, not a defect.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const componentRoot = resolve(root, 'src/components')
const componentSources = sourceFiles(componentRoot)

const i18n = { locale: 'en' as const, setLocale: () => {}, t: createTranslator('en') }

/**
 * The markup as text.
 *
 * `renderToStaticMarkup` escapes the apostrophe in "part's" as `&#x27;`, so a
 * test that asserts on a sentence containing one has to look at the decoded
 * text. Asserting on the raw markup would make the test depend on the
 * serialiser's escaping choices rather than on the sentence.
 */
function text(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

const SCHEMA = JSON.stringify({
  part_family: 'bracket',
  design_summary: 'A bracket',
  parameters: [
    { key: 'edge_length', label: 'Edge Length', value: 20, min: 5, max: 200, step: 1, kind: 'number', unit: 'mm', group: 'general' },
  ],
})

const baseJob = {
  id: 'job-1',
  state: 'DELIVERED',
  inputRequest: 'A solid 20 mm cube',
  stlPath: '/artifacts/job-1/model.stl',
  scadSource: 'edge_length = 20;',
  parameterSchema: SCHEMA,
  parameterValues: JSON.stringify({ edge_length: 20 }),
  validationResults: JSON.stringify([
    { rule_id: 'C001', rule_name: 'OpenSCAD Compile', level: 'ENGINEERING', passed: true, is_critical: true, status: 'PASS', message: 'Compiled' },
  ]),
} as unknown as Job

/*
 * The summary payload, exactly as `/api/jobs?summary=true` returns it: the
 * record's identity and its artifacts, but NONE of the heavy fields.
 *
 * This matters for the tests below. `resolveParameterSchema` falls back to
 * parsing the SCAD source when the schema is missing, so a fixture that keeps
 * `scadSource` never reaches the "no schema" branch at all — it renders a
 * parameter list and every empty-state assertion fails for the wrong reason.
 * The real summary has no `scadSource` either, so the fixture must not have one.
 */
const summaryJob = {
  ...baseJob,
  summaryOnly: true,
  scadSource: null,
  parameterSchema: null,
  parameterValues: null,
  validationResults: null,
} as unknown as Job

function renderDimensions(job: Job, changedKeys: Set<string> = new Set()) {
  return renderToStaticMarkup(
    <I18nContext.Provider value={i18n}>
      <DimensionsModule
        job={job}
        values={{ edge_length: 20 }}
        changedKeys={changedKeys}
        isProcessing={false}
        onDraft={() => {}}
        onReset={() => {}}
      />
    </I18nContext.Provider>,
  )
}

function renderChecks(job: Job) {
  return renderToStaticMarkup(
    <I18nContext.Provider value={i18n}>
      <ChecksModule
        job={job}
        isProcessing={false}
        hasDraftChanges={false}
        revision={1}
      />
    </I18nContext.Provider>,
  )
}

describe('1 · staleness has one writer', () => {
  test('the dimensions module never states artifact staleness', () => {
    const source = read('src/components/cad/workspace/DimensionsModule.tsx')
    // The composer's staleness line is the only place that may say the built
    // artifact no longer matches the draft (DESIGN.md section 18). The module
    // must not even *have* a translatable sentence for it — so the check is on
    // the translation calls, not on the raw file: a comment may legitimately
    // mention the concept while naming the owner.
    expect(source).not.toMatch(/t\(\s*["'`][^"'`]*Rebuild required/)
    expect(source).not.toMatch(/t\(\s*["'`][^"'`]*No rebuild needed/)
    // And it does not derive its own notion of "changed": it is handed the set.
    expect(source).toContain('changedKeys')
    expect(source).not.toMatch(/values\[[^\]]+\]\s*!==\s*p\.value/)
  })

  test('a changed draft is reported as an edit, never as artifact staleness', () => {
    const html = text(renderDimensions(baseJob, new Set(['edge_length'])))
    // It says what the user did ("1 changed") and offers the undo.
    expect(html).toContain('1 changed')
    expect(html).toContain('Undo')
    // And it does not claim the built artifact is out of date. That sentence
    // belongs to the composer, and two answers to one question is the defect.
    expect(html).not.toContain('Rebuild required')
    expect(html).not.toContain('No rebuild needed')
  })

  test('a delivered part with an untouched draft shows no change at all', () => {
    const html = renderDimensions(baseJob)
    expect(html).not.toContain('changed')
    expect(html).not.toContain('Undo')
  })

  test('the composer owns the staleness sentence and the module owns the edits', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    expect(shell).toContain('t("{0} parameters changed · Rebuild required"')
    // The shell is the single writer: it computes the baseline and the set.
    expect(shell).toContain('builtParameterValues')
    expect(shell).toContain('changedKeys')
  })
})

describe('2 · a loading screen never lies', () => {
  test('a part whose details are still arriving shows no sentence at all', () => {
    const dimensions = renderDimensions(summaryJob)
    expect(dimensions).not.toContain('Generate this part')
    expect(dimensions).not.toContain('No dimensions yet')
    expect(dimensions).toContain('aria-busy="true"')

    const checks = renderChecks(summaryJob)
    expect(checks).not.toContain('Generate a part to see')
    expect(checks).not.toContain('No check results yet')
    expect(checks).toContain('aria-busy="true"')
  })

  test('a part that was never generated still gets its honest invitation', () => {
    const fresh = {
      ...baseJob,
      state: 'NEW',
      stlPath: null,
      scadSource: null,
      parameterSchema: null,
    } as unknown as Job
    expect(renderDimensions(fresh)).toContain('Generate this part to see them here.')
  })

  test('a part that WAS generated is never told to generate itself', () => {
    const built = { ...baseJob, scadSource: null, parameterSchema: null } as unknown as Job
    const html = renderDimensions(built)
    expect(html).not.toContain('Generate this part')
    expect(html).toContain('This design has no adjustable dimensions.')
  })

  test('a failed detail load says so instead of loading forever', () => {
    const failed = {
      ...summaryJob,
      summaryOnly: false,
      detailFailed: true,
    } as unknown as Job
    expect(text(renderDimensions(failed))).toContain("Could not load this part's dimensions.")
    expect(text(renderChecks(failed))).toContain("Could not load this part's check results.")
  })
})

describe('3 · no internal identifier reaches the screen', () => {
  test('an engine that is no longer configured has no name', () => {
    expect(engineLabel([], 'provider:abc:deepseek-v4-flash')).toBeNull()
    expect(engineLabel([], 'gpt-4o-mini')).toBeNull()
    expect(engineLabel([], 'claude-sonnet-4')).toBeNull()
  })

  test('nothing in the CAD tree peels an id apart to print it', () => {
    for (const file of componentSources) {
      const source = readFileSync(file, 'utf-8')
      expect(source).not.toMatch(/modelId\.split\(/)
      expect(source).not.toMatch(/\.split\(':\'\)\.pop\(\)/)
    }
  })

  test('the readout only ever names an engine that is configured', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    expect(shell).toContain('builtBy={jobEngine?.label ?? null}')
  })
})

describe('4 · no Tailwind palette survives', () => {
  const PALETTE =
    /(?:text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|divide|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?/

  test('not one palette utility is left in the component tree', () => {
    const offenders: string[] = []
    for (const file of componentSources) {
      const source = readFileSync(file, 'utf-8')
      if (PALETTE.test(source)) offenders.push(file.replace(root + '/', ''))
    }
    expect(offenders).toEqual([])
  })

  test('cyan is gone in particular - the review named it', () => {
    for (const file of componentSources) {
      expect(readFileSync(file, 'utf-8')).not.toContain('cyan-')
    }
  })

  test('the lint rule that keeps them gone is still in place', () => {
    const config = read('eslint.config.mjs')
    expect(config).toContain('Tailwind palette colour')
    expect(config).toContain('src/components/**/*.{ts,tsx}')
  })
})

describe('5 · the first frame has content', () => {
  test('the viewport lays the rendered still frame down before the canvas exists', () => {
    const panel = read('src/components/cad/workspace/ViewerPanel.tsx')
    expect(panel).toContain('src={selectedJob.pngPath}')
    // The chunk fallback must not cover the still frame with a skeleton.
    expect(panel).toMatch(/loading:\s*\(\)\s*=>\s*null/)
  })

  test('the viewer itself does the same, for the window while the mesh loads', () => {
    const viewer = read('src/components/cad/three-d-viewer.tsx')
    expect(viewer).toContain('src={job.pngPath}')
    expect(viewer).toContain('isLoading && !job.pngPath')
  })
})

describe('6 · the mobile sheet bar says which sheet is open', () => {
  test('the active tab carries a pressed state and a visible mark', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    expect(shell).toContain('aria-pressed={activeSheet === sheet.id}')
    expect(shell).toContain('shell-tab-active')

    const css = read('src/app/globals.css')
    expect(css).toContain('.shell-tab-active')
    expect(css).toContain('inset 0 -2px 0 var(--shell-signal)')
  })
})

describe('7 · body text is never smaller than 11px', () => {
  test('the sentences the review named are not on 10px elements', () => {
    const readout = read('src/components/cad/workspace/ReadoutModule.tsx')
    // "Target values are not measured geometry." was both 10px and jargon.
    expect(readout).not.toContain('Target values are not measured geometry.')
    expect(readout).not.toMatch(/text-\[10px\][^>]*>\s*\{t\("From parameters/)

    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    // The ruler scale and the canvas hint are sentences, not engraved labels.
    expect(shell).not.toMatch(/text-\[10px\][^\n]*mm · 0 — 200/)
    expect(shell).not.toMatch(/text-\[10px\][^\n]*Drag a module header/)
  })

  test('a state word is 11px wherever it is read', () => {
    // "Needs your decision" tells the user what to do next.
    const card = read('src/components/cad/sortable-job-card.tsx')
    expect(card).toMatch(/text-\[11px\][^\n]*leading-\[1\.4\]/)
    expect(card).not.toMatch(/text-\[10px\][^\n]*leading-\[1\.4\]/)

    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    expect(shell).not.toContain("'font-mono text-[10px] whitespace-nowrap',")
    expect(shell).not.toContain("'font-mono text-[10px] tracking-[0.06em] whitespace-nowrap',")
  })

  test('the engraver floor itself has not moved', () => {
    // 10px survives as chrome - the engraved section headings and badges.
    const instrument = read('src/components/cad/workspace/instrument.tsx')
    expect(instrument).toContain('text-[10px]')
  })
})

describe('8 · the failure state has one lit action, and it is the right one', () => {
  test('a failed part does not light the composer', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    // The trigger the review could not find: the arming condition used to treat
    // "has no STL" as "never generated", which is also true of a failed run.
    expect(shell).toContain('isFailedJob')
    expect(shell).toContain('(!isFailedJob && Boolean(state.selectedJob && !state.selectedJob.stlPath))')
  })

  test('the failure card can take the solid accent while the composer is dim', () => {
    const notice = read('src/components/cad/workspace/JobFailureNotice.tsx')
    expect(notice).toContain('solid')
    expect(notice).toContain('bg-[var(--shell-signal)]')

    const panel = read('src/components/cad/workspace/ViewerPanel.tsx')
    expect(panel).toContain('solid={failureActionIsSolid}')
  })
})

describe('9 · the layout maths is measured, not guessed', () => {
  test('the slots rail clears the readout plate it has to clear', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
    // The old 280px constant was right for one part and wrong by 59px for the
    // next; the ceiling now comes from the plate's measured height.
    expect(shell).toContain('readoutHeight')
    expect(shell).toContain('ResizeObserver')
    expect(shell).not.toContain("'calc(100vh - 280px)'")
  })

  test('the origin triad is grounded and not painted in primaries', () => {
    const viewer = read('src/components/cad/three-d-viewer.tsx')
    expect(viewer).not.toContain('axisHelper.position.set(-50, 0.1, -50)')
    expect(viewer).toContain('--shell-field-grid-strong')
    expect(viewer).toContain('axis.position.set(')
  })
})
