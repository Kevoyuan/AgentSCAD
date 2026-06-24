'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { Palette, Type, LayoutGrid, Sparkles, RotateCcw, Check, Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

// ─── Theme Config ────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  { name: 'Violet', hue: 263, hex: '#7c3aed', color: 'bg-violet-500', ring: 'ring-violet-400' },
  { name: 'Cyan', hue: 185, hex: '#06b6d4', color: 'bg-cyan-500', ring: 'ring-cyan-400' },
  { name: 'Emerald', hue: 155, hex: '#10b981', color: 'bg-emerald-500', ring: 'ring-emerald-400' },
  { name: 'Amber', hue: 38, hex: '#f59e0b', color: 'bg-amber-500', ring: 'ring-amber-400' },
  { name: 'Rose', hue: 345, hex: '#f43f5e', color: 'bg-rose-500', ring: 'ring-rose-400' },
  { name: 'Orange', hue: 25, hex: '#f97316', color: 'bg-orange-500', ring: 'ring-orange-400' },
]

const FONT_SIZES = [
  { name: 'Small', value: '11px', label: 'S' },
  { name: 'Medium', value: '13px', label: 'M' },
  { name: 'Large', value: '15px', label: 'L' },
]

const UI_DENSITIES = [
  { name: 'Compact', value: 'compact', gap: '0.25rem', padding: '0.5rem' },
  { name: 'Normal', value: 'normal', gap: '0.5rem', padding: '0.75rem' },
  { name: 'Comfortable', value: 'comfortable', gap: '0.75rem', padding: '1rem' },
]

const THEME_MODES = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'system' as const, label: 'System', icon: Monitor },
]

interface ThemeSettings {
  accentHue: number
  fontSize: string
  density: string
  animationsEnabled: boolean
}

const DEFAULT_SETTINGS: ThemeSettings = {
  accentHue: 263,
  fontSize: '13px',
  density: 'normal',
  animationsEnabled: true,
}

function loadSettings(): ThemeSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const saved = localStorage.getItem('agentscad-theme')
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: ThemeSettings) {
  try {
    localStorage.setItem('agentscad-theme', JSON.stringify(settings))
  } catch { /* ignore */ }
}

// ─── Apply Theme to DOM ──────────────────────────────────────────────────

function applyThemeToDOM(settings: ThemeSettings) {
  const root = document.documentElement
  const accent = ACCENT_COLORS.find(a => a.hue === settings.accentHue) || ACCENT_COLORS[0]
  const isDark = root.classList.contains('dark')

  // Apply accent as shared CSS custom properties.
  // CAD surfaces use --cad-accent; app chrome uses --app-accent.
  root.style.setProperty('--app-accent', accent.hex)
  root.style.setProperty('--cad-accent', accent.hex)
  root.style.setProperty('--primary', accent.hex)
  root.style.setProperty('--ring', accent.hex)
  root.style.setProperty('--accent-hue', String(settings.accentHue))

  // Accent hover: slightly lighter in dark, slightly darker in light
  const accentHover = isDark
    ? `hsl(${settings.accentHue}, 70%, 65%)`
    : `hsl(${settings.accentHue}, 70%, 45%)`
  root.style.setProperty('--app-accent-hover', accentHover)

  // Accent background: subtle tint
  const accentBg = `hsla(${settings.accentHue}, 70%, 50%, 0.08)`
  root.style.setProperty('--app-accent-bg', accentBg)
  root.style.setProperty('--accent', accentBg)

  // Accent text: lighter in dark mode, darker in light mode
  const accentText = isDark
    ? `hsl(${settings.accentHue}, 70%, 72%)`
    : `hsl(${settings.accentHue}, 70%, 42%)`
  root.style.setProperty('--app-accent-text', accentText)
  root.style.setProperty('--accent-foreground', accentText)

  // Accent border
  const accentBorder = `hsla(${settings.accentHue}, 70%, 50%, 0.25)`
  root.style.setProperty('--app-accent-border', accentBorder)

  // Accent text secondary (dimmer)
  const accentTextSec = isDark
    ? `hsla(${settings.accentHue}, 60%, 72%, 0.7)`
    : `hsla(${settings.accentHue}, 60%, 42%, 0.7)`
  root.style.setProperty('--app-accent-text-secondary', accentTextSec)

  // CAD accent companions used by sliders, viewport glow, chips, and inspector states.
  root.style.setProperty('--cad-accent-soft', `hsla(${settings.accentHue}, 70%, 50%, ${isDark ? '0.16' : '0.10'})`)
  root.style.setProperty('--cad-grid', `hsla(${settings.accentHue}, 70%, 50%, ${isDark ? '0.14' : '0.06'})`)

  // Batch bar
  const batchBarBg = `hsla(${settings.accentHue}, 70%, 50%, 0.06)`
  root.style.setProperty('--app-batch-bar-bg', batchBarBg)
  const batchBarText = isDark
    ? `hsl(${settings.accentHue}, 50%, 78%)`
    : `hsl(${settings.accentHue}, 70%, 42%)`
  root.style.setProperty('--app-batch-bar-text', batchBarText)

  // Focus ring
  const focusRing = `hsla(${settings.accentHue}, 70%, 50%, ${isDark ? '0.3' : '0.2'})`
  root.style.setProperty('--app-focus-ring', focusRing)
  root.style.setProperty('--app-input-focus-border', `hsla(${settings.accentHue}, 70%, 50%, ${isDark ? '0.5' : '0.45'})`)

  // Interactive hover
  const interactiveHover = `hsla(${settings.accentHue}, 70%, 50%, 0.06)`
  root.style.setProperty('--app-interactive-hover', interactiveHover)

  // Selected bg
  const selectedBg = `hsla(${settings.accentHue}, 70%, 50%, ${isDark ? '0.08' : '0.05'})`
  root.style.setProperty('--app-selected-bg', selectedBg)

  // Gradient separator
  const gradSep = isDark
    ? `linear-gradient(90deg, transparent, hsla(${settings.accentHue}, 70%, 50%, 0.25), hsla(${settings.accentHue}, 70%, 50%, 0.08), transparent)`
    : `linear-gradient(90deg, transparent, hsla(${settings.accentHue}, 70%, 50%, 0.12), hsla(${settings.accentHue}, 70%, 50%, 0.04), transparent)`
  root.style.setProperty('--app-gradient-separator', gradSep)

  // Legacy accent variables (for backwards compat)
  root.style.setProperty('--accent-color', `hsl(${settings.accentHue}, 70%, 60%)`)
  root.style.setProperty('--accent-color-dim', `hsl(${settings.accentHue}, 50%, 30%)`)
  root.style.setProperty('--accent-color-bright', `hsl(${settings.accentHue}, 80%, 70%)`)
  root.style.setProperty('--accent-color-bg', `hsl(${settings.accentHue}, 50%, 12%)`)
  root.style.setProperty('--accent-color-border', `hsl(${settings.accentHue}, 40%, 25%)`)

  // Apply font size
  root.style.setProperty('--base-font-size', settings.fontSize)

  // Apply density
  const densityConfig = UI_DENSITIES.find(d => d.value === settings.density) || UI_DENSITIES[1]
  root.style.setProperty('--ui-gap', densityConfig.gap)
  root.style.setProperty('--ui-padding', densityConfig.padding)

  // Apply animations
  if (!settings.animationsEnabled) {
    root.style.setProperty('--animation-duration', '0s')
    root.classList.add('reduce-motion')
  } else {
    root.style.setProperty('--animation-duration', '')
    root.classList.remove('reduce-motion')
  }
}

// ─── Theme Panel Component ───────────────────────────────────────────────

export function ThemePanel() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    return loadSettings()
  })
  const [mounted, setMounted] = useState(() => {
    if (typeof window === 'undefined') return false
    return true
  })

  // Apply theme on mount and when settings change
  useEffect(() => {
    applyThemeToDOM(settings)
  }, [settings])

  // Re-apply accent colors when theme mode changes (dark/light affects accent text/hover)
  useEffect(() => {
    if (mounted) {
      applyThemeToDOM(settings)
    }
  }, [resolvedTheme, mounted])

  const updateSettings = useCallback((partial: Partial<ThemeSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial }
      saveSettings(next)
      applyThemeToDOM(next)
      return next
    })
  }, [])

  const handleThemeChange = useCallback((value: string) => {
    // Add transition class for smooth theme switch
    const root = document.documentElement
    root.classList.add('theme-transition')
    setTheme(value)
    // Remove transition class after animation completes
    setTimeout(() => {
      root.classList.remove('theme-transition')
    }, 400)
  }, [setTheme])

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
    applyThemeToDOM(DEFAULT_SETTINGS)
    setTheme('dark')
  }, [setTheme])

  if (!mounted) return null

  const isDark = resolvedTheme === 'dark'

  return (
    <div className="space-y-5 p-1">
      {/* Theme Mode Toggle */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sun className="w-3.5 h-3.5 text-[var(--app-text-muted)]" />
          <span className="text-eyebrow text-[var(--app-text-muted)]">Theme Mode</span>
        </div>
        <div className="flex items-center gap-1.5">
          {THEME_MODES.map((mode) => {
            const isActive = theme === mode.value
            const Icon = mode.icon
            return (
              <button
                key={mode.value}
                className={`flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg border transition-all duration-200 ${
                  isActive
                    ? 'border-[color:var(--app-accent-border)] bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]'
                    : `border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:border-[color:var(--app-border-strong)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]`
                }`}
                onClick={() => handleThemeChange(mode.value)}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="text-xs font-mono">{mode.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="theme-mode-check"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  >
                    <Check className="w-2.5 h-2.5 text-[var(--app-accent-text)]" />
                  </motion.div>
                )}
              </button>
            )
          })}
        </div>
        {theme === 'system' && (
          <p className="text-xs text-[var(--app-text-dim)] mt-1.5 ml-1">
            System preference: {resolvedTheme === 'dark' ? 'Dark' : 'Light'} mode detected
          </p>
        )}
      </div>

      <Separator className="bg-[var(--app-surface-hover)]" />

      {/* Accent Color */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Palette className="w-3.5 h-3.5 text-[var(--app-text-muted)]" />
          <span className="text-eyebrow text-[var(--app-text-muted)]">Accent Color</span>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {ACCENT_COLORS.map(accent => (
            <button
              key={accent.name}
              className={`relative flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all duration-200 ${
                settings.accentHue === accent.hue
                  ? `border-[color:var(--app-accent-border)] bg-[var(--app-accent-bg)]`
                  : `border-[color:var(--app-border)] hover:border-[color:var(--app-border-strong)] hover:bg-[var(--app-surface-hover)]`
              }`}
              onClick={() => updateSettings({ accentHue: accent.hue })}
            >
              <div className={`w-5 h-5 rounded-full ${accent.color} ${
                settings.accentHue === accent.hue ? 'ring-2 ring-offset-1 ring-offset-[var(--app-bg)] ' + accent.ring : ''
              }`} />
              <span className="text-[8px] font-mono text-[var(--app-text-dim)]">{accent.name}</span>
              {settings.accentHue === accent.hue && (
                <motion.div
                  layoutId="accent-check"
                  className="absolute -top-0.5 -right-0.5"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                >
                  <Check className="w-2.5 h-2.5 text-[var(--app-text-secondary)]" />
                </motion.div>
              )}
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-[var(--app-surface-hover)]" />

      {/* Font Size */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Type className="w-3.5 h-3.5 text-[var(--app-text-muted)]" />
          <span className="text-eyebrow text-[var(--app-text-muted)]">Font Size</span>
        </div>
        <div className="flex items-center gap-2">
          {FONT_SIZES.map(fs => (
            <button
              key={fs.value}
              className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200 ${
                settings.fontSize === fs.value
                  ? `border-[color:var(--app-accent-border)] bg-[var(--app-accent-bg)]`
                  : `border-[color:var(--app-border)] hover:border-[color:var(--app-border-strong)] hover:bg-[var(--app-surface-hover)]`
              }`}
              onClick={() => updateSettings({ fontSize: fs.value })}
            >
              <span className={`font-mono ${settings.fontSize === fs.value ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-muted)]'}`}
                style={{ fontSize: fs.value }}>
                Aa
              </span>
              <span className="text-[8px] font-mono text-[var(--app-text-dim)]">{fs.name}</span>
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-[var(--app-surface-hover)]" />

      {/* UI Density */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <LayoutGrid className="w-3.5 h-3.5 text-[var(--app-text-muted)]" />
          <span className="text-eyebrow text-[var(--app-text-muted)]">UI Density</span>
        </div>
        <div className="flex items-center gap-2">
          {UI_DENSITIES.map(d => (
            <button
              key={d.value}
              className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200 ${
                settings.density === d.value
                  ? `border-[color:var(--app-accent-border)] bg-[var(--app-accent-bg)]`
                  : `border-[color:var(--app-border)] hover:border-[color:var(--app-border-strong)] hover:bg-[var(--app-surface-hover)]`
              }`}
              onClick={() => updateSettings({ density: d.value })}
            >
              <div className={`flex flex-col ${settings.density === d.value ? 'text-[var(--app-text-secondary)]' : 'text-[var(--app-text-dim)]'}`}
                style={{ gap: d.gap }}>
                <div className="w-4 h-1 rounded bg-current/30" />
                <div className="w-4 h-1 rounded bg-current/30" />
                <div className="w-4 h-1 rounded bg-current/30" />
              </div>
              <span className="text-[8px] font-mono text-[var(--app-text-dim)]">{d.name}</span>
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-[var(--app-surface-hover)]" />

      {/* Animations Toggle */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-[var(--app-text-muted)]" />
            <span className="text-eyebrow text-[var(--app-text-muted)]">Animations</span>
          </div>
          <button
            className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
              settings.animationsEnabled ? 'bg-[var(--app-success)]' : 'bg-[var(--app-border)]'
            }`}
            onClick={() => updateSettings({ animationsEnabled: !settings.animationsEnabled })}
          >
            <motion.div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
              animate={{ left: settings.animationsEnabled ? '18px' : '2px' }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--app-text-dim)] mt-1 ml-5">
          {settings.animationsEnabled ? 'Animations enabled' : 'Reduced motion (respects prefers-reduced-motion)'}
        </p>
      </div>

      <Separator className="bg-[var(--app-surface-hover)]" />

      {/* Reset to Defaults */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full h-7 text-[13px] gap-1.5 text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] border border-[color:var(--app-border)]"
        onClick={resetToDefaults}
      >
        <RotateCcw className="w-3.5 h-3.5" />Reset to Defaults
      </Button>
    </div>
  )
}
