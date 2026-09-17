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

  const stateHex = getStateHex(job.state)
  const leftBorderColor = stateHex
  const isCancelable = CANCELABLE_STATES.includes(job.state)
  const isProcessing = PROCESSING_STATES.includes(job.state)
  const progressPercent = getPipelineProgress(job.state)
  const progressColor = stateHex
  const [failedPreviewPath, setFailedPreviewPath] = useState<string | null>(null)
  const previewFailed = Boolean(job.pngPath && failedPreviewPath === job.pngPath)

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, '--border-color': leftBorderColor } as CSSProperties}
      className={`group/card relative cursor-pointer overflow-hidden border-b border-[color:var(--app-border-subtle)] px-2.5 py-2 transition-all ${
        isDragging || isSortableDragging
          ? 'shadow-xl ring-1 ring-[color:var(--app-accent-border)] scale-[1.01] z-50 bg-[var(--app-surface-raised)]'
          : ''
      } ${
        isProcessing ? 'opacity-95' : ''
      } ${
        isSelected
          ? 'bg-[var(--app-accent-bg)] border-l-2 border-l-[color:var(--app-accent)]'
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
          aria-label={isChecked ? 'Deselect job' : 'Select job'}
        >
          {isChecked ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
      </div>

      <div className="relative z-[1] pl-5 pr-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--app-text-secondary)] group-hover/card:text-[var(--app-text-primary)] transition-colors">
              {job.inputRequest}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 flex-wrap">
              <StateBadge state={job.state} />
              <span className="text-[10px] font-mono tabular-nums text-[var(--cad-text-muted)]">
                {timeAgo(job.createdAt)}
              </span>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
          </div>
        </div>

        {isSelected && job.pngPath && job.state !== 'NEW' && job.state !== 'SCAD_GENERATED' && (
          <div className="mt-2 h-16 overflow-hidden rounded-md border border-[color:var(--app-border-subtle)] bg-[var(--app-empty-bg)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]">
            {previewFailed ? (
              <div className="flex h-full w-full items-center justify-center gap-2 text-[10px] text-[var(--app-text-dim)]">
                <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
                <span>Preview unavailable</span>
              </div>
            ) : (
              <img
                src={job.pngPath}
                alt="Preview"
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setFailedPreviewPath(job.pngPath)}
              />
            )}
          </div>
        )}
        {(isProcessing || FAILED_STATES.includes(job.state)) && (
          <div className="pipeline-mini-progress mt-1.5">
            <div
              className="pipeline-mini-progress-fill"
              style={{
                width: `${job.state === 'DELIVERED' ? 100 : progressPercent}%`,
                backgroundColor: job.state === 'DELIVERED' ? 'var(--cad-text-muted)' : (job.state === 'VALIDATION_FAILED' || job.state === 'GEOMETRY_FAILED' || job.state === 'RENDER_FAILED') ? 'var(--cad-danger)' : progressColor
              }}
            />
          </div>
        )}

        {isSelected && <TagBadges customerId={job.customerId} maxDisplay={2} />}

        {/* Action Dock on Hover */}
        <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" onClick={e => e.stopPropagation()}>
          {job.state === 'NEW' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-emerald-500 hover:bg-emerald-500/10 rounded"
              onClick={() => onProcess(job)}
              title="Process"
            >
              <Play className="w-3 h-3" />
              <span>Process</span>
            </Button>
          )}
          {FAILED_STATES.includes(job.state) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-sky-400 hover:bg-sky-400/10 rounded"
              onClick={() => onProcess(job)}
              title="Retry"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </Button>
          )}
          {isCancelable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-orange-400 hover:bg-orange-400/10 rounded"
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
            className="h-5 w-5 p-0 text-[var(--app-text-dim)] hover:text-rose-500 hover:bg-rose-500/10 rounded"
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
  return (
    <div
      className="rounded-md border border-[color:var(--app-accent-border)] bg-[var(--app-surface)] p-2.5 shadow-xl ring-2 ring-[color:var(--app-accent-border)]/40 scale-[1.02]"
    >
      <div className="pl-4 pr-5">
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-[12px] text-[var(--app-text-secondary)] leading-tight line-clamp-2 flex-1">{job.inputRequest}</p>
          <div className="flex items-center gap-1 shrink-0">
            <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <StateBadge state={job.state} />
          <span className="text-[8px] text-[var(--app-text-dim)] font-mono">{timeAgo(job.createdAt)}</span>
        </div>
        <TagBadges customerId={job.customerId} maxDisplay={3} />
      </div>
    </div>
  )
}
