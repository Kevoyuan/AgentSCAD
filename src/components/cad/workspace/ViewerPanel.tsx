'use client'

/*
 * ==========================================
 * Junior Designer Assumptions & Design Decisions
 * ==========================================
 *
 * 1. 宽屏物理距离感知假设：
 *    在 1m 笔记本或超宽 (4K) 显示器上，如果底部快捷键指南随父容器无限横向拉伸，
 *    快捷键 `kbd` 与它的文字描述距离会过远。读者视线需要频繁横向跳跃，造成眼部疲劳。
 *    因此，在 Layout 上添加 `max-w-[800px] mx-auto` 的约束是必要的，这能确保视线自然聚焦。
 *
 * 2. 位置四问响应：
 *    - 叙事角色：此处的 Onboarding 快捷键速查表是“引导/效率”角色，引导用户从小白跨越到键盘流专家。
 *    - 观众距离：1m 显示器，所以字号保持为 12px 即可。
 *    - 视觉温度：安静、工具感、物理刻度盘气质。背景与分割线都以极淡色表现，使快捷键本身呈现低对比度的专业感。
 *    - 容量估算：一横排 4 个快捷键卡片，宽度限制在 800px 下每个约 180px，内容塞得极其宽松、呼吸感充分。
 *
 * 3. 标题排版层级优化 (Typographic Contrast Optimization)：
 *    原先的 onboarding 大标题 H3 (如 "How the 3D Pipeline Works" 等) 与小卡片 H4 共享了 12px (text-xs) 的尺寸，
 *    导致层级扁平。将其升级为 13px (text-[13px]) 能够创造更清晰的字号缩放比例与导向感，强化设计视觉层级。
 */

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  Box, Play, Clock, CheckCircle2,
  Cpu, Layers, Plus, Ruler, BoxSelect, AlertTriangle, RotateCcw,
  ShieldCheck, ShieldAlert, ShieldQuestion, Settings, Hammer,
  ArrowRight, ChevronRight, Command, Sparkles, BookOpen, ChevronLeft
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ResizablePanel } from '@/components/ui/resizable'

import { Job, CANCELABLE_STATES, ValidationResult, parseJSON, timeAgo } from '@/components/cad/types'
import { StateBadge } from '@/components/cad/state-badge'
import { PartFamilyIcon, getPartFamilyLabel, getPartFamilyColor } from '@/components/cad/part-family-icon'
import { QuickActionsBar } from '@/components/cad/quick-actions-bar'
import { buildDeliveryReadiness, type DeliveryReadinessReport } from '@/lib/validation/delivery-readiness'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { CadViewportEmptyState } from './empty-states'

const ThreeDViewer = dynamic(() => import('@/components/cad/three-d-viewer').then(m => ({ default: m.ThreeDViewer })), { ssr: false, loading: () => <div className="flex items-center justify-center h-full p-4"><Skeleton className="h-full w-full rounded-[6px]" /></div> })
const JobStatusPage = dynamic(() => import('@/components/cad/job-status-page').then(m => ({ default: m.JobStatusPage })), { ssr: false, loading: () => <div className="p-6"><Skeleton className="h-96 w-full rounded-[6px]" /></div> })

function getReadinessTone(report: DeliveryReadinessReport) {
  switch (report.status) {
    case 'ready':
      return {
        icon: ShieldCheck,
        shell: 'border-emerald-500/20 bg-emerald-500/[0.07]',
        text: 'text-emerald-400',
        progress: 'bg-emerald-500',
      }
    case 'blocked':
      return {
        icon: ShieldAlert,
        shell: 'border-rose-500/20 bg-rose-500/[0.07]',
        text: 'text-rose-400',
        progress: 'bg-rose-500',
      }
    case 'review':
      return {
        icon: AlertTriangle,
        shell: 'border-amber-500/20 bg-amber-500/[0.07]',
        text: 'text-amber-400',
        progress: 'bg-amber-500',
      }
    case 'unverified':
      return {
        icon: ShieldQuestion,
        shell: 'border-sky-500/20 bg-sky-500/[0.07]',
        text: 'text-sky-400',
        progress: 'bg-sky-500',
      }
    default:
      return {
        icon: Clock,
        shell: 'border-[color:var(--app-border)] bg-[var(--app-surface)]',
        text: 'text-[var(--app-text-muted)]',
        progress: 'bg-[var(--app-accent)]',
      }
  }
}

function DeliveryReadinessStrip({
  job,
  isProcessing,
  onProcess,
  onRepair,
  onVisualRepair,
  onDownloadScad,
  onDownloadStl,
  onSetActiveTab,
}: {
  job: Job
  isProcessing: boolean
  onProcess: (job: Job) => void
  onRepair: (job: Job) => void
  onVisualRepair: (job: Job) => void
  onDownloadScad: (job: Job) => void
  onDownloadStl?: (job: Job) => void
  onSetActiveTab: (tab: string) => void
}) {
  const validationResults = parseJSON<ValidationResult[]>(job.validationResults, [])
  const report = buildDeliveryReadiness({
    state: job.state,
    scadSource: job.scadSource,
    stlPath: job.stlPath,
    pngPath: job.pngPath,
    validationResults,
  })
  const tone = getReadinessTone(report)
  const Icon = tone.icon
  const primaryDetail = report.blockers[0] || report.warnings[0] || report.summary
  const showAction = report.nextAction !== 'wait'

  const handleAction = () => {
    switch (report.nextAction) {
      case 'process':
      case 'reprocess':
        onProcess(job)
        break
      case 'auto_repair':
        onRepair(job)
        break
      case 'visual_repair':
        onVisualRepair(job)
        break
      case 'inspect_validation':
        onSetActiveTab('VALIDATION')
        break
      case 'export':
        if (job.stlPath && onDownloadStl) {
          onDownloadStl(job)
        } else {
          onDownloadScad(job)
        }
        break
    }
  }

  const actionLabel = report.nextAction === 'export'
    ? (job.stlPath && onDownloadStl ? 'Download STL' : 'Download SCAD')
    : report.nextActionLabel

  return (
    <div className={`mx-3 my-2 rounded-lg border px-3 py-2 ${tone.shell}`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${tone.text}`} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`truncate text-sm font-medium ${tone.text}`}>{report.label}</span>
              <span className="shrink-0 rounded border border-[color:var(--app-border)] bg-[var(--app-surface)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--app-text-muted)]">
                {Math.round(report.score * 100)}%
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-[var(--app-text-muted)]">{primaryDetail}</p>
          </div>
        </div>
        {showAction && (
          <Button
            size="sm"
            variant={report.status === 'ready' ? 'default' : 'outline'}
            className="h-7 shrink-0 gap-1.5 text-xs"
            onClick={handleAction}
            disabled={isProcessing}
          >
            {actionLabel}
          </Button>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--app-border-subtle)]">
        <div className={`h-full rounded-full transition-all ${tone.progress}`} style={{ width: `${Math.round(report.score * 100)}%` }} />
      </div>
    </div>
  )
}

export function ViewerPanel({
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
    <ResizablePanel id="agentscad-viewer-panel" order={2} defaultSize={52} minSize={36} className="cad-viewer-panel min-w-0 overflow-hidden">
      <PanelErrorBoundary panelName="3D Viewport" resetKey={selectedJob?.id}>
        <div className="flex flex-col h-full bg-[var(--app-bg)] min-w-0 overflow-hidden">
          {selectedJob ? (
          <>
            <div className="px-3 py-2 border-b border-[color:var(--cad-border)] bg-[var(--cad-surface)] shrink-0 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <PartFamilyIcon family={selectedJob.partFamily || 'unknown'} size={18} className={getPartFamilyColor(selectedJob.partFamily)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--cad-text)] truncate max-w-[180px]">{getPartFamilyLabel(selectedJob.partFamily)}</span>
                      {getDimensionSummary(selectedJob) && (
                        <span className="hidden xl:inline-flex items-center gap-1 text-xs font-mono text-[var(--cad-text-muted)]">
                          <Ruler className="w-3.5 h-3.5" />
                          {getDimensionSummary(selectedJob)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--cad-text-secondary)] leading-snug truncate max-w-[520px]">{selectedJob.inputRequest}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StateBadge state={selectedJob.state} size="md" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                <span className="flex items-center gap-1 text-[var(--app-text-muted)]">
                  <Clock className="w-3.5 h-3.5" />
                  Created: {timeAgo(selectedJob.createdAt)}
                </span>
                {selectedJob.completedAt && (
                  <span className="flex items-center gap-1 text-[var(--app-success)]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Completed: {timeAgo(selectedJob.completedAt)}
                  </span>
                )}
                {selectedJob.builderName && (
                  <span className="flex items-center gap-1 text-[var(--app-text-dim)]">
                    <Cpu className="w-3.5 h-3.5" />
                    {selectedJob.builderName}
                  </span>
                )}
                {selectedJob.generationPath && (
                  <span className="flex items-center gap-1 text-[var(--app-text-dim)]">
                    <Layers className="w-3.5 h-3.5" />
                    {selectedJob.generationPath}
                  </span>
                )}
                <span className="hidden 2xl:flex items-center gap-1 text-[var(--cad-text-muted)]">
                  <BoxSelect className="w-3.5 h-3.5" />
                  {selectedJob.stlPath ? 'STL loaded' : 'procedural preview'}
                </span>
              </div>
            </div>

            {/* Gradient Divider */}
            <div className="gradient-separator" />

            {/* Quick Actions Bar */}
            <QuickActionsBar
              job={selectedJob}
              onProcess={onProcess}
              onCancel={onCancel}
              onDelete={onDelete}
              onReprocess={onProcess}
              onDownloadScad={onDownloadScad}
              onDownloadStl={handleDownloadStl}
              isDownloadingStl={downloading}
              onView3D={onView3D}
              onViewLog={onViewLog}
              onShare={onShare}
              onRepair={onRepair}
              isProcessing={isProcessing}
            />

            <DeliveryReadinessStrip
              job={selectedJob}
              isProcessing={isProcessing}
              onProcess={onProcess}
              onRepair={onRepair}
              onVisualRepair={onVisualRepair}
              onDownloadScad={onDownloadScad}
              onDownloadStl={handleDownloadStl}
              onSetActiveTab={onSetActiveTab}
            />

            {/* Center Content: Conditional based on job state */}
            {(() => {
              const canShowRenderedViewer = Boolean(selectedJob.stlPath) &&
                ['DELIVERED', 'HUMAN_REVIEW'].includes(selectedJob.state) &&
                !isSelectedProcessing
              const isActiveProcessing = !canShowRenderedViewer &&
                !['NEW', 'DELIVERED', 'CANCELLED'].includes(selectedJob.state) &&
                !['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(selectedJob.state)
              const isFailed = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(selectedJob.state)
              const isCancelable = CANCELABLE_STATES.includes(selectedJob.state)

              if (isSelectedProcessing || isActiveProcessing) {
                return (
                  <JobStatusPage
                    job={selectedJob}
                    streamEvents={isSelectedProcessing ? pipelineEvents : []}
                    onViewLogs={() => onSetActiveTab('LOG')}
                    onViewError={() => onSetActiveTab('VALIDATION')}
                    onCancel={onCancel}
                    onResolveIntent={(selectedInterpretationId) => onResolveIntent(selectedJob, selectedInterpretationId)}
                    isCancelable={isCancelable || isSelectedProcessing}
                  />
                )
              }

              if (isFailed) {
                return (
                  <JobStatusPage
                    job={selectedJob}
                    onViewLogs={() => onSetActiveTab('LOG')}
                    onViewError={() => onSetActiveTab('VALIDATION')}
                    onCancel={onCancel}
                    onResolveIntent={(selectedInterpretationId) => onResolveIntent(selectedJob, selectedInterpretationId)}
                    isCancelable={false}
                  />
                )
              }

              // Rendered artifact states: show the actual STL/preview, even if validation needs review.
              if (selectedJob.state === 'DELIVERED' || canShowRenderedViewer) {
                return (
                  <div className="flex-1 p-2 min-h-0 relative">
                    {selectedJob.state === 'HUMAN_REVIEW' && (
                      <div className="absolute top-4 left-4 right-4 z-10 cad-viewport-glass rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-[var(--cad-warning)] shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--cad-text)]">Rendered with validation blockers</p>
                            <p className="text-xs text-[var(--cad-text-muted)] truncate">Preview and STL are available. Reprocess or edit before export.</p>
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[13px] gap-1.5"
                            onClick={() => onVisualRepair(selectedJob)}
                            disabled={isProcessing}
                          >
                            <Cpu className="w-3.5 h-3.5" />
                            Visual Repair
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[13px] gap-1.5 bg-[var(--cad-accent)] hover:bg-[var(--app-accent-hover)]"
                            onClick={() => onProcess(selectedJob)}
                            disabled={isProcessing}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reprocess
                          </Button>
                        </div>
                      </div>
                    )}
                    {!selectedJob.stlPath && (
                      <div className="absolute top-4 left-4 right-4 z-10 cad-viewport-glass rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-[var(--cad-warning)] shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--cad-text)]">Preview is live from parameters</p>
                            <p className="text-xs text-[var(--cad-text-muted)] truncate">Rendered STL is stale. Rebuild to produce manufacturable artifacts.</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-[13px] gap-1.5 bg-[var(--cad-accent)] hover:bg-[var(--app-accent-hover)] shrink-0"
                          onClick={() => onProcess(selectedJob)}
                          disabled={isProcessing}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Rebuild STL
                        </Button>
                      </div>
                    )}
                    <ThreeDViewer
                      job={selectedJob}
                      onDownloadStl={() => handleDownloadStl(selectedJob)}
                      isDownloadingStl={downloading}
                      hasStl={Boolean(selectedJob.stlPath)}
                    />
                  </div>
                )
              }

              // NEW / SCAD_GENERATED: Show engineered empty/ready state with Process & SCAD buttons
              return (
                <CadViewportEmptyState
                  selectedJob={selectedJob}
                  isProcessing={isSelectedProcessing}
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
  </ResizablePanel>
)
}
