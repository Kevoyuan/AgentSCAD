'use client'

import { useState } from 'react'
import {
  Box, Play, Settings,
  Loader2,
  Plus, ArrowUpDown, Keyboard,
  BarChart3, GitCompare, Palette,
  Sun, Moon, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  ResizableHandle, ResizablePanelGroup,
} from '@/components/ui/resizable'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { PipelineVisualization } from '@/components/cad/pipeline-visualization'
import dynamic from 'next/dynamic'
import { Footer } from '@/components/cad/footer'
import type { CommandAction } from '@/components/cad/command-palette'

const NotificationCenter = dynamic(() => import('@/components/cad/notification-center').then(m => ({ default: m.NotificationCenter })), { ssr: false })
const CommandPalette = dynamic(() => import('@/components/cad/command-palette').then(m => ({ default: m.CommandPalette })), { ssr: false })
const ThemePanel = dynamic(() => import('@/components/cad/theme-panel').then(m => ({ default: m.ThemePanel })), { ssr: false })
const ProviderSettingsPanel = dynamic(() => import('@/components/cad/provider-settings-panel').then(m => ({ default: m.ProviderSettingsPanel })), { ssr: false })

const StatsDashboard = dynamic(() => import('@/components/cad/stats-dashboard').then(m => ({ default: m.StatsDashboard })), { ssr: false, loading: () => <div className="flex items-center justify-center h-96"><Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" /></div> })
const JobCompare = dynamic(() => import('@/components/cad/job-compare').then(m => ({ default: m.JobCompare })), { ssr: false, loading: () => <div className="flex items-center justify-center h-96"><Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" /></div> })

import { useWorkspaceState } from './useWorkspaceState'
import { JobListPanel } from './JobListPanel'
import { ViewerPanel } from './ViewerPanel'
import { InspectorPanel } from './InspectorPanel'
const JobComposer = dynamic(() => import('./JobComposer').then(m => ({ default: m.JobComposer })), { ssr: false })
import { KeyboardShortcuts } from './KeyboardShortcuts'

export function MainWorkspace() {
  const state = useWorkspaceState()
  const [settingsTab, setSettingsTab] = useState<'providers' | 'theme'>('providers')

  // Command Palette Actions
  const commandPaletteActions: CommandAction[] = [
    {
      id: 'create-job',
      label: 'Create New Job',
      icon: <Plus className="w-4 h-4 text-emerald-400" />,
      shortcut: '⌘N',
      onSelect: () => state.setShowComposer(true),
      category: 'action' as const,
    },
    {
      id: 'toggle-theme',
      label: 'Toggle Theme',
      icon: <Palette className="w-4 h-4 text-[var(--app-accent-text)]" />,
      shortcut: 'T',
      onSelect: () => {
        setSettingsTab('theme')
        state.setShowSettings(true)
      },
      category: 'action' as const,
    },
    {
      id: 'show-stats',
      label: 'Show Statistics',
      icon: <BarChart3 className="w-4 h-4 text-cyan-400" />,
      shortcut: '',
      onSelect: () => state.setShowStats(true),
      category: 'action' as const,
    },
    {
      id: 'show-compare',
      label: 'Compare Jobs',
      icon: <GitCompare className="w-4 h-4 text-amber-400" />,
      shortcut: '',
      onSelect: () => state.setShowCompare(true),
      category: 'action' as const,
    },
    {
      id: 'export-data',
      label: 'Export All Data',
      icon: <Box className="w-4 h-4 text-[var(--app-text-muted)]" />,
      shortcut: '',
      onSelect: () => state.exportAllData(),
      category: 'action' as const,
    },
  ]

  const handleCloseAll = () => {
    state.setShowCommandPalette(false)
    state.setShowComposer(false)
    state.setShowShortcuts(false)
    state.setShowStats(false)
    state.setShowCompare(false)
    state.setShowSettings(false)
  }

  const handleNavigateToJob = (jobId: string) => {
    const found = state.allJobs.find(j => j.id === jobId)
    if (found) {
      state.setSelectedJob(found)
      state.setActiveTab('SPEC')
    }
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--app-bg)] text-[var(--app-text-primary)] overflow-hidden">
      <KeyboardShortcuts
        selectedJob={state.selectedJob}
        showComposer={state.showComposer}
        onShowComposer={state.setShowComposer}
        onShowCommandPalette={state.setShowCommandPalette}
        onShowShortcuts={state.setShowShortcuts}
        onShowStats={state.setShowStats}
        onShowCompare={state.setShowCompare}
        onShowSettings={state.setShowSettings}
        onCloseAll={handleCloseAll}
        onSetActiveTab={state.setActiveTab}
        onDelete={state.handleDelete}
        onProcess={state.handleProcess}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)] bg-[var(--app-surface)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[var(--cad-accent)] flex items-center justify-center shadow-[0_0_12px_var(--cad-accent-soft)]">
              <Box className="w-3 h-3 text-white" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight text-[var(--app-text-primary)]">
              AgentSCAD
            </h1>
          </div>
          <Separator orientation="vertical" className="h-4 bg-[var(--app-border)]" />
          <PipelineVisualization
            state={state.selectedJob?.state || 'NEW'}
            job={state.selectedJob || undefined}
            onStepClick={(stepKey, tabName) => {
              if (state.selectedJob) state.setActiveTab(tabName)
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]" onClick={() => state.setShowStats(true)} aria-label="Stats Dashboard">
                  <BarChart3 className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Stats Dashboard (S)</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]" onClick={() => state.setShowCompare(true)} aria-label="Compare Jobs">
                  <GitCompare className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Compare Jobs</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <NotificationCenter
            notifications={state.notifications}
            activityEvents={state.activityEvents}
            onMarkRead={state.markNotificationRead}
            onMarkAllRead={state.markAllNotificationsRead}
            onClearAll={state.clearAllNotifications}
            onClearActivity={state.clearActivityEvents}
            onActivityClick={(event) => {
              const found = state.allJobs.find(j => j.id.slice(0, 8) === event.jobId)
              if (found) {
                state.setSelectedJob(found)
                state.setActiveTab('SPEC')
              }
            }}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]" onClick={() => {
                  const next = (state.mounted && state.resolvedTheme === 'dark') ? 'light' : 'dark'
                  state.setTheme(next)
                }} aria-label="Toggle theme">
                  {!state.mounted ? <div className="w-3.5 h-3.5" aria-hidden="true" /> : state.resolvedTheme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Toggle {!state.mounted ? 'Theme' : state.resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]" onClick={() => {
                  setSettingsTab('theme')
                  state.setShowSettings(true)
                }} aria-label="Theme & Settings">
                  <Settings className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Theme & Settings</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]" onClick={() => state.setShowShortcuts(true)} aria-label="Keyboard Shortcuts">
                  <Keyboard className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Shortcuts (?)</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button size="sm" className="h-7 text-[13px] gap-1 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] linear-transition px-3" onClick={() => state.setShowComposer(true)}>
            <Plus className="w-3.5 h-3.5" />New Job
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <ResizablePanelGroup id="agentscad-workspace-panels" direction="horizontal">
          <JobListPanel
            jobs={state.jobs}
            sortedJobs={state.sortedJobsForDnd}
            allJobs={state.allJobs}
            selectedJob={state.selectedJob}
            selectedIds={state.selectedIds}
            filterState={state.filterState}
            stateCounts={state.stateCounts}
            activeDragId={state.activeDragId}
            sensors={state.sensors}
            isFirstLoadComplete={state.isFirstLoadComplete}
            onDragStart={state.handleDragStart}
            onDragEnd={state.handleDragEnd}
            onDragCancel={state.handleDragCancel}
            onSelectJob={(job) => { state.selectJob(job, 'SPEC') }}
            onToggleSelect={state.toggleSelect}
            onProcess={state.handleProcess}
            onCancel={(j) => state.setCancelTarget(j)}
            onDuplicate={state.handleDuplicate}
            onDelete={state.handleDelete}
            onLinkParent={state.handleLinkParent}
            onBatchAction={state.handleBatchAction}
            onFilterChange={state.handleFilterChange}
            onSetActiveTab={state.setActiveTab}
          />

          <ResizableHandle id="agentscad-left-viewer-resize" withHandle />

          <ViewerPanel
            selectedJob={state.selectedJob}
            isProcessing={state.isProcessing}
            processingJobId={state.processingJobId}
            pipelineEvents={state.pipelineEvents}
            onProcess={state.handleProcess}
            onCancel={(j) => state.setCancelTarget(j)}
            onDelete={state.handleDelete}
            onDownloadScad={state.downloadScad}
            onView3D={state.handleQuickView3D}
            onViewLog={state.handleQuickViewLog}
            onShare={state.handleQuickShare}
            onRepair={state.handleRepair}
            onVisualRepair={state.handleVisualRepair}
            onSetActiveTab={state.setActiveTab}
            onShowComposer={() => state.setShowComposer(true)}
            isFirstLoadComplete={state.isFirstLoadComplete}
          />

          <ResizableHandle id="agentscad-viewer-inspector-resize" withHandle />

          <InspectorPanel
            selectedJob={state.selectedJob}
            allJobs={state.allJobs}
            activeTab={state.activeTab}
            tabDirection={state.tabDirection}
            onSetActiveTab={state.setActiveTab}
            onSetPrevTab={state.setPrevTab}
            onSetTabDirection={state.setTabDirection}
            onUpdate={state.loadJobs}
            onPreviewParameters={(job, parameterValues) => {
              const previewJob = {
                ...job,
                parameterValues: JSON.stringify(parameterValues),
              }
              state.setSelectedJob(previewJob)
            }}
            onApplyScad={state.handleApplyScad}
            onProcess={state.handleProcess}
            onRepair={state.handleRepair}
            onNavigateToJob={handleNavigateToJob}
            onClearSelectedJob={() => state.setSelectedJob(null)}
            onShowComposer={() => state.setShowComposer(true)}
            isFirstLoadComplete={state.isFirstLoadComplete}
          />
        </ResizablePanelGroup>
      </main>

      {/* Footer */}
      <Footer
        jobs={state.allJobs}
        jobCount={state.allJobs.length}
        jobCountFlash={state.jobCountFlash}
        deliveredCount={state.stateCounts['DELIVERED'] || 0}
        failedCount={(state.stateCounts['VALIDATION_FAILED'] || 0) + (state.stateCounts['GEOMETRY_FAILED'] || 0) + (state.stateCounts['RENDER_FAILED'] || 0)}
        successRate={state.successRate}
        onExport={state.exportAllData}
      />

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}

      <JobComposer
        showComposer={state.showComposer}
        newJobText={state.newJobText}
        newJobModelId={state.newJobModelId}
        newJobTags={state.newJobTags}
        isCreating={state.isCreating}
        isAiEnhancing={state.isAiEnhancing}
        recentRequests={state.recentRequests}
        onShowComposerChange={state.setShowComposer}
        onNewJobTextChange={state.setNewJobText}
        onNewJobModelIdChange={state.setNewJobModelId}
        onNewJobTagsChange={state.setNewJobTags}
        onCreate={state.handleCreate}
        onAiEnhance={state.handleAiEnhance}
        onAddProvider={() => {
          setSettingsTab('providers')
          state.setShowSettings(true)
        }}
      />

      {/* Cancel Confirmation */}
      <AlertDialog open={!!state.cancelTarget} onOpenChange={() => state.setCancelTarget(null)}>
        <AlertDialogContent className="bg-[var(--app-dialog-bg)] border border-[color:var(--app-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.4)] rounded-xl dialog-enter">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Cancel Job?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-[var(--app-text-muted)]">
              This will cancel job &quot;{state.cancelTarget?.inputRequest?.slice(0, 60)}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[var(--app-surface-raised)] border-[color:var(--app-border)] text-[var(--app-text-muted)] text-xs">Keep Running</AlertDialogCancel>
            <AlertDialogAction className="bg-orange-600 hover:bg-orange-500 text-xs" onClick={() => state.cancelTarget && state.handleCancel(state.cancelTarget)}>
              Cancel Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={state.showShortcuts} onOpenChange={state.setShowShortcuts}>
        <DialogContent className="bg-[var(--app-dialog-bg)] border border-[color:var(--app-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.4)] rounded-xl max-w-md dialog-enter" aria-describedby="shortcuts-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-[var(--app-accent-text)]" />Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription id="shortcuts-description" className="sr-only">
              Keyboard shortcuts for navigating and controlling AgentSCAD
            </DialogDescription>
          </DialogHeader>
          <div className="gradient-divider" />
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
            {/* Navigation */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpDown className="w-3.5 h-3.5 text-[var(--app-accent-text)]" />
                <span className="text-[13px] font-mono tracking-widest text-[var(--app-accent-text)] uppercase">Navigation</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { keys: ['?', ''], desc: 'Toggle shortcuts' },
                  { keys: ['1', '-', '6'], desc: 'Switch inspector tab' },
                  { keys: ['E', ''], desc: 'Edit SCAD code' },
                  { keys: ['H', ''], desc: 'Show history (LOG)' },
                  { keys: ['S', ''], desc: 'Open stats dashboard' },
                  { keys: ['T', ''], desc: 'Open theme settings' },
                ].map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--app-text-muted)]">{s.desc}</span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((k, i) => k ? <span key={i} className="keyboard-key">{k}</span> : <span key={i} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Job Actions */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[13px] font-mono tracking-widest text-emerald-400 uppercase">Job Actions</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { keys: ['⌘', 'N'], desc: 'New job' },
                  { keys: ['⌘', '⇧', 'N'], desc: 'New job (focus input)' },
                  { keys: ['Space'], desc: 'Process selected' },
                  { keys: ['Del'], desc: 'Delete selected' },
                ].map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--app-text-muted)]">{s.desc}</span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((k, i) => <span key={i} className="keyboard-key">{k}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Inspector */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[13px] font-mono tracking-widest text-amber-400 uppercase">Inspector Tabs</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { key: '1', tab: 'SPEC' },
                  { key: '2', tab: 'PARAMS' },
                  { key: '3', tab: 'ASSIST' },
                  { key: '4', tab: 'VALID' },
                  { key: '5', tab: 'HISTORY' },
                  { key: '6', tab: 'CODE' },
                ].map((s) => (
                  <div key={s.tab} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--app-text-muted)] font-mono">{s.tab}</span>
                    <span className="keyboard-key">{s.key}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* General */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[13px] font-mono tracking-widest text-cyan-400 uppercase">General</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { keys: ['Esc'], desc: 'Close dialog' },
                  { keys: ['?'], desc: 'Toggle this panel' },
                ].map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--app-text-muted)]">{s.desc}</span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((k, i) => <span key={i} className="keyboard-key">{k}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats Dashboard */}
      <Dialog open={state.showStats} onOpenChange={state.setShowStats}>
        <DialogContent className="bg-[var(--app-dialog-bg)] border border-[color:var(--app-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.4)] rounded-xl max-w-2xl dialog-enter" aria-describedby="stats-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[var(--app-accent-text)]" />Stats Dashboard
            </DialogTitle>
            <DialogDescription id="stats-description" className="sr-only">
              Statistics and metrics for all CAD jobs
            </DialogDescription>
          </DialogHeader>
          <StatsDashboard jobs={state.allJobs} />
        </DialogContent>
      </Dialog>

      {/* Job Compare */}
      <Dialog open={state.showCompare} onOpenChange={state.setShowCompare}>
        <DialogContent className="bg-[var(--app-dialog-bg)] border border-[color:var(--app-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.4)] rounded-xl max-w-4xl max-h-[80vh] dialog-enter" aria-describedby="compare-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-[var(--app-accent-text)]" />Compare Jobs
            </DialogTitle>
            <DialogDescription id="compare-description" className="sr-only">
              Side-by-side comparison of selected CAD jobs
            </DialogDescription>
          </DialogHeader>
          <JobCompare jobs={state.allJobs} />
        </DialogContent>
      </Dialog>

      {/* Theme & Settings */}
      <Dialog open={state.showSettings} onOpenChange={state.setShowSettings}>
        <DialogContent className="bg-[var(--app-dialog-bg)] border border-[color:var(--app-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.4)] rounded-xl flex h-[min(760px,calc(100vh-3rem))] w-[min(42rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden dialog-enter" aria-describedby="settings-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Settings className="w-4 h-4 text-[var(--app-accent-text)]" />Settings
            </DialogTitle>
            <DialogDescription id="settings-description" className="sr-only">
              Theme customization, providers, and application settings
            </DialogDescription>
          </DialogHeader>
          <div className="gradient-divider" />
          <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as 'providers' | 'theme')} className="min-h-0 flex-1">
            <TabsList className="grid w-full grid-cols-2 bg-[var(--app-bg)] border border-[color:var(--app-border)]">
              <TabsTrigger value="providers" className="text-xs">Providers</TabsTrigger>
              <TabsTrigger value="theme" className="text-xs">Theme</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--app-scrollbar-thumb) transparent' }}>
              <TabsContent value="providers" forceMount className="mt-3 data-[state=inactive]:hidden">
                <ProviderSettingsPanel />
              </TabsContent>
              <TabsContent value="theme" forceMount className="mt-3 data-[state=inactive]:hidden">
                <ThemePanel />
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Command Palette */}
      <CommandPalette
        open={state.showCommandPalette}
        onOpenChange={state.setShowCommandPalette}
        jobs={state.allJobs}
        onSelectJob={(job) => { state.selectJob(job, 'SPEC') }}
        actions={commandPaletteActions}
      />
    </div>
  )
}
