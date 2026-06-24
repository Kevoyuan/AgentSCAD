'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { History, Settings, FileCode, StickyNote, ChevronDown, Search, User } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Job, timeAgo, parseJSON } from './types'
import { fetchJobVersions, JobVersion } from './api'

// ─── Field metadata ────────────────────────────────────────────────────────

const FIELD_INFO: Record<string, { label: string; icon: typeof Settings; color: string }> = {
  parameters: { label: 'Parameters', icon: Settings, color: 'text-[var(--app-accent-text)]' },
  scadSource: { label: 'SCAD Source', icon: FileCode, color: 'text-cyan-400' },
  notes: { label: 'Notes', icon: StickyNote, color: 'text-amber-400' },
}

// ─── Diff helper for parameter changes ────────────────────────────────────

function ParameterDiff({ oldValue, newValue }: { oldValue: string | null; newValue: string | null }) {
  const oldParams = parseJSON<Record<string, unknown>>(oldValue, {})
  const newParams = parseJSON<Record<string, unknown>>(newValue, {})

  // Find changed keys
  const allKeys = new Set([...Object.keys(oldParams), ...Object.keys(newParams)])
  const changes: Array<{ key: string; old: unknown; new: unknown }> = []

  for (const key of allKeys) {
    const oldVal = oldParams[key]
    const newVal = newParams[key]
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ key, old: oldVal, new: newVal })
    }
  }

  if (changes.length === 0) {
    return <span className="text-xs text-[var(--app-text-dim)] italic">No specific changes detected</span>
  }

  return (
    <div className="space-y-1 mt-1">
      {changes.map(c => (
        <div key={c.key} className="flex items-center gap-2 text-[13px] font-mono">
          <span className="text-[var(--app-text-muted)] min-w-[60px]">{c.key}</span>
          <span className="text-rose-400 line-through">{c.old != null ? String(c.old) : '—'}</span>
          <span className="text-[var(--app-text-dim)]">→</span>
          <span className="text-emerald-400">{c.new != null ? String(c.new) : '—'}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Line diff for SCAD changes ──────────────────────────────────────────

function ScadDiff({ oldValue, newValue }: { oldValue: string | null; newValue: string | null }) {
  const oldLines = (oldValue || '').split('\n')
  const newLines = (newValue || '').split('\n')
  const maxLen = Math.max(oldLines.length, newLines.length, 5)

  const diffs: Array<{ lineNum: number; type: 'same' | 'added' | 'removed'; oldContent: string; newContent: string }> = []

  // Simple line-by-line diff
  const maxLines = Math.min(maxLen, 20) // Limit display
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]
    if (oldLine === undefined && newLine === undefined) continue
    if (oldLine === newLine) {
      diffs.push({ lineNum: i + 1, type: 'same', oldContent: oldLine || '', newContent: newLine || '' })
    } else {
      if (oldLine !== undefined) {
        diffs.push({ lineNum: i + 1, type: 'removed', oldContent: oldLine, newContent: '' })
      }
      if (newLine !== undefined) {
        diffs.push({ lineNum: i + 1, type: 'added', oldContent: '', newContent: newLine })
      }
    }
  }

  return (
    <div className="mt-1 font-mono text-xs max-h-32 overflow-y-auto rounded bg-[var(--app-bg)] border border-[color:var(--app-border)]">
      {diffs.map((d, idx) => (
        <div
          key={idx}
          className={`flex ${
            d.type === 'removed' ? 'bg-rose-500/10 text-rose-300' :
            d.type === 'added' ? 'bg-emerald-500/10 text-emerald-300' :
            'text-[var(--app-text-dim)]'
          }`}
        >
          <span className="w-8 text-right pr-2 shrink-0 select-none text-[var(--app-text-dim)]">{d.lineNum}</span>
          <span className="flex-1 truncate">{d.type === 'removed' ? `- ${d.oldContent}` : d.type === 'added' ? `+ ${d.newContent}` : `  ${d.newContent}`}</span>
        </div>
      ))}
      {maxLen > 20 && (
        <div className="text-center text-[var(--app-text-dim)] py-0.5">... {maxLen - 20} more lines</div>
      )}
    </div>
  )
}

// ─── Notes diff ──────────────────────────────────────────────────────────

function NotesDiff({ oldValue, newValue }: { oldValue: string | null; newValue: string | null }) {
  return (
    <div className="mt-1 space-y-1">
      {oldValue && (
        <div>
          <span className="text-[8px] text-[var(--app-text-dim)] uppercase">Before</span>
          <p className="text-[13px] text-rose-300/80 line-through truncate max-w-full">{oldValue.slice(0, 100)}{oldValue.length > 100 ? '...' : ''}</p>
        </div>
      )}
      {newValue && (
        <div>
          <span className="text-[8px] text-[var(--app-text-dim)] uppercase">After</span>
          <p className="text-[13px] text-emerald-300/80 truncate max-w-full">{newValue.slice(0, 100)}{newValue.length > 100 ? '...' : ''}</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────

interface JobVersionHistoryProps {
  job: Job
}

export function JobVersionHistory({ job }: JobVersionHistoryProps) {
  const [versions, setVersions] = useState<JobVersion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterField, setFilterField] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchJobVersions(job.id)
      .then(data => {
        if (!cancelled) setVersions(data.versions)
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [job.id])

  const filteredVersions = useMemo(() => {
    if (!filterField) return versions
    return versions.filter(v => v.field === filterField)
  }, [versions, filterField])

  const fieldCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const v of versions) {
      counts[v.field] = (counts[v.field] || 0) + 1
    }
    return counts
  }, [versions])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-dim)] gap-3 p-6">
        <div className="w-8 h-7 border-2 border-[color:var(--app-accent)] border-t-transparent rounded-full animate-spin" />
        <p className="text-[13px]">Loading history...</p>
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--cad-text-muted)] gap-3 p-6">
        <div className="w-12 h-12 rounded border border-[color:var(--cad-border-strong)] flex items-center justify-center opacity-40">
          <History className="w-6 h-6" />
        </div>
        <p className="text-sm">No version history</p>
        <p className="text-[13px] text-[var(--app-text-dim)]">Changes to parameters, SCAD, and notes will be tracked here</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)] shrink-0">
        <h3 className="text-eyebrow text-[var(--app-text-muted)] flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" />
          Version History
        </h3>
        <Badge variant="outline" className="text-xs h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
          {versions.length} changes
        </Badge>
      </div>

      {/* Filter */}
      {Object.keys(fieldCounts).length > 1 && (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[color:var(--app-border)]">
          <Search className="w-3.5 h-3.5 text-[var(--app-text-dim)]" />
          {['all', ...Object.keys(fieldCounts)].map(f => {
            const isActive = f === 'all' ? !filterField : filterField === f
            const info = f !== 'all' ? FIELD_INFO[f] : null
            return (
              <button
                key={f}
                className={`shrink-0 text-[8px] font-mono px-1.5 py-0.5 rounded linear-transition ${
                  isActive ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] border border-[color:var(--app-accent-border)]' : 'text-[var(--app-text-dim)] hover:text-[var(--app-text-muted)] border border-transparent'
                }`}
                onClick={() => setFilterField(f === 'all' ? null : f)}
              >
                {f === 'all' ? 'ALL' : (info?.label || f)} {f !== 'all' ? fieldCounts[f] || '' : ''}
              </button>
            )
          })}
        </div>
      )}

      {/* Timeline */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          <AnimatePresence>
            {filteredVersions.map((version, idx) => {
              const fieldInfo = FIELD_INFO[version.field] || { label: version.field, icon: Settings, color: 'text-[var(--app-text-muted)]' }
              const FieldIcon = fieldInfo.icon
              const isExpanded = expandedId === version.id

              return (
                <motion.div
                  key={version.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="relative"
                >
                  {/* Timeline dot and line */}
                  <div className="absolute left-0 top-0 bottom-0 w-4 flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full mt-2 ${fieldInfo.color.replace('text-', 'bg-')}`} />
                    {idx < filteredVersions.length - 1 && (
                      <div className="flex-1 w-px bg-[var(--app-surface-hover)] mt-1" />
                    )}
                  </div>

                  {/* Content */}
                  <div
                    className="ml-5 rounded-md linear-border bg-[var(--app-surface)] overflow-hidden cursor-pointer hover:bg-[var(--app-surface-hover)] linear-transition"
                    onClick={() => setExpandedId(isExpanded ? null : version.id)}
                  >
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <FieldIcon className={`w-3.5 h-3.5 ${fieldInfo.color}`} />
                        <span className="text-[13px] font-medium text-[var(--app-text-secondary)]">{fieldInfo.label}</span>
                        <span className="text-[8px] text-[var(--app-text-dim)]">changed</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[8px] text-[var(--app-text-dim)]">
                          <User className="w-2 h-2" />
                          {version.changedBy}
                        </span>
                        <span className="text-[8px] text-[var(--app-text-dim)]">{timeAgo(version.createdAt)}</span>
                        <motion.div
                          animate={{ rotate: isExpanded ? 180 : 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <ChevronDown className="w-3.5 h-3.5 text-[var(--app-text-dim)]" />
                        </motion.div>
                      </div>
                    </div>

                    {/* Expanded diff */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-2 border-t border-[color:var(--app-border)]">
                            {version.field === 'parameters' && (
                              <ParameterDiff oldValue={version.oldValue} newValue={version.newValue} />
                            )}
                            {version.field === 'scadSource' && (
                              <ScadDiff oldValue={version.oldValue} newValue={version.newValue} />
                            )}
                            {version.field === 'notes' && (
                              <NotesDiff oldValue={version.oldValue} newValue={version.newValue} />
                            )}
                            <div className="text-[8px] text-[var(--app-text-dim)] mt-1">
                              {new Date(version.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  )
}
