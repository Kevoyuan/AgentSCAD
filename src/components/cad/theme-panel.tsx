'use client'

import { useI18n } from '@/components/i18n-provider'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'

/*
 * Appearance, per DESIGN.md "Secondary surfaces".
 *
 * This panel used to write about twenty CSS variables onto :root - an accent hue, a
 * base font size, a UI density, an animation switch - and none of them had a consumer
 * left. Worse, it set `--cad-accent`, `--primary` and `--ring`, so picking "Indigo"
 * recoloured the legacy panels *and* the shadcn focus rings while the shell stayed on
 * its own signal: two accents on one screen, written by a control that claimed to own
 * the palette (DESIGN.md section 22 - one writer per element).
 *
 * What actually works is the theme mode, which next-themes owns. That is what is
 * offered, plus one line saying why the palette is not a preference: section 11 fixes
 * one expressive accent, and the density control that matters already lives in the
 * 面板 module (全览 / 调参 / 看模型).
 */

const THEME_MODES = [
  { value: 'light' as const, label: "Light", icon: Sun },
  { value: 'dark' as const, label: "Dark", icon: Moon },
  { value: 'system' as const, label: "System", icon: Monitor },
]

const subscribeToNothing = () => () => {}
const onClient = () => true
const onServer = () => false

export function ThemePanel() {
  const { t } = useI18n()

  const { theme, setTheme, resolvedTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribeToNothing, onClient, onServer)

  // The cross-fade is the one place a theme switch is allowed to animate.
  const [switching, setSwitching] = useState(false)
  useEffect(() => {
    if (!switching) return
    const timer = setTimeout(() => {
      document.documentElement.classList.remove('theme-transition')
      setSwitching(false)
    }, 400)
    return () => clearTimeout(timer)
  }, [switching])

  if (!mounted) return null

  return (
    <div className="space-y-4 p-1">
      <div>
        <div className="mb-2 font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
          {t("Interface theme")}
        </div>
        <div className="flex items-center gap-0.5 rounded-[6px] bg-[var(--shell-well)] p-0.5">
          {THEME_MODES.map(mode => {
            const isActive = theme === mode.value
            const Icon = mode.icon
            return (
              <button
                key={mode.value}
                type="button"
                aria-pressed={isActive}
                className={`flex-1 h-[28px] flex items-center justify-center gap-1.5 rounded-[4px] font-mono text-[11px] transition-colors ${
                  isActive
                    ? 'bg-[var(--shell-signal)] text-[var(--shell-signal-ink)]'
                    : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)]'
                }`}
                onClick={() => {
                  document.documentElement.classList.add('theme-transition')
                  setSwitching(true)
                  setTheme(mode.value)
                }}
              >
                <Icon className="w-3 h-3" />
                <span>{t(mode.label)}
</span>
              </button>
            )
          })}
        </div>
        {theme === 'system' && (
          <p className="mt-2 font-mono text-[10px] text-[var(--shell-text-dim)]">
            {t("System theme: currently")}{resolvedTheme === 'dark' ? t("Dark") : t("Light")}
          </p>
        )}
      </div>

      <p className="text-[12px] leading-[1.6] text-[var(--shell-text-muted)]">
        {t("Choose Light, Dark, or System to match your device.")}
      </p>
    </div>
  )
}
