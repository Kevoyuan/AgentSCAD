'use client'

import { useI18n } from '@/components/i18n-provider'

import { CSSProperties, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, CheckSquare, Square, Box } from 'lucide-react'
import {
  Job,
  PROCESSING_JOB_STATES,
  getJobDimensions,
  getJobStateUi,
  getStateToneColor,
  relativeTime,
  getPipelineProgress,
  STATE_TONE_CLASS,
  STATE_TONE_DOT_CLASS,
  STATE_TONE_RING_CLASS,
} from './types'
import { PartFamilyIcon } from './part-family-icon'

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

// Kept as a named export for existing consumers; the implementation is shared.
export const extractKeyDimensions = getJobDimensions

// ─── Thumbnail ──────────────────────────────────────────────────────────────
/*
 * The rail used to show the raw OpenSCAD preview: a saturated cyan model on a
 * white square, squeezed into 24-34px. At that size it read as coloured noise and
 * it was the only cyan left in the product (DESIGN.md sections 11, 24).
 *
 * The preview is still the most recognisable thumbnail we have, so it stays - but
 * it is neutralised and framed:
 *  - object-contain, never object-cover: the part is never cropped to a blob;
 *  - an inner well behind it, so the white preview background is not a glowing
 *    card in the dark rail;
 *  - grayscale + blend: in dark mode the preview is inverted and lightened onto
 *    the well (the white paper disappears), in light mode multiplied onto it;
 *  - a semantic 1px state ring, so state is legible before the row text is read.
 * When there is no render yet, the engraved family icon does the same job.
 */
const KNOWN_FAMILIES = new Set([
  'spur_gear', 'device_stand', 'phone_case', 'electronics_enclosure', 'bracket', 'bolt',
])

function JobThumbnail({ job }: { job: Job }) {
  const { t } = useI18n()
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const { tone, labelKey } = getJobStateUi(job.state)
  const hasGeometry = Boolean(job.pngPath) && !['NEW', 'SCAD_GENERATED', 'CANCELLED'].includes(job.state)
  const previewFailed = Boolean(job.pngPath) && failedPath === job.pngPath
  const family = job.partFamily?.toLowerCase() ?? ''
  const showFamilyIcon = !hasGeometry || previewFailed

  return (
    <div
      aria-hidden="true"
      className={[
        'relative mt-[1px] h-10 w-10 shrink-0 overflow-hidden rounded-[4px] bg-[var(--shell-inner)]',
        'ring-1 ring-inset',
        STATE_TONE_RING_CLASS[tone],
      ].join(' ')}
      title={t(labelKey)}
    >
      {showFamilyIcon && KNOWN_FAMILIES.has(family) ? (
        <span className="grid h-full w-full place-items-center">
          <PartFamilyIcon family={job.partFamily} size={22} animate={false} />
        </span>
      ) : showFamilyIcon ? (
        <span className="grid h-full w-full place-items-center text-[var(--shell-text-label)]">
          <Box className="h-4 w-4" strokeWidth={1.5} />
        </span>
      ) : (
        <img
          src={job.pngPath as string}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailedPath(job.pngPath)}
          className={[
            'h-full w-full select-none object-contain',
            /* neutral, never a cyan blob: grayscale + lighten on the dark well,
               grayscale + multiply on the light well */
            '[filter:grayscale(1)_contrast(1.06)] [mix-blend-mode:multiply]',
            'dark:[filter:grayscale(1)_invert(1)_brightness(1.2)_contrast(0.95)] dark:[mix-blend-mode:lighten]',
          ].join(' ')}
        />
      )}
      {/* The mid-rail thumbnail is a preview, not a button; the row owns the action. */}
      <span className="sr-only">{t(labelKey)}</span>
    </div>
  )
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

  const { labelKey, tone } = getJobStateUi(job.state)
  const stateLabel = t(labelKey)
  const isProcessing = (PROCESSING_JOB_STATES as readonly string[]).includes(job.state)
  const progressPercent = getPipelineProgress(job.state)
  const toneHex = getStateToneColor(job.state)
  const created = relativeTime(job.createdAt)

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="design-row"
      data-state-tone={tone}
      /*
       * DESIGN.md section 21: every operation is reachable from the keyboard, and no
       * focus may land on something invisible. A row is the only way to open a part,
       * so it is a real tab stop with Enter/Space activation, and the utilities that
       * live on hover also appear on focus-within.
       */
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      aria-label={`${job.inputRequest}, ${stateLabel}`}
      className={[
        'group/row relative cursor-pointer border-b border-[color:var(--shell-hairline)] py-[7px] pl-2 pr-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:ring-inset',
        isSelected
          ? 'bg-[color-mix(in_srgb,var(--shell-signal)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--shell-signal)_16%,transparent)]'
          : 'hover:bg-[var(--shell-hover)]',
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
      {/* Active mark: a 2px signal bar on the left edge. Together with the tinted
          row and the signal index this is unmistakable at a glance; it is also the
          only saturated element in the rail, so the selected part cannot be missed. */}
      {isSelected && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[var(--shell-signal)]"
        />
      )}

      {/* Row utilities live on hover/focus only and never sit on the thumbnail
          (the thumbnail now leads the row). One compact bordered cluster (28px
          targets, title + aria-label on both) appears over the end of the title's
          first line, so it reads as an action bar rather than two stray glyphs
          (DESIGN.md sections 6, 14, 21). The state word and age stay uncovered. */}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] p-0.5 opacity-0 shadow-[var(--shell-shadow)] transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("Drag to reorder")}
          title={t("Drag to reorder")}
          className="grid h-7 w-7 cursor-grab place-items-center rounded-[3px] text-[var(--shell-text-dim)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(job.id) }}
          aria-label={isChecked ? t("Deselect") : t("Select part")}
          title={isChecked ? t("Deselect") : t("Select part")}
          className={[
            'grid h-7 w-7 place-items-center rounded-[3px] transition-colors hover:bg-[var(--shell-hover)]',
            isChecked ? 'text-[var(--shell-signal)]' : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)]',
          ].join(' ')}
        >
          {isChecked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={[
            'w-4 shrink-0 pt-[2px] font-mono text-[10px] tabular-nums',
            isSelected ? 'font-semibold text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text-dim)]',
          ].join(' ')}
        >
          {String(index ?? 0).padStart(2, '0')}
        </span>

        <JobThumbnail job={job} />

        <div className="min-w-0 flex-1">
          {/* 12.5px / 600 with a real 2-line clamp and an ellipsis, plus a native
              title tooltip for the rare brief that still overflows. */}
          <p
            title={job.inputRequest}
            className={[
              'line-clamp-2 text-[13px] font-semibold leading-[1.35] transition-colors',
              isSelected
                ? 'text-[var(--shell-text)]'
                : 'text-[var(--shell-text-muted)] group-hover/row:text-[var(--shell-text)]',
            ].join(' ')}
          >
            {job.inputRequest}
          </p>

          {/* Meta: the unified state word (never the enum), then relative time.
              The state word is a sentence the user reads to know what to do
              next - "Needs your decision" - so it is 11px, not 10px: the 10px
              floor in DESIGN.md section 12 is for engraved chrome labels, and a
              state word is not chrome. The relative time is chrome and could
              drop, but the two share a row and a baseline, so they share a
              size. Both use the label tone of the shell text ladder, so they
              clear 4.6:1 in both themes (sections 12, 21). */}
          <div className="mt-[3px] flex min-w-0 items-center gap-2 font-mono text-[11px] leading-[1.4]">
            <span className={`inline-flex min-w-0 items-center gap-1 ${STATE_TONE_CLASS[tone]}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_TONE_DOT_CLASS[tone]}`} />
              <span className="truncate">{stateLabel}</span>
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-[var(--shell-text-muted)]">{created}</span>
          </div>

          {(isProcessing) && (
            <div
              className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-[var(--shell-hairline)]"
              role="progressbar"
              aria-label={stateLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(4, Math.min(100, progressPercent))}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(4, Math.min(100, progressPercent))}%`,
                  background: toneHex,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Drag Overlay Card (rendered while dragging) ────────────────────────────

export function DragOverlayCard({ job }: { job: Job }) {
  const { t } = useI18n()
  const { labelKey, tone } = getJobStateUi(job.state)
  const dimensions = getJobDimensions(job)

  return (
    <div className="flex items-start gap-2.5 rounded-[9px] border border-[color:var(--shell-signal)]/40 bg-[var(--shell-module-solid)] px-3 py-2.5 shadow-[0_22px_46px_-12px_rgba(0,0,0,0.7)]">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-semibold leading-[1.35] text-[var(--shell-text)]">
          {job.inputRequest}
        </p>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] leading-[1.4]">
          <span className={`inline-flex items-center gap-1 ${STATE_TONE_CLASS[tone]}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATE_TONE_DOT_CLASS[tone]}`} />
            {t(labelKey)}
          </span>
          {dimensions && <span className="truncate text-[var(--shell-text-label)]">{dimensions}</span>}
        </div>
      </div>
      <JobThumbnail job={job} />
    </div>
  )
}
