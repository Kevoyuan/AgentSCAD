'use client'

/*
 * 尺寸 — DESIGN.md section 6, "Dimensions".
 *
 * Parameters are instrument readings, not a web form: a label, a stepper, a unit.
 * Editing a stepper is a *preview*. Nothing is written until the composer's action
 * rebuilds the design, which is what makes the composer's staleness line honest
 * ("参数已改，需重建") and what keeps preview state distinguishable from the
 * built artifact (DESIGN.md acceptance criteria 5).
 */

import { Job } from '@/components/cad/types'
import { Stepper } from './instrument'
import { resolveParameterSchema } from './parameter-schema'

export function DimensionsModule({
  job,
  values,
  isProcessing,
  onDraft,
  onReset,
}: {
  job: Job
  values: Record<string, number>
  isProcessing: boolean
  onDraft: (key: string, value: number) => void
  onReset: () => void
}) {
  const schema = resolveParameterSchema(job)

  if (!schema) {
    return (
      <p className="px-[11px] pb-[11px] text-[11.5px] text-[var(--shell-text-dim)]">
        这个零件还没有尺寸。先生成一次，尺寸会出现在这里。
      </p>
    )
  }

  const changedKeys = schema.parameters
    .filter(p => {
      const current = values[p.key]
      return typeof current === 'number' && Math.abs(current - p.value) > 1e-9
    })
    .map(p => p.key)
  const changed = new Set(changedKeys)

  return (
    <div className="px-[11px] pb-[11px]">
      {schema.groups.map((group, gi) => (
        <div
          key={group.name}
          className={gi === schema.groups.length - 1 ? 'pt-[9px]' : 'pt-[9px] pb-[6px] border-b border-[color:var(--shell-hairline)]'}
        >
          {schema.groups.length > 1 && (
            <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)] mb-1">
              {group.label}
            </div>
          )}
          {group.parameters.map(param => {
            const value = typeof values[param.key] === 'number' ? values[param.key] : param.value
            const isChanged = changed.has(param.key)
            return (
              <div key={param.key} className="grid grid-cols-[1fr_auto] items-center gap-2 h-[29px]">
                <span
                  className="truncate text-[11.5px] text-[var(--shell-text-muted)]"
                  title={param.description || param.label}
                >
                  {param.label}
                </span>
                <span className="flex items-center gap-1">
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
                  {param.unit && (
                    <span className="w-[18px] font-mono text-[9px] text-[var(--shell-text-dim)]">
                      {param.unit}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      ))}

      {changed.size > 0 && (
        <button
          type="button"
          onClick={onReset}
          className="mt-[8px] w-full h-[26px] rounded-[4px] border border-dashed border-[color:var(--shell-border)] font-mono text-[9.5px] tracking-[0.1em] text-[var(--shell-text-dim)] hover:text-[var(--shell-signal-soft)] hover:border-[var(--shell-signal)]/50 transition-colors"
        >
          ↺ 撤销 {changed.size} 项改动
        </button>
      )}
    </div>
  )
}
