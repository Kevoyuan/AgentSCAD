import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, DEFAULT_LOCALE, isLocale } from '..'
import { I18nContext } from '@/components/i18n-provider'
import { LanguagePanel } from '@/components/cad/language-panel'
import { CadViewportEmptyState } from '@/components/cad/workspace/empty-states'
import { labelFor } from '@/components/cad/workspace/ViewCube'

const english = createTranslator('en')
const chinese = createTranslator('zh-CN')

describe('interface localization', () => {
  test('English is the default; unsupported preferences do not become locales', () => {
    expect(DEFAULT_LOCALE).toBe('en')
    expect(isLocale('en')).toBe(true)
    expect(isLocale('zh-CN')).toBe(true)
    for (const unsupported of ['zh', 'de', '', null, undefined]) expect(isLocale(unsupported)).toBe(false)
    const html = renderToStaticMarkup(<LanguagePanel />)
    expect(html).toContain('Interface language')
    expect(html).toMatch(/<option[^>]*value="en"[^>]*selected/)
  })

  test('both languages interpolate complete messages and preserve template placeholders', () => {
    expect(english('{0} parameters changed · Rebuild required', { 0: 3 })).toBe('3 parameters changed · Rebuild required')
    expect(chinese('{0} parameters changed · Rebuild required', { 0: 3 })).toBe('参数已改 3 项，需重建')
    expect(chinese('A spur gear with {teeth} teeth, a {bore} mm bore and {faceWidth} mm face width')).toContain('{teeth}')
    expect(chinese('用户的零件描述')).toBe('用户的零件描述')
    expect(chinese('A custom model label')).toBe('A custom model label')
    expect(chinese('__proto__')).toBe('__proto__')
    expect(chinese('constructor')).toBe('constructor')
  })

  test('the same workspace empty state renders in English and Chinese', () => {
    const englishHtml = renderToStaticMarkup(<CadViewportEmptyState selectedJob={null} isProcessing={false} />)
    expect(englishHtml).toContain('Describe the part you need.')
    expect(englishHtml).not.toContain('写一句话')
    const chineseHtml = renderToStaticMarkup(
      <I18nContext.Provider value={{ locale: 'zh-CN', setLocale: () => {}, t: chinese }}>
        <CadViewportEmptyState selectedJob={null} isProcessing={false} />
        <LanguagePanel />
      </I18nContext.Provider>
    )
    expect(chineseHtml).toContain('写一句话，描述你要的零件。')
    expect(chineseHtml).toContain('界面语言')
    expect(chineseHtml).toMatch(/<option[^>]*value="zh-CN"[^>]*selected/)
  })

  test('view labels follow the language while camera geometry stays the same', () => {
    expect(labelFor(89.8, 0)).toBe('Top')
    expect(labelFor(89.8, 0, chinese)).toBe('上')
    expect(labelFor(45, 45, chinese)).toBe('等轴 · 前上右')
  })
})
