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

  const chips = [
    job.partFamily ? getPartFamilyLabel(job.partFamily) : 'Part family pending',
    job.generationPath?.replace(/_/g, ' ') || 'Generation path pending',
    job.builderName || 'Builder pending',
    dimensions.length ? `${dimensions.join(' x ')} mm` : 'Dimensions pending',
  ]

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* Design Intent & Prompt */}
      <div className="rounded-lg border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] p-3">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[color:var(--app-border-subtle)]">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--cad-text-muted)]">Design Intent</span>
          <span className="text-[10px] font-mono text-[var(--app-accent)]">ID: {job.id.slice(0, 8)}</span>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--cad-text)] font-normal select-text">
          {job.inputRequest}
        </p>
      </div>

      {/* Engineering Attributes Grid */}
      <div className="rounded-lg border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] overflow-hidden">
        <div className="px-3 py-2 border-b border-[color:var(--app-border-subtle)] bg-[var(--app-surface-raised)]/40 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--cad-text-muted)]">Fabrication Specs</span>
          <span className="text-[10px] font-mono text-[var(--cad-text-dim)]">{job.partFamily || 'Custom'}</span>
        </div>
        <div className="divide-y divide-[color:var(--app-border-subtle)]">
          <div className="flex items-center justify-between px-3 py-2 text-[12px]">
            <span className="text-[var(--cad-text-muted)]">Part Family</span>
            <span className="font-medium text-[var(--cad-text)]">{job.partFamily ? getPartFamilyLabel(job.partFamily) : 'Custom / Unclassified'}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[12px]">
            <span className="text-[var(--cad-text-muted)]">Bounding Box</span>
            <span className="font-mono tabular-nums text-[var(--cad-measure)]">{dimensions.length ? `${dimensions.join(' × ')} mm` : 'Pending render'}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[12px]">
            <span className="text-[var(--cad-text-muted)]">Engine / Path</span>
            <span className="font-mono text-[var(--cad-text-secondary)]">{job.generationPath?.replace(/_/g, ' ') || 'Direct synthesis'}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[12px]">
            <span className="text-[var(--cad-text-muted)]">Builder</span>
            <span className="font-mono text-[var(--cad-text-secondary)]">{job.builderName || 'OpenSCAD v2.0'}</span>
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

      {/* Telemetry Footer */}
      {(job.builderName || job.generationPath) && (
        <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] font-mono text-[var(--cad-text-dim)]">
          <Cpu className="h-3 w-3" />
          <span>{[job.builderName, job.generationPath].filter(Boolean).join(' / ')}</span>
        </div>
      )}
    </div>
  )
}
