'use client'

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  createTranslator, DEFAULT_LOCALE, englishTranslator, isLocale, LOCALE_STORAGE_KEY,
  type Locale, type Translator,
} from '@/lib/i18n'

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
}

export const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: englishTranslator,
})

let browserLocale: Locale = DEFAULT_LOCALE
let initialized = false
const listeners = new Set<() => void>()

function getSnapshot(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  if (!initialized) {
    initialized = true
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
      if (isLocale(saved)) browserLocale = saved
    } catch {
      // Preferences still work in memory when browser storage is unavailable.
    }
  }
  return browserLocale
}

function notify() {
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
    browserLocale = isLocale(event.newValue) ? event.newValue : DEFAULT_LOCALE
    notify()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

function setLocale(next: Locale) {
  if (!isLocale(next)) return
  browserLocale = next
  initialized = true
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // Keep the selected language for this session if persistence is unavailable.
  }
  notify()
}

const getServerSnapshot = () => DEFAULT_LOCALE

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale) }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
