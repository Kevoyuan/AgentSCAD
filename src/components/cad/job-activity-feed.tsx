'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Play, CheckCircle2, XCircle, Ban, Code2,
  Settings, Clock, Filter, Trash2, X, Activity, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Job } from './types'

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

// ─── Activity Icon & Color Mapping ──────────────────────────────────────

const EVENT_CONFIG: Record<ActivityEventType, { icon: typeof Plus; color: string; bgColor: string }> = {
  created: { icon: Plus, color: 'text-[var(--app-accent-text)]', bgColor: 'bg-[var(--app-accent-bg)]' },
  processed: { icon: Play, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  review: { icon: AlertTriangle, color: 'text-yellow-300', bgColor: 'bg-yellow-500/10' },
  delivered: { icon: CheckCircle2, color: 'text-lime-400', bgColor: 'bg-lime-500/10' },
  failed: { icon: XCircle, color: 'text-rose-400', bgColor: 'bg-rose-500/10' },
}

// ─── Time ago helper ──────────────────────────────────────────────────────

function activityTimeAgo(date: Date): string {
  const now = Date.now()
  const then = date.getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
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

export function JobActivityFeed({
  events,
  onClear,
  onEventClick,
  showHeader = true,
}: JobActivityFeedProps) {
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
    <div className="flex flex-col h-full">
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--app-border)]">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[var(--app-accent-text)]" />
            <span className="text-sm font-medium text-[var(--app-text-secondary)]">Activity Feed</span>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] border border-[color:var(--app-accent-border)]">
              {filteredEvents.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {events.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[8px] gap-0.5 text-[var(--app-text-muted)] hover:text-[var(--app-text-muted)] px-1"
                onClick={onClear}
              >
                <Trash2 className="w-2.5 h-2.5" />Clear
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filter Pills */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[color:var(--app-border)] overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <Filter className="w-2.5 h-2.5 text-[var(--app-text-dim)] shrink-0" />
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`shrink-0 text-[8px] font-mono px-1.5 py-0.5 rounded-md transition-colors ${
              filter === opt.key
                ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] border border-[color:var(--app-accent-border)]'
                : 'text-[var(--app-text-dim)] hover:text-[var(--app-text-muted)] border border-transparent'
            }`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Events List */}
      <ScrollArea className="flex-1 max-h-70" ref={scrollRef}>
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-10 h-10 rounded border border-[color:var(--cad-border-strong)] flex items-center justify-center opacity-40">
              <Activity className="w-5 h-5 text-[var(--cad-text-muted)]" />
            </div>
            <p className="text-sm text-[var(--app-text-dim)]">
              {filter === 'ALL' ? 'No activity yet' : `No ${filter} events`}
            </p>
            <p className="text-xs text-[var(--app-text-dim)]">Events will appear here as jobs progress</p>
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--app-border)]">
            <AnimatePresence>
              {filteredEvents.map(event => {
                const config = EVENT_CONFIG[event.type]
                const Icon = config.icon
                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="activity-item flex items-start gap-2.5 px-3 py-2 cursor-pointer"
                    onClick={() => onEventClick?.(event)}
                  >
                    <div className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center ${config.bgColor}`}>
                      <Icon className={`w-2.5 h-2.5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] text-[var(--app-text-secondary)] truncate max-w-[120px]">
                          {event.jobName.length > 20 ? event.jobName.slice(0, 20) + '...' : event.jobName}
                        </span>
                        <span className="text-xs text-[var(--app-text-dim)]">{event.action}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[8px] font-mono text-[var(--app-text-dim)]">{event.jobId}</span>
                        <span className="text-[8px] text-[var(--app-text-dim)]">·</span>
                        <span className="text-[8px] text-[var(--app-text-dim)]">{activityTimeAgo(event.timestamp)}</span>
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
