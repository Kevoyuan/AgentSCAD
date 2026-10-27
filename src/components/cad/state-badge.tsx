'use client'

import { useI18n } from '@/components/i18n-provider'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getJobStateUi,
  STATE_TONE_CLASS,
  STATE_TONE_DOT_CLASS,
} from './types'

/*
 * The one status chip. It reads the unified vocabulary from `types.tsx`, so a
 * badge can never say "ARTIFACTS READY" while the rail says "Ready to export"
 * (DESIGN.md sections 2, 6, 11). Colour is a secondary signal: the state word is
 * always present, and the dot/ring is semantic. Sizes are floored at 10px - the
 * old `xs` rendered 8px status text, which was unreadable and failed the
 * text-ladder contrast rule (DESIGN.md sections 12, 21).
 */

const SIZE_CLASS = {
  xs: 'gap-1 text-[10px] px-1 py-0 leading-[16px]',
  sm: 'gap-1.5 text-[11px] px-1.5 py-0.5 leading-[16px]',
  md: 'gap-1.5 text-[12px] px-2 py-1 leading-[16px]',
} as const

const DOT_SIZE_CLASS = {
  xs: 'h-1 w-1',
  sm: 'h-1.5 w-1.5',
  md: 'h-1.5 w-1.5',
} as const

export function StateBadge({
  state,
  size = 'sm',
  timestamp,
}: {
  state: string
  size?: 'xs' | 'sm' | 'md'
  timestamp?: string
}) {
  const { t, locale } = useI18n()
  const { labelKey, tone } = getJobStateUi(state)
  const label = t(labelKey)

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts)
      return d.toLocaleString(locale, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch {
      return ts
    }
  }

  const tooltipContent = (
    <div className="text-[11px] leading-snug">
      <div className="font-medium">{label}</div>
      {timestamp && (
        <div className="mt-0.5 font-mono text-[10px] opacity-80">{formatTimestamp(timestamp)}</div>
      )}
    </div>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-[3px] font-medium ${SIZE_CLASS[size]} ${STATE_TONE_CLASS[tone]}`}
        >
          <span
            aria-hidden="true"
            className={`shrink-0 rounded-full ${DOT_SIZE_CLASS[size]} ${STATE_TONE_DOT_CLASS[tone]}`}
          />
          <span>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  )
}
