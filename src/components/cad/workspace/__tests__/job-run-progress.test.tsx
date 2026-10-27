import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JobRunProgress } from '../JobRunProgress'
import type { Job } from '@/components/cad/types'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'

const now = new Date().toISOString()
const job = { state: 'DEBUGGING', scadSource: 'cube(2);', executionProgress: {
  step: 'compiling_scad', startedAt: now, stageStartedAt: now, updatedAt: now,
  timeoutMs: 3000000, backend: 'native', sourceBytes: 14098, message: 'compiling',
} } as Job
const actions = { onCancel() {}, onViewCode() {}, onViewLog() {} }

test('compile progress shows real stage, saved source, budget and actions without a fake percentage', () => {
  const html = renderToStaticMarkup(<JobRunProgress job={job} {...actions} />)
  expect(html).toContain('Compiling OpenSCAD geometry')
  expect(html).toContain('50:00')
  expect(html).toContain('13.8 KB')
  expect(html).toContain('View saved code')
  expect(html).toContain('Stop job')
  expect(html).toContain('completion percentage')
  expect(html).not.toContain('aria-valuenow')
})

test('reload without a live heartbeat reports uncertainty, with Chinese labels', () => {
  const html = renderToStaticMarkup(<I18nContext.Provider value={{locale:'zh-CN', setLocale() {}, t:createTranslator('zh-CN')}}>
    <JobRunProgress job={{...job,executionProgress:null}} {...actions} />
  </I18nContext.Provider>)
  expect(html).toContain('正在等待新的运行心跳')
  expect(html).toContain('查看已保存代码')
  expect(html).toContain('停止任务')
})
