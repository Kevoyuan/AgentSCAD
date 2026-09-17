'use client'

import { useState } from 'react'
import { ChevronRight, Copy, CheckCircle } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

interface BreadcrumbNavProps {
  jobId: string
  activeTab: string
  onNavigateHome?: () => void
  onNavigateJobs?: () => void
}

const TAB_LABELS: Record<string, string> = {
  PARAMS: 'Parameters',
  PARAMETERS: 'Parameters',
  SPEC: 'Spec',
  MODEL: 'Model',
  CODE: 'Code',
  VALIDATION: 'Validation',
  RESEARCH: 'Research',
  VALIDATE: 'Validation',
  SCAD: 'SCAD Code',
  LOG: 'Timeline Log',
  NOTES: 'Notes',
  DEPS: 'Dependencies',
  HISTORY: 'Version History',
  AI: 'AI Chat',
}

export function BreadcrumbNav({ jobId, activeTab, onNavigateHome, onNavigateJobs }: BreadcrumbNavProps) {
  const [copied, setCopied] = useState(false)
  const jobPrefix = jobId.slice(0, 8)
  const tabLabel = TAB_LABELS[activeTab] || activeTab

  const handleCopyId = async () => {
    const ok = await copyText(jobId)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <nav className="flex items-center gap-1.5 h-5 text-[11px] font-mono shrink-0 select-none" aria-label="Breadcrumb">
      <button
        className="text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] transition-colors"
        onClick={onNavigateHome}
        aria-label="Navigate to home"
      >
        AgentSCAD
      </button>
      <ChevronRight className="w-2.5 h-2.5 text-[var(--app-text-dim)]/70" />
      <button
        className="text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] transition-colors"
        onClick={onNavigateJobs}
        aria-label="Navigate to jobs list"
      >
        Jobs
      </button>
      <ChevronRight className="w-2.5 h-2.5 text-[var(--app-text-dim)]/70" />
      <button
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[var(--app-surface-raised)] border border-[color:var(--app-border)] text-[var(--app-text-primary)] hover:border-[var(--cad-accent)] transition-colors group cursor-pointer"
        onClick={handleCopyId}
        title="Click to copy full Job ID"
        aria-label={`Job ID: ${jobPrefix}. Click to copy.`}
      >
        <span className="font-semibold">{jobPrefix}</span>
        {copied ? (
          <CheckCircle className="w-2.5 h-2.5 text-emerald-500" />
        ) : (
          <Copy className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
      <ChevronRight className="w-2.5 h-2.5 text-[var(--app-text-dim)]/70" />
      <span className="text-[var(--cad-accent)] font-semibold">
        {tabLabel}
      </span>
    </nav>
  )
}
