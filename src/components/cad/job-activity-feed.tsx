'use client'

import { useI18n } from '@/components/i18n-provider'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Play, CheckCircle2, XCircle, Ban, Activity, AlertTriangle, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { JOB_STATE_UI } from './types'

// ─── Activity Event Types ────────────────────────────────────────────────

export type ActivityEventType = 'created' | 'processed' | 'review' | 'delivered' | 'failed'

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  jobName: string
  jobId: string
  action: string
  timestamp: Date
}

// ─── Activity Icon & Colour Mapping ─────────────────────────────────────
/*
 * Semantic shell tokens only, and only where a semantic state exists
 * (DESIGN.md section 11). The old map reached for amber/lime/rose Tailwind steps
 * outside the palette; this one resolves to the same tokens the rail uses.
 */
const EVENT_CONFIG: Record<ActivityEventType, { icon: typeof Plus; color: string }> = {
  created: { icon: Plus, color: 'text-[var(--shell-text-label)]' },
  processed: { icon: Play, color: 'text-[var(--shell-warn)]' },
  review: { icon: AlertTriangle, color: 'text-[var(--shell-warn)]' },
  delivered: { icon: CheckCircle2, color: 'text-[var(--shell-ok)]' },
  failed: { icon: XCircle, color: 'text-[var(--shell-fail)]' },
}

/*
 * Rename the raw activity verbs that used to leak pipeline vocabulary ("SCAD
 * Generated", "Processing Failed") into the same words the rows and the palette
 * use. Unknown actions pass through unchanged - they are user-facing sentences
 * already, not enum values.
 */
const ACTION_LABEL_KEYS: Record<string, string> = {
  'Created and started': 'Created',
  'SCAD Generated': JOB_STATE_UI.SCAD_GENERATED.labelKey,
  Delivered: JOB_STATE_UI.DELIVERED.labelKey,
  'Processing Failed': JOB_STATE_UI.GEOMETRY_FAILED.labelKey,
  Cancelled: JOB_STATE_UI.CANCELLED.labelKey,
  'Visual repair rendered': JOB_STATE_UI.RENDERED.labelKey,
}

// ─── Time ago helper ──────────────────────────────────────────────────────

function relativeTimeFromDate(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── Filter Labels ──────────────────────────────────────────────────────

const FILTER_OPTIONS: { key: ActivityEventType | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'created', label: 'Created' },
  { key: 'processed', label: 'Processed' },
  { key: 'review', label: 'Review' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
]

// ─── Props ──────────────────────────────────────────────────────────────

interface JobActivityFeedProps {
  events: ActivityEvent[]
  onClear: () => void
  onEventClick?: (event: ActivityEvent) => void
  showHeader?: boolean
}

// ─── Job Activity Feed ──────────────────────────────────────────────────
/*
 * Rendered inside the notifications drawer. It used to print the raw truncated
 * job id (`cmv0ju1`) under every event at 8px, which is both an id leak and
 * unreadable (DESIGN.md sections 2, 12). An event is now: what happened to which
 * part, and how long ago - no internal ids, all text ≥10px.
 */

export function JobActivityFeed({
  events,
  onClear,
  onEventClick,
  showHeader = true,
}: JobActivityFeedProps) {
  const { t } = useI18n()

  const [filter, setFilter] = useState<ActivityEventType | 'ALL'>('ALL')
  const scrollRef = useRef<HTMLDivElement>(null)

  const filteredEvents = filter === 'ALL'
    ? events
    : events.filter(e => e.type === filter)

  // Auto-scroll to latest event
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [filteredEvents.length])

  return (
    <div className="flex h-full flex-col">
      {showHeader && (
        <div className="flex items-center justify-between border-b border-[color:var(--shell-hairline)] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-3.5 w-3.5 shrink-0 text-[var(--shell-text-label)]" />
            <span className="truncate text-[13px] font-medium text-[var(--shell-text)]">{t("Activity Feed")}</span>
            <span className="shrink-0 rounded-[3px] border border-[color:var(--shell-border)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--shell-text-label)]">
              {filteredEvents.length}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {events.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[10px] text-[var(--shell-text-label)] hover:text-[var(--shell-text)]"
                onClick={onClear}
                aria-label={t("Clear")}
                title={t("Clear")}
              >
                <Trash2 className="h-2.5 w-2.5" />{t("Clear")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filter pills: one quiet row, wrapped labels, no hidden horizontal scroll. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[color:var(--shell-hairline)] px-3 py-1.5">
        {FILTER_OPTIONS.map(opt => {
          const active = filter === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              className={[
                'h-6 shrink-0 rounded-[3px] border px-1.5 font-mono text-[10px] transition-colors',
                active
                  ? 'border-[color:var(--shell-border-strong)] bg-[var(--shell-hover)] text-[var(--shell-text)]'
                  : 'border-transparent text-[var(--shell-text-label)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]',
              ].join(' ')}
              onClick={() => setFilter(opt.key)}
            >
              {t(opt.label)}
            </button>
          )
        })}
      </div>

      {/* Events list */}
      <ScrollArea className="max-h-70 flex-1" ref={scrollRef}>
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
            <div className="grid h-9 w-9 place-items-center rounded-[6px] border border-[color:var(--shell-border)]">
              <Activity className="h-4 w-4 text-[var(--shell-text-label)]" />
            </div>
            <p className="text-[12px] text-[var(--shell-text-muted)]">
              {filter === 'ALL' ? t("No activity yet") : t("No {0} events", { 0: t(FILTER_OPTIONS.find(o => o.key === filter)?.label ?? '') })}
            </p>
            <p className="text-[11px] text-[var(--shell-text-label)]">
              {t("Activity appears here as parts are built.")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--shell-hairline)]">
            <AnimatePresence>
              {filteredEvents.map(event => {
                const config = EVENT_CONFIG[event.type]
                const Icon = config.icon
                const actionKey = ACTION_LABEL_KEYS[event.action] ?? event.action
                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="activity-item flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-[var(--shell-hover)]"
                    onClick={() => onEventClick?.(event)}
                  >
                    <div className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center">
                      <Icon className={`h-3 w-3 ${config.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate text-[13px] leading-[1.35] text-[var(--shell-text-muted)]"
                          title={event.jobName}
                        >
                          {event.jobName}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-[11px] leading-[1.4] text-[var(--shell-text-label)]">
                          {t(actionKey)}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-[10px] text-[var(--shell-text-dim)]">·</span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--shell-text-label)]">
                          {relativeTimeFromDate(event.timestamp)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
