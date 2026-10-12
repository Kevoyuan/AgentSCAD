'use client'

import { useI18n } from '@/components/i18n-provider'

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
  SPEC: "Description",
  PARAMS: "Dimensions",
  PARAMETERS: "Dimensions",
  MODEL: "Sources",
  CODE: "Code",
  SCAD: "Code",
  VALIDATION: "Checks",
  VALIDATE: "Checks",
  HISTORY: "History",
  LOG: "History",
  NOTES: "History",
  ASSIST: "Assistant",
  AI: "Assistant",
}

export function BreadcrumbNav({ jobId, jobName, activeTab, onNavigateHome, onNavigateJobs }: BreadcrumbNavProps) {
  const { t } = useI18n()

  const tabLabel = TAB_LABELS[activeTab] || activeTab
  // DESIGN.md section 6: no internal ids in the interface. The design's own name
  // is what identifies it to the user; the cuid stays in the data layer.
  const displayName = (jobName || '').trim() || t("Untitled part")

  return (
    // One line, the design's own name. The trail "AgentSCAD / Designs / <id>" was
    // three levels of navigation for a two-level product, and the active tab is
    // already shown by the tab strip directly below.
    <nav
      className="flex min-w-0 items-center h-5 shrink-0 select-none"
      aria-label={t("Current location")}
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