'use client'

import { AlertTriangle, Cpu, RotateCcw, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Job, parseJSON } from './types'
import { CadConstraintChip, CadPanel, CadSectionHeader } from './cad-primitives'
import { getPartFamilyLabel } from './part-family-icon'

export function SpecPanel({
  job,
  onProcess,
  onRepair,
}: {
  job: Job
  onProcess: (job: Job) => void
  onRepair: (job: Job) => void
}) {
  const values = parseJSON<Record<string, number>>(job.parameterValues, {})
  const failed = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(job.state)
  const stale = job.state === 'DELIVERED' && !job.stlPath
  const dimensions = [
    values.width ?? values.phone_width ?? values.outer_diameter ?? values.diameter,
    values.depth ?? values.phone_length ?? values.thickness,
    values.height ?? values.phone_thickness,
  ].filter(v => typeof v === 'number')

  /* DESIGN.md section 18: engine paths and builder names are internals and must
     not appear in the interface. What the user needs here is the part family and
     the measured envelope. */
  const chips = [
    job.partFamily ? getPartFamilyLabel(job.partFamily) : '零件族待定',
    dimensions.length ? `${dimensions.join(' × ')} mm` : '尺寸待定',
  ]

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* Design Brief & Prompt. Re-tokenised to the shell (DESIGN.md section 22): the
          sheet is part of the C2 surface and was still painted from the old palette. */}
      <div className="rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-3">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[color:var(--shell-hairline)]">
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--shell-text-label)]">零件描述</span>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--shell-text)] font-normal select-text">
          {job.inputRequest}
        </p>
      </div>

      {/* Engineering Attributes Grid */}
      <div className="rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] overflow-hidden">
        <div className="px-3 py-2 border-b border-[color:var(--shell-hairline)] flex items-center justify-between">
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--shell-text-label)]">制造规格</span>
          <span className="text-[9px] font-mono text-[var(--shell-text-dim)]">{job.partFamily || 'Custom'}</span>
        </div>
        <div className="divide-y divide-[color:var(--shell-hairline)]">
          <div className="flex items-center justify-between px-3 py-2 text-[12.5px]">
            <span className="text-[var(--shell-text-muted)]">零件族</span>
            <span className="font-medium text-[var(--shell-text)]">{job.partFamily ? getPartFamilyLabel(job.partFamily) : '未分类'}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[12.5px]">
            <span className="text-[var(--shell-text-muted)]">外形尺寸</span>
            <span className="font-mono tabular-nums text-[var(--shell-text)]">{dimensions.length ? `${dimensions.join(' × ')} mm` : '—'}</span>
          </div>
                            </div>
      </div>

      {/* Diagnostics & Remediation Bar if Failed or Stale */}
      {(failed || stale) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="space-y-0.5">
              <h4 className="text-[12px] font-medium text-amber-500">
                {failed ? 'Diagnostic Required' : 'Stale Render'}
              </h4>
              <p className="text-[12px] leading-relaxed text-[var(--cad-text-secondary)]">
                {failed
                  ? 'If artifacts exist, Auto Repair will restore the run without regenerating geometry. Otherwise retry the pipeline.'
                  : 'Parameters changed after render. Rebuild STL before export.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {failed && (
              <Button
                size="sm"
                className="h-7 gap-1.5 bg-[var(--cad-accent)] hover:bg-[var(--app-accent-hover)] text-white text-[12px] font-medium px-2.5 rounded-md"
                onClick={() => onRepair(job)}
              >
                <Wrench className="h-3 w-3" />
                Auto Repair
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-[color:var(--app-border)] text-[var(--cad-text)] hover:bg-[var(--app-surface-hover)] text-[12px] font-medium px-2.5 rounded-md"
              onClick={() => onProcess(job)}
            >
              <RotateCcw className="h-3 w-3" />
              {failed ? 'Retry Pipeline' : 'Rebuild STL'}
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}
