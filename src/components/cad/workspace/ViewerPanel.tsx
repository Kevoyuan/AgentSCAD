'use client'

import { useI18n } from '@/components/i18n-provider'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'

import { Job, CANCELABLE_STATES } from '@/components/cad/types'
import { cn } from '@/lib/utils'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { JobRunProgress } from './JobRunProgress'
import { JobCancelledNotice, JobFailureNotice } from './JobFailureNotice'
import { CadViewportEmptyState } from './empty-states'

/*
 * The 3D chunk is loaded on demand, so for the first moments of a cold start
 * the viewport had nothing at all in it - and the part's PNG render was sitting
 * on disk the whole time, reachable in one request.
 *
 * The fallback is therefore empty on purpose: the still frame behind it is the
 * content. A skeleton here would cover the very thing that makes the wait
 * short.
 */
const ThreeDViewer = dynamic(() => import('@/components/cad/three-d-viewer').then(m => ({ default: m.ThreeDViewer })), {
  ssr: false,
  loading: () => null,
})

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
  hasParts,
  partsCount,
  failureActionIsSolid = false,
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
  /** the rail already holds parts, so the empty canvas points at it (optional) */
  hasParts?: boolean
  partsCount?: number
  /**
   * Whether the failure card's action owns the accent.
   *
   * The composer's circular action is the workspace's one solid lit control
   * (DESIGN.md section 5), so the failure card only takes the solid form while
   * the composer is dim - that is, while the failure card is the one action the
   * screen offers. The moment the user types a brief or edits a parameter the
   * composer is armed, and the card drops back to the accent's soft form.
   */
  failureActionIsSolid?: boolean
}) {
  const { t } = useI18n()

  const [internalDownloadingStl, setInternalDownloadingStl] = useState(false)

  const handleDownloadStl = useCallback(async (job: Job) => {
    if (onDownloadStl) {
      onDownloadStl(job)
      return
    }
    if (!job.stlPath) {
      toast.error(t("STL file has not been generated for this job. Please rebuild."))
      return
    }
    if (internalDownloadingStl) return

    setInternalDownloadingStl(true)
    const toastId = `stl-download-${job.id}`
    toast.loading(t("Fetching binary STL artifact..."), { id: toastId })

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
      toast.success(t("STL model downloaded"), { id: toastId, description: filename })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Download failed"), { id: toastId })
    } finally {
      setInternalDownloadingStl(false)
    }
  }, [onDownloadStl, internalDownloadingStl, t])

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
      <PanelErrorBoundary panelName={t("3D Viewport")} resetKey={selectedJob?.id}>
        {/*
          `aria-busy` is the only way assistive technology can tell "this region
          is still being worked out" from "this region is finished and empty".
          Without it, a viewport mid-generation and a viewport with nothing in it
          read identically - the very distinction the whole loading state exists
          to make. It sits on the stable wrapper so the flag survives the branch
          below swapping the contents.
        */}
        <div
          className="w-full h-full min-w-0 overflow-hidden relative"
          aria-busy={isSelectedProcessing}
        >
          {selectedJob ? (
          <>
            {/* Keep existing geometry visible during rebuilds. A failed run
                exposes its stage and diagnostic message here, with a direct
                route to the persisted execution timeline. */}
            {(() => {
              const hasGeometry = Boolean(selectedJob.stlPath)
              const isRunning = isSelectedProcessing ||
                (!['NEW', 'DELIVERED', 'CANCELLED', 'HUMAN_REVIEW',
                   'VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(selectedJob.state))
              const isFailed = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(selectedJob.state)
              // A cancellation is its own thing, not a failure: it belongs in a
              // calmer card, and it used to belong in no card at all.
              const isCancelled = selectedJob.state === 'CANCELLED'

              // A run or a failure with geometry on disk: keep the part on screen.
              if (hasGeometry) {
                const showNotice = isRunning || isFailed || isCancelled
                return (
                  <div className="w-full h-full min-h-0 relative">
                    {/*
                     * Every status card shares one top strip. On the stacked layout the
                     * fit control floats at the top-right of the viewport, so below
                     * 960px the strip starts under it instead of running beneath it -
                     * the audit caught the review notice clipped by that button.
                     */}
                    {showNotice && (
                      <div data-testid="viewer-status-notice" className="pointer-events-none absolute inset-x-2 top-[70px] z-10 flex flex-col items-center gap-2 min-[960px]:left-[300px] min-[960px]:right-[290px] max-[959px]:top-[68px]">
                        {isRunning && (
                          <div className="pointer-events-auto w-full max-w-[460px]">
                            <JobRunProgress job={selectedJob} onCancel={() => onCancel(selectedJob)} onViewCode={() => onSetActiveTab('CODE')} onViewLog={() => onViewLog(selectedJob)} />
                          </div>
                        )}

                        {/* A HUMAN_REVIEW notice used to sit here: a 460px card pinned
                            over the top of the model for as long as the part was
                            selected, with no close control and no action. It duplicated
                            the verdict 检验 already prints - and that is the only place
                            with the repair buttons - while its copy contradicted the
                            state machine: on a part waiting for a decision it told the
                            user to "press Generate to rebuild" instead of answering the
                            question. The plate that owns the facts owns the sentence. */}
                        {!isRunning && isFailed && (
                          <div className="pointer-events-auto w-full max-w-[460px]">
                            <JobFailureNotice job={selectedJob} onViewLog={onViewLog} onProcess={onProcess} onRepair={onRepair} solid={failureActionIsSolid} />
                          </div>
                        )}
                        {isCancelled && (
                          <div className="pointer-events-auto w-full max-w-[460px]">
                            <JobCancelledNotice job={selectedJob} onViewLog={onViewLog} onProcess={onProcess} />
                          </div>
                        )}
                      </div>
                    )}

                    {/*
                     * The still frame, laid down before the viewport exists.
                     *
                     * The 3D chunk is fetched on demand and the geometry is fetched
                     * after it, so the viewport is empty for two windows: while the
                     * chunk is in flight (up to 6.5s on a cold start) and while the
                     * mesh is loading. The part's PNG render answers both. It sits
                     * at z-0 and the canvas at z-1; the canvas is opaque once it
                     * paints, so the still frame disappears by itself the moment the
                     * real viewport is ready.
                     *
                     * A job with no render on disk gets a skeleton instead, because
                     * there is genuinely nothing to show.
                     */}
                    {selectedJob.pngPath ? (
                      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
                        <img
                          src={selectedJob.pngPath}
                          alt=""
                          aria-hidden="true"
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="absolute inset-0 z-0 flex items-center justify-center p-4">
                        <div className="flex w-full max-w-xs flex-col items-center gap-3">
                          <Skeleton className="h-40 w-full rounded-[6px]" />
                          <Skeleton className="h-2.5 w-28 rounded" />
                        </div>
                      </div>
                    )}

                    <div className={cn('relative z-[1] h-full', isRunning && 'opacity-[0.42] transition-opacity')}>
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

              if (isFailed && !isRunning) {
                return (
                  <div className="h-full flex items-center justify-center px-4">
                    <JobFailureNotice job={selectedJob} onViewLog={onViewLog} onProcess={onProcess} onRepair={onRepair} solid={failureActionIsSolid} />
                  </div>
                )
              }

              // Nothing to show in the viewport, but the run was stopped on
              // purpose - say so, and say how to start over.
              if (isCancelled) {
                return (
                  <div className="h-full flex items-center justify-center px-4">
                    <JobCancelledNotice job={selectedJob} onViewLog={onViewLog} onProcess={onProcess} />
                  </div>
                )
              }

              if (isRunning) return (
                <div className="flex h-full items-center justify-center overflow-auto px-4 py-6">
                  <JobRunProgress job={selectedJob} onCancel={() => onCancel(selectedJob)} onViewCode={() => onSetActiveTab('CODE')} onViewLog={() => onViewLog(selectedJob)} />
                </div>
              )

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
                  hasParts={hasParts}
                  partsCount={partsCount}
                />
              )
            })()}
          </>
        ) : (
          <CadViewportEmptyState
            isFirstLoadComplete={isFirstLoadComplete}
            hasParts={hasParts}
            partsCount={partsCount}
            onShowComposer={onShowComposer}
          />
        )}
        </div>
      </PanelErrorBoundary>
    </div>
  )
}
