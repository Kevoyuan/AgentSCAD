'use client'

import { ReactNode } from 'react'
import {
  Play, RotateCcw, Copy, Ban, Trash2, Link2, Clipboard, ExternalLink,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from '@/components/ui/context-menu'
import { Job, CANCELABLE_STATES } from './types'
import { copyText } from '@/lib/clipboard'

// ─── Types ────────────────────────────────────────────────────────────────

interface JobContextMenuProps {
  job: Job
  children: ReactNode
  onProcess: (job: Job) => void
  onDuplicate: (job: Job) => void
  onCancel: (job: Job) => void
  onDelete: (id: string) => void
  onLinkParent: (job: Job) => void
}

// ─── Component ────────────────────────────────────────────────────────────

export function JobContextMenu({
  job,
  children,
  onProcess,
  onDuplicate,
  onCancel,
  onDelete,
  onLinkParent,
}: JobContextMenuProps) {
  const isCancelable = CANCELABLE_STATES.includes(job.state)
  const canProcess = job.state === 'NEW' || job.state === 'DELIVERED'
  const isProcessing = ['SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING', 'HUMAN_REVIEW'].includes(job.state)

  const handleCopyId = () => {
    void copyText(job.id)
  }

  const handleOpenInNewTab = () => {
    const url = `${window.location.origin}/?job=${job.id}`
    void copyText(url)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52 linear-surface linear-border linear-shadow-md">
        {/* Process / Reprocess */}
        {canProcess && (
          <ContextMenuItem
            className="text-sm gap-2 text-[var(--shell-ok)] focus:text-[var(--shell-ok)] focus:bg-transparent"
            onClick={() => onProcess(job)}
          >
            {job.state === 'DELIVERED' ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {job.state === 'DELIVERED' ? 'Reprocess' : 'Process'}
            <ContextMenuShortcut className="text-xs text-[var(--app-text-dim)]">⌘P</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        {/* Duplicate */}
        <ContextMenuItem
          className="text-sm gap-2 text-[var(--app-text-secondary)] focus:text-[var(--app-text-primary)] focus:bg-[var(--app-hover-subtle)]"
          onClick={() => onDuplicate(job)}
        >
          <Copy className="w-3.5 h-3.5" />
          Duplicate
          <ContextMenuShortcut className="text-xs text-[var(--app-text-dim)]">⌘D</ContextMenuShortcut>
        </ContextMenuItem>

        {/* Cancel (for active states) */}
        {isCancelable && (
          <ContextMenuItem
            className="text-sm gap-2 text-[var(--shell-warn)] focus:text-[var(--shell-warn)] focus:bg-transparent"
            onClick={() => onCancel(job)}
          >
            <Ban className="w-3.5 h-3.5" />
            Cancel
          </ContextMenuItem>
        )}

        <ContextMenuSeparator className="bg-[var(--app-surface-hover)]" />

        <ContextMenuItem
          className="text-sm gap-2 text-[var(--app-text-secondary)] focus:text-[var(--app-text-primary)] focus:bg-[var(--app-hover-subtle)]"
          onClick={() => onLinkParent(job)}
        >
          <Link2 className="w-3.5 h-3.5" />
          Link to Parent
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[var(--app-surface-hover)]" />

        {/* Copy Job ID */}
        <ContextMenuItem
          className="text-sm gap-2 text-[var(--app-text-muted)] focus:text-[var(--app-text-secondary)] focus:bg-[var(--app-hover-subtle)]"
          onClick={handleCopyId}
        >
          <Clipboard className="w-3.5 h-3.5" />
          Copy Job ID
          <ContextMenuShortcut className="text-xs text-[var(--app-text-dim)]">⌘C</ContextMenuShortcut>
        </ContextMenuItem>

        {/* Open in New Tab (copies URL) */}
        <ContextMenuItem
          className="text-sm gap-2 text-[var(--app-text-muted)] focus:text-[var(--app-text-secondary)] focus:bg-[var(--app-hover-subtle)]"
          onClick={handleOpenInNewTab}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Copy URL
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[var(--app-surface-hover)]" />

        {/* Delete - destructive */}
        <ContextMenuItem
          variant="destructive"
          className="text-sm gap-2 text-[var(--shell-fail)] focus:text-[var(--shell-fail)] focus:bg-transparent"
          onClick={() => onDelete(job.id)}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
          <ContextMenuShortcut className="text-xs text-[var(--shell-fail)]">Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
