'use client'

import { useI18n } from '@/components/i18n-provider'

import { CSSProperties, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { Job, CANCELABLE_STATES, timeAgo, getPipelineProgress, getStateHex } from './types'
import { StateBadge } from './state-badge'
import { PartFamilyIcon } from './part-family-icon'
import { TagBadges } from './tag-badges'
import { Button } from '@/components/ui/button'
import {
  Play, Ban, Repeat, Trash2, CheckSquare, Square, RefreshCw,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SortableJobCardProps {
  job: Job
  /* DESIGN.md section 6 row anatomy: 01 / 02 / 03 as the row's leading mark. */
  index?: number
  isSelected: boolean
  isChecked: boolean
  isDragging?: boolean
  onSelect: (job: Job) => void
  onToggleSelect: (id: string) => void
  onProcess: (job: Job) => void
  onCancel: (job: Job) => void
  onDuplicate: (job: Job) => void
  onDelete: (id: string) => void
}

/**
 * Row state text. DESIGN.md section 6 keeps a row to number / name / one state
 * line, and the vocabulary table prefers 可导出 over DELIVERED, 待确认 over
 * HUMAN_REVIEW, and so on. Colour is a secondary signal; the word is primary.
 */
const STATE_TEXT: Record<string, string> = {
  NEW: "Awaiting generation",
  SCAD_GENERATED: "Awaiting render",
  RENDERED: "Rendered",
  VALIDATED: "Validation passed",
  DELIVERED: "Ready to export",
  DEBUGGING: "Repairing",
  REPAIRING: "Repairing",
  VALIDATION_FAILED: "Validation failed",
  GEOMETRY_FAILED: "Geometry failed",
  RENDER_FAILED: "Render failed",
  HUMAN_REVIEW: "Needs confirmation",
  CANCELLED: "Canceled",
  DELETING: "Deleting",
}
const PASS_STATES = ['DELIVERED', 'VALIDATED', 'RENDERED']
const WARN_STATES = ['HUMAN_REVIEW', 'DEBUGGING', 'REPAIRING', 'SCAD_GENERATED']

// Processing states that should show the pulse ring animation
const PROCESSING_STATES = ['SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']

// Failed states that should show retry action
const FAILED_STATES = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED']

// ─── Sortable Job Card ──────────────────────────────────────────────────────

// ─── Helper: Extract key dimensions for metrology row ───────────────────────

export function extractKeyDimensions(job: Job): string | null {
  if (job.validationReportJson) {
    try {
      const report = JSON.parse(job.validationReportJson)
      if (Array.isArray(report.checks)) {
        for (const chk of report.checks) {
          if (chk.rule_id === 'B001' && chk.details) {
            const actual = chk.details.actual_bbox as { length?: number; width?: number; height?: number } | undefined
            if (actual && typeof actual.length === 'number' && typeof actual.width === 'number' && typeof actual.height === 'number') {
              return `${Math.round(actual.length)} × ${Math.round(actual.width)} × ${Math.round(actual.height)} mm`
            }
          }
        }
      }
    } catch {
      // Ignore JSON error
    }
  }

  if (job.parameterValues) {
    try {
      const vals = JSON.parse(job.parameterValues)
      const l = vals.length ?? vals.l ?? vals.box_length ?? vals.outer_length ?? vals.base_length
      const w = vals.width ?? vals.w ?? vals.box_width ?? vals.outer_width ?? vals.base_width
      const h = vals.height ?? vals.h ?? vals.box_height ?? vals.outer_height ?? vals.base_height ?? vals.thickness
      if (typeof l === 'number' && typeof w === 'number' && typeof h === 'number') {
        return `${Math.round(l)} × ${Math.round(w)} × ${Math.round(h)} mm`
      }
    } catch {
      // Ignore JSON error
    }
  }

  return null
}

// ─── Sortable Job Card ──────────────────────────────────────────────────────

export function SortableJobCard({
  job,
  index,
  isSelected,
  isChecked,
  isDragging = false,
  onSelect,
  onToggleSelect,
  onProcess,
  onCancel,
  onDuplicate,
  onDelete,
}: SortableJobCardProps) {
  const { t } = useI18n()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: job.id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  }

  const isCancelable = CANCELABLE_STATES.includes(job.state)
  const isProcessing = PROCESSING_STATES.includes(job.state)
  const progressPercent = getPipelineProgress(job.state)
  const [failedPreviewPath, setFailedPreviewPath] = useState<string | null>(null)
  const previewFailed = Boolean(job.pngPath && failedPreviewPath === job.pngPath)
  const keyDimensions = extractKeyDimensions(job)

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="design-row"
      /*
       * DESIGN.md section 21: every operation is reachable from the keyboard, and no
       * focus may land on something invisible. A row is the only way to open a part,
       * so it is a real tab stop with Enter/Space activation, and the utilities that
       * live on hover also appear on focus-within.
       */
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      aria-label={`${job.inputRequest}, ${t(STATE_TEXT[job.state] ?? job.state)}`}
      className={[
        'group/row relative cursor-pointer border-b border-[color:var(--shell-hairline)] pl-2 pr-2.5 py-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:ring-inset',
        isSelected ? 'bg-[var(--shell-signal)]/[0.09]' : 'hover:bg-[var(--shell-hover)]',
        (isDragging || isSortableDragging) && 'z-50 bg-[var(--shell-inner)]',
      ].filter(Boolean).join(' ')}
      onClick={() => onSelect(job)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        // Space would otherwise scroll the rail while also selecting.
        e.preventDefault()
        onSelect(job)
      }}
    >
      {/* active mark: a 2px signal bar, the only saturated element in the rail */}
      {isSelected && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[var(--shell-signal)]" />
      )}

      {/* Row utilities live on hover and take no permanent space. No action
          cluster: DESIGN.md section 6 forbids persistent icon groups per row. */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("Drag to reorder")}
          className="h-5 w-4 grid place-items-center rounded-[3px] cursor-grab text-[var(--shell-text-dim)] hover:text-[var(--shell-text-muted)] active:cursor-grabbing"
        >
          <GripVertical className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(job.id) }}
          aria-label={isChecked ? t("Deselect") : t("Select part")}
          className={[
            'h-5 w-5 grid place-items-center rounded-[3px] transition-colors',
            isChecked ? 'text-[var(--shell-signal)]' : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text-muted)]',
          ].join(' ')}
        >
          {isChecked ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
      </div>

      <div className="flex items-start gap-2.5">
        <span
          className={[
            'w-4 shrink-0 pt-[3px] font-mono text-[10px] tabular-nums',
            isSelected ? 'text-[var(--shell-signal)]' : 'text-[var(--shell-text-dim)]',
          ].join(' ')}
        >
          {String(index ?? 0).padStart(2, '0')}
        </span>

        <div className="min-w-0 flex-1 pr-8">
          <p
            className={[
              'line-clamp-2 text-[12px] font-semibold leading-[1.3] transition-colors',
              isSelected ? 'text-[var(--shell-text)]' : 'text-[var(--shell-text-muted)] group-hover/row:text-[var(--shell-text)]',
            ].join(' ')}
          >
            {job.inputRequest}
          </p>

          <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] leading-none">
            <span
              className={FAILED_STATES.includes(job.state)
                ? 'text-[var(--shell-fail)]'
                : PASS_STATES.includes(job.state)
                ? 'text-[var(--shell-ok)]'
                : WARN_STATES.includes(job.state)
                ? 'text-[var(--shell-warn)]'
                : 'text-[var(--shell-text-dim)]'}
            >
              {t(STATE_TEXT[job.state] ?? job.state)}
            </span>
            {keyDimensions && <span className="truncate text-[var(--shell-text-dim)]">{keyDimensions}</span>}
            <span className="ml-auto shrink-0 tabular-nums text-[var(--shell-text-dim)]">
              {timeAgo(job.createdAt)}
            </span>
          </div>

          {(isProcessing || FAILED_STATES.includes(job.state)) && (
            <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-[var(--shell-hairline)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(4, Math.min(100, progressPercent))}%`,
                  background: FAILED_STATES.includes(job.state) ? 'var(--shell-fail)' : 'var(--shell-signal)',
                }}
              />
            </div>
          )}
        </div>

        {/* a small preview, only once geometry exists */}
        {job.pngPath && job.state !== 'NEW' && job.state !== 'SCAD_GENERATED' && (
          <div className="mt-0.5 h-[34px] w-[34px] shrink-0 overflow-hidden rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-well)]">
            {previewFailed ? (
              <div className="grid h-full w-full place-items-center text-[var(--shell-raise)]">·</div>
            ) : (
              <img
                src={job.pngPath}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                onError={() => setFailedPreviewPath(job.pngPath)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Drag Overlay Card (rendered while dragging) ────────────────────────────

export function DragOverlayCard({ job }: { job: Job }) {
  const { t } = useI18n()

  const keyDimensions = extractKeyDimensions(job)
  return (
    <div className="rounded-[9px] border border-[var(--shell-signal)]/40 bg-[var(--shell-module-solid)] px-3 py-2.5 shadow-[0_22px_46px_-12px_rgba(0,0,0,0.7)]">
      <p className="line-clamp-2 text-[12px] font-semibold leading-[1.3] text-[var(--shell-text)]">
        {job.inputRequest}
      </p>
      <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] text-[var(--shell-text-dim)]">
        <span>{t(STATE_TEXT[job.state] ?? job.state)}
</span>
        {keyDimensions && <span>{keyDimensions}</span>}
      </div>
    </div>
  )
}
