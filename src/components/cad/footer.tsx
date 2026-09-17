'use client'

import { FileJson, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { Job } from './types'

// ─── Types ──────────────────────────────────────────────────────────────

interface FooterProps {
  jobs: Job[]
  jobCount: number
  jobCountFlash?: boolean
  deliveredCount?: number
  failedCount?: number
  successRate?: number
  onExport: () => void
  activeJob?: Job | null
}

// ─── Separator ──────────────────────────────────────────────────────────

function Dot() {
  return <span className="text-[var(--cad-text-muted)] opacity-40 select-none">·</span>
}

// ─── Footer Component ──────────────────────────────────────────────────

export function Footer({
  jobs: _jobs,
  jobCount,
  onExport,
  activeJob,
}: FooterProps) {
  const versionCount = activeJob ? ((activeJob.retryCount || 0) + 1) : 1
  const isSaved = Boolean(activeJob?.id)

  return (
    <footer className="h-7 px-3 border-t border-[color:var(--cad-border)] bg-[var(--cad-surface)] shrink-0 flex items-center justify-between text-[11px] font-mono text-[var(--cad-text-muted)] select-none">
      {/* Quiet Environment Strip */}
      <div className="flex items-center gap-2">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 cursor-default text-[var(--cad-text-secondary)]">
                <span className="text-[var(--cad-text-muted)]">Units:</span>
                <span>mm</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] font-mono">
              Base unit for parametric CAD models is millimeters (mm)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Dot />

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 cursor-default">
                <span className="text-[var(--cad-text-muted)]">Runtime:</span>
                <span className="text-[var(--cad-text-secondary)]">OpenSCAD WASM</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] font-mono">
              Deterministic geometry engine running in isolated WASM child process
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Dot />

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1.5 cursor-default">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--cad-success)]" />
                <span className="text-[var(--cad-text-secondary)]">Provider Ready</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] font-mono">
              Model provider API connected and responsive
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {activeJob && (
          <>
            <Dot />
            <span className="flex items-center gap-1 text-[var(--cad-text-secondary)]">
              {isSaved ? (
                <span className="flex items-center gap-1 text-[var(--cad-text-muted)]">
                  <Check className="w-3 h-3 text-[var(--cad-success)]" />
                  <span>Saved</span>
                </span>
              ) : (
                <span>Draft</span>
              )}
            </span>

            <Dot />
            <span className="text-[var(--cad-text-secondary)]">
              Rev {versionCount}
            </span>
          </>
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2.5">
        <span className="hidden sm:inline text-[10px] text-[var(--cad-text-muted)]">
          {jobCount} {jobCount === 1 ? 'design' : 'designs'}
        </span>

        <Dot />

        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-1 text-[var(--cad-text-muted)] hover:text-[var(--cad-text-primary)] hover:bg-[var(--cad-surface-muted)] transition-colors"
          onClick={onExport}
          title="Export designs backup as JSON"
        >
          <FileJson className="w-3 h-3" />
          <span>Export JSON</span>
        </Button>
      </div>
    </footer>
  )
}
