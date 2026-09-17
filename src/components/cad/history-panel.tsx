'use client'

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
}

export function HistoryPanel({ job, onUpdate }: HistoryPanelProps) {
  const [subTab, setSubTab] = useState<HistorySubTab>('versions')
  const logs = parseJSON<ExecutionLog[]>(job.executionLogs, [])
  const hasNotes = Boolean(job.notes && job.notes.trim().length > 0)

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 bg-[var(--app-surface)]">
      {/* Precision Segmented Controller */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/30 shrink-0">
        <div className="flex items-center gap-1 bg-[var(--app-surface)] p-0.5 rounded-md border border-[color:var(--app-border)]">
          <button
            type="button"
            onClick={() => setSubTab('versions')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-xs font-mono transition-all duration-150 active:scale-[0.98] ${
              subTab === 'versions'
                ? 'bg-[var(--app-accent)] text-white font-medium shadow-sm'
                : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]'
            }`}
          >
            <History className="w-3 h-3" />
            <span>VERSIONS</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('timeline')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-xs font-mono transition-all duration-150 active:scale-[0.98] ${
              subTab === 'timeline'
                ? 'bg-[var(--app-accent)] text-white font-medium shadow-sm'
                : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>TIMELINE</span>
            {logs.length > 0 && (
              <span
                className={`text-[10px] font-mono tabular-nums px-1 py-0.2 rounded ${
                  subTab === 'timeline'
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--app-surface-raised)] text-[var(--app-text-muted)]'
                }`}
              >
                {logs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('notes')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-xs font-mono transition-all duration-150 active:scale-[0.98] ${
              subTab === 'notes'
                ? 'bg-[var(--app-accent)] text-white font-medium shadow-sm'
                : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]'
            }`}
          >
            <StickyNote className="w-3 h-3" />
            <span>NOTES</span>
            {hasNotes && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
      </div>

      {/* Main Single View Stage */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative">
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
