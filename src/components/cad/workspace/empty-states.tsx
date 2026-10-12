'use client'

import { useI18n } from '@/components/i18n-provider'

import React from 'react'
import { Plus, RotateCcw, AlertCircle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { GeneratingPart } from './GeneratingPart'

/*
 * Empty states, per DESIGN.md:
 *   section 6  - modules state what will appear, in one line, in dim text
 *   section 9  - first run answers four things without a tutorial
 *   section 19 - never explain the application's own architecture to the user
 *
 * The previous versions rendered a marketing landing page inside a panel
 * ("WORKSPACE INITIALIZED", "INSPECTOR ARCHITECTURE", six capability cards,
 * four template chips). DESIGN.md section 18 and the 2026-09-17 findings call
 * that out explicitly, so these are deliberately quiet now.
 */

// ============================================================================
// 1. JobListEmptyState - the slots rail
// ============================================================================

export interface JobListEmptyStateProps {
  isFirstLoadComplete: boolean
  totalJobsCount: number
  hasActiveFilters: boolean
  onResetFilters: () => void
  onShowComposer: (presetText?: string) => void
}

export function JobListEmptyState({
  isFirstLoadComplete,
  hasActiveFilters,
  onResetFilters,
  onShowComposer,
}: JobListEmptyStateProps) {
  const { t } = useI18n()

  if (!isFirstLoadComplete) {
    return (
      <div className="p-2 space-y-2 min-w-0" data-testid="job-list-loading-skeleton">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-2.5 rounded-[6px] border border-[color:var(--shell-hairline)] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-24 rounded-[4px]" />
              <Skeleton className="h-4 w-14 rounded-[4px]" />
            </div>
            <Skeleton className="h-3 w-3/4 rounded-[3px]" />
          </div>
        ))}
      </div>
    )
  }

  // Filter mismatch is a dead end, so it gets the one action that resolves it.
  if (hasActiveFilters) {
    return (
      <div className="p-4 space-y-3" data-testid="job-list-filter-empty">
        <div className="flex items-center gap-2 text-[var(--shell-text-label)]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono text-[11px]">{t("No parts match your filters")}</span>
        </div>
        <button
          type="button"
          onClick={onResetFilters}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border border-[color:var(--shell-border)] font-mono text-[11px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:border-[color:var(--shell-border-strong)] transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {t("Clear filters")}
        </button>
      </div>
    )
  }

  // Cold start: one line plus the action. No preset grid - the composer owns creation.
  return (
    <div className="p-4 space-y-3" data-testid="job-list-cold-start">
      <p className="text-[11.5px] leading-[1.6] text-[var(--shell-text-dim)]">
        {t("No parts yet.")}<br />
        {t("Start with a description below.")}
      </p>
      <button
        type="button"
        onClick={() => onShowComposer()}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border border-[color:var(--shell-border)] font-mono text-[11px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:border-[color:var(--shell-border-strong)] transition-colors"
      >
        <Plus className="w-3 h-3" />
        {t("New part")}<span className="text-[var(--shell-text-dim)]">⌘ N</span>
      </button>
    </div>
  )
}

// ============================================================================
// 2. CadViewportEmptyState - the canvas itself
// ============================================================================

export interface CadViewportEmptyStateProps {
  selectedJob?: import('@/components/cad/types').Job | null
  isProcessing?: boolean
  isFirstLoadComplete?: boolean
  /**
   * A clarification is pending, so 要你定一下 already carries the action. Showing a
   * second lit button here would be the "five competing entry points" defect the
   * 2026-09-17 audit found.
   */
  awaitingDecision?: boolean
  onProcess?: (job: import('@/components/cad/types').Job) => void
  onShowComposer?: (presetText?: string) => void
  onSetActiveTab?: (tab: string) => void
}

const FIRST_RUN_EXAMPLES = [
  "Camera bracket for a 35 mm DIN rail, M4 screw holes",
  "90 × 60 × 25 mm electronics enclosure, 2.5 mm walls",
  "Module 2 spur gear with 12 teeth",
] as const

export function CadViewportEmptyState({
  selectedJob,
  isProcessing = false,
  isFirstLoadComplete = true,
  awaitingDecision = false,
  onProcess,
  onShowComposer,
}: CadViewportEmptyStateProps) {
  const { t } = useI18n()

  if (!isFirstLoadComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 h-full w-full min-w-0 overflow-hidden select-none">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-56 w-full rounded-[8px]" />
        </div>
      </div>
    )
  }

  // A design exists but has no geometry yet. One sentence, one action — or, while
  // a run is in flight, no action at all: the composer's button is the stop control
  // and the lamps report progress (DESIGN.md sections 3 and 5).
  if (selectedJob) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center h-full w-full min-w-0 select-none"
        data-testid="viewport-pending-geometry"
      >
        {awaitingDecision ? (
          <>
            <p className="text-[13px] text-[var(--shell-text-muted)]">{t("This description needs an interpretation.")}</p>
            <p className="mt-1.5 font-mono text-[10.5px] text-[var(--shell-text-dim)]">
              {t("Choose an interpretation in the panel on the right")}
            </p>
          </>
        ) : isProcessing ? (
          <>
            {/* The bench is not empty while the machine works: a small part turns
                over in the middle of the canvas. It states nothing - the lamps above
                are the progress display (DESIGN.md section 17) - and it is replaced
                by the real part the moment geometry lands. */}
            <GeneratingPart className="mb-4" />
            <p className="text-[13px] text-[var(--shell-text-muted)]">{t("Generating geometry…")}</p>
            <p className="mt-1.5 font-mono text-[10.5px] text-[var(--shell-text-dim)]">
              {t("Progress appears in the four indicators above. Use the button beside the input to stop.")}
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--shell-text-muted)] mb-3">{t("This part has no geometry yet.")}</p>
            <button
              type="button"
              onClick={() => onProcess?.(selectedJob)}
              className="h-8 px-3.5 rounded-[6px] bg-[var(--shell-signal)] text-[#1A0F08] font-mono text-[12px] font-bold tracking-[0.06em] hover:bg-[#FF6E36] transition-colors"
            >
              {t("Generate geometry")}
            </button>
          </>
        )}
      </div>
    )
  }

  // First run. DESIGN.md section 9: answer the four questions, nothing else.
  // No giant centred CTA here - the composer already owns the primary action,
  // and two competing create buttons was finding #1 of the 2026-09-17 audit.
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center h-full w-full min-w-0 select-none"
      data-testid="viewport-cold-start"
    >
      <div className="w-full max-w-[620px] px-6 text-center">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--shell-text)]">
          {t("Describe the part you need.")}
        </h2>
        <p className="mt-2 font-mono text-[10.5px] leading-[1.8] text-[var(--shell-text-dim)]">
          {t("This description will be the source for your part. After generation, its dimensions and check results")}<br />
          {t("will appear in the side modules. Edit the dimensions and press Generate to rebuild.")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {FIRST_RUN_EXAMPLES.map((example) => (
            <button
              key={t(example)}
              type="button"
              onClick={() => onShowComposer?.(t(example))}
              className="rounded-full border border-[color:var(--shell-border)] bg-black/[0.3] px-3 py-1 font-mono text-[10px] text-[var(--shell-text-label)] hover:border-[var(--shell-signal)]/50 hover:text-[var(--shell-signal-soft)] transition-colors"
            >
              {t(example)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 3. InspectorEmptyState - dimensions / checks rail
// ============================================================================

export interface InspectorEmptyStateProps {
  isFirstLoadComplete: boolean
  onShowComposer?: () => void
  onOpenSettings?: (tab: 'providers' | 'theme') => void
  onOpenShortcuts?: () => void
}

export function InspectorEmptyState({
  isFirstLoadComplete,
}: InspectorEmptyStateProps) {
  const { t } = useI18n()

  if (!isFirstLoadComplete) {
    return (
      <div className="p-4 space-y-3 h-full min-w-0 select-none" data-testid="inspector-loading-skeleton">
        <Skeleton className="h-20 w-full rounded-[6px]" />
        <Skeleton className="h-28 w-full rounded-[6px]" />
      </div>
    )
  }

  // One line. The old version explained the application's own architecture
  // ("INSPECTOR ARCHITECTURE" plus six READY capability cards) to a user who
  // has not made anything yet.
  return (
    <div className="p-4 select-none" data-testid="inspector-empty">
      <p className="text-[11.5px] leading-[1.6] text-[var(--shell-text-dim)]">
        {t("No part selected.")}<br />
        {t("After generation, its dimensions, checks and outputs will appear here.")}
      </p>
    </div>
  )
}
