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
  onOpenStats,
  onOpenCompare,
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
  /* DESIGN.md "Secondary surfaces": statistics and comparison have no permanent
     entry point. They appear here, contextually, once several designs are selected. */
  onOpenStats?: () => void
  onOpenCompare?: () => void
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

          {/* Batch action bar. Appears only in an explicit multi-select mode.
              DESIGN.md section 6: selection must not compete with the open design,
              so this is a quiet ruled strip, not a coloured toolbar. */}
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-b border-[color:var(--shell-border)] bg-[var(--shell-well)] shrink-0"
                data-testid="slots-batch-bar"
              >
                {/* The count is an anchor on the left; the actions wrap beside it
                    rather than pushing it onto a line of its own. */}
                <div className="flex items-start gap-2 px-2.5 py-1.5 min-w-0">
                  <span className="shrink-0 pt-[3px] font-mono text-[10.5px] leading-none text-[var(--shell-text-muted)]">
                    已选 {selectedIds.size}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-0.5">
                    {/* >= 2 designs: these two are the only read-only actions here */}
                    {selectedIds.size >= 2 && onOpenCompare && (
                      <button
                        type="button"
                        onClick={onOpenCompare}
                        className="h-6 px-2 rounded-[4px] font-mono text-[10.5px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] transition-colors shrink-0"
                      >
                        对比
                      </button>
                    )}
                    {selectedIds.size >= 2 && onOpenStats && (
                      <button
                        type="button"
                        onClick={onOpenStats}
                        className="h-6 px-2 rounded-[4px] font-mono text-[10.5px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] transition-colors shrink-0"
                      >
                        统计
                      </button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 gap-1 rounded-[4px] font-mono text-[10.5px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] shrink-0"
                      onClick={() => onBatchAction('reprocess')}
                    >
                      <RotateCcw className="w-3 h-3" />
                      重建
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 gap-1 rounded-[4px] font-mono text-[10.5px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] shrink-0"
                      onClick={() => onBatchAction('cancel')}
                    >
                      <Ban className="w-3 h-3" />
                      取消
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 gap-1 rounded-[4px] font-mono text-[10.5px] text-[var(--shell-fail)] hover:bg-[var(--shell-fail)]/12 shrink-0"
                      onClick={() => onBatchAction('delete')}
                    >
                      <Trash2 className="w-3 h-3" />
                      删除
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 rounded-[4px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] shrink-0"
                      onClick={onClearSelection}
                      aria-label="清除选择"
                    >
                      <X className="w-3 h-3" />
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
                <div className="min-w-0">
                  {/* Each row is a keyboard-selectable option (DESIGN.md section 21);
                      the empty state stays outside the listbox. */}
                  <div
                    role="listbox"
                    aria-label="零件槽位"
                    className="min-w-0 divide-y divide-[color:var(--app-border-subtle)]"
                  >
                    {sortedJobs.map((job, i) => (
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
                          index={i + 1}
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
                  </div>
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
