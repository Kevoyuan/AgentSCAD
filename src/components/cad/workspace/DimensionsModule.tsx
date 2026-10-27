'use client'

import { useI18n } from '@/components/i18n-provider'

/*
 * 尺寸 — DESIGN.md section 6, "Dimensions".
 *
 * Parameters are instrument readings, not a web form: a label, a stepper, a unit.
 * Editing a stepper is a *preview*. Nothing is written until the composer's action
 * rebuilds the design, which is what makes the composer's staleness line honest
 * ("参数已改，需重建") and what keeps preview state distinguishable from the
 * built artifact (DESIGN.md acceptance criteria 5).
 *
 * Long designs (a 38-parameter engine block) are the normal case, not an edge case
 * (DESIGN.md section 6: "if a design has 20 parameters, group them and collapse the
 * groups"). The module never scrolls itself - Module.tsx owns the single body
 * scroll - so this file only decides what is worth showing at once:
 *   - a filter once the list is longer than a glance;
 *   - collapsible groups when the schema really has them;
 *   - a capped first page with an explicit "show more" so 38 rows never become a
 *     blind scroll;
 *   - a sticky draft footer, because a change made at the bottom of a long list
 *     must not hide its own "Rebuild required" state below the fold.
 */

import * as React from 'react'
import { ChevronDown, ChevronRight, RotateCcw, Search, X } from 'lucide-react'
import { Job } from '@/components/cad/types'
import { cn } from '@/lib/utils'
import { EmptyNote, PendingRows, Stepper } from './instrument'
import { resolveParameterSchema, parameterUnit } from './parameter-schema'
import { jobDetailsFailed, jobDetailsPending, jobHasBeenBuilt } from './job-detail-state'

/** Rows shown per group before the explicit "show more" page break. */
const PAGE_SIZE = 12
/** Below this a design does not need a filter or a pager. */
const FILTER_THRESHOLD = 8

export function DimensionsModule({
  job,
  values,
  changedKeys,
  isProcessing,
  onDraft,
  onReset,
}: {
  job: Job
  values: Record<string, number>
  /**
   * Keys whose draft differs from the values this part was built with.
   *
   * Computed once, by the shell, against `job.parameterValues` — never here.
   * This module used to derive its own set by comparing `values` against the
   * schema's declared defaults, which reported "1 parameter changed" on a part
   * nobody had touched (its build had overridden the declared default) while the
   * composer, working from the draft, said "no rebuild needed". Two answers to
   * one question on one screen is exactly what DESIGN.md section 18 forbids.
   */
  changedKeys: Set<string>
  isProcessing: boolean
  onDraft: (key: string, value: number) => void
  onReset: () => void
}) {
  const { t } = useI18n()

  const schema = resolveParameterSchema(job)

  const [filter, setFilter] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = React.useState<Record<string, boolean>>({})

  // One design at a time: a filter from the previous part must not hide the new one.
  const jobId = job.id
  React.useEffect(() => {
    setFilter('')
    setCollapsed({})
    setShowAll({})
  }, [jobId])

  if (!schema) {
    /*
     * Three different facts can look the same here, and only one of them is a
     * reason to write a sentence:
     *
     *   - the record is still in flight  → draw the shape of the rows, say nothing
     *   - the part was never generated   → "generate this part"
     *   - the part has no dimensions     → "this design has no adjustable dimensions"
     *
     * The middle case is the one the shell used to get wrong: the list payload
     * arrives without a schema, the module could not tell "missing" from
     * "empty", and it printed the first sentence for one to two seconds on
     * every part the user opened — telling people to generate the part they had
     * just clicked on.
     */
    if (jobDetailsPending(job)) {
      return (
        <div className="px-[11px] pb-[11px]">
          <PendingRows rows={3} label={t("Loading dimensions…")} />
        </div>
      )
    }
    return (
      <div className="px-[11px] pb-[11px]">
        <EmptyNote>
          {jobDetailsFailed(job)
            ? t("Could not load this part's dimensions.")
            : jobHasBeenBuilt(job)
            ? t("This design has no adjustable dimensions.")
            : t("No dimensions yet. Generate this part to see them here.")}
        </EmptyNote>
      </div>
    )
  }

  const query = filter.trim().toLowerCase()
  const matches = (p: (typeof schema.parameters)[number]) =>
    !query ||
    p.label.toLowerCase().includes(query) ||
    p.key.toLowerCase().includes(query) ||
    (p.description || '').toLowerCase().includes(query)

  const groups = schema.groups.map(group => ({
    ...group,
    parameters: group.parameters.filter(matches),
  }))
  const visibleGroups = groups.filter(group => group.parameters.length > 0)
  const matchCount = visibleGroups.reduce((count, group) => count + group.parameters.length, 0)
  const total = schema.parameters.length
  const filtering = query.length > 0
  const showFilter = total > FILTER_THRESHOLD

  const changed = changedKeys
  const changedLabels = schema.parameters.filter(p => changed.has(p.key)).map(p => p.label)

  const row = (param: (typeof schema.parameters)[number]) => {
    const value = typeof values[param.key] === 'number' ? values[param.key] : param.value
    const isChanged = changed.has(param.key)
    // At 1024 the label column truncates ("Camera Clearan…"). The row title always
    // starts with the label so hover reveals what the column cannot, and only appends
    // a description that says more than the label (legacy schemas use "X"/"Y"/"Z").
    const description = param.description?.trim()
    const title =
      description && description !== param.label && description.length > 3
        ? `${param.label} — ${description}`
        : param.label
    return (
      <div
        key={param.key}
        /* Three fixed columns, not a label and a floating cluster.
           The old row was `1fr auto` with the stepper and the unit pushed to the
           right edge, so the label sat 60-90px away from the number it named and the
           units did not line up between rows. Now every row shares one grid: the
           label column, a 104px stepper column, and a 24px unit column that forms a
           single vertical rule down the plate. */
        className="grid grid-cols-[minmax(0,1fr)_104px_24px] items-center gap-x-2 min-h-[32px]"
        title={title}
      >
        <span
          className={cn(
            'truncate text-[12px]',
            isChanged ? 'text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text-muted)]'
          )}
        >
          {param.label}
        </span>
        <Stepper
          label={param.label}
          value={value}
          min={param.min}
          max={param.max}
          step={param.step}
          kind={param.kind}
          disabled={isProcessing || param.editable === false}
          changed={isChanged}
          onDraft={next => onDraft(param.key, next)}
        />
        <span
          className={cn(
            'text-right font-mono text-[10px] tabular-nums',
            isChanged ? 'text-[var(--shell-signal-soft)]' : 'text-[var(--shell-text-label)]'
          )}
          title={parameterUnit(param) || undefined}
        >
          {parameterUnit(param)}
        </span>
      </div>
    )
  }

  return (
    <div className="px-[11px] pb-[11px]">
      {/* Search the instrument, not the scrollbar. Appears only when the list is
          long enough that scanning it is the actual problem. */}
      {showFilter && (
        <div className="pt-[5px]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-[7px] top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--shell-text-dim)]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t("Filter parameters")}
              aria-label={t("Filter parameters")}
              title={t("Filter parameters by name")}
              className={cn(
                'h-[28px] w-full rounded-[4px] border border-[color:var(--shell-border)] pl-[25px] pr-[26px]',
                '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:pl-[30px] [@media(pointer:coarse)]:pr-[44px]',
                'font-mono text-[11px] text-[var(--shell-text)] placeholder:text-[var(--shell-text-dim)]',
                'outline-none focus:border-[var(--shell-signal)] transition-colors'
              )}
              style={{ background: 'var(--shell-inner)' }}
            />
            {filtering && (
              <button
                type="button"
                onClick={() => setFilter('')}
                aria-label={t("Clear filter")}
                title={t("Clear filter")}
                className="absolute right-0 top-0 flex h-[28px] w-[26px] items-center justify-center text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
          {filtering && (
            <p className="pt-[4px] font-mono text-[10px] tabular-nums text-[var(--shell-text-label)]">
              {matchCount} / {total}
            </p>
          )}
        </div>
      )}

      {visibleGroups.length === 0 ? (
        <EmptyNote>{t("No parameters match this filter.")}</EmptyNote>
      ) : (
        visibleGroups.map((group, groupIndex) => {
          const isCollapsed = Boolean(collapsed[group.name])
          const fullyShown = Boolean(showAll[group.name]) || filtering
          const cap = fullyShown ? group.parameters.length : PAGE_SIZE
          const shown = group.parameters.slice(0, cap)
          const hidden = group.parameters.length - shown.length
          const hasGroupHeader = schema.groups.length > 1
          const lastGroup = groupIndex === visibleGroups.length - 1

          return (
            <div
              key={group.name}
              className={cn(
                !lastGroup && 'pb-[3px] border-b border-[color:var(--shell-hairline)]',
                hasGroupHeader ? 'pt-[2px]' : 'pt-[2px]'
              )}
            >
              {hasGroupHeader && (
                <button
                  type="button"
                  onClick={() => setCollapsed(prev => ({ ...prev, [group.name]: !prev[group.name] }))}
                  aria-expanded={!isCollapsed}
                  title={t("Show or hide this parameter group")}
                  className="flex min-h-[28px] w-full items-center justify-between gap-2 text-left [@media(pointer:coarse)]:min-h-11"
                >
                  <span className="flex items-center gap-[5px] font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    )}
                    {t(group.label)}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--shell-text-dim)]">
                    {group.parameters.length}
                  </span>
                </button>
              )}
              {!isCollapsed && (
                <>
                  {shown.map(row)}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAll(prev => ({ ...prev, [group.name]: true }))}
                      title={t("Show {0} more parameters", { 0: hidden })}
                      className="mt-[6px] flex h-[28px] w-full items-center justify-center rounded-[4px] border border-dashed border-[color:var(--shell-border)] font-mono text-[10px] tracking-[0.08em] text-[var(--shell-text-label)] transition-colors hover:border-[var(--shell-border-strong)] hover:text-[var(--shell-text)] [@media(pointer:coarse)]:h-11"
                    >
                      ＋ {t("Show {0} more", { 0: hidden })}
                    </button>
                  )}
                  {hidden === 0 && !filtering && Boolean(showAll[group.name]) && group.parameters.length > PAGE_SIZE && (
                    <button
                      type="button"
                      onClick={() => setShowAll(prev => ({ ...prev, [group.name]: false }))}
                      title={t("Show less")}
                      className="mt-[6px] flex h-[28px] w-full items-center justify-center rounded-[4px] font-mono text-[10px] tracking-[0.08em] text-[var(--shell-text-label)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] [@media(pointer:coarse)]:h-11"
                    >
                      {t("Show less")}
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })
      )}

      {/* Draft state is a persistent instrument warning, not a toast: sticky so it
          stays visible while the user is still editing rows far from the footer.

          It reports the EDIT ("2 changed") and offers the undo — it does not
          state artifact staleness. That sentence has exactly one owner, the
          composer's staleness line (DESIGN.md section 18); printing it here too
          is what let the two disagree on screen. */}
      {changed.size > 0 && (
        <div
          className="sticky bottom-0 z-10 -mx-[11px] mt-[8px] border-t border-[color:var(--shell-hairline)] px-[11px] py-[7px]"
          style={{ background: 'var(--shell-module-solid)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="min-w-0 flex-1 text-[11px] leading-[1.35] text-[var(--shell-signal-soft)]"
              title={changedLabels.join(', ')}
            >
              {changed.size === 1
                ? t("1 changed")
                : t("{0} changed", { 0: changed.size })}
            </span>
            <button
              type="button"
              onClick={onReset}
              aria-label={t("↺ Undo")}
              title={t("↺ Undo")}
              className="flex h-[28px] shrink-0 items-center gap-[4px] rounded-[4px] border border-[color:var(--shell-border)] px-[7px] font-mono text-[10px] text-[var(--shell-text-label)] transition-colors hover:border-[var(--shell-border-strong)] hover:text-[var(--shell-text)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-3"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {t("Undo")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
