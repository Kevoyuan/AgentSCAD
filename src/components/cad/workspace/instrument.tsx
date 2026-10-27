'use client'

import { useI18n } from '@/components/i18n-provider'

/*
 * Instrument primitives (DESIGN.md section 14).
 *
 * Steppers, verdicts, output rows and revision cells repeat across the floating
 * modules, so they are documented primitives here instead of being re-invented
 * per module. Everything resolves through shell tokens so both themes work.
 *
 * Shared shells for the four right-column modules also live here: the engraved
 * section heading, the one-button recovery action, the quiet empty line and the
 * metrology formatter. Duplicating those per module is how the 4/6/9 radius
 * scale and the 10px text floor drifted the first time.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { getPrecision, clampAndAlign } from '@/components/cad/parameter-panel'

/* ── Stepper  [ −  163.4  + ] ─────────────────────────────────────────────── */

/*
 * 28px hit targets (DESIGN.md section 21: ≥28px on desktop), a mono value that
 * reads as a measurement rather than a form field, and two visible affordances
 * at rest: the bordered value well says "type here" and the − / ＋ keys say
 * "step me". The old 15px hover-only halves were below the pointer floor.
 */
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
  const { t } = useI18n()

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
    // Step from what is on screen, so typing 163.5 then pressing ＋ gives 164.5.
    const base = Number.parseFloat(draft)
    const origin = Number.isFinite(base) ? base : value
    emit(clampAndAlign(origin + direction * step, min, max, step, kind, precision), false)
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

  const nudgeTitle = (direction: -1 | 1) =>
    direction < 0
      ? t("Decrease {0} by {1}", { 0: label, 1: step })
      : t("Increase {0} by {1}", { 0: label, 1: step })

  // Coarse pointers (DESIGN.md section 20): the visible stepper keeps its instrument
  // size on desktop, but touch gets physical 44px controls so adjacent targets
  // never steal taps from the value field.
  return (
    <span
      className={cn(
        'grid items-stretch h-[30px] w-[104px] shrink-0 rounded-[4px] border overflow-hidden transition-colors',
        'grid-cols-[28px_minmax(0,1fr)_28px]',
        '[@media(pointer:coarse)]:h-[46px] [@media(pointer:coarse)]:w-[146px]',
        '[@media(pointer:coarse)]:grid-cols-[44px_minmax(0,1fr)_44px]',
        changed
          ? 'border-[var(--shell-signal)]'
          : 'border-[color:var(--shell-border)] focus-within:border-[var(--shell-signal)]',
        disabled && 'opacity-50'
      )}
      style={{
        background: changed
          ? 'color-mix(in srgb, var(--shell-signal) 9%, var(--shell-inner))'
          : 'var(--shell-inner)',
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={t("Decrease {0}", { 0: label })}
        title={nudgeTitle(-1)}
        onClick={() => nudge(-1)}
        className={cn(
          'relative h-full border-0 bg-transparent font-mono text-[12px] leading-none text-[var(--shell-text-muted)]',
          'hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] active:bg-[var(--shell-well)] disabled:cursor-not-allowed',
        )}
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        title={t("Type a value, or use ↑ / ↓ to step")}
        disabled={disabled}
        value={draft}
        onFocus={e => {
          setFocused(true)
          e.currentTarget.select()
        }}
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
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            nudge(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            nudge(-1)
          } else if (e.key === 'Escape') {
            setDraft(value.toFixed(precision))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={cn(
          'w-full min-w-0 h-full bg-transparent border-x border-[color:var(--shell-border)] text-right px-[5px]',
          'font-mono text-[12px] tabular-nums outline-none cursor-text',
          changed ? 'text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text)]'
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={t("Increase {0}", { 0: label })}
        title={nudgeTitle(1)}
        onClick={() => nudge(1)}
        className={cn(
          'relative h-full border-0 bg-transparent font-mono text-[12px] leading-none text-[var(--shell-text-muted)]',
          'hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] active:bg-[var(--shell-well)] disabled:cursor-not-allowed',
        )}
      >
        ＋
      </button>
    </span>
  )
}

/* ── Section heading  ─────────────────────────────────────────────────────── */

/*
 * The engraved 10px mono label that separates conclusions from outputs from
 * revisions inside a module. `action` is a quiet end-aligned control (History),
 * never a second primary.
 */
export function SectionHeading({
  children,
  meta,
  action,
  className,
}: {
  children: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 pt-[10px] pb-[3px]', className)}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
        {children}
      </span>
      {action ??
        (meta ? (
          <span className="font-mono text-[10px] tracking-[0.05em] text-[var(--shell-text-label)]">{meta}</span>
        ) : null)}
    </div>
  )
}

/* ── Quiet, readable empty / explanatory line ─────────────────────────────── */

export function EmptyNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('py-[6px] text-[12px] leading-[1.45] text-[var(--shell-text-label)]', className)}>
      {children}
    </p>
  )
}

/* ── Pending rows  ▁▁▁  ─────────────────────────────────────────────────────── */

/*
 * A region whose data is on its way, drawn as the SHAPE of the thing that is
 * coming.
 *
 * The rule this exists to enforce: while the record is still loading, the
 * module shows bars, not a sentence. A sentence is a claim, and the claims the
 * shell used to make during that window ("No dimensions yet. Generate this part
 * to see them here.", "No check results yet. Generate a part to see them here.")
 * were all false — the part exists, its details are simply in flight — and false
 * in the most expensive direction, because they sent the user to repeat work
 * they had already done.
 *
 * The sr-only line is the same fact for assistive technology: DESIGN.md section
 * 17 asks a loading region to say it is loading in markup as well as in shape,
 * and `aria-busy` carries the flag to anyone who cannot see the bars.
 */
export function PendingRows({
  rows = 3,
  label,
  className,
}: {
  rows?: number
  /** the accessible name for the busy region */
  label: string
  className?: string
}) {
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-[7px]', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-[30px] animate-pulse rounded-[4px] bg-[var(--shell-well)]"
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
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
  const toneStyle = VERDICT_TONE[tone]
  const [expanded, setExpanded] = React.useState(false)
  const detail = title?.trim()
  const expandable = Boolean(detail) && detail!.length > 0

  return (
    <div
      className="border-b border-[color:var(--shell-hairline)] last:border-b-0"
      title={expandable && !expanded ? detail : undefined}
    >
      <div
        className={cn(
          'grid grid-cols-[1fr_auto] items-center gap-3 min-h-[30px] py-[4px] [@media(pointer:coarse)]:min-h-11',
          expandable && 'cursor-help'
        )}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={expandable ? () => setExpanded(v => !v) : undefined}
        onKeyDown={
          expandable
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setExpanded(v => !v)
                }
              }
            : undefined
        }
      >
        <span
          className={cn(
            'text-[12px] leading-[1.25] truncate',
            tone === 'fail' ? 'text-[var(--shell-text)]' : 'text-[var(--shell-text-muted)]'
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'flex items-center gap-[6px] font-mono text-[11px] tracking-[0.06em] whitespace-nowrap',
            toneStyle.className
          )}
        >
          <i
            className={cn('w-[9px] h-[9px] rounded-[3px] not-italic', !toneStyle.filled && 'border border-current')}
            style={toneStyle.filled ? { background: 'currentColor' } : undefined}
            aria-hidden="true"
          />
          {word}
        </span>
      </div>
      {/* The deterministic message is evidence, not decoration: when it exists it is
          printed, so "Fail" is never an unexplained word. Rows without a message stay
          one line. */}
      {expandable && expanded && (
        <p className="pb-[6px] pr-[2px] text-[11px] leading-[1.45] text-[var(--shell-text-label)]">{detail}</p>
      )}
    </div>
  )
}

/* ── Output row  导出 STL     2.1 MB ─────────────────────────────────────── */

export function OutputRow({
  label,
  meta,
  disabled,
  onClick,
  title,
}: {
  label: string
  meta?: string
  disabled?: boolean
  onClick?: () => void
  title?: string
}) {
  const { t } = useI18n()
  const resolvedTitle = title ?? (disabled ? t("Not available until the part is built") : label)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={resolvedTitle}
      aria-label={meta ? `${label} — ${meta}` : label}
      className={cn(
        'flex w-full items-center justify-between gap-3 h-[32px] px-[10px] rounded-[4px] border whitespace-nowrap',
        'text-[12px] transition-colors',
        disabled
          ? 'opacity-45 cursor-not-allowed border-[color:var(--shell-border)] text-[var(--shell-text-muted)]'
          : 'border-[color:var(--shell-border)] text-[var(--shell-text)] hover:border-[var(--shell-border-strong)] hover:bg-[var(--shell-hover)]'
      )}
      style={{ background: 'var(--shell-well)' }}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          'shrink-0 font-mono text-[11px] tabular-nums',
          disabled ? 'text-[var(--shell-text-muted)]' : 'text-[var(--shell-text-label)]'
        )}
      >
        {meta ?? '—'}
      </span>
    </button>
  )
}

/* ── Footer action  STL 40 KB │ SCAD 75 ln │ History ─────────────────────── */

/*
 * The Checks plate pins its outputs to the bottom edge as one compact row, so the
 * plate can never cut an output button in half at the fold. Three equal actions,
 * label + telemetry on one line, never wrapped. Full sentence lives in `title`.
 */
export function FooterAction({
  label,
  meta,
  onClick,
  disabled,
  title,
}: {
  label: string
  meta?: string
  onClick?: () => void
  disabled?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={meta ? `${title} — ${meta}` : title}
      className={cn(
        'flex h-[28px] min-w-0 items-center justify-center gap-[3px] whitespace-nowrap rounded-[4px] border px-[4px]',
        '[@media(pointer:coarse)]:h-11',
        'transition-colors',
        disabled
          ? 'cursor-not-allowed border-[color:var(--shell-border)] opacity-45'
          : 'border-[color:var(--shell-border)] hover:border-[var(--shell-border-strong)] hover:bg-[var(--shell-hover)]'
      )}
      style={{ background: 'var(--shell-well)' }}
    >
      <span className="text-[10px] text-[var(--shell-text-muted)]">{label}</span>
      {meta && (
        <span className="truncate font-mono text-[10px] tabular-nums text-[var(--shell-text-label)]">{meta}</span>
      )}
    </button>
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
  const filled = Math.max(0, Math.min(3, dots))
  return (
    <div
      className={cn(
        'flex-1 min-w-0 rounded-[4px] border px-[8px] py-[7px] transition-colors',
        state === 'stale'
          ? 'border-[color:var(--shell-signal)]'
          : 'border-[color:var(--shell-border)]',
        dim && 'opacity-60'
      )}
      style={{ background: 'var(--shell-well)' }}
    >
      <div className="flex gap-[3px] mb-[5px]" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <i
            key={i}
            className={cn(
              'w-[10px] h-[10px] rounded-[3px] not-italic',
              // A built revision fills its dots; a pending one shows its dots hollow
              // and waiting, which is the flip-dot pair's whole point.
              state === 'built' && (i < filled ? 'bg-[var(--shell-ok)]' : 'bg-[var(--shell-raise)]'),
              state === 'stale' && 'border border-[var(--shell-signal)] animate-pulse motion-reduce:animate-none',
              state === 'none' && 'border border-[color:var(--shell-border-strong)]'
            )}
          />
        ))}
      </div>
      <div
        className={cn(
          'font-mono text-[10px] leading-[1.35] tracking-[0.05em]',
          state === 'stale' ? 'text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text-label)]'
        )}
      >
        {text}
      </div>
    </div>
  )
}

/* ── Recovery action ─────────────────────────────────────────────────────── */

/*
 * DESIGN.md section 10: a blocked check offers repair as a real action, not a dim
 * word. The primary variant is the accent's *soft* form (signal text, 50% border,
 * 10% well), because the composer's circular action stays the only solid lit
 * control in the workspace (section 5). It still reads as the one thing to press.
 */
export function ActionButton({
  children,
  title,
  onClick,
  variant = 'secondary',
  disabled,
  icon,
  className,
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'quiet'
  disabled?: boolean
  icon?: React.ReactNode
  className?: string
}) {
  const variants = {
    primary:
      'border-[color:color-mix(in_srgb,var(--shell-signal)_55%,transparent)] text-[var(--shell-signal-soft)] bg-[color-mix(in_srgb,var(--shell-signal)_10%,transparent)] hover:border-[var(--shell-signal)] hover:bg-[color-mix(in_srgb,var(--shell-signal)_16%,transparent)]',
    secondary:
      'border-[color:var(--shell-border)] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:border-[var(--shell-border-strong)] hover:bg-[var(--shell-hover)]',
    quiet: 'border-transparent text-[var(--shell-text-label)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)]',
  } as const

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'flex w-full items-center justify-center gap-[7px] h-[30px] px-[10px] rounded-[4px] border',
        '[@media(pointer:coarse)]:h-11',
        'text-[12px] font-medium whitespace-nowrap transition-colors',
        variants[variant],
        disabled && 'opacity-40 cursor-not-allowed',
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/* ── Measurements ────────────────────────────────────────────────────────── */

/*
 * A metrology instrument does not print 840.04 for a hand-sized part. Measured
 * values print at one decimal; declared parameters keep their own precision.
 */
export function formatMeasured(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(decimals)
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
