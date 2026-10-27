import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelPicker, engineLabel, modelOptions } from '../ModelPicker'
import type { ModelInfo } from '@/components/cad/api'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'

const model = (overrides: Partial<ModelInfo> & Pick<ModelInfo, 'id' | 'name'>): ModelInfo => ({
  description: '',
  provider: 'deepseek',
  providerName: 'DeepSeek',
  multimodal: false,
  reasoning: true,
  category: 'fast',
  ...overrides,
})

const savedFlash = model({
  id: 'provider:bab099eb-71b4-4d62-a8b5-ef4d06ae86ed:deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  provider: 'bab099eb-71b4-4d62-a8b5-ef4d06ae86ed',
})
const envFlash = model({ id: 'provider:env-deepseek:deepseek-v4-flash', name: 'DeepSeek V4 Flash' })
const envPro = model({ id: 'provider:env-deepseek:deepseek-v4-pro', name: 'DeepSeek V4 Pro', category: 'flagship' })

function markup(models: ModelInfo[], value: string, isLoading = false, partSelected = false) {
  return renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'en', setLocale() {}, t: createTranslator('en') }}>
      <ModelPicker
        models={models}
        value={value}
        isLoading={isLoading}
        partSelected={partSelected}
        onChange={() => {}}
        onManage={() => {}}
      />
    </I18nContext.Provider>
  )
}

test('the chip drops the provider prefix so the engine name fits the field', () => {
  const html = markup([savedFlash], savedFlash.id)
  expect(html).toContain('>V4 Flash<')
  expect(html).not.toContain('>DeepSeek V4 Flash<')
  // The full name still reaches assistive tech and the tooltip.
  expect(html).toContain('aria-label="Model engine: DeepSeek V4 Flash"')
})

test('a model whose name does not repeat the provider keeps its whole name', () => {
  expect(markup([envPro], envPro.id)).toContain('>V4 Pro<')
})

test('two providers offering the same model are told apart by where they came from', () => {
  // `/api/models` merges saved and environment providers, so this collision is
  // reachable on any install that has both a key in .env and one saved in Settings.
  const rows = modelOptions([savedFlash, envFlash], createTranslator('en'))
  expect(rows.map(row => row.subtitle)).toEqual([
    'DeepSeek · Saved in Settings',
    'DeepSeek · From environment',
  ])
  // The trigger carries the same distinction, since it repeats the current choice.
  expect(markup([savedFlash, envFlash], savedFlash.id)).toContain('DeepSeek · Saved in Settings')
})

test('the source tag stays out of the way when no names collide', () => {
  const rows = modelOptions([savedFlash, envPro], createTranslator('en'))
  expect(rows.map(row => row.subtitle)).toEqual(['DeepSeek', 'DeepSeek'])
  const html = markup([savedFlash, envPro], savedFlash.id)
  expect(html).not.toContain('Saved in Settings')
  expect(html).not.toContain('From environment')
})

test('an unset or unknown engine reads as a prompt, never as a blank chip', () => {
  expect(markup([savedFlash], '')).toContain('>Choose model<')
  expect(markup([savedFlash], 'provider:gone:model')).toContain('>Choose model<')
  expect(markup([], '', true)).toContain('>Loading...<')
})

test('the trigger is a button with an expanded state, not a div', () => {
  const html = markup([savedFlash], savedFlash.id)
  expect(html).toContain('data-testid="model-picker"')
  expect(html).toContain('aria-haspopup="dialog"')
  expect(html).toContain('aria-expanded="false"')
})

test('with a part open the chip says "next", because it never meant "this part"', () => {
  // The composer placeholder switches to "Describe a change" once a part is open,
  // which made the chip read as that part's engine. It is not: it is the engine the
  // next build will use. The part's own engine is shown in the header.
  expect(markup([savedFlash], savedFlash.id, false, true)).toContain('aria-label="Next build: DeepSeek V4 Flash"')
  expect(markup([savedFlash], savedFlash.id, false, true)).toContain('Next build uses DeepSeek V4 Flash · DeepSeek')
  expect(markup([savedFlash], savedFlash.id, false, false)).toContain('aria-label="Model engine: DeepSeek V4 Flash"')
})

test('an engine that is no longer configured has no name, and never its id', () => {
  // A part outlives the provider that built it. The old fallback peeled the last
  // segment off the id and printed it, so the workspace showed the literal
  // string "deepseek-v4-flash" - an internal identifier in chrome, which
  // DESIGN.md section 26 forbids. Unknown means unknown.
  expect(engineLabel([savedFlash], savedFlash.id)).toEqual({
    label: 'V4 Flash',
    full: 'DeepSeek V4 Flash · DeepSeek',
  })
  expect(engineLabel([], savedFlash.id)).toBeNull()
  expect(engineLabel([savedFlash], null)).toBeNull()

  // And the fallback must not be reachable by any other route: no id fragment
  // may become a label.
  for (const id of [
    'provider:gone:deepseek-v4-flash',
    'env-deepseek:deepseek-v4-flash',
    'gpt-4o-mini',
    'claude-sonnet-4',
  ]) {
    const label = engineLabel([], id)
    expect(label).toBeNull()
  }
})
