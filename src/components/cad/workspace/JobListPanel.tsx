'use client'

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
  Layers, Ban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResizablePanel } from '@/components/ui/resizable'

import { Job } from '@/components/cad/types'
import { SortableJobCard, DragOverlayCard } from '@/components/cad/sortable-job-card'
import { JobContextMenu } from '@/components/cad/job-context-menu'
import { SearchFilterPanel, FilterState } from '@/components/cad/search-filter-panel'
import { SensorDescriptor } from '@dnd-kit/core'
import { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { Loader2 } from 'lucide-react'

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
  isFirstLoadComplete,
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
}) {
  return (
    <ResizablePanel id="agentscad-job-list-panel" order={1} defaultSize={18} minSize={14} maxSize={30} className="cad-left-panel">
      <div className="flex flex-col h-full bg-[var(--app-bg)]">
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
              className="overflow-hidden border-b border-[color:var(--app-border)] bg-[var(--app-batch-bar-bg)]"
            >
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-mono text-[var(--app-batch-bar-text)]">{selectedIds.size} selected</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1 text-amber-400 hover:text-amber-300" onClick={() => onBatchAction('reprocess')}>
                    <RotateCcw className="w-3.5 h-3.5" />Reprocess
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1 text-orange-400 hover:text-orange-300" onClick={() => onBatchAction('cancel')}>
                    <Ban className="w-3.5 h-3.5" />Cancel
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1 text-rose-400 hover:text-rose-300" onClick={() => onBatchAction('delete')}>
                    <Trash2 className="w-3.5 h-3.5" />Delete
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-[var(--app-text-muted)]" onClick={onClearSelection} aria-label="Clear selection">
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
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SortableContext
              items={sortedJobs.map(j => j.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="p-2 space-y-1.5">
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
                {jobs.length === 0 && !isFirstLoadComplete && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" />
                  </div>
                )}
                {jobs.length === 0 && isFirstLoadComplete && (
                  <div className="relative flex flex-col items-center justify-center px-4 py-14 text-[var(--app-text-muted)] gap-3">
                    <div className="w-14 h-14 rounded-[8px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] flex items-center justify-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <Layers className="w-6 h-6 text-[var(--app-text-dim)] opacity-50" />
                    </div>
                    <div className="text-center">
                      <p className="text-[13px] font-medium text-[var(--app-text-secondary)]">No jobs found</p>
                      <p className="text-[12px] leading-5 text-[var(--app-text-dim)] mt-1">Create a new job or adjust filters</p>
                    </div>
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
    </ResizablePanel>
  )
}
