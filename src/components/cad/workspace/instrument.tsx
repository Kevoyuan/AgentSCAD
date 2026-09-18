'use client'

/*
 * Instrument primitives (DESIGN.md section 14).
 *
 * Steppers, verdicts, output rows and revision cells repeat across the floating
 * modules, so they are documented primitives here instead of being re-invented
 * per module. Everything resolves through shell tokens so both themes work.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { getPrecision, clampAndAlign } from '@/components/cad/parameter-panel'

/* ── Stepper  [ −  163.4  + ] ─────────────────────────────────────────────── */

export function Stepper({
  value,
  min,
  max,
  step,
  kind,
  disabled,
  changed,
  label,
  onDraft,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step: number
  kind?: string
  disabled?: boolean
  changed?: boolean
  /** accessible name; the visible label lives in the row outside the control */
  label: string
  /** a preview change, not yet built */
  onDraft?: (value: number) => void
  /** the same change, persisted */
  onCommit?: (value: number) => void
}) {
  const precision = getPrecision(step, min, kind)
  const [draft, setDraft] = React.useState(() => value.toFixed(precision))
  const [focused, setFocused] = React.useState(false)

  // One writer per element: the input follows `draft` while the user types and
  // resyncs from the prop only when it is not being edited.
  React.useEffect(() => {
    if (!focused) setDraft(value.toFixed(precision))
  }, [value, precision, focused])

  const emit = (next: number, commit: boolean) => {
    setDraft(next.toFixed(precision))
    if (commit) onCommit?.(next)
    else onDraft?.(next)
  }

  const nudge = (direction: number) => {
    if (disabled) return
    const next = clampAndAlign(value + direction * step, min, max, step, kind, precision)
    emit(next, false)
  }

  const commitTyped = () => {
    if (disabled) return
    const parsed = Number.parseFloat(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(precision))
      return
    }
    emit(clampAndAlign(parsed, min, max, step, kind, precision), true)
  }

  return (
    <span
      className={cn(
        'grid items-center h-[22px] rounded-[4px] border overflow-hidden transition-colors',
        'grid-cols-[15px_68px_15px]',
        changed
          ? 'border-[var(--shell-signal)]'
          : 'border-[color:var(--shell-border)] focus-within:border-[var(--shell-signal)]',
        disabled && 'opacity-40'
      )}
      style={{ background: 'var(--shell-well)' }}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={`${label} 减小`}
        onClick={() => nudge(-1)}
        className="h-full border-0 bg-transparent font-mono text-[11px] leading-none text-[var(--shell-text-dim)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:cursor-not-allowed"
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={e => {
          setDraft(e.target.value)
          const parsed = Number.parseFloat(e.target.value)
          if (Number.isFinite(parsed)) onDraft?.(clampAndAlign(parsed, min, max, step, kind, precision))
        }}
        onBlur={() => {
          setFocused(false)
          commitTyped()
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitTyped()
          } else if (e.key === 'Escape') {
            setDraft(value.toFixed(precision))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={cn(
          'w-full h-full bg-transparent border-x border-[color:var(--shell-border)] text-right px-[5px]',
          'font-mono text-[11px] tabular-nums outline-none',
          changed ? 'text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text)]'
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={`${label} 增大`}
        onClick={() => nudge(1)}
        className="h-full border-0 bg-transparent font-mono text-[11px] leading-none text-[var(--shell-text-dim)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:cursor-not-allowed"
      >
        ＋
      </button>
    </span>
  )
}

/* ── Verdict  ■ 通过 ──────────────────────────────────────────────────────── */

export type VerdictTone = 'pass' | 'warn' | 'fail' | 'mute'

const VERDICT_TONE: Record<VerdictTone, { className: string; filled: boolean }> = {
  pass: { className: 'text-[var(--shell-ok)]', filled: true },
  warn: { className: 'text-[var(--shell-warn)]', filled: true },
  fail: { className: 'text-[var(--shell-fail)]', filled: true },
  // A check that could not run is not an alarm: hollow square, dim text.
  mute: { className: 'text-[var(--shell-text-dim)]', filled: false },
}

export function Verdict({
  label,
  word,
  tone,
  title,
}: {
  label: string
  word: string
  tone: VerdictTone
  title?: string
}) {
  const t = VERDICT_TONE[tone]
  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center h-[30px] border-b border-[color:var(--shell-hairline)] last:border-b-0"
      title={title}
    >
      <span className="text-[11.5px] text-[var(--shell-text-muted)] truncate pr-2">{label}</span>
      <span className={cn('flex items-center gap-[6px] font-mono text-[9.5px] tracking-[0.08em]', t.className)}>
        <i
          className={cn('w-2 h-2 rounded-[1px] not-italic', !t.filled && 'border border-current')}
          style={t.filled ? { background: 'currentColor' } : undefined}
          aria-hidden="true"
        />
        {word}
      </span>
    </div>
  )
}

/* ── Output row  导出 STL     2.1 MB ─────────────────────────────────────── */

export function OutputRow({
  label,
  meta,
  disabled,
  onClick,
  secondary,
}: {
  label: string
  meta?: string
  disabled?: boolean
  onClick?: () => void
  secondary?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-stretch gap-1 mt-[6px]">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'flex flex-1 items-center justify-between gap-[10px] h-[30px] px-[10px] rounded-[4px] border',
          'text-[11px] text-[var(--shell-text)] transition-colors',
          disabled
            ? 'opacity-35 cursor-not-allowed border-[color:var(--shell-border)]'
            : 'border-[color:var(--shell-border)] hover:border-[var(--shell-border-strong)] hover:bg-[var(--shell-hover)]'
        )}
        style={{ background: 'var(--shell-well)' }}
      >
        <span>{label}</span>
        {meta && <span className="font-mono text-[10px] text-[var(--shell-text-dim)]">{meta}</span>}
      </button>
      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          className="h-[30px] px-[10px] rounded-[4px] border border-[color:var(--shell-border)] font-mono text-[10px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:border-[var(--shell-border-strong)] transition-colors"
          style={{ background: 'var(--shell-well)' }}
        >
          {secondary.label}
        </button>
      )}
    </div>
  )
}

/* ── Revision cell  REV 3 · 已构建  ■■■ ─────────────────────────────────── */

export function RevCell({
  dots,
  text,
  state,
  dim,
}: {
  dots: number
  text: string
  state: 'built' | 'stale' | 'none'
  dim?: boolean
}) {
  return (
    <div
      className={cn(
        'flex-1 rounded-[3px] border px-[7px] py-[6px] transition-opacity',
        state === 'stale'
          ? 'border-[color:var(--shell-signal)]/60'
          : 'border-[color:var(--shell-border)]',
        dim && 'opacity-40'
      )}
      style={{ background: 'var(--shell-well)' }}
    >
      <div className="flex gap-[3px] mb-[5px]" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <i
            key={i}
            className={cn(
              'w-[9px] h-[9px] rounded-[1px] not-italic',
              // A built revision fills its dots; a pending one shows all three
              // hollow and waiting, which is the flip-dot pair's whole point.
              state === 'built' && i < dots && 'bg-[var(--shell-ok)]',
              state === 'built' && i >= dots && 'bg-[var(--shell-raise)]',
              state === 'stale' && 'border border-[var(--shell-signal)] animate-pulse',
              state === 'none' && 'bg-[var(--shell-raise)]'
            )}
          />
        ))}
      </div>
      <div
        className={cn(
          'font-mono text-[9px] tracking-[0.07em]',
          state === 'stale' ? 'text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text-label)]'
        )}
      >
        {text}
      </div>
    </div>
  )
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
