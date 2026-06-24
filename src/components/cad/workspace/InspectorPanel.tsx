'use client'

import * as React from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings, Shield, Activity, Clock,
  History, Plus, BoxSelect, FileCode, Loader2, Sparkles,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResizablePanel } from '@/components/ui/resizable'

import { Job } from '@/components/cad/types'
import { ParameterPanel } from '@/components/cad/parameter-panel'
import { ValidationPanel } from '@/components/cad/validation-panel'
import { ScadEditor } from '@/components/cad/scad-editor'
import { JobDependencies } from '@/components/cad/job-dependencies'
import { JobVersionHistory } from '@/components/cad/job-version-history'
import { BreadcrumbNav } from '@/components/cad/breadcrumb-nav'
import { SpecPanel } from '@/components/cad/spec-panel'

const ResearchPanel = dynamic(() => import('@/components/cad/research-panel').then(m => ({ default: m.ResearchPanel })), { ssr: false, loading: () => <div className="p-4 text-[var(--app-text-dim)] text-xs">Loading...</div> })
const TimelinePanel = dynamic(() => import('@/components/cad/timeline-panel').then(m => ({ default: m.TimelinePanel })), { ssr: false, loading: () => <div className="p-4 text-[var(--app-text-dim)] text-xs">Loading...</div> })
const NotesPanel = dynamic(() => import('@/components/cad/notes-panel').then(m => ({ default: m.NotesPanel })), { ssr: false, loading: () => <div className="p-4 text-[var(--app-text-dim)] text-xs">Loading...</div> })
const ChatPanel = dynamic(() => import('@/components/cad/chat-panel').then(m => ({ default: m.ChatPanel })), { ssr: false, loading: () => <div className="flex items-center justify-center h-full"><div className="w-5 h-5 animate-spin text-[var(--app-text-muted)]">Loading...</div></div> })

export function InspectorPanel({
  selectedJob,
  allJobs,
  activeTab,
  tabDirection,
  onSetActiveTab,
  onSetPrevTab,
  onSetTabDirection,
  onUpdate,
  onPreviewParameters,
  onApplyScad,
  onProcess,
  onRepair,
  onNavigateToJob,
  onClearSelectedJob,
  onShowComposer,
  isFirstLoadComplete,
  panelRef,
  onCollapseChange,
}: {
  selectedJob: Job | null
  allJobs: Job[]
  activeTab: string
  tabDirection: number
  panelRef?: React.RefObject<ImperativePanelHandle | null>
  onCollapseChange?: (collapsed: boolean) => void
  onSetActiveTab: (tab: string) => void
  onSetPrevTab: (tab: string) => void
  onSetTabDirection: (dir: number) => void
  onUpdate: () => void
  onPreviewParameters: (job: Job, parameterValues: Record<string, number>) => void
  onApplyScad: (job: Job, scadSource: string) => Promise<void>
  onProcess: (job: Job) => void
  onRepair: (job: Job) => void
  onNavigateToJob: (jobId: string) => void
  onClearSelectedJob: () => void
  onShowComposer: () => void
  isFirstLoadComplete: boolean
}) {
  const normalizeTab = (tab: string) => ({
    PARAMS: 'PARAMETERS',
    RESEARCH: 'MODEL',
    DEPS: 'MODEL',
    SCAD: 'CODE',
    AI: 'ASSIST',
    VALIDATE: 'VALIDATION',
    LOG: 'HISTORY',
    NOTES: 'HISTORY',
  }[tab] || tab)

  const normalizedActiveTab = normalizeTab(activeTab)

  const renderActiveTab = () => {
    if (!selectedJob) return null

    switch (normalizedActiveTab) {
      case 'SPEC':
        return <SpecPanel job={selectedJob} onProcess={onProcess} onRepair={onRepair} />
      case 'PARAMETERS':
        return (
          <ParameterPanel
            job={selectedJob}
            onUpdate={onUpdate}
            onPreviewUpdate={(parameterValues) => onPreviewParameters(selectedJob, parameterValues)}
          />
        )
      case 'MODEL':
        return (
          <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(180px,0.55fr)]">
            <div className="min-h-0 min-w-0 overflow-hidden">
              <ResearchPanel job={selectedJob} />
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden border-t border-[color:var(--app-border)]">
              <JobDependencies job={selectedJob} allJobs={allJobs} onUpdate={onUpdate} onNavigateToJob={onNavigateToJob} />
            </div>
          </div>
        )
      case 'VALIDATION':
        return <ValidationPanel job={selectedJob} />
      case 'ASSIST':
        return <ChatPanel key={selectedJob.id} job={selectedJob} onApplyScad={onApplyScad} />
      case 'CODE':
        return <ScadEditor job={selectedJob} onUpdate={onUpdate} onApply={onApplyScad} />
      case 'HISTORY':
        return (
          <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(160px,0.55fr)_minmax(140px,0.5fr)]">
            <div className="min-h-0 min-w-0 overflow-hidden">
              <JobVersionHistory key={selectedJob.id} job={selectedJob} />
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden border-t border-[color:var(--app-border)]">
              <TimelinePanel job={selectedJob} />
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden border-t border-[color:var(--app-border)]">
              <NotesPanel job={selectedJob} onUpdate={onUpdate} />
            </div>
          </div>
        )
      default:
        return <SpecPanel job={selectedJob} onProcess={onProcess} onRepair={onRepair} />
    }
  }

  return (
    <ResizablePanel id="agentscad-inspector-panel" order={3} defaultSize={30} minSize={24} maxSize={42} className="cad-inspector-panel min-w-0">
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--app-surface)]">
        {selectedJob ? (
          <Tabs value={normalizedActiveTab} onValueChange={(v) => {
            const tabOrder = ['SPEC', 'PARAMETERS', 'ASSIST', 'VALIDATION', 'HISTORY', 'CODE']
            const newIdx = tabOrder.indexOf(v)
            const oldIdx = tabOrder.indexOf(normalizedActiveTab)
            onSetTabDirection(newIdx > oldIdx ? 1 : -1)
            onSetPrevTab(normalizedActiveTab)
            onSetActiveTab(v)
          }} className="flex h-full min-h-0 min-w-0 flex-col">
            {/* Inspector Breadcrumb */}
            <div className="min-w-0 shrink-0 px-3 py-1 breadcrumb-fade-in">
              <BreadcrumbNav
                jobId={selectedJob.id}
                activeTab={normalizedActiveTab}
                onNavigateHome={onClearSelectedJob}
                onNavigateJobs={onClearSelectedJob}
              />
            </div>
            {/* Gradient separator between breadcrumb and tabs */}
            <div className="gradient-separator" />
            <TabsList className="cad-inspector-tabs w-full justify-start overflow-x-auto overflow-y-hidden px-2 py-1 bg-transparent border-b border-[color:var(--app-border)] h-auto rounded-none shrink-0">
              {[
                { key: 'SPEC', label: 'SPEC', icon: BoxSelect },
                { key: 'PARAMETERS', label: 'PARAMS', icon: Settings },
                { key: 'ASSIST', label: 'ASSIST', icon: Sparkles },
                { key: 'VALIDATION', label: 'VALID', icon: Shield },
                { key: 'HISTORY', label: 'HISTORY', icon: History },
                { key: 'CODE', label: 'CODE', icon: FileCode },
              ].map(tab => (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  className="tab-indicator shrink-0 text-xs font-mono tracking-wider px-2.5 py-1.5 data-[state=active]:bg-[var(--app-accent-bg)] data-[state=active]:text-[var(--app-accent-text)] data-[state=active]:tab-active-glow rounded-sm h-auto min-h-0 transition-all duration-150"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" custom={tabDirection}>
                <motion.div
                  key={normalizedActiveTab}
                  custom={tabDirection}
                  initial={{ opacity: 0, x: tabDirection * 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: tabDirection * -20 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className={`h-full min-h-0 min-w-0 ${tabDirection > 0 ? 'slide-in-right' : 'slide-in-left'}`}
                >
                  {renderActiveTab()}
                </motion.div>
              </AnimatePresence>
            </div>
          </Tabs>
        ) : !isFirstLoadComplete ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" />
          </div>
        ) : (
          <div className="relative flex flex-col items-center justify-center h-full text-[var(--app-text-muted)] gap-3 p-6">
            {/* Enhanced empty state with SVG illustration */}
            <div className="w-12 h-12 border border-dashed border-[var(--cad-border-strong)] rounded flex items-center justify-center opacity-40">
              <BoxSelect className="w-6 h-6 text-[var(--cad-text-muted)]" />
            </div>
            <div className="text-center mt-2">
              <p className="text-sm font-medium text-[var(--app-text-muted)]">Inspector Panel</p>
              <p className="text-[13px] text-[var(--app-text-dim)] mt-1 max-w-[200px]">Select a job from the list to view parameters, code, and pipeline details</p>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-[13px] gap-1 mt-2 border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)] hover:border-[color:var(--app-border-strong)]" onClick={onShowComposer}>
              <Plus className="w-3.5 h-3.5" />Create a Job to Begin
            </Button>
          </div>
        )}
      </div>
    </ResizablePanel>
  )
}
