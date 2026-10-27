import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChecksModule } from '../ChecksModule'
import type { Job } from '@/components/cad/types'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'

const reviewJob = {
  id: 'review-job',
  state: 'HUMAN_REVIEW',
  stlPath: '/artifacts/review-job/model.stl',
  scadSource: 'total_length = 842;\nmodule generated_part() { cube(1); }\ngenerated_part();',
  validationResults: JSON.stringify([
    { rule_id: 'B001', rule_name: 'Bounding Box Match', level: 'ENGINEERING', passed: false, is_critical: true, status: 'FAIL', message: 'Bbox mismatch: Z 42mm off' },
    { rule_id: 'R002', rule_name: 'Maximum Dimensions', level: 'MANUFACTURING', passed: false, is_critical: false, status: 'FAIL', message: 'Exceeds 300mm' },
    { rule_id: 'C001', rule_name: 'OpenSCAD Compile', level: 'ENGINEERING', passed: true, is_critical: true, status: 'PASS', message: 'Compiled' },
    { rule_id: 'S001', rule_name: 'Semantic Geometry Match', level: 'ENGINEERING', passed: true, is_critical: true, status: 'SKIP', message: 'Skipped' },
  ]),
} as Job

test('a blocked review exposes repair actions above the verdict list, not below a scroll fold', () => {
  const html = renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'en', setLocale() {}, t: createTranslator('en') }}>
      <ChecksModule
        job={reviewJob}
        isProcessing={false}
        hasDraftChanges={false}
        revision={4}
        onRepair={() => {}}
        onVisualRepair={() => {}}
      />
    </I18nContext.Provider>,
  )

  expect(html).toContain('Available actions')
  expect(html).toContain('Automatic repair')
  expect(html).toContain('Visual repair')
  expect(html).toContain('Export STL')
  expect(html).toContain('Export OpenSCAD')
  expect(html.indexOf('Available actions')).toBeLessThan(html.indexOf('Dimensions match intent'))
});

test('a job without blockers keeps the action block hidden', () => {
  const html = renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'en', setLocale() {}, t: createTranslator('en') }}>
      <ChecksModule
        job={{ ...reviewJob, validationResults: JSON.stringify([
          { rule_id: 'C001', rule_name: 'OpenSCAD Compile', level: 'ENGINEERING', passed: true, is_critical: true, status: 'PASS', message: 'Compiled' },
        ]) } as Job}
        isProcessing={false}
        hasDraftChanges={false}
        revision={4}
        onRepair={() => {}}
      />
    </I18nContext.Provider>,
  )

  expect(html).not.toContain('Available actions')
  expect(html).toContain('Export STL')
});
