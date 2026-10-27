'use client'

import { useI18n } from '@/components/i18n-provider'

import * as React from 'react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { History, Clock, StickyNote } from 'lucide-react'
import { Job, parseJSON, ExecutionLog } from './types'
import { JobVersionHistory } from './job-version-history'
import { TimelinePanel } from './timeline-panel'
import { NotesPanel } from './notes-panel'

export type HistorySubTab = 'versions' | 'timeline' | 'notes'

interface HistoryPanelProps {
  job: Job
  onUpdate: () => void
  initialTab?: HistorySubTab
}

/* Shell tokens only (DESIGN.md section 22). The sub-tab used the legacy amber
   `--app-accent` fill with white text - 3.1:1 in light mode - and 24px tall
   targets. It is now the shell's one signal fill with dark ink, on 28px targets. */
const SUB_TAB =
  'linear-focus-ring inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2.5 font-mono text-[11px] outline-none transition-colors'

export function HistoryPanel({ job, onUpdate, initialTab }: HistoryPanelProps) {
  const { t } = useI18n()

  const [subTab, setSubTab] = useState<HistorySubTab>(initialTab ?? (job.state.endsWith('_FAILED') ? 'timeline' : 'versions'))
  const logs = parseJSON<ExecutionLog[]>(job.executionLogs, [])
  const hasNotes = Boolean(job.notes && job.notes.trim().length > 0)

  const tabClass = (active: boolean) => `${SUB_TAB} ${
    active
      ? 'bg-[var(--shell-signal)] font-semibold text-[var(--shell-signal-ink)]'
      : 'text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
  }`

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* Precision Segmented Controller */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--shell-hairline)] px-3 py-1.5">
        <div
          role="group"
          aria-label={t("History sections")}
          className="flex items-center gap-0.5 rounded-[6px] border border-[color:var(--shell-hairline)] bg-[var(--shell-well)] p-0.5"
        >
          <button
            type="button"
            onClick={() => setSubTab('versions')}
            aria-pressed={subTab === 'versions'}
            className={tabClass(subTab === 'versions')}
          >
            <History className="w-3 h-3" />
            <span>{t("VERSIONS")}</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('timeline')}
            aria-pressed={subTab === 'timeline'}
            className={tabClass(subTab === 'timeline')}
          >
            <Clock className="w-3 h-3" />
            <span>{t("TIMELINE")}</span>
            {logs.length > 0 && (
              <span
                className={`rounded px-1 py-0.5 font-mono text-[10px] tabular-nums ${
                  subTab === 'timeline'
                    ? 'bg-[color-mix(in_srgb,var(--shell-signal-ink)_16%,transparent)] text-[var(--shell-signal-ink)]'
                    : 'bg-[var(--shell-well)] text-[var(--shell-text-label)]'
                }`}
              >
                {logs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('notes')}
            aria-pressed={subTab === 'notes'}
            className={tabClass(subTab === 'notes')}
          >
            <StickyNote className="w-3 h-3" />
            <span>{t("NOTES")}</span>
            {hasNotes && (
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${subTab === 'notes' ? 'bg-[var(--shell-signal-ink)]' : 'bg-[var(--shell-warn)]'}`} />
            )}
          </button>
        </div>
      </div>

      {/* Main Single View Stage */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={subTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="h-full w-full"
          >
            {subTab === 'versions' && <JobVersionHistory key={job.id} job={job} />}
            {subTab === 'timeline' && <TimelinePanel job={job} />}
            {subTab === 'notes' && <NotesPanel job={job} onUpdate={onUpdate} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
