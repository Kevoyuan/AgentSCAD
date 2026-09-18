'use client'

import { ChevronRight } from 'lucide-react'

interface BreadcrumbNavProps {
  jobId: string
  /* preferred over jobId for display */
  jobName?: string
  activeTab: string
  onNavigateHome?: () => void
  onNavigateJobs?: () => void
}

const TAB_LABELS: Record<string, string> = {
  SPEC: '描述',
  PARAMS: '尺寸',
  PARAMETERS: '尺寸',
  MODEL: '来源',
  CODE: '源码',
  SCAD: '源码',
  VALIDATION: '检验',
  VALIDATE: '检验',
  HISTORY: '记录',
  LOG: '记录',
  NOTES: '记录',
  ASSIST: '助手',
  AI: '助手',
}

export function BreadcrumbNav({ jobId, jobName, activeTab, onNavigateHome, onNavigateJobs }: BreadcrumbNavProps) {
  const tabLabel = TAB_LABELS[activeTab] || activeTab
  // DESIGN.md section 6: no internal ids in the interface. The design's own name
  // is what identifies it to the user; the cuid stays in the data layer.
  const displayName = (jobName || '').trim() || '未命名零件'

  return (
    // One line, the design's own name. The trail "AgentSCAD / Designs / <id>" was
    // three levels of navigation for a two-level product, and the active tab is
    // already shown by the tab strip directly below.
    <nav
      className="flex min-w-0 items-center h-5 shrink-0 select-none"
      aria-label="当前位置"
    >
      <span
        className="min-w-0 truncate font-mono text-[10px] tracking-[0.04em] text-[var(--shell-text-dim)]"
        title={displayName}
      >
        {displayName}
      </span>
    </nav>
  )
}