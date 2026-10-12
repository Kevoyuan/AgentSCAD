import chineseMessages from './zh-CN.json'

export type Locale = 'en' | 'zh-CN'
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'agentscad-language'
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-CN']
export type TranslationValues = Record<string, string | number>
export type Translator = (message: string, values?: TranslationValues) => string

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh-CN'
}

/** English source messages are stable catalog keys; unknown/model content stays intact. */
export function createTranslator(locale: Locale): Translator {
  return (message, values) => {
    const translated = locale === 'zh-CN' && Object.prototype.hasOwnProperty.call(chineseMessages, message)
      ? (chineseMessages as Record<string, string>)[message]
      : message
    return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
      values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
    )
  }
}

export const englishTranslator = createTranslator(DEFAULT_LOCALE)
