'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'

import { Job, CANCELABLE_STATES } from '@/components/cad/types'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { CadViewportEmptyState } from './empty-states'

const ThreeDViewer = dynamic(() => import('@/components/cad/three-d-viewer').then(m => ({ default: m.ThreeDViewer })), { ssr: false, loading: () => <div className="flex items-center justify-center h-full p-4"><Skeleton className="h-full w-full rounded-[6px]" /></div> })

export function ViewerPanel({
  viewCommand,
  onViewChange,
  selectedJob,
  isProcessing,
  processingJobId,
  pipelineEvents,
  onProcess,
  onResolveIntent,
  onCancel,
  onDelete,
  onDownloadScad,
  onDownloadStl,
  isDownloadingStl,
  onView3D,
  onViewLog,
  onShare,
  onRepair,
  onVisualRepair,
  onSetActiveTab,
  onShowComposer,
  isFirstLoadComplete,
}: {
  viewCommand?: import('@/components/cad/three-d-viewer').ViewCommand | null
  onViewChange?: (camera: { azimuth: number; elevation: number }) => void
  selectedJob: Job | null
  isProcessing: boolean
  processingJobId: string | null
  pipelineEvents: Array<{ step: string; state: string; message: string; timestamp: string }>
  onProcess: (job: Job) => void
  onResolveIntent: (job: Job, selectedInterpretationId: string) => Promise<void>
  onCancel: (job: Job) => void
  onDelete: (id: string) => void
  onDownloadScad: (job: Job) => void
  onDownloadStl?: (job: Job) => void
  isDownloadingStl?: boolean
  onView3D: () => void
  onViewLog: (job: Job) => void
  onShare: (job: Job) => void
  onRepair: (job: Job) => void
  onVisualRepair: (job: Job) => void
  onSetActiveTab: (tab: string) => void
  onShowComposer: (presetText?: string) => void
  isFirstLoadComplete: boolean
}) {
  const [internalDownloadingStl, setInternalDownloadingStl] = useState(false)

  const handleDownloadStl = useCallback(async (job: Job) => {
    if (onDownloadStl) {
      onDownloadStl(job)
      return
    }
    if (!job.stlPath) {
      toast.error('STL file has not been generated for this job. Please rebuild.')
      return
    }
    if (internalDownloadingStl) return

    setInternalDownloadingStl(true)
    const toastId = `stl-download-${job.id}`
    toast.loading('Fetching binary STL artifact...', { id: toastId })

    try {
      const res = await fetch(`/api/jobs/${job.id}/artifacts/stl`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!res.ok) {
        let errorMsg = 'Failed to download STL artifact'
        try {
          const data = await res.json()
          if (typeof data?.error === 'string' && data.error.trim()) errorMsg = data.error
        } catch {}
        throw new Error(errorMsg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safePart = (job.partFamily || 'part').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
      const filename = `${job.id.slice(0, 8)}-${safePart}.stl`
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('STL model downloaded', { id: toastId, description: filename })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed', { id: toastId })
    } finally {
      setInternalDownloadingStl(false)
    }
  }, [onDownloadStl, internalDownloadingStl])

  const downloading = isDownloadingStl !== undefined ? isDownloadingStl : internalDownloadingStl

  const getDimensionSummary = (job: Job) => {
    try {
      const values = JSON.parse(job.parameterValues || '{}') as Record<string, number>
      const width = values.width ?? values.outerWidth ?? values.diameter
      const depth = values.depth ?? values.outerDepth ?? values.length
      const height = values.height ?? values.outerHeight ?? values.thickness
      const dimensions = [width, depth, height].filter(v => typeof v === 'number')
      return dimensions.length ? `${dimensions.join(' x ')} mm` : ''
    } catch {
      return ''
    }
  }
  const isSelectedProcessing = Boolean(selectedJob && isProcessing && processingJobId === selectedJob.id)

  return (
    // The viewer is no longer a resizable panel (DESIGN.md section 3: the canvas is
    // the application). `cad-viewer-panel` stays as the styling/test hook.
    <div className="cad-viewer-panel min-w-0 overflow-hidden w-full h-full">
      <PanelErrorBoundary panelName="3D Viewport" resetKey={selectedJob?.id}>
        <div className="w-full h-full min-w-0 overflow-hidden relative">
          {selectedJob ? (
          <>
            {/* Center Content: Conditional based on job state.
                DESIGN.md sections 3 and 7: the canvas is the application, and during
                a run "the previous geometry stays visible, dimmed, and labelled with
                its revision". Progress is reported by the four-lamp strip; failures
                are reported as verdicts in 检验; the trace log is the 记录 sheet. So
                the viewport never replaces the part with a status page, and never
                prints provider ids, generation paths or step names at user level. */}
            {(() => {
              const hasGeometry = Boolean(selectedJob.stlPath)
              const isRunning = isSelectedProcessing ||
                (!['NEW', 'DELIVERED', 'CANCELLED', 'HUMAN_REVIEW',
                   'VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(selectedJob.state))
              const isFailed = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(selectedJob.state)

              // A run or a failure with geometry on disk: keep the part on screen.
              if (hasGeometry) {
                return (
                  <div className="w-full h-full min-h-0 relative">
                    {isRunning && (
                      <div className="absolute top-4 left-2 z-10 rounded-[9px] border border-[var(--shell-border)] px-3 py-2 flex items-center gap-2 backdrop-blur-md"
                        style={{ background: 'var(--shell-module)', boxShadow: 'var(--shell-shadow)' }}
                      >
                        <span className="w-1.5 h-1.5 rounded-[1px] bg-[var(--shell-signal)] animate-pulse shrink-0" />
                        <p className="text-[11.5px] text-[var(--shell-text-muted)]">
                          正在重建 · 下面是上一版几何
                        </p>
                      </div>
                    )}

                    {/* Informational notices only. The composer owns the single
                        action (section 5); what can be repaired is answered in 检验. */}
                    {!isRunning && selectedJob.state === 'HUMAN_REVIEW' && (
                      <div className="absolute top-4 left-2 z-10 rounded-[9px] border border-[var(--shell-border)] px-3 py-2 flex items-center gap-2 max-w-[420px] backdrop-blur-md"
                        style={{ background: 'var(--shell-module)', boxShadow: 'var(--shell-shadow)' }}
                      >
                        <AlertTriangle className="w-4 h-4 text-[var(--shell-warn)] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-[var(--shell-text)]">几何已生成，检验有拦截项</p>
                          <p className="text-[11px] text-[var(--shell-text-muted)] truncate">预览和 STL 都在。导出前先在检验里看结论，或按生成重建。</p>
                        </div>
                      </div>
                    )}
                    {!isRunning && isFailed && (
                      <div className="absolute top-4 left-2 z-10 rounded-[9px] border border-[var(--shell-border)] px-3 py-2 flex items-center gap-2 max-w-[420px] backdrop-blur-md"
                        style={{ background: 'var(--shell-module)', boxShadow: 'var(--shell-shadow)' }}
                      >
                        <AlertTriangle className="w-4 h-4 text-[var(--shell-fail)] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-[var(--shell-text)]">重建没有通过</p>
                          <p className="text-[11px] text-[var(--shell-text-muted)] truncate">下面是上一版可用的几何。失败原因在检验里，完整记录在记录里。</p>
                        </div>
                      </div>
                    )}
                    {!isRunning && !isFailed && !selectedJob.stlPath && (
                      <div className="absolute top-4 left-2 z-10 rounded-[9px] border border-[var(--shell-border)] px-3 py-2 flex items-center gap-2 max-w-[420px] backdrop-blur-md"
                        style={{ background: 'var(--shell-module)', boxShadow: 'var(--shell-shadow)' }}
                      >
                        <AlertTriangle className="w-4 h-4 text-[var(--shell-warn)] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-[var(--shell-text)]">这是参数预览，不是已构建的 STL</p>
                          <p className="text-[11px] text-[var(--shell-text-muted)] truncate">按生成重建后才会产出可导出的几何。</p>
                        </div>
                      </div>
                    )}

                    <div className={isRunning ? 'w-full h-full opacity-[0.42] transition-opacity' : 'w-full h-full'}>
                      <ThreeDViewer
                        job={selectedJob}
                        onDownloadStl={() => handleDownloadStl(selectedJob)}
                        isDownloadingStl={downloading}
                        hasStl={Boolean(selectedJob.stlPath)}
                        viewCommand={viewCommand}
                        onViewChange={onViewChange}
                      />
                    </div>
                  </div>
                )
              }

              // No geometry yet: the invitation, with the run reported by the lamps.
              return (
                <CadViewportEmptyState
                  selectedJob={selectedJob}
                  isProcessing={isSelectedProcessing || isRunning}
                  awaitingDecision={
                    selectedJob.state === 'HUMAN_REVIEW' &&
                    selectedJob.generationPath === 'intent_clarification'
                  }
                  onProcess={onProcess}
                  onShowComposer={onShowComposer}
                  onSetActiveTab={onSetActiveTab}
                />
              )
            })()}
          </>
        ) : (
          <CadViewportEmptyState
            isFirstLoadComplete={isFirstLoadComplete}
            onShowComposer={onShowComposer}
          />
        )}
        </div>
      </PanelErrorBoundary>
    </div>
  )
}
