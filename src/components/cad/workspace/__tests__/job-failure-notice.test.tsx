import { expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JobCancelledNotice, JobFailureNotice, readJobFailure } from '../JobFailureNotice'
import type { Job } from '@/components/cad/types'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'

const job = {
  id: 'failed-job', state: 'GEOMETRY_FAILED', executionLogs: JSON.stringify([
    { timestamp: '2026-10-25T17:40:09Z', event: 'LLM_UNAVAILABLE', message: 'Processing failed during generate [LLM_UNAVAILABLE]: Connection interrupted (ECONNRESET)' },
  ]),
} as Job

test('a failed generation shows the actual stage, connection error and log action', () => {
  const markup = renderToStaticMarkup(<JobFailureNotice job={job} onViewLog={() => {}} />)
  expect(markup).toContain('Failed at: Write OpenSCAD')
  expect(markup).toContain('ECONNRESET')
  expect(markup).toContain('View execution log')
  expect(markup).not.toContain('This part has no geometry yet')
})

test('Chinese failure stage remains readable and malformed logs do not crash', () => {
  const markup = renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'zh-CN', setLocale: () => {}, t: createTranslator('zh-CN') }}>
      <JobFailureNotice job={job} onViewLog={() => {}} />
    </I18nContext.Provider>,
  )
  expect(markup).toContain('失败步骤：写出 OpenSCAD')
  expect(markup).toContain('查看执行日志')
  expect(readJobFailure({ ...job, executionLogs: '{}' }).message).toBeNull()
  expect(readJobFailure({ ...job, state: 'RENDER_FAILED', executionLogs: null }).stage).toBe('Render geometry')
})

/*
 * A cancellation was invisible: `isFailed` covers only the three failure states,
 * and `isRunning` deliberately excludes CANCELLED, so a stopped job rendered
 * whatever the pipeline had last written with no acknowledgment anywhere. The
 * reason was in the execution log and nowhere a user would look.
 */
const cancelled = {
  id: 'cancelled-job', state: 'CANCELLED', scadSource: 'cube(10);',
  executionLogs: JSON.stringify([
    { timestamp: '2026-10-26T09:00:00Z', event: 'CANCELLED', message: 'Stopped by the user before the part was finished.' },
  ]),
} as Job

test('a stopped run is acknowledged, and not as a failure', () => {
  const markup = renderToStaticMarkup(<JobCancelledNotice job={cancelled} onViewLog={() => {}} onProcess={() => {}} />)
  expect(markup).toContain('You stopped this run')
  expect(markup).toContain('Generate again')
  expect(markup).toContain('View execution log')
  // It is not an error, so it must not borrow the failure card's alarm: no
  // `role="alert"`, no "Failed at:". The user pressed stop; they already know.
  expect(markup).not.toContain('role="alert"')
  expect(markup).not.toContain('Failed at:')
})

test('the cancellation log does not leak an internal state name', () => {
  // The old message interpolated the job state: "...in state REPAIRING". An
  // internal enum in user-facing copy is the same defect as showing a rule id.
  const route = readFileSync(
    resolve(__dirname, '../../../../app/api/jobs/[id]/cancel/route.ts'), 'utf-8',
  )
  expect(route).not.toContain('in state ${job.state}')
  expect(route).toContain('Stopped by the user before the part was finished.')
})

test('the viewer renders the cancellation card for a stopped job', () => {
  const viewer = readFileSync(resolve(__dirname, '../ViewerPanel.tsx'), 'utf-8')
  expect(viewer).toContain("selectedJob.state === 'CANCELLED'")
  expect(viewer).toContain('<JobCancelledNotice')
  // It must be reachable in both layouts: over the part when geometry exists,
  // and alone when there is nothing to show.
  expect(viewer.match(/<JobCancelledNotice/g)?.length).toBe(2)
})
