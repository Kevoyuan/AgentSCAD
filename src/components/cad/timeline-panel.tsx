'use client'

import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Job, ExecutionLog, parseJSON, formatTime } from './types'
import { slideInLeft, slideInLeftTransition, staggerContainer, staggerChild, staggerTransition } from './motion-presets'

export function TimelinePanel({ job }: { job: Job }) {
  const logs = parseJSON<ExecutionLog[]>(job.executionLogs, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)]">
        <h3 className="text-eyebrow text-[var(--app-text-muted)]">Timeline</h3>
        <Badge variant="outline" className="text-xs h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
          {logs.length} events
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <motion.div
          className="p-2 space-y-0.5"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {logs.map((log, i) => (
            <motion.div
              key={i}
              variants={{ ...slideInLeft }}
              transition={{ ...slideInLeftTransition, delay: i * 0.03 }}
              className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--app-hover-subtle)] linear-transition group"
            >
              <span className="text-[8px] font-mono text-[var(--app-text-dim)] mt-0.5 whitespace-nowrap">{formatTime(log.timestamp)}</span>
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded shrink-0 ${
                log.event.includes('FAILED') ? 'bg-rose-500/10 text-rose-400' :
                log.event === 'DELIVERED' ? 'bg-lime-500/10 text-lime-400' :
                log.event === 'SCAD_GENERATED' ? 'bg-amber-500/10 text-amber-400' :
                log.event === 'RENDERED' ? 'bg-cyan-500/10 text-cyan-400' :
                log.event === 'VALIDATED' ? 'bg-emerald-500/10 text-emerald-400' :
                'bg-[var(--app-surface-hover)] text-[var(--app-text-muted)]'
              }`}>{log.event}</span>
              <span className="text-sm text-[var(--app-text-muted)] flex-1">{log.message}</span>
            </motion.div>
          ))}
          {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--app-text-dim)] gap-2">
              <Clock className="w-6 h-6 opacity-30" />
              <span className="text-xs">No events yet</span>
            </div>
          )}
        </motion.div>
      </ScrollArea>
    </div>
  )
}
