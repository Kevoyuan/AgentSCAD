'use client'

import * as React from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DndContext, closestCenter,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  Trash2, RotateCcw, X,
  Ban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResizablePanel } from '@/components/ui/resizable'

import { Job } from '@/components/cad/types'
import { SortableJobCard, DragOverlayCard } from '@/components/cad/sortable-job-card'
import { JobContextMenu } from '@/components/cad/job-context-menu'
import { SearchFilterPanel, FilterState, DEFAULT_FILTER_STATE } from '@/components/cad/search-filter-panel'
import { SensorDescriptor } from '@dnd-kit/core'
import { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { JobListEmptyState } from './empty-states'

export function JobListPanel({
  jobs,
  sortedJobs,
  allJobs,
  selectedJob,
  selectedIds,
  filterState,
  stateCounts,
  activeDragId,
  sensors,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onSelectJob,
  onToggleSelect,
  onProcess,
  onCancel,
  onDuplicate,
  onDelete,
  onLinkParent,
  onBatchAction,
  onClearSelection,
  onFilterChange,
  onSetActiveTab,
  onShowComposer,
  onResetFilters,
  isFirstLoadComplete,
  panelRef,
  onCollapseChange,
}: {
  jobs: Job[]
  isFirstLoadComplete: boolean
  sortedJobs: Job[]
  allJobs: Job[]
  selectedJob: Job | null
  selectedIds: Set<string>
  filterState: FilterState
  stateCounts: Record<string, number>
  activeDragId: string | null
  sensors: SensorDescriptor<Record<string, unknown>>[]
  panelRef?: React.RefObject<ImperativePanelHandle | null>
  onCollapseChange?: (collapsed: boolean) => void
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
  onSelectJob: (job: Job) => void
  onToggleSelect: (id: string) => void
  onProcess: (job: Job) => void
  onCancel: (job: Job) => void
  onDuplicate: (job: Job) => void
  onDelete: (id: string) => void
  onLinkParent: (job: Job) => void
  onBatchAction: (action: 'delete' | 'cancel' | 'reprocess') => void
  onClearSelection: () => void
  onFilterChange: (filters: FilterState) => void
  onSetActiveTab: (tab: string) => void
  onShowComposer?: (presetText?: string) => void
  onResetFilters?: () => void
}) {
  const hasActiveFilters = Boolean(
    filterState.search.trim().length > 0 ||
    (filterState.states && filterState.states.length > 0) ||
    filterState.dateRange !== 'all' ||
    Boolean(filterState.partFamily)
  )

  return (
    <ResizablePanel
      id="agentscad-job-list-panel"
      ref={panelRef}
      order={1}
      defaultSize={18}
      minSize={14}
      maxSize={30}
      collapsible
      collapsedSize={0}
      onCollapse={() => onCollapseChange?.(true)}
      onExpand={() => onCollapseChange?.(false)}
      className="cad-left-panel min-w-0 overflow-hidden"
    >
      <PanelErrorBoundary panelName="Job List" resetKey={selectedJob?.id}>
        <div className="flex flex-col h-[calc(100%-16px)] m-2 rounded-2xl border border-white/[0.08] shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl bg-[var(--app-surface)]/90 min-w-0 overflow-hidden">
          {/* Search & Filter Panel */}
          <SearchFilterPanel
            filters={filterState}
            onFiltersChange={onFilterChange}
            allJobs={allJobs}
            stateCounts={stateCounts}
          />

          {/* Batch Action Bar */}
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-b border-[color:var(--app-border)] bg-[var(--app-batch-bar-bg)] shrink-0"
              >
                <div className="flex items-center justify-between px-3 py-1.5 gap-1 min-w-0">
                  <span className="text-xs font-mono text-[var(--app-batch-bar-text)] shrink-0">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex items-center gap-1 min-w-0 flex-wrap justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 gap-1 text-[var(--app-accent-text)] hover:bg-[var(--app-accent-bg)] shrink-0"
                      onClick={() => onBatchAction('reprocess')}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">Rebuild</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 gap-1 text-orange-400 hover:text-orange-300 shrink-0"
                      onClick={() => onBatchAction('cancel')}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">Cancel</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 gap-1 text-rose-400 hover:text-rose-300 shrink-0"
                      onClick={() => onBatchAction('delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">Delete</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 text-[var(--app-text-muted)] shrink-0"
                      onClick={onClearSelection}
                      aria-label="Clear selection"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Jobs List with Drag & Drop */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div className="flex-1 min-h-0 overflow-y-auto min-w-0">
              <SortableContext
                items={sortedJobs.map(j => j.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="min-w-0 divide-y divide-[color:var(--app-border-subtle)]">
                  {sortedJobs.map(job => (
                    <JobContextMenu
                      key={job.id}
                      job={job}
                      onProcess={onProcess}
                      onDuplicate={onDuplicate}
                      onCancel={onCancel}
                      onDelete={onDelete}
                      onLinkParent={onLinkParent}
                    >
                      <SortableJobCard
                        job={job}
                        isSelected={selectedJob?.id === job.id}
                        isChecked={selectedIds.has(job.id)}
                        onSelect={(j) => { onSelectJob(j); onSetActiveTab('SPEC') }}
                        onToggleSelect={onToggleSelect}
                        onProcess={onProcess}
                        onCancel={onCancel}
                        onDuplicate={onDuplicate}
                        onDelete={onDelete}
                      />
                    </JobContextMenu>
                  ))}
                  {jobs.length === 0 && (
                    <div className="p-3">
                      <JobListEmptyState
                        isFirstLoadComplete={isFirstLoadComplete}
                        totalJobsCount={allJobs.length}
                        hasActiveFilters={hasActiveFilters}
                        onResetFilters={() => {
                          if (onResetFilters) {
                            onResetFilters()
                          } else {
                            onFilterChange({ ...DEFAULT_FILTER_STATE })
                          }
                        }}
                        onShowComposer={(preset) => {
                          onShowComposer?.(preset)
                        }}
                      />
                    </div>
                  )}
                </div>
              </SortableContext>
            </div>
            <DragOverlay>
              {activeDragId ? (
                <DragOverlayCard job={sortedJobs.find(j => j.id === activeDragId)!} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </PanelErrorBoundary>
    </ResizablePanel>
  )
}
