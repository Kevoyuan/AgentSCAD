'use client'

import { motion } from 'framer-motion'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getStateInfo } from './types'

const ACTIVE_STATES = ['NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']
const FAILED_STATES = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED']
const SHORT_LABELS: Record<string, string> = {
  NEW: 'Draft',
  SCAD_GENERATED: 'Generated',
  RENDERED: 'Rendered',
  VALIDATED: 'Validated',
  DELIVERED: 'Artifacts ready',
  VALIDATION_FAILED: 'Validation blocked',
  GEOMETRY_FAILED: 'Validation blocked',
  RENDER_FAILED: 'Validation blocked',
  HUMAN_REVIEW: 'Needs review',
  DEBUGGING: 'Repairing',
  REPAIRING: 'Repairing',
  CANCELLED: 'Cancelled',
}

export function StateBadge({ state, size = 'sm', timestamp }: { state: string; size?: 'xs' | 'sm' | 'md'; timestamp?: string }) {
  const info = getStateInfo(state)
  const label = SHORT_LABELS[state] || state.replace(/_/g, ' ')
  const isFailed = FAILED_STATES.includes(state)
  const isDelivered = state === 'DELIVERED'
  const isReview = state === 'HUMAN_REVIEW'
  const isProcessing = ACTIVE_STATES.includes(state)

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts)
      return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
    } catch {
      return ts
    }
  }

  const tooltipContent = (
    <div className="text-xs">
      <div className="font-mono font-semibold">{state}</div>
      {timestamp && (
        <div className="text-[13px] opacity-70 mt-0.5">{formatTimestamp(timestamp)}</div>
      )}
    </div>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.span
          key={state}
          className={`inline-flex items-center rounded-sm font-mono font-medium relative ${
            size === 'xs' ? 'gap-1 text-[8px] px-1 py-0.5' : 
            size === 'sm' ? 'gap-1.5 text-[10px] px-1.5 py-0.5' : 
            'gap-1.5 text-xs px-2 py-0.5'
          } ${
            isFailed ? 'text-[var(--cad-danger)]' : 
            isDelivered ? 'text-[var(--cad-success)]' : 
            isReview ? 'text-[var(--cad-warning)]' : 
            isProcessing ? 'text-[var(--cad-accent)]' : 
            'text-[var(--cad-text-muted)]'
          } bg-transparent border border-transparent transition-colors`}
          initial={{ scale: 1.05, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <span className={`relative rounded-full ${
            isFailed ? 'bg-[var(--cad-danger)]' : 
            isDelivered ? 'bg-[var(--cad-success)]' : 
            isReview ? 'bg-[var(--cad-warning)]' : 
            isProcessing ? 'bg-[var(--cad-accent)]' : 
            'bg-[var(--cad-text-muted)]'
          } ${isProcessing || isDelivered ? 'status-pulse' : ''} ${
            size === 'xs' ? 'w-1 h-1' : 'w-1.5 h-1.5'
          }`} />
          <span className="relative tracking-wider uppercase">{label}</span>
        </motion.span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  )
}
