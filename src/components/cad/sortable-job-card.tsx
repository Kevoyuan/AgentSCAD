'use client'

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
      className={`group/card relative cursor-pointer overflow-hidden border-b border-[var(--app-border-subtle)] px-2.5 py-2 transition-all ${
        isDragging || isSortableDragging
          ? 'shadow-lg ring-1 ring-[var(--app-accent-border)] scale-[1.01] z-50 bg-[var(--app-surface-raised)]'
          : ''
      } ${
        isProcessing ? 'opacity-95' : ''
      } ${
        isSelected
          ? 'bg-[var(--app-selected-bg)] border-l-2 border-l-[var(--app-accent)]'
          : 'bg-transparent hover:bg-[var(--app-surface-hover)] border-l-2 border-l-transparent'
      }`}
      onClick={() => onSelect(job)}
    >
      {/* Drag Handle */}
      <div
        className="absolute right-1 top-1.5 z-10 flex min-h-[22px] min-w-[22px] cursor-grab items-center justify-center rounded p-1 text-[var(--app-text-dim)] opacity-0 transition-opacity hover:text-[var(--app-text-secondary)] active:cursor-grabbing group-hover/card:opacity-100"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3 h-3" />
      </div>

      {/* Select checkbox */}
      <div className="absolute left-1.5 top-2.5 z-10" onClick={e => e.stopPropagation()}>
        <button
          className={`flex h-4 w-4 items-center justify-center rounded transition-all ${
            isChecked
              ? 'bg-[var(--app-accent)] text-white'
              : 'text-[var(--app-text-dim)] opacity-0 hover:bg-[var(--app-surface-hover)] group-hover/card:opacity-100'
          }`}
          onClick={() => onToggleSelect(job.id)}
          aria-label={isChecked ? 'Deselect design' : 'Select design'}
        >
          {isChecked ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
      </div>

      <div className="relative z-[1] pl-5 pr-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Design brief / title */}
            <p className="line-clamp-2 text-xs font-medium leading-snug text-[var(--app-text-secondary)] group-hover/card:text-[var(--app-text-primary)] transition-colors">
              {job.inputRequest}
            </p>

            {/* Metrology dimensions overlay */}
            {keyDimensions && (
              <div className="mt-0.5 text-[11px] font-mono text-[var(--cad-measure)] tracking-tight">
                {keyDimensions}
              </div>
            )}

            {/* Status & time ago */}
            <div className="mt-1 flex min-w-0 items-center gap-1.5 flex-wrap">
              <StateBadge state={job.state} size="xs" />
              <span className="text-[10px] font-mono tabular-nums text-[var(--app-text-muted)]">
                {timeAgo(job.createdAt)}
              </span>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
          </div>
        </div>

        {/* Selected compact thumbnail */}
        {isSelected && job.pngPath && job.state !== 'NEW' && job.state !== 'SCAD_GENERATED' && (
          <div className="mt-2 h-14 overflow-hidden rounded-[5px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] shadow-inner">
            {previewFailed ? (
              <div className="flex h-full w-full items-center justify-center gap-2 text-[10px] text-[var(--app-text-dim)]">
                <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
                <span>Preview unavailable</span>
              </div>
            ) : (
              <img
                src={job.pngPath}
                alt="Design preview"
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setFailedPreviewPath(job.pngPath)}
              />
            )}
          </div>
        )}

        {/* Progress bar when running or failed */}
        {(isProcessing || FAILED_STATES.includes(job.state)) && (
          <div className="pipeline-mini-progress mt-1.5">
            <div
              className="pipeline-mini-progress-fill"
              style={{
                width: `${job.state === 'DELIVERED' ? 100 : progressPercent}%`,
                backgroundColor: FAILED_STATES.includes(job.state) ? 'var(--app-danger)' : 'var(--app-accent)'
              }}
            />
          </div>
        )}

        {/* Contextual Action Dock on Hover */}
        <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" onClick={e => e.stopPropagation()}>
          {job.state === 'NEW' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-[var(--app-accent-text)] hover:bg-[var(--app-accent-bg)] rounded"
              onClick={() => onProcess(job)}
              title="Generate"
            >
              <Play className="w-3 h-3" />
              <span>Generate</span>
            </Button>
          )}
          {FAILED_STATES.includes(job.state) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-[var(--app-accent-text)] hover:bg-[var(--app-accent-bg)] rounded"
              onClick={() => onProcess(job)}
              title="Rebuild"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Rebuild</span>
            </Button>
          )}
          {isCancelable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-[var(--app-warning)] hover:bg-[var(--app-warning-bg)] rounded"
              onClick={() => onCancel(job)}
              title="Cancel"
            >
              <Ban className="w-3 h-3" />
              <span>Cancel</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-[var(--app-text-dim)] hover:text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] rounded"
            onClick={() => onDuplicate(job)}
            title="Duplicate"
          >
            <Repeat className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-[var(--app-text-dim)] hover:text-[var(--app-danger)] hover:bg-[var(--app-danger-bg)] rounded"
            onClick={() => onDelete(job.id)}
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Drag Overlay Card (rendered while dragging) ────────────────────────────

export function DragOverlayCard({ job }: { job: Job }) {
  const keyDimensions = extractKeyDimensions(job)
  return (
    <div
      className="rounded-md border border-[var(--app-accent-border)] bg-[var(--app-surface)] p-2.5 shadow-xl ring-2 ring-[var(--app-accent-border)]/40 scale-[1.02]"
    >
      <div className="pl-4 pr-5">
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-xs text-[var(--app-text-secondary)] leading-tight line-clamp-2 flex-1">{job.inputRequest}</p>
          <div className="flex items-center gap-1 shrink-0">
            <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
          </div>
        </div>
        {keyDimensions && (
          <div className="mt-0.5 text-[11px] font-mono text-[var(--cad-measure)]">
            {keyDimensions}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1.5">
          <StateBadge state={job.state} size="xs" />
          <span className="text-[10px] text-[var(--app-text-dim)] font-mono">{timeAgo(job.createdAt)}</span>
        </div>
      </div>
    </div>
  )
}
