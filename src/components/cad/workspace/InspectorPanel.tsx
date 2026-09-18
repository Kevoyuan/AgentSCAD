'use client'

import * as React from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings, Shield, Activity, Clock,
  History, Plus, BoxSelect, FileCode, Sparkles,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResizablePanel } from '@/components/ui/resizable'

import { Job } from '@/components/cad/types'
import { ParameterPanel } from '@/components/cad/parameter-panel'
import { ValidationPanel } from '@/components/cad/validation-panel'
import { ScadEditor } from '@/components/cad/scad-editor'
import { JobDependencies } from '@/components/cad/job-dependencies'
import { BreadcrumbNav } from '@/components/cad/breadcrumb-nav'
import { SpecPanel } from '@/components/cad/spec-panel'
import { HistoryPanel } from '@/components/cad/history-panel'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { InspectorEmptyState } from './empty-states'

const ResearchPanel = dynamic(() => import('@/components/cad/research-panel').then(m => ({ default: m.ResearchPanel })), { ssr: false, loading: () => <div className="p-4 text-[var(--app-text-dim)] text-xs">Loading...</div> })
const ChatPanel = dynamic(() => import('@/components/cad/chat-panel').then(m => ({ default: m.ChatPanel })), { ssr: false, loading: () => <div className="p-4"><Skeleton className="h-40 w-full rounded-[6px]" /></div> })

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
  onOpenSettings,
  onOpenShortcuts,
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
  onOpenSettings?: (tab: 'providers' | 'theme') => void
  onOpenShortcuts?: () => void
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
        return <ValidationPanel job={selectedJob} onRepair={onRepair} />
      case 'ASSIST':
        return <ChatPanel key={selectedJob.id} job={selectedJob} onApplyScad={onApplyScad} />
      case 'CODE':
        return <ScadEditor job={selectedJob} onUpdate={onUpdate} onApply={onApplyScad} />
      case 'HISTORY':
        return <HistoryPanel job={selectedJob} onUpdate={onUpdate} />
      default:
        return <SpecPanel job={selectedJob} onProcess={onProcess} onRepair={onRepair} />
    }
  }

  return (
    <ResizablePanel
      id="agentscad-inspector-panel"
      ref={panelRef}
      order={3}
      defaultSize={30}
      minSize={24}
      maxSize={42}
      collapsible
      collapsedSize={0}
      onCollapse={() => onCollapseChange?.(true)}
      onExpand={() => onCollapseChange?.(false)}
      className="cad-inspector-panel min-w-0 overflow-hidden"
    >
      <PanelErrorBoundary panelName="Inspector" resetKey={`${selectedJob?.id || 'none'}_${normalizedActiveTab}`}>
        {/* The sheet's own plate is the frame (DESIGN.md section 22, one card): the
            docked panel's second border, radius, blur and inset used to stack on top
            of it, which is the nested-card pattern the mechanical scan flags. */}
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
                  jobName={selectedJob.inputRequest}
                  activeTab={normalizedActiveTab}
                  onNavigateHome={onClearSelectedJob}
                  onNavigateJobs={onClearSelectedJob}
                />
              </div>
              <TabsList className="w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden px-2 py-0 bg-transparent border-b border-[color:var(--shell-hairline)] h-8 rounded-none shrink-0 shadow-none">
                {[
                  { key: 'SPEC', label: '描述', icon: BoxSelect },
                  { key: 'CODE', label: '源码', icon: FileCode },
                  { key: 'HISTORY', label: '记录', icon: History },
                ].map(tab => (
                  <TabsTrigger
                    key={tab.key}
                    value={tab.key}
                    className="relative shrink-0 h-8 px-3 py-0 text-[12px] font-mono tracking-normal rounded-none border-b-2 border-transparent bg-transparent text-[var(--shell-text-dim)] shadow-none transition-colors hover:text-[var(--shell-text)] data-[state=active]:border-[var(--shell-signal)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--shell-text)] data-[state=active]:font-semibold data-[state=active]:shadow-none select-none cursor-pointer"
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
          ) : (
            <InspectorEmptyState
              isFirstLoadComplete={isFirstLoadComplete}
              onShowComposer={onShowComposer}
              onOpenSettings={(tab) => onOpenSettings?.(tab)}
              onOpenShortcuts={() => onOpenShortcuts?.()}
            />
          )}
        </div>
      </PanelErrorBoundary>
    </ResizablePanel>
  )
}
