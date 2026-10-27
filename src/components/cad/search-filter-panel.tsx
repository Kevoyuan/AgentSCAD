'use client'

import { useI18n } from '@/components/i18n-provider'

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
import { getPartFamilyLabel } from './part-family-icon'

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
/*
 * The rail header (DESIGN.md section 6, "Slots"): one search field, one labelled
 * filter control, then the single create action (owned by JobListPanel). Every
 * control is a named button; the clear-search affordance is a real 28px target
 * with an accessible name instead of a bare ✕. Colours are shell tokens only.
 */

interface SearchFilterPanelProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  allJobs: Job[]
  stateCounts: Record<string, number>
}

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
        <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--shell-text-label)]">
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
  const { t } = useI18n()

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

  const chipClass = (active: boolean) => `min-h-7 max-w-full rounded-[4px] border px-2 py-0.5 text-[11px] font-medium leading-[1.5] transition-colors active:scale-[0.99] ${
    active
      ? 'border-[color:var(--shell-border-strong)] bg-[var(--shell-hover)] text-[var(--shell-text)]'
      : 'border-transparent text-[var(--shell-text-label)] hover:border-[color:var(--shell-border)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
  }`

  const fieldClass = 'h-8 min-w-0 rounded-[6px] border-[color:var(--shell-border)] bg-[var(--shell-well)] text-[12px] text-[var(--shell-text)] placeholder:text-[var(--shell-placeholder)] focus:border-[var(--shell-signal)]'

  return (
    <div className="shrink-0 border-b border-[color:var(--shell-hairline)]">
      {/* Search row - always visible */}
      <div className="px-2.5 pb-2 pt-2.5 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--shell-text-label)]" />
          <Input
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            placeholder={t("Search parts…")}
            aria-label={t("Search parts…")}
            title={t("Search parts…")}
            /* `shell-field`: focus is this border turning amber, not a ring inside it. */
            className={`shell-field h-8 min-w-0 rounded-[6px] border-[color:var(--shell-border)] bg-[var(--shell-well)] pl-8 pr-8 text-[12px] text-[var(--shell-text)] placeholder:text-[var(--shell-placeholder)] focus:border-[var(--shell-signal)]`}
            suppressHydrationWarning
          />
          {filters.search && (
            <button
              type="button"
              className="absolute right-0.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[4px] text-[var(--shell-text-label)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
              onClick={() => updateFilter('search', '')}
              aria-label={t("Clear")}
              title={t("Clear")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`relative h-8 w-8 shrink-0 rounded-[6px] border p-0 transition-colors ${expanded ? 'border-[color:var(--shell-border-strong)] bg-[var(--shell-hover)] text-[var(--shell-text)]' : 'border-[color:var(--shell-border)] text-[var(--shell-text-label)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'}`}
                onClick={() => setExpanded(!expanded)}
                aria-label={activeCount > 0 ? `${t("Filter and sort")} (${activeCount})` : t("Filter and sort")}
                title={t("Filter and sort")}
                aria-expanded={expanded}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {activeCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border border-[color:var(--shell-border)] bg-[var(--shell-raise)] px-1 font-mono text-[10px] tabular-nums leading-none text-[var(--shell-text)]">
                    {activeCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-[11px]">{t("Filter & Sort")}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mx-2.5 mb-2.5 space-y-3 rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-2.5">
              {/* Status lives in here. DESIGN.md section 6: filters open from one
                  action rather than permanently consuming module height. */}
              <FilterSection label={t("Status")}>
                <div className="flex flex-wrap items-center gap-1">
                  {FILTER_STATES.map(f => {
                    const totalFiltered = Object.values(stateCounts).reduce((a, b) => a + b, 0)
                    const count = f.key === 'ALL'
                      ? totalFiltered
                      : f.key === 'FAILED'
                      ? (stateCounts['VALIDATION_FAILED'] || 0) + (stateCounts['GEOMETRY_FAILED'] || 0) + (stateCounts['RENDER_FAILED'] || 0)
                      : stateCounts[f.key] || 0
                    const isOn = f.key === 'ALL'
                      ? filters.states.length === 0
                      : filters.states.includes(f.key)
                    return (
                      <button
                        key={f.key}
                        type="button"
                        className={chipClass(isOn)}
                        onClick={() => {
                          if (f.key === 'ALL') updateFilter('states', [])
                          else toggleState(f.key)
                        }}
                        aria-pressed={isOn}
                        title={t(f.label)}
                      >
                        <span className="block truncate">
                          {t(f.label)}
                          {count > 0 ? ` ${count}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </FilterSection>

              <FilterSection label={t("Date range")}>
                <div className="grid grid-cols-2 gap-1">
                  {DATE_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      className={chipClass(filters.dateRange === opt.key)}
                      onClick={() => updateFilter('dateRange', opt.key as FilterState['dateRange'])}
                      aria-pressed={filters.dateRange === opt.key}
                    >
                      <span className="block truncate">{t(opt.label)}</span>
                    </button>
                  ))}
                </div>
                {filters.dateRange === 'custom' && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5">
                    <Input
                      type="date"
                      value={filters.dateFrom || ''}
                      onChange={e => updateFilter('dateFrom', e.target.value || null)}
                      aria-label={t("From date")}
                      className={fieldClass}
                    />
                    <span className="sr-only">{t("to")}</span>
                    <Input
                      type="date"
                      value={filters.dateTo || ''}
                      onChange={e => updateFilter('dateTo', e.target.value || null)}
                      aria-label={t("To date")}
                      className={fieldClass}
                    />
                  </div>
                )}
              </FilterSection>

              {/* Part Family */}
              <FilterSection label={t("Part family")}>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    className={chipClass(!filters.partFamily)}
                    onClick={() => updateFilter('partFamily', null)}
                    aria-pressed={!filters.partFamily}
                  >
                    {t("All")}
                  </button>
                  {partFamilies.filter(pf => pf !== 'unknown').map(pf => (
                    <button
                      key={pf}
                      type="button"
                      className={chipClass(filters.partFamily === pf)}
                      onClick={() => updateFilter('partFamily', pf === filters.partFamily ? null : pf)}
                      title={getPartFamilyLabel(pf)}
                      aria-pressed={filters.partFamily === pf}
                    >
                      <span className="block max-w-[120px] truncate">{getPartFamilyLabel(pf)}</span>
                    </button>
                  ))}
                </div>
              </FilterSection>

              {/* Builder Name */}
              <FilterSection label={t("Builder")}>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    className={chipClass(!filters.builderName)}
                    onClick={() => updateFilter('builderName', null)}
                    aria-pressed={!filters.builderName}
                  >
                    {t("All")}
                  </button>
                  {builderNames.map(bn => (
                    <button
                      key={bn}
                      type="button"
                      className={chipClass(filters.builderName === bn)}
                      onClick={() => updateFilter('builderName', bn === filters.builderName ? null : bn)}
                      title={bn}
                      aria-pressed={filters.builderName === bn}
                    >
                      <span className="block max-w-[120px] truncate">{bn}</span>
                    </button>
                  ))}
                </div>
              </FilterSection>

              {/* Sort */}
              <FilterSection label={t("Sort by")}>
                <div className="flex flex-wrap items-center gap-1">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      className={chipClass(filters.sortBy === opt.key)}
                      onClick={() => updateFilter('sortBy', opt.key as FilterState['sortBy'])}
                      aria-pressed={filters.sortBy === opt.key}
                    >
                      <span className="block truncate">{t(opt.label)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-[4px] text-[var(--shell-text-label)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
                    onClick={() => updateFilter('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc')}
                    title={filters.sortOrder === 'asc' ? t("Ascending") : t("Descending")}
                    aria-label={filters.sortOrder === 'asc' ? t("Ascending") : t("Descending")}
                  >
                    <ArrowUpDown className={`h-3.5 w-3.5 transition-transform ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </FilterSection>

              {/* Clear All */}
              {activeCount > 0 && (
                <div className="flex items-center justify-between gap-2 border-t border-[color:var(--shell-hairline)] pt-2">
                  <span className="min-w-0 truncate text-[11px] text-[var(--shell-text-label)]">
                    {activeCount} {activeCount === 1 ? t("active filter") : t("active filters")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 rounded-[4px] px-2 text-[11px] text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
                    onClick={clearAll}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t("Clear filters")}</span>
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
