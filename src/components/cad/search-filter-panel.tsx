'use client'

import { useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, SlidersHorizontal, X, ArrowUpDown, RotateCcw,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Job, FILTER_STATES } from './types'

// ─── Filter Types ───────────────────────────────────────────────────────────

export interface FilterState {
  search: string
  states: string[]
  dateRange: 'all' | 'today' | 'week' | 'month' | 'custom'
  dateFrom: string | null
  dateTo: string | null
  partFamily: string | null
  builderName: string | null
  sortBy: 'created' | 'updated' | 'state'
  sortOrder: 'asc' | 'desc'
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  states: [],
  dateRange: 'all',
  dateFrom: null,
  dateTo: null,
  partFamily: null,
  builderName: null,
  sortBy: 'created',
  sortOrder: 'desc',
}

// ─── Filter Functions ───────────────────────────────────────────────────────

export function applyFilters(jobs: Job[], filters: FilterState): Job[] {
  let result = [...jobs]

  // Search filter
  if (filters.search) {
    const q = filters.search.toLowerCase()
    result = result.filter(j =>
      j.inputRequest.toLowerCase().includes(q) ||
      j.id.toLowerCase().includes(q) ||
      (j.builderName && j.builderName.toLowerCase().includes(q)) ||
      (j.partFamily && j.partFamily.toLowerCase().includes(q))
    )
  }

  // State filter (multi-select)
  if (filters.states.length > 0) {
    result = result.filter(j => {
      return filters.states.some(s => {
        if (s === 'FAILED') return ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(j.state)
        return j.state === s
      })
    })
  }

  // Date range
  const now = new Date()
  if (filters.dateRange === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    result = result.filter(j => new Date(j.createdAt) >= startOfDay)
  } else if (filters.dateRange === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    result = result.filter(j => new Date(j.createdAt) >= weekAgo)
  } else if (filters.dateRange === 'month') {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    result = result.filter(j => new Date(j.createdAt) >= monthAgo)
  } else if (filters.dateRange === 'custom' && filters.dateFrom) {
    const from = new Date(filters.dateFrom)
    result = result.filter(j => new Date(j.createdAt) >= from)
    if (filters.dateTo) {
      const to = new Date(filters.dateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter(j => new Date(j.createdAt) <= to)
    }
  }

  // Part family filter
  if (filters.partFamily) {
    result = result.filter(j => j.partFamily === filters.partFamily)
  }

  // Builder name filter
  if (filters.builderName) {
    result = result.filter(j => j.builderName === filters.builderName)
  }

  // Sort
  result.sort((a, b) => {
    let cmp = 0
    switch (filters.sortBy) {
      case 'created':
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        break
      case 'updated':
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        break
      case 'state':
        cmp = a.state.localeCompare(b.state)
        break
    }
    return filters.sortOrder === 'desc' ? -cmp : cmp
  })

  return result
}

export function countActiveFilters(filters: FilterState): number {
  let count = 0
  if (filters.search) count++
  if (filters.states.length > 0) count++
  if (filters.dateRange !== 'all') count++
  if (filters.partFamily) count++
  if (filters.builderName) count++
  if (filters.sortBy !== 'created' || filters.sortOrder !== 'desc') count++
  return count
}

// ─── URL Params Serialization ───────────────────────────────────────────────

export function filtersToUrlParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('q', filters.search)
  if (filters.states.length > 0) params.set('states', filters.states.join(','))
  if (filters.dateRange !== 'all') params.set('dr', filters.dateRange)
  if (filters.dateFrom) params.set('df', filters.dateFrom)
  if (filters.dateTo) params.set('dt', filters.dateTo)
  if (filters.partFamily) params.set('pf', filters.partFamily)
  if (filters.builderName) params.set('bn', filters.builderName)
  if (filters.sortBy !== 'created') params.set('sort', filters.sortBy)
  if (filters.sortOrder !== 'desc') params.set('order', filters.sortOrder)
  return params
}

export function urlParamsToFilters(params: URLSearchParams): Partial<FilterState> {
  const filters: Partial<FilterState> = {}
  if (params.get('q')) filters.search = params.get('q')!
  if (params.get('states')) filters.states = params.get('states')!.split(',').filter(Boolean)
  if (params.get('dr')) filters.dateRange = params.get('dr') as FilterState['dateRange']
  if (params.get('df')) filters.dateFrom = params.get('df')
  if (params.get('dt')) filters.dateTo = params.get('dt')
  if (params.get('pf')) filters.partFamily = params.get('pf')
  if (params.get('bn')) filters.builderName = params.get('bn')
  const sort = params.get('sort')
  if (sort === 'created' || sort === 'updated' || sort === 'state') filters.sortBy = sort
  const order = params.get('order')
  if (order === 'asc' || order === 'desc') filters.sortOrder = order
  return filters
}

// ─── Search Filter Panel Component ──────────────────────────────────────────

interface SearchFilterPanelProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  allJobs: Job[]
  stateCounts: Record<string, number>
}

const ALL_STATES = [
  'NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED',
  'DELIVERED', 'CANCELLED', 'VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED',
]

const DATE_OPTIONS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
]

const SORT_OPTIONS = [
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Updated' },
  { key: 'state', label: 'State' },
]

function FilterSection({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-medium uppercase text-[var(--app-text-dim)]">
          {label}
        </label>
      </div>
      {children}
    </section>
  )
}

export function SearchFilterPanel({
  filters,
  onFiltersChange,
  allJobs,
  stateCounts,
}: SearchFilterPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const activeCount = countActiveFilters(filters)

  // Extract unique values from jobs for filter options
  const partFamilies = useMemo(() => {
    const families = new Set<string>()
    allJobs.forEach(j => { if (j.partFamily) families.add(j.partFamily) })
    return Array.from(families).sort()
  }, [allJobs])

  const builderNames = useMemo(() => {
    const names = new Set<string>()
    allJobs.forEach(j => { if (j.builderName) names.add(j.builderName) })
    return Array.from(names).sort()
  }, [allJobs])

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }, [filters, onFiltersChange])

  const toggleState = useCallback((state: string) => {
    const next = filters.states.includes(state)
      ? filters.states.filter(s => s !== state)
      : [...filters.states, state]
    updateFilter('states', next)
  }, [filters.states, updateFilter])

  const clearAll = useCallback(() => {
    onFiltersChange(DEFAULT_FILTER_STATE)
  }, [onFiltersChange])

  const chipClass = (active: boolean) => `min-h-7 max-w-full rounded-[6px] border px-2.5 py-1 text-[11px] font-medium leading-4 transition-all active:scale-[0.98] ${
    active
      ? 'border-[color:var(--app-accent-border)] bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]'
      : 'border-transparent text-[var(--app-text-muted)] hover:border-[color:var(--app-border-subtle)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]'
  }`

  return (
    <div className="border-b border-[color:var(--app-border)] bg-[var(--app-surface)]">
      {/* Search Row - Always visible */}
      <div className="px-2.5 pt-2.5 pb-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--app-text-dim)]" />
          <Input
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            placeholder="Search designs..."
            className="h-8 min-w-0 rounded-[7px] border-[var(--app-border-subtle)] bg-[var(--app-input-bg)] pl-8 pr-7 text-xs shadow-none placeholder:text-[var(--app-text-dim)] focus:border-[var(--app-accent)]"
            suppressHydrationWarning
          />
          {filters.search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-text-dim)] hover:text-[var(--app-text-muted)] transition-colors"
              onClick={() => updateFilter('search', '')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 shrink-0 rounded-[7px] p-0 relative border transition-all active:scale-[0.98] ${expanded ? 'border-[color:var(--app-accent-border)] bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] shadow-[0_0_0_3px_var(--app-focus-ring)]' : 'border-[color:var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[color:var(--app-border)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]'}`}
                onClick={() => setExpanded(!expanded)}
                aria-label="Filter and sort"
                aria-expanded={expanded}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {activeCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 rounded-full bg-[var(--app-accent)] px-1 text-white text-[7px] font-mono tabular-nums flex items-center justify-center">
                    {activeCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Filter & Sort</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* State Pills - Always visible */}
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-0.5 overflow-x-auto rounded-[7px] border border-[color:var(--app-border-subtle)] bg-[var(--app-bg)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" style={{ scrollbarWidth: 'none' }}>
        {FILTER_STATES.map(f => {
          const totalFiltered = Object.values(stateCounts).reduce((a, b) => a + b, 0)
          const count = f.key === 'ALL' ? totalFiltered :
            f.key === 'FAILED' ? (stateCounts['VALIDATION_FAILED'] || 0) + (stateCounts['GEOMETRY_FAILED'] || 0) + (stateCounts['RENDER_FAILED'] || 0) :
            stateCounts[f.key] || 0
          const isMultiActive = f.key === 'ALL'
            ? filters.states.length === 0
            : filters.states.includes(f.key === 'FAILED' ? 'FAILED' : f.key)
          return (
            <button
              key={f.key}
              className={`shrink-0 max-w-[128px] text-[10px] font-semibold px-2 py-1 rounded-[5px] transition-all min-h-6 active:scale-[0.98] truncate ${
                isMultiActive ? 'bg-[var(--app-surface)] text-[var(--app-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.06),inset_0_0_0_1px_var(--app-border-subtle)]' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]'
              }`}
              onClick={() => {
                if (f.key === 'ALL') {
                  updateFilter('states', [])
                } else {
                  toggleState(f.key === 'FAILED' ? 'FAILED' : f.key)
                }
              }}
              aria-label={`Filter by ${f.label}`}
              aria-pressed={isMultiActive}
            >
              {f.label} {count > 0 ? count : ''}
            </button>
          )
        })}
        </div>
      </div>

      {/* Expanded Filter Panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mx-2.5 mb-2.5 rounded-[8px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
              {/* Row 1: Date Range */}
              <div className="space-y-3">
                <FilterSection label="Date range">
                  <div className="grid grid-cols-2 gap-1 rounded-[7px] bg-[var(--app-bg)] p-1">
                    {DATE_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        className={chipClass(filters.dateRange === opt.key)}
                        onClick={() => updateFilter('dateRange', opt.key as FilterState['dateRange'])}
                      >
                        <span className="block truncate">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  {filters.dateRange === 'custom' && (
                    <div className="grid grid-cols-1 gap-1.5 mt-2">
                      <Input
                        type="date"
                        value={filters.dateFrom || ''}
                        onChange={e => updateFilter('dateFrom', e.target.value || null)}
                        className="h-8 min-w-0 rounded-[7px] border-[color:var(--app-border-subtle)] bg-[var(--app-input-bg)] text-[12px] text-[var(--app-text-secondary)]"
                      />
                      <span className="sr-only">to</span>
                      <Input
                        type="date"
                        value={filters.dateTo || ''}
                        onChange={e => updateFilter('dateTo', e.target.value || null)}
                        className="h-8 min-w-0 rounded-[7px] border-[color:var(--app-border-subtle)] bg-[var(--app-input-bg)] text-[12px] text-[var(--app-text-secondary)]"
                      />
                    </div>
                  )}
                </FilterSection>

                {/* Part Family */}
                <FilterSection label="Part family">
                  <div className="flex items-center gap-1 flex-wrap rounded-[7px] bg-[var(--app-bg)] p-1">
                    <button
                      className={chipClass(!filters.partFamily)}
                      onClick={() => updateFilter('partFamily', null)}
                    >
                      All
                    </button>
                    {partFamilies.map(pf => (
                      <button
                        key={pf}
                        className={chipClass(filters.partFamily === pf)}
                        onClick={() => updateFilter('partFamily', pf === filters.partFamily ? null : pf)}
                        title={pf.replace(/_/g, ' ')}
                      >
                        <span className="block max-w-[120px] truncate">{pf.replace(/_/g, ' ')}</span>
                      </button>
                    ))}
                  </div>
                </FilterSection>

                {/* Builder Name */}
                <FilterSection label="Builder">
                  <div className="flex items-center gap-1 flex-wrap rounded-[7px] bg-[var(--app-bg)] p-1">
                    <button
                      className={chipClass(!filters.builderName)}
                      onClick={() => updateFilter('builderName', null)}
                    >
                      All
                    </button>
                    {builderNames.map(bn => (
                      <button
                        key={bn}
                        className={chipClass(filters.builderName === bn)}
                        onClick={() => updateFilter('builderName', bn === filters.builderName ? null : bn)}
                        title={bn}
                      >
                        <span className="block max-w-[120px] truncate">{bn}</span>
                      </button>
                    ))}
                  </div>
                </FilterSection>

                {/* Sort */}
                <FilterSection label="Sort by">
                  <div className="flex flex-wrap items-center gap-1 rounded-[7px] bg-[var(--app-bg)] p-1">
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        className={chipClass(filters.sortBy === opt.key)}
                        onClick={() => updateFilter('sortBy', opt.key as FilterState['sortBy'])}
                      >
                        <span className="block truncate">{opt.label}</span>
                      </button>
                    ))}
                    <button
                      className="h-7 w-7 rounded-[6px] text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)] transition-all active:scale-[0.98] flex items-center justify-center"
                      onClick={() => updateFilter('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc')}
                      title={filters.sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                    >
                      <ArrowUpDown className={`w-3.5 h-3.5 transition-transform ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </FilterSection>
              </div>

              {/* Clear All */}
              {activeCount > 0 && (
                <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-[color:var(--app-border-separator)]">
                  <span className="min-w-0 text-[11px] text-[var(--app-text-dim)] truncate">
                    {activeCount} active filter{activeCount !== 1 ? 's' : ''}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 rounded-[6px] text-[11px] gap-1 text-[var(--app-text-muted)] hover:bg-[var(--app-danger-bg)] hover:text-[var(--app-danger)]"
                    onClick={clearAll}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Clear filters</span>
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
