import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChecksModule } from '../workspace/ChecksModule'
import { JobListEmptyState } from '../workspace/empty-states'
import { getJobStateUi, getPipelineProgress, JOB_STATE_UI, type Job } from '../types'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'

/*
 * Regressions found by walking the running app against real job data
 * (2026-10-26) and asking the question the product could not answer: did the
 * user get what they asked for?
 *
 * Two of these are measurement defects, not look-and-feel ones. The outcome
 * ledger had no UI producer, so "accepted" and "rejected" were never written
 * and task success could not be computed from the product at all. The others
 * are places where the interface stated something untrue: a shortcuts sheet
 * that advertised keys the app did not have, a state that rendered as
 * "Draft" because no one wrote its label, a progress bar that restarted at
 * zero in the middle of a repair, and a lamp strip that carried the run
 * stage in colour alone.
 */

const root = resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8')

const shell = read('src/components/cad/workspace/MainWorkspace.tsx')
const types = read('src/components/cad/types.tsx')

describe('the shortcuts sheet tells the truth', () => {
  test('it does not advertise a tab scheme the app removed', () => {
    // The sheet listed six inspector tabs on keys 1-6. The inspector has three
    // tabs, and the digits belong to the camera: MainWorkspace claims them in
    // VIEW_KEYS and calls preventDefault, so a digit could never reach the tab
    // strip. A user pressing "2" for "Parameters" got a right-hand view.
    expect(shell).not.toContain('t("Switch inspector tab")')
    expect(shell).not.toContain('t("PARAMS")')
    expect(shell).not.toContain('t("ASSIST")')
    expect(shell).not.toContain('t("VALID")')

    // It now names the keys the shell actually owns.
    expect(shell).toContain('t("Standard views")')
    expect(shell).toContain('t("Fit to view")')
    expect(shell).toContain('t("Isometric view")')
  })

  test('the two keys it advertises are the two keys it binds', () => {
    // E and H were printed in the sheet with no owner behind them: the user was
    // told to press them and nothing happened.
    expect(shell).toMatch(/key === 'e'/)
    expect(shell).toMatch(/key === 'h'/)
    expect(shell).toContain("state.setActiveTab('CODE')")
    expect(shell).toContain("state.setActiveTab('HISTORY')")
  })

  test('the inspector tabs it lists are the tabs that exist', () => {
    const inspector = read('src/components/cad/workspace/InspectorPanel.tsx')
    const registered = [...inspector.matchAll(/key:\s*"([A-Z]+)"/g)].map(m => m[1])
    expect(registered.sort()).toEqual(['CODE', 'HISTORY', 'SPEC'])

    /*
     * 2026-10-27: the sheet no longer has an "INSPECTOR TABS" group of its own -
     * that group was what duplicated E and H under a second heading (UI-04). The
     * keys now appear once, in the Navigation group, and each names the panel it
     * opens. Only Code and History have a key, so only those two may be promised;
     * SPEC has no shortcut and must not be advertised as one.
     */
    expect(shell).toContain('t("Open the code panel")')
    expect(shell).toContain('t("Open the history panel")')
    expect(shell).not.toContain('t("Open the description panel")')
  })
})

describe('every job state says what it is', () => {
  test('a job being deleted is not a draft', () => {
    // The batch delete route writes DELETING before it removes the row, and a
    // failed artifact cleanup leaves the row behind in that state. With no
    // mapping it fell through to the default and read as "Draft", so a failed
    // delete looked like a brand new empty part.
    const ui = getJobStateUi('DELETING')
    expect(ui.labelKey).toBe('Deleting')
    expect(ui.tone).toBe('warn')
    expect(ui.labelKey).not.toBe('Draft')
  })

  test('the state table covers every state the API can write', () => {
    const api = read('src/app/api/jobs/route.ts')
    const valid = api.match(/const VALID_STATES = \[([\s\S]*?)\] as const/)
    expect(valid).not.toBeNull()
    const states = [...(valid as RegExpMatchArray)[1].matchAll(/"([A-Z_]+)"/g)].map(m => m[1])
    expect(states.length).toBeGreaterThan(0)

    for (const state of states) {
      // Every writable state needs its own row. A state that is missing falls
      // through to the default, and the default reads as "Draft" - the one
      // reading that is never right for a state the pipeline actually wrote.
      expect(Object.keys(JOB_STATE_UI)).toContain(state)
    }
  })
})

describe('the progress bar does not restart in the middle of a run', () => {
  test('a part being repaired is not back at the beginning', () => {
    // The bar used to be an index lookup into the five happy-path states, so
    // every off-path state returned 0 and the card clamped it to 4%. A part
    // that was being repaired showed a bar that had barely started.
    expect(getPipelineProgress('REPAIRING')).toBeGreaterThan(40)
    expect(getPipelineProgress('DEBUGGING')).toBeGreaterThan(40)

    // The happy path still reads the same way.
    expect(getPipelineProgress('NEW')).toBe(20)
    expect(getPipelineProgress('DELIVERED')).toBe(100)
    expect(getPipelineProgress('UNKNOWN_STATE')).toBe(0)
  })

  test('the card clamps a missing value, not a real one', () => {
    const card = read('src/components/cad/sortable-job-card.tsx')
    // The clamp is a floor for a 0% state, not a way to turn a real 0 into 4%.
    // Repair states must resolve above the floor before the clamp sees them.
    expect(getPipelineProgress('REPAIRING')).toBeGreaterThanOrEqual(4)
    expect(card).toContain('getPipelineProgress(job.state)')
  })
})

describe('the run stage is not carried by colour alone', () => {
  test('each lamp carries a word', () => {
    // The four lamps printed the same four words at every stage. Which one was
    // current lived in the dot colour, so a screen reader heard nothing and the
    // stage was invisible without colour vision - the shell's own rule says
    // colour is never the only signal.
    expect(shell).toContain('aria-live="polite"')
    expect(shell).toContain('aria-current={isCurrent ?')
    expect(shell).toMatch(/sr-only[\s\S]{0,200}t\("Done"\)/)
    expect(shell).toMatch(/sr-only[\s\S]{0,200}t\("Running"\)/)
  })

  test('a new notification is announced', () => {
    const centre = read('src/components/cad/notification-center.tsx')
    expect(centre).toContain('aria-live="polite"')
  })
})

describe('the outcome ledger can finally be written by the product', () => {
  const deliveredJob = {
    id: 'delivered-job',
    state: 'DELIVERED',
    stlPath: '/artifacts/delivered-job/model.stl',
    scadSource: 'module generated_part() { cube(20); }\ngenerated_part();',
    validationResults: JSON.stringify([
      { rule_id: 'C001', rule_name: 'OpenSCAD Compile', level: 'ENGINEERING', passed: true, is_critical: true, status: 'PASS', message: 'Compiled' },
    ]),
  } as Job

  const renderChecks = (job: Job) =>
    renderToStaticMarkup(
      React.createElement(
        I18nContext.Provider,
        { value: { locale: 'en', setLocale() {}, t: createTranslator('en') } },
        React.createElement(ChecksModule, {
          job,
          isProcessing: false,
          hasDraftChanges: false,
          revision: 1,
        }),
      ),
    )

  test('a finished part can be judged', () => {
    // Without a verdict action, "accepted" and "rejected" were never written
    // by anything: the ledger only held edits and exports, both of which are
    // process signals rather than proof that the part was right.
    const html = renderChecks(deliveredJob)
    expect(html).toContain('Delivery verdict')
    expect(html).toContain('Accept this part')
    expect(html).toContain('This part is not right')
  })

  test('a broken part is not judged', () => {
    // Judging known-broken geometry would record a verdict on a part that the
    // checks already rejected.
    const html = renderChecks({
      ...deliveredJob,
      validationResults: JSON.stringify([
        { rule_id: 'B001', rule_name: 'Bounding Box Match', level: 'ENGINEERING', passed: false, is_critical: true, status: 'FAIL', message: 'Bbox mismatch' },
      ]),
    } as Job)
    expect(html).not.toContain('Delivery verdict')
  })

  test('the client can post a decision and read the summary back', () => {
    const api = read('src/components/cad/api.ts')
    expect(api).toContain('recordJobOutcome')
    expect(api).toContain('fetchJobOutcomeSummary')
    expect(api).toContain('`/api/jobs/${id}/outcome`')
  })
})

describe('controls a keyboard user needs are reachable', () => {
  test('the SCAD editor has a name for its textarea', () => {
    // A textarea with no label is announced as "edit text" with nothing else.
    const editor = read('src/components/cad/scad-editor.tsx')
    expect(editor).toMatch(/<textarea[\s\S]{0,400}aria-label=/)
  })

  test('a revision row can be opened without a mouse', () => {
    // The version row is the only way to read a diff, and it was a div with a
    // click handler: no role, no tab stop, no key handler.
    const history = read('src/components/cad/job-version-history.tsx')
    expect(history).toContain('role="button"')
    expect(history).toContain('tabIndex={0}')
    expect(history).toContain('aria-expanded={isExpanded}')
    expect(history).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/)
  })
})

describe('a cancellation says why', () => {
  test('the cancel route records the reason', () => {
    // A cancelled job wrote only its state, so the log could not tell "the user
    // stopped this" from "the run was killed" - the difference between a
    // deliberate abandon and a hidden failure.
    const route = read('src/app/api/jobs/[id]/cancel/route.ts')
    expect(route).toContain('appendLog(')
    expect(route).toContain("'CANCELLED'")
  })
})

describe('"still working" is distinguishable from "nothing here"', () => {
  const render = (element: React.ReactElement) =>
    renderToStaticMarkup(
      <I18nContext.Provider value={{ locale: 'en', setLocale: () => {}, t: createTranslator('en') }}>
        {element}
      </I18nContext.Provider>,
    )

  test('the job list skeleton says it is busy, and says so in words', () => {
    // Without this, a screen reader read four grey boxes and an empty list as
    // the same thing. It matters more once reduced motion stops them pulsing:
    // then the skeleton carries its meaning in shape alone.
    const markup = render(
      <JobListEmptyState
        isFirstLoadComplete={false}
        totalJobsCount={0}
        hasActiveFilters={false}
        onResetFilters={() => {}}
        onShowComposer={() => {}}
      />,
    )
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Loading parts')
  })

  test('the finished empty list is not marked busy', () => {
    // The flag has to come off, or every empty state reads as still loading.
    const markup = render(
      <JobListEmptyState
        isFirstLoadComplete
        totalJobsCount={0}
        hasActiveFilters={false}
        onResetFilters={() => {}}
        onShowComposer={() => {}}
      />,
    )
    expect(markup).not.toContain('aria-busy="true"')
  })

  test('the viewport flags itself while a part is being built', () => {
    const viewer = read('src/components/cad/workspace/ViewerPanel.tsx')
    expect(viewer).toContain('aria-busy={isSelectedProcessing}')
  })
})

describe('dead panels are not carried in the tree', () => {
  test('the five orphaned components are gone', () => {
    // Verified unreferenced across the whole tree — including tests — before
    // removal, and the typecheck after removal confirmed it. They were 1500+
    // lines of unreachable code, two of which also ran infinite spinners.
    for (const file of [
      'job-status-page',
      'pipeline-visualization',
      'quick-actions-bar',
      'scad-viewer',
      'footer',
    ]) {
      expect(existsSync(resolve(root, `src/components/cad/${file}.tsx`))).toBe(false)
    }
  })
})

describe('motion stops when the system is asked to reduce it', () => {
  const css = read('src/app/globals.css')
  // The file already carries an earlier reduced-motion block for seven custom
  // classes (skeleton-pulse, slide-in-*, empty-float…). Target the block that
  // handles the Tailwind utilities specifically, or these assertions pass on the
  // older block and keep passing after someone deletes this one.
  const blocks = css.split('@media (prefers-reduced-motion: reduce)').slice(1)
  const target = (block: string) => block.slice(0, block.indexOf('\n}'))
  const motionBlock = target(blocks.find((b) => b.includes('.animate-spin')) ?? '')

  test('the looping utilities have a reduced-motion counterpart', () => {
    // 19 animate-spin and 8 animate-pulse across the CAD tree, and exactly one
    // of them carried its own motion-reduce variant. A design system should make
    // the correct behaviour the default, so this is handled once globally rather
    // than at 27 call sites that can each forget.
    expect(motionBlock).toContain('.animate-spin')
    expect(motionBlock).toContain('.animate-pulse')
    expect(motionBlock).toContain('animation: none')
  })

  test('the rule does not need !important to win', () => {
    // Tailwind v4 emits utilities inside `@layer`, and unlayered rules beat
    // layered ones, so this works by cascade position alone. Reaching for
    // `!important` would mean someone had lost confidence in that and was
    // papering over a rule that had silently stopped applying.
    expect(motionBlock).not.toContain('!important')
  })

  test('every infinite animation defined here has a reduced-motion counterpart', () => {
    // The lock that grows on its own. Add an `animation: … infinite` rule to this
    // file without handling reduced motion and this fails, which is the opposite
    // of the four that were already sitting here uncovered.
    const looping = new Set<string>()
    for (const match of css.matchAll(/animation:[^;]*\binfinite\b/g)) {
      const preceding = css.slice(Math.max(0, (match.index ?? 0) - 300), match.index)
      const name = [...preceding.matchAll(/\.([a-zA-Z][\w-]*)/g)].pop()
      if (name) looping.add(name[1] ?? '')
    }
    const handled = new Set<string>()
    for (const block of blocks) {
      const body = block.slice(0, block.indexOf('\n}'))
      for (const match of body.matchAll(/\.([a-zA-Z][\w-]*)/g)) handled.add(match[1] ?? '')
    }
    expect(looping.size).toBeGreaterThan(0)
    expect([...looping].filter((name) => !handled.has(name))).toEqual([])
  })

  test('the view cube stops travelling, but still arrives', () => {
    // Its rotation is animated through an inline style, which no stylesheet
    // media query can reach — so it has to ask in JS. It must still turn to the
    // commanded view: the view change is the information, the journey is not.
    const cube = read('src/components/cad/workspace/ViewCube.tsx')
    expect(cube).toContain('useReducedMotion')
    expect(cube).toContain("isDragging || reducedMotion ? 'none' : 'transform .34s")
  })

  test('the words survive without the motion', () => {
    // Stopping a spinner is only safe if the loading state is also stated in
    // words. If it is motion-only, freezing it removes the only signal there was.
    const composer = read('src/components/cad/workspace/JobComposer.tsx')
    expect(composer).toContain('t("Refining…")')
    expect(composer).toContain('t("Loading models…")')
  })
})
