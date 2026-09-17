'use client'

import { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Trash2, Ban, RotateCcw, Download, Eye,
  Share2, FileText, Wrench, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Job, CANCELABLE_STATES } from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuickAction {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  onClick: () => void
  variant?: 'default' | 'danger' | 'success' | 'warning'
  disabled?: boolean
}

interface QuickActionsBarProps {
  job: Job | null
  onProcess: (job: Job) => void
  onCancel: (job: Job) => void
  onDelete: (id: string) => void
  onReprocess: (job: Job) => void
  onDownloadScad: (job: Job) => void
  onDownloadStl?: (job: Job) => void
  isDownloadingStl?: boolean
  onView3D: () => void
  onViewLog: (job: Job) => void
  onShare: (job: Job) => void
  onRepair: (job: Job) => void
  isProcessing: boolean
}

// ─── Get Actions by State ───────────────────────────────────────────────────

function getActionsForState(
  job: Job,
  props: QuickActionsBarProps
): QuickAction[] {
  const isFailed = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(job.state)
  const isCancelable = CANCELABLE_STATES.includes(job.state)

  switch (job.state) {
    case 'NEW':
      return [
        {
          id: 'process',
          label: 'Process',
          icon: <Play className="w-3.5 h-3.5" />,
          shortcut: 'Space',
          onClick: () => props.onProcess(job),
          variant: 'success',
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          shortcut: 'Del',
          onClick: () => props.onDelete(job.id),
          variant: 'danger',
        },
      ]

    case 'SCAD_GENERATED':
    case 'RENDERED':
    case 'VALIDATED':
    case 'DEBUGGING':
    case 'REPAIRING':
      return [
        {
          id: 'cancel',
          label: 'Cancel',
          icon: <Ban className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onCancel(job),
          variant: 'warning',
        },
      ]

    case 'HUMAN_REVIEW':
      return [
        {
          id: 'reprocess',
          label: 'Reprocess',
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onReprocess(job),
          variant: 'success',
        },
        ...(props.onDownloadStl && job.stlPath
          ? [
              {
                id: 'download-stl',
                label: props.isDownloadingStl ? 'Downloading STL...' : 'Download STL',
                icon: props.isDownloadingStl ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                ),
                shortcut: '',
                onClick: () => props.onDownloadStl?.(job),
                variant: 'success' as const,
                disabled: props.isDownloadingStl,
              },
            ]
          : []),
        {
          id: 'download-scad',
          label: 'Download SCAD',
          icon: <Download className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onDownloadScad(job),
        },
        {
          id: 'view-log',
          label: 'View Log',
          icon: <FileText className="w-3.5 h-3.5" />,
          shortcut: '5',
          onClick: () => props.onViewLog(job),
        },
      ]

    case 'DELIVERED':
      return [
        {
          id: 'reprocess',
          label: 'Reprocess',
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onReprocess(job),
        },
        ...(props.onDownloadStl
          ? [
              {
                id: 'download-stl',
                label: props.isDownloadingStl ? 'Downloading STL...' : 'Download STL',
                icon: props.isDownloadingStl ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                ),
                shortcut: '',
                onClick: () => props.onDownloadStl?.(job),
                variant: 'success' as const,
                disabled: !job.stlPath || props.isDownloadingStl,
              },
            ]
          : []),
        {
          id: 'download-scad',
          label: 'Download SCAD',
          icon: <Download className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onDownloadScad(job),
        },
        {
          id: 'view-3d',
          label: 'View 3D',
          icon: <Eye className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onView3D(),
        },
        {
          id: 'share',
          label: 'Share',
          icon: <Share2 className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onShare(job),
        },
      ]

    case 'CANCELLED':
      return [
        {
          id: 'reprocess',
          label: 'Reprocess',
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          shortcut: '',
          onClick: () => props.onReprocess(job),
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          shortcut: 'Del',
          onClick: () => props.onDelete(job.id),
          variant: 'danger',
        },
      ]

    default:
      // FAILED states
      if (isFailed) {
        return [
          {
            id: 'auto-repair',
            label: 'Auto Repair',
            icon: <Wrench className="w-3.5 h-3.5" />,
            shortcut: '',
            onClick: () => props.onRepair(job),
            variant: 'success',
          },
          {
            id: 'reprocess',
            label: 'Reprocess',
            icon: <RotateCcw className="w-3.5 h-3.5" />,
            shortcut: '',
            onClick: () => props.onReprocess(job),
          },
          {
            id: 'view-log',
            label: 'View Log',
            icon: <FileText className="w-3.5 h-3.5" />,
            shortcut: '5',
            onClick: () => props.onViewLog(job),
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            shortcut: 'Del',
            onClick: () => props.onDelete(job.id),
            variant: 'danger',
          },
        ]
      }
      return []
  }
}

// ─── Variant Colors ─────────────────────────────────────────────────────────

const VARIANT_CLASSES: Record<string, { button: string; hover: string }> = {
  default: {
    button: 'text-[var(--app-text-muted)]',
    hover: 'hover:text-[var(--app-text-primary)] hover:bg-[var(--app-hover-subtle)]',
  },
  success: {
    button: 'text-emerald-400',
    hover: 'hover:text-emerald-300 hover:bg-emerald-500/10',
  },
  danger: {
    button: 'text-rose-400',
    hover: 'hover:text-rose-300 hover:bg-rose-500/10',
  },
  warning: {
    button: 'text-orange-400',
    hover: 'hover:text-orange-300 hover:bg-orange-500/10',
  },
}

// ─── Quick Actions Bar Component ────────────────────────────────────────────

export function QuickActionsBar(props: QuickActionsBarProps) {
  const { job } = props

  if (!job) return null

  const actions = getActionsForState(job, props)

  if (actions.length === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[color:var(--app-border)] bg-[var(--app-surface-50)]">
          {actions.map((action, idx) => {
            const variant = action.variant || 'default'
            const classes = VARIANT_CLASSES[variant]

            return (
              <TooltipProvider key={action.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 px-2 text-xs gap-1.5 ${classes.button} ${classes.hover} transition-colors`}
                      onClick={action.onClick}
                      disabled={(action.id === 'process' && props.isProcessing) || Boolean(action.disabled)}
                    >
                      {action.icon}
                      <span className="hidden sm:inline">{action.label}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span>{action.label}</span>
                    {action.shortcut && (
                      <span className="ml-2 text-[var(--app-text-muted)] font-mono text-xs">[{action.shortcut}]</span>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
