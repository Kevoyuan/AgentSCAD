'use client'

import { useI18n } from '@/components/i18n-provider'
import { type Locale } from '@/lib/i18n'

export function LanguagePanel() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="space-y-3 p-1">
      <div className="space-y-2">
        <label htmlFor="interface-language" className="block font-mono text-[10px] font-medium tracking-[0.12em] text-[var(--shell-text-label)]">
          {t('Interface language')}
        </label>
        <select
          id="interface-language"
          value={locale}
          onChange={event => setLocale(event.target.value as Locale)}
          className="h-10 w-full rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] px-3 text-sm text-[var(--shell-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)]"
        >
          <option value="en" lang="en">English</option>
          <option value="zh-CN" lang="zh-CN">简体中文</option>
        </select>
      </div>
      <p className="text-[11.5px] leading-[1.6] text-[var(--shell-text-muted)]">
        {t('Changes apply immediately and are saved in this browser.')}
      </p>
    </div>
  )
}
