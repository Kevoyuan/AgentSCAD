'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Brain, ArrowRight } from 'lucide-react'
import { PartFamilyIcon, getPartFamilyLabel } from './part-family-icon'
import { StateBadge } from './state-badge'
import { timeAgo } from './types'
import {
  staggerContainer,
  staggerChild,
  staggerTransition,
} from './motion-presets'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SimilarJob {
  id: string
  inputRequest: string
  partFamily: string | null
  parameterSchema: string | null
  parameterValues: string | null
  state: string
  createdAt: string
  completedAt: string | null
  builderName: string | null
  generationPath: string | null
}

interface CaseMemoryProps {
  searchQuery: string
  onSuggestionClick?: (job: SimilarJob) => void
}

// ─── Debounce Hook ──────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

// ─── Case Memory Component ──────────────────────────────────────────────────

export function CaseMemory({ searchQuery, onSuggestionClick }: CaseMemoryProps) {
  const [similarJobs, setSimilarJobs] = useState<SimilarJob[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const debouncedQuery = useDebounce(searchQuery, 300)

  const searchSimilar = useCallback(async (q: string) => {
    if (!q || q.trim().length < 3) {
      setSimilarJobs([])
      return
    }

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setIsSearching(true)
    try {
      const res = await fetch(`/api/jobs/similar?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      if (!controller.signal.aborted) {
        setSimilarJobs(data.similar || [])
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Similar jobs search failed:', err)
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false)
      }
    }
  }, [])

  useEffect(() => {
    searchSimilar(debouncedQuery)
  }, [debouncedQuery, searchSimilar])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [])

  const rawQueryReady = searchQuery.trim().length >= 3
  const debouncedQueryReady = debouncedQuery.trim().length >= 3
  const isWaitingForDebounce = rawQueryReady && !debouncedQueryReady

  if (!rawQueryReady) {
    return null
  }

  return (
    <div className="mt-0">
      <div className="mb-2 flex h-4 items-center gap-1.5">
        <Brain className="w-3.5 h-3.5 text-[var(--shell-text-label)]" />
        <span className="font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
          案例记忆
        </span>
        <span className={`font-mono text-[9px] text-[var(--shell-signal-soft)] transition-opacity ${(isSearching || isWaitingForDebounce) ? 'opacity-100' : 'opacity-0'}`}>
          检索中…
        </span>
      </div>

      <div className="min-h-10">
        {similarJobs.length > 0 && debouncedQueryReady ? (
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            transition={staggerTransition}
            className="stable-scrollbar space-y-1.5 max-h-48 overflow-y-auto pr-1"
          >
            {similarJobs.map((job) => (
              <motion.div
                key={job.id}
                variants={staggerChild}
                className="group/suggestion relative rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] p-2.5 cursor-pointer transition-colors hover:border-[color:var(--shell-border-strong)] hover:bg-[var(--shell-hover)]"
                onClick={() => onSuggestionClick?.(job)}
              >
                <div className="flex items-start gap-2">
                  <PartFamilyIcon family={job.partFamily || 'unknown'} size={16} animate={false} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-[var(--shell-text)] leading-tight line-clamp-2">
                      {job.inputRequest}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <StateBadge state={job.state} />
                      {job.partFamily && (
                        <span className="font-mono text-[9px] text-[var(--shell-text-dim)]">
                          {getPartFamilyLabel(job.partFamily)}
                        </span>
                      )}
                      <span className="font-mono text-[9px] text-[var(--shell-text-dim)]">
                        {timeAgo(job.createdAt)}
                      </span>
                    </div>
                  </div>
                  <button
                    className="shrink-0 flex items-center gap-0.5 font-mono text-[9px] text-[var(--shell-signal-soft)] opacity-0 group-hover/suggestion:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 hover:text-[var(--shell-signal)] border border-[color:var(--shell-border)] px-1.5 py-1 rounded-[4px]"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSuggestionClick?.(job)
                    }}
                  >
                    使用 <ArrowRight className="w-2 h-2" />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="flex min-h-10 items-center justify-center text-[12.5px] text-[var(--shell-text-dim)]">
            {isSearching || isWaitingForDebounce ? '正在检索历史零件…' : '没有相似的历史零件'}
          </div>
        )}
      </div>
    </div>
  )
}
