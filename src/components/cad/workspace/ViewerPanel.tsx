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

import dynamic from 'next/dynamic'
import {
  Box, Play, Clock, CheckCircle2, Loader2,
  Cpu, Layers, Plus, Ruler, BoxSelect, AlertTriangle, RotateCcw,
  ShieldCheck, ShieldAlert, ShieldQuestion, Settings, Hammer,
  ArrowRight, ChevronRight, Command, Sparkles, BookOpen, ChevronLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResizablePanel } from '@/components/ui/resizable'

import { Job, CANCELABLE_STATES, ValidationResult, parseJSON, timeAgo } from '@/components/cad/types'
import { StateBadge } from '@/components/cad/state-badge'
import { PartFamilyIcon, getPartFamilyLabel, getPartFamilyColor } from '@/components/cad/part-family-icon'
import { QuickActionsBar } from '@/components/cad/quick-actions-bar'
import { buildDeliveryReadiness, type DeliveryReadinessReport } from '@/lib/validation/delivery-readiness'

const ThreeDViewer = dynamic(() => import('@/components/cad/three-d-viewer').then(m => ({ default: m.ThreeDViewer })), { ssr: false, loading: () => <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" /></div> })
const JobStatusPage = dynamic(() => import('@/components/cad/job-status-page').then(m => ({ default: m.JobStatusPage })), { ssr: false, loading: () => <div className="flex items-center justify-center h-96"><Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" /></div> })

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
  onSetActiveTab,
}: {
  job: Job
  isProcessing: boolean
  onProcess: (job: Job) => void
  onRepair: (job: Job) => void
  onVisualRepair: (job: Job) => void
  onDownloadScad: (job: Job) => void
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
        onDownloadScad(job)
        break
    }
  }

  const actionLabel = report.nextAction === 'export' ? 'Download SCAD' : report.nextActionLabel

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
  onCancel,
  onDelete,
  onDownloadScad,
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
  onCancel: (job: Job) => void
  onDelete: (id: string) => void
  onDownloadScad: (job: Job) => void
  onView3D: () => void
  onViewLog: (job: Job) => void
  onShare: (job: Job) => void
  onRepair: (job: Job) => void
  onVisualRepair: (job: Job) => void
  onSetActiveTab: (tab: string) => void
  onShowComposer: (presetText?: string) => void
  isFirstLoadComplete: boolean
}) {
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
    <ResizablePanel id="agentscad-viewer-panel" order={2} defaultSize={52} minSize={36} className="cad-viewer-panel">
      <div className="flex flex-col h-full bg-[var(--app-bg)]">
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
                    <ThreeDViewer job={selectedJob} />
                  </div>
                )
              }

              // NEW: Show empty/ready state with Process button
              return (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 cad-viewport-shell m-2">
                  <div className="w-16 h-16 rounded-lg cad-viewport-glass flex items-center justify-center">
                    <Play className="w-8 h-7 opacity-60 text-[var(--cad-accent)]" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-[var(--cad-text)]">Ready for geometry</p>
                    <p className="text-[13px] text-[var(--cad-text-muted)] mt-1">Run the pipeline to produce parameters, mesh, and validation.</p>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] linear-transition"
                    onClick={() => onProcess(selectedJob)}
                    disabled={isProcessing}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Process Job
                  </Button>
                </div>
              )
            })()}
          </>
        ) : !isFirstLoadComplete ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--app-text-muted)]" />
          </div>
        ) : (
          <QuickStartDashboard onShowComposer={onShowComposer} />
        )}
      </div>
    </ResizablePanel>
  )
}

interface QuickStartDashboardProps {
  onShowComposer: (presetText?: string) => void
}

function QuickStartDashboard({ onShowComposer }: QuickStartDashboardProps) {
  const presets = [
    {
      title: 'Spur Gear',
      description: 'Parametric involute gear. Supports custom module, tooth count, and pressure angle.',
      prompt: 'Parametric spur gear with module 2, 24 teeth, 20-degree pressure angle, and 8mm bore.',
      icon: Settings,
      iconColor: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
      badge: 'BOSL2 standard'
    },
    {
      title: 'Electronics Box',
      description: 'Hinged protective enclosure. Includes screw bosses, ventilation slots, and snap-fit lid.',
      prompt: 'Hinged electronics enclosure with 2.5mm wall thickness, M3 screw posts, ventilated grid slots, and snap-fit locking lid.',
      icon: BoxSelect,
      iconColor: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
      badge: 'CNC/3D Print'
    },
    {
      title: 'Device Stand',
      description: 'Phone/tablet stand. Tune inclination angle, slot width, and routing slot.',
      prompt: 'Universal smartphone/tablet stand with adjustable 20-degree incline angle, 12mm phone slot width, and back cable routing hole.',
      icon: Hammer,
      iconColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      badge: 'Parametric'
    },
    {
      title: 'Phone Case',
      description: 'Precision bumper case. Includes camera lip protection, ports cutouts, and anti-slip grip.',
      prompt: 'Minimalist phone case with camera bump lip protection, accurate cutout slots for charger and speakers, and 1.5mm wrap-around bumper walls.',
      icon: Cpu,
      iconColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      badge: 'Customizable'
    }
  ]

  return (
    <div className="h-full overflow-y-auto stable-scrollbar px-6 py-8 flex flex-col items-center max-w-4xl mx-auto space-y-8 select-none">
      {/* Welcome Heading */}
      <div className="text-center space-y-3 max-w-2xl mt-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--app-accent-bg)] border border-[color:var(--app-accent-border)] text-xs font-mono text-[var(--app-accent-text)] pulse-soft">
          <Sparkles className="w-3.5 h-3.5" />
          Parametric CAD Pipeline Active
        </div>
        <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-[var(--app-text-bright)] to-[var(--app-text-muted)] bg-clip-text text-transparent">
          Welcome to AgentSCAD Workspace
        </h2>
        <p className="text-sm text-[var(--app-text-muted)] leading-relaxed">
          Describe your part in natural language. Our pipeline will automatically infer parameters, generate parametric OpenSCAD code, compile the 3D mesh, and validate it against manufacturing constraints.
        </p>
        <div className="pt-2 flex justify-center">
          <Button
            size="default"
            className="h-9 px-5 gap-2 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white font-medium shadow-[0_4px_16px_var(--cad-accent-soft)] rounded-lg transition-all transform active:scale-95"
            onClick={() => onShowComposer()}
          >
            <Plus className="w-4 h-4" />
            Create New CAD Design (⌘N)
          </Button>
        </div>
      </div>

      {/* Guided Steps */}
      <div className="w-full space-y-4">
        <h3 className="text-eyebrow text-[var(--app-text-dim)] px-1">
          How the 3D Pipeline Works
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { step: '01', title: 'Intake Request', desc: 'Briefly describe your hardware part, wall thickness, and mounting holes.' },
            { step: '02', title: 'Synthesize CAD', desc: 'LLM infers parameter bounds and generates parametric OpenSCAD source code.' },
            { step: '03', title: 'Render Mesh', desc: 'OpenSCAD compiles the STL mesh, then AgentSCAD creates its PNG preview.' },
            { step: '04', title: 'Validate Model', desc: 'Rules engine checks wall thickness, water-tight manifold, and physical limits.' }
          ].map((item, idx) => (
            <div key={item.step} className="p-3.5 rounded-xl border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] relative flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-[var(--app-accent-text)] bg-[var(--app-accent-bg)] px-1.5 py-0.5 rounded">
                  {item.step}
                </span>
                {idx < 3 && <ChevronRight className="w-3.5 h-3.5 text-[var(--app-text-dim)] hidden md:block" />}
              </div>
              <h4 className="text-xs font-semibold text-[var(--app-text-primary)]">{item.title}</h4>
              <p className="text-[11px] leading-relaxed text-[var(--app-text-muted)]">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Presets Grid */}
      <div className="w-full space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-eyebrow text-[var(--app-text-dim)]">
            Click a Preset Template
          </h3>
          <span className="text-[10px] text-[var(--app-text-dim)]">Load pre-configured specifications</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {presets.map((preset) => {
            const IconComponent = preset.icon
            return (
              <div
                key={preset.title}
                onClick={() => onShowComposer(preset.prompt)}
                className="group p-4 rounded-xl hover-glow-card cursor-pointer bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] border-[color:var(--app-border-subtle)] hover:border-[color:var(--app-accent-border)] flex gap-3.5 items-start text-left"
              >
                <div className={`p-2.5 rounded-lg border ${preset.iconColor} shrink-0`}>
                  <IconComponent className="w-4.5 h-4.5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-[var(--app-text-primary)] group-hover:text-[var(--app-accent-text)] transition-colors">
                      {preset.title}
                    </h4>
                    <span className="text-[9px] font-mono text-[var(--app-text-dim)] px-1 bg-[var(--app-surface-raised)] border border-[color:var(--app-border-subtle)] rounded">
                      {preset.badge}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--app-text-muted)]">
                    {preset.description}
                  </p>
                  <div className="pt-1.5 flex items-center gap-1 text-[11px] font-mono text-[var(--app-accent-text)] opacity-0 group-hover:opacity-100 transition-opacity">
                    Use this template
                    <ArrowRight className="w-3 h-3 animate-pulse" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Shortcuts Quick-Lookup */}
      <div className="w-full max-w-[800px] mx-auto border-t border-[color:var(--app-border-subtle)] pt-6 space-y-3">
        <h3 className="text-eyebrow text-[var(--app-text-dim)] px-1">
          Keyboard Shortcuts Guide
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-1">
          {[
            { key: ['⌘', 'N'], desc: 'New CAD Job' },
            { key: ['⌘', 'B'], desc: 'Toggle Left Sidebar' },
            { key: ['⌘', 'I'], desc: 'Toggle Right Inspector' },
            { key: ['⌘', '⇧', 'F'], desc: 'Focus 3D Viewport' }
          ].map((shortcut) => (
            <div key={shortcut.desc} className="flex items-center justify-between gap-2 border-b border-[color:var(--app-border-subtle)] pb-1.5">
              <span className="text-xs text-[var(--app-text-muted)]">{shortcut.desc}</span>
              <div className="flex gap-0.5 shrink-0">
                {shortcut.key.map((k) => (
                  <kbd key={k} className="kbd-key-premium" style={{ userSelect: 'none' }}>{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
