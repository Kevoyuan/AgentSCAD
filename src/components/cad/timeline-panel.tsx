'use client'

import { useI18n } from '@/components/i18n-provider'

import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Job, ExecutionLog, parseJSON, formatTime } from './types'
import { slideInLeft, slideInLeftTransition, staggerContainer, staggerChild, staggerTransition } from './motion-presets'

export function TimelinePanel({ job }: { job: Job }) {
  const { t, locale } = useI18n()

  const logs = parseJSON<ExecutionLog[]>(job.executionLogs, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)]">
        <h3 className="text-eyebrow text-[var(--app-text-muted)]">{t("Timeline")}</h3>
        <Badge variant="outline" className="text-[12px] h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
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
              <span className="text-[10px] font-mono text-[var(--app-text-dim)] mt-0.5 whitespace-nowrap">{formatTime(log.timestamp, locale)}</span>
              <span className={`text-[10px] font-mono px-1 py-0.5 rounded shrink-0 ${
                /*
                 * Two kinds of event, two kinds of colour.
                 *
                 * A failure is a verdict and wears the fail token. A delivery and
                 * a validation are successes and wear the ok token. The stages in
                 * between - code written, geometry rendered - are progress, not
                 * outcomes, so they stay neutral: colouring "SCAD_GENERATED"
                 * amber made an ordinary pipeline step look like a warning, which
                 * is the rainbow DESIGN.md section 11 refuses.
                 */
                /FAILED|ERROR|LLM_/.test(log.event) ? 'bg-[color-mix(in_srgb,var(--shell-fail)_10%,transparent)] text-[var(--shell-fail)]' :
                log.event === 'DELIVERED' ? 'bg-[color-mix(in_srgb,var(--shell-ok)_10%,transparent)] text-[var(--shell-ok)]' :
                log.event === 'VALIDATED' ? 'bg-[color-mix(in_srgb,var(--shell-ok)_10%,transparent)] text-[var(--shell-ok)]' :
                log.event === 'SCAD_GENERATED' ? 'bg-[var(--shell-well)] text-[var(--shell-text-muted)]' :
                log.event === 'RENDERED' ? 'bg-[var(--shell-well)] text-[var(--shell-text-muted)]' :
                'bg-[var(--app-surface-hover)] text-[var(--app-text-muted)]'
              }`}>{log.event}</span>
              <span className="text-[13px] text-[var(--app-text-muted)] flex-1 min-w-0 whitespace-pre-wrap break-words">{log.message}</span>
            </motion.div>
          ))}
          {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--app-text-dim)] gap-2">
              <Clock className="w-6 h-6 opacity-30" />
              <span className="text-[12px]">{t("No events yet")}</span>
            </div>
          )}
        </motion.div>
      </ScrollArea>
    </div>
  )
}
