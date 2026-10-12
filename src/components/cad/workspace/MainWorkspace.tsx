'use client'

import { useI18n } from '@/components/i18n-provider'

/*
 * ─── AgentSCAD shell: Direction C2, floating instrument panel ────────────────
 * Authority: DESIGN.md at the repo root.
 *
 * The docked shell is gone: no app bar, no footer, no resizable column group,
 * no persistent pipeline strip. The stage below is the application, and every
 * control is an absolutely positioned floating module on top of it.
 *
 * Clipping strategy: the root and the stage both clip on both axes. There is no
 * column arithmetic left to overflow, because modules take explicit positions
 * inside the stage instead of sharing a horizontal flow.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box, Play, Settings,
  Plus, ArrowUpDown, Keyboard,
  BarChart3, GitCompare, Palette,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import dynamic from 'next/dynamic'
import type { CommandAction } from '@/components/cad/command-palette'
import { cn } from '@/lib/utils'

const NotificationCenter = dynamic(() => import('@/components/cad/notification-center').then(m => ({ default: m.NotificationCenter })), { ssr: false })
const CommandPalette = dynamic(() => import('@/components/cad/command-palette').then(m => ({ default: m.CommandPalette })), { ssr: false })
const ThemePanel = dynamic(() => import('@/components/cad/theme-panel').then(m => ({ default: m.ThemePanel })), { ssr: false })
const ProviderSettingsPanel = dynamic(() => import('@/components/cad/provider-settings-panel').then(m => ({ default: m.ProviderSettingsPanel })), { ssr: false })

const StatsDashboard = dynamic(() => import('@/components/cad/stats-dashboard').then(m => ({ default: m.StatsDashboard })), { ssr: false, loading: () => <div className="p-6"><Skeleton className="h-96 w-full rounded-[8px]" /></div> })
const JobCompare = dynamic(() => import('@/components/cad/job-compare').then(m => ({ default: m.JobCompare })), { ssr: false, loading: () => <div className="p-6"><Skeleton className="h-96 w-full rounded-[8px]" /></div> })

import { useWorkspaceState } from './useWorkspaceState'
import { JobListPanel } from './JobListPanel'
import { ViewerPanel } from './ViewerPanel'
import { InspectorPanel } from './InspectorPanel'
import { SettingsSheet, type SettingsTab } from './SettingsSheet'
import { LanguagePanel } from '@/components/cad/language-panel'
import { ViewCube } from './ViewCube'
import { DEFAULT_FILTER_STATE } from '@/components/cad/search-filter-panel'
const JobComposer = dynamic(() => import('./JobComposer').then(m => ({ default: m.JobComposer })), { ssr: false })
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { Module } from './Module'
import { DimensionsModule } from './DimensionsModule'
import { ChecksModule, checksModuleHint } from './ChecksModule'
import { DecisionModule, readInterpretations } from './DecisionModule'
import { ReadoutModule } from './ReadoutModule'
import { resolveParameterSchema, effectiveParameterValues, parameterBoundingBox, parameterWallThickness } from './parameter-schema'
import { updateParameters, fetchJobVersions } from '@/components/cad/api'

export type DensityPreset = 'full' | 'tuning' | 'model-only'

/**
 * The design's revision number, from the versions the backend actually recorded.
 * A design with no recorded edits is REV 1, so the flip-dot pair in 检验 can never
 * claim a revision that does not exist.
 */
function useRevision(jobId: string | null): number {


  const [state, setState] = useState<{ jobId: string | null; count: number }>({ jobId, count: 0 })

  // Reset during render when the design changes: an effect would cost a second
  // render pass, and the previous design's revision must never be shown for the
  // new one even for a frame.
  if (state.jobId !== jobId) {
    setState({ jobId, count: 0 })
  }

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    fetchJobVersions(jobId)
      .then(({ versions }) => {
        if (!cancelled) setState({ jobId, count: Array.isArray(versions) ? versions.length : 0 })
      })
      .catch(() => {
        if (!cancelled) setState({ jobId, count: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  return state.count + 1
}

/** Which of the four run lamps is done / current, from the pipeline's own steps. */
function readLampStates(events: Array<{ step: string }>): Array<'done' | 'now' | 'idle'> {  const reached = new Set<string>()
  for (const e of events) reached.add(e.step)

  const intakeDone = ['intent_analyzed', 'planning_reused', 'planning_geometry', 'geometry_planned'].some(s => reached.has(s))
  const synthesisDone = reached.has('scad_generated')
  const renderDone = reached.has('rendered')
  const validationStarted = reached.has('validating')
  const finished = reached.has('delivered')

  const states: Array<'done' | 'now' | 'idle'> = ['idle', 'idle', 'idle', 'idle']
  if (intakeDone) states[0] = 'done'
  if (synthesisDone) states[1] = 'done'
  if (renderDone) states[2] = 'done'

  if (finished) return ['done', 'done', 'done', 'done']

  // The first lamp that has not finished is the one running.
  const firstIdle = states.indexOf('idle')
  if (firstIdle >= 0) states[firstIdle] = 'now'
  else if (validationStarted) states[3] = 'now'

  return states
}

interface ModuleState {
  x?: number
  y?: number
  isFree: boolean
  isCollapsed: boolean
  zIndex: number
}

const DEFAULT_MODULE_STATES: Record<string, ModuleState> = {
  slots: { isFree: false, isCollapsed: false, zIndex: 20 },
  viewer: { isFree: false, isCollapsed: false, zIndex: 10 },
  quickstart: { isFree: false, isCollapsed: false, zIndex: 20 },
  params: { isFree: false, isCollapsed: false, zIndex: 20 },
  decision: { isFree: false, isCollapsed: false, zIndex: 20 },
  code: { isFree: false, isCollapsed: false, zIndex: 20 },
  checks: { isFree: false, isCollapsed: false, zIndex: 20 },
  brand: { isFree: false, isCollapsed: false, zIndex: 25 },
  readout: { isFree: false, isCollapsed: false, zIndex: 25 },
}

export function MainWorkspace() {
  const { t } = useI18n()

  const state = useWorkspaceState()
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
  const [providerRevision, setProviderRevision] = useState(0)
  const [floatingPrompt, setFloatingPrompt] = useState('')

  // Direction C2 Density and Visibility Controls
  const [density, setDensity] = useState<DensityPreset>('full')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // One camera, two controls. The cube mirrors these angles; the viewport reports
  // them back on every orbit, and a cube click bumps the nonce to command a view.
  const [camera, setCamera] = useState({ azimuth: 45, elevation: 27 })
  const [viewNonce, setViewNonce] = useState(0)
  const [fitNonce, setFitNonce] = useState(0)
  const [isSpaceHidden, setIsSpaceHidden] = useState(false)
  const [moduleStates, setModuleStates] = useState<Record<string, ModuleState>>(DEFAULT_MODULE_STATES)
  const [highestZIndex, setHighestZIndex] = useState(30)
  /**
   * Parameter edits are a draft, not a write. The steppers move immediately; the
   * design is only rebuilt when the composer's action is pressed, which is what
   * keeps "preview" and "built artifact" distinguishable (DESIGN.md section 5).
   */
  const [paramDraft, setParamDraft] = useState<Record<string, number> | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  /** The 源码 / 记录 sheet: everything that is not a canvas module (section 6). */
  const [showDetails, setShowDetails] = useState(false)

  // A different design means the previous draft no longer applies.
  const selectedJobId = state.selectedJob?.id ?? null
  useEffect(() => {
    setParamDraft(null)
  }, [selectedJobId])

  const resolvedSchema = resolveParameterSchema(state.selectedJob)
  const effectiveValues = effectiveParameterValues(state.selectedJob, paramDraft)
  const declaredBox = Object.keys(effectiveValues).length ? parameterBoundingBox(effectiveValues) : null
  const declaredWall = parameterWallThickness(effectiveValues)

  const changes = (() => {
    if (!resolvedSchema || !paramDraft) return []
    return resolvedSchema.parameters
      .filter(p => {
        const next = paramDraft[p.key]
        return typeof next === 'number' && Math.abs(next - p.value) > 1e-9
      })
      .map(p => ({ key: p.key, label: p.label, from: p.value, to: paramDraft[p.key] }))
  })()
  const hasDraftChanges = changes.length > 0

  const handleParamDraft = useCallback((key: string, value: number) => {
    setParamDraft(prev => ({ ...(prev ?? {}), [key]: value }))
  }, [])

  const handleParamReset = useCallback(() => {
    setParamDraft(null)
  }, [])

  /**
   * Persist the draft and rebuild. The route re-renders and re-validates, so this
   * is a real rebuild path, not just a value save.
   */
  const commitParameters = useCallback(async (): Promise<boolean> => {
    const job = state.selectedJob
    if (!job || !paramDraft || Object.keys(paramDraft).length === 0) return true
    setIsSaving(true)
    try {
      await updateParameters(job.id, paramDraft)
      setParamDraft(null)
      await state.loadJobs()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Failed to save parameters"))
      return false
    } finally {
      setIsSaving(false)
    }
  }, [state, paramDraft, t])

  const handleComposerSubmit = () => {
    if (floatingPrompt.trim()) {
      state.setNewJobText(floatingPrompt.trim())
      state.setShowComposer(true)
      setFloatingPrompt('')
      return
    }
    const job = state.selectedJob
    if (!job) {
      state.setShowComposer(true)
      return
    }
    if (hasPendingDecision && interpretationId) {
      void state.handleResolveIntent(job, interpretationId)
      return
    }
    if (hasDraftChanges) {
      void commitParameters()
      return
    }
    if (state.isProcessing) return
    state.handleProcess(job)
  }

  const handleResetLayout = useCallback(() => {
    setModuleStates(DEFAULT_MODULE_STATES)
    setDensity('full')
    setIsSpaceHidden(false)
  }, [])

  const handleModuleDragEnd = useCallback((id: string, pos: { x: number; y: number }) => {
    setHighestZIndex(prev => prev + 1)
    setModuleStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        x: pos.x,
        y: pos.y,
        isFree: true,
        zIndex: highestZIndex + 1,
      },
    }))
  }, [highestZIndex])

  const handleCollapseChange = useCallback((id: string, collapsed: boolean) => {
    setModuleStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        isCollapsed: collapsed,
      },
    }))
  }, [])

  const bringToFront = useCallback((id: string) => {
    setHighestZIndex(prev => {
      const next = prev + 1
      setModuleStates(ms => ({
        ...ms,
        [id]: {
          ...ms[id],
          zIndex: next,
        },
      }))
      return next
    })
  }, [])

  // Space key handler: toggles hiding every module except composer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (isInputFocused || state.showComposer) return

      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setIsSpaceHidden(prev => !prev)
        return
      }

      // DESIGN.md section 21: standard views and fit must be reachable from the
      // keyboard - a precision drag must never be the only way to ask for "front".
      const VIEW_KEYS: Record<string, { azimuth: number; elevation: number } | 'fit'> = {
        '1': { azimuth: 0, elevation: 0 },      // 前
        '2': { azimuth: 90, elevation: 0 },     // 右
        '3': { azimuth: 0, elevation: 90 },     // 上
        '4': { azimuth: 180, elevation: 0 },    // 后
        '5': { azimuth: -90, elevation: 0 },    // 左
        '6': { azimuth: 0, elevation: -90 },    // 下
        '0': { azimuth: 45, elevation: 45 },    // 等轴（前上右）
        f: 'fit', F: 'fit',
      }
      const want = VIEW_KEYS[e.key]
      if (!want || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      if (want === 'fit') {
        setViewNonce(v => v + 1)          // nonce bump re-applies even at the same angle
        setFitNonce(v => v + 1)
      } else {
        setCamera(want)
        setFitNonce(0)
        setViewNonce(v => v + 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.showComposer])

  // Command Palette Actions
  const commandPaletteActions: CommandAction[] = [
    {
      id: 'create-job',
      label: t("New Design"),
      icon: <Plus className="w-4 h-4 text-[var(--shell-ok)]" />,
      shortcut: '⌘N',
      onSelect: () => state.setShowComposer(true),
      category: 'action' as const,
    },
    {
      id: 'toggle-theme',
      label: t("Toggle Theme"),
      icon: <Palette className="w-4 h-4 text-[var(--shell-signal)]" />,
      shortcut: 'T',
      onSelect: () => {
        setSettingsTab('theme')
        state.setShowSettings(true)
      },
      category: 'action' as const,
    },
    {
      id: 'show-stats',
      label: t("Show Statistics"),
      icon: <BarChart3 className="w-4 h-4 text-[var(--shell-ok)]" />,
      shortcut: '',
      onSelect: () => state.setShowStats(true),
      category: 'action' as const,
    },
    {
      id: 'show-compare',
      label: t("Compare Designs"),
      icon: <GitCompare className="w-4 h-4 text-[var(--shell-warn)]" />,
      shortcut: 'C',
      onSelect: () => state.setShowCompare(true),
      category: 'action' as const,
    },
    {
      id: 'export-data',
      label: t("Export All Data"),
      icon: <Box className="w-4 h-4 text-[var(--shell-text-muted)]" />,
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

  const activeJobName = state.selectedJob?.inputRequest
    ? (state.selectedJob.inputRequest.slice(0, 32))
    : t("Untitled part")

  const lampStates = readLampStates(state.pipelineEvents)
  const revision = useRevision(state.selectedJob?.id ?? null)

  /*
   * Visibility by density preset (DESIGN.md section 3).
   *   全览     everything
   *   调参     dimensions + readout, checks folded to one line
   *   看模型   composer only, plus the cube so orientation is still reachable
   * `Space` hides all of it and always leaves the composer.
   */
  const isModuleVisible = (id: string) => {
    if (isSpaceHidden) {
      return id === 'cmd' || id === 'composer'
    }
    if (density === 'model-only') {
      return id === 'cmd' || id === 'composer' || id === 'viewer' || id === 'controls'
    }
    if (density === 'tuning') {
      // slots and 源码 step aside. 检验 stays but folds to one line, so the user
      // never tunes parameters without seeing whether the part still passes.
      return id !== 'slots' && id !== 'code'
    }
    return true
  }

  /*
   * In 调参 the verdict folds to its title bar (DESIGN.md section 3). An explicit
   * user toggle always wins, so folding is a default and never a trap.
   */
  const [checksCollapseTouched, setChecksCollapseTouched] = useState(false)
  const isChecksCollapsed = checksCollapseTouched
    ? (moduleStates['checks']?.isCollapsed ?? false)
    : density === 'tuning'

  /*
   * DESIGN.md section 20, 960–1279px: "modules shrink but keep their positions".
   * 源码 is the one module whose content is genuinely optional on a small screen —
   * the same code is one click away in the 源码 / 记录 sheet.
   */
  const [isCompact, setIsCompact] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const apply = () => setIsCompact(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // A pending clarification replaces 尺寸 with 要你定一下 rather than stacking both.
  const isAsking = Boolean(
    state.selectedJob &&
    state.selectedJob.state === 'HUMAN_REVIEW' &&
    state.selectedJob.generationPath === 'intent_clarification'
  )

  /*
   * The chosen interpretation is part of the draft, like a parameter edit: the
   * decision module only selects, and the composer's single action commits it
   * (DESIGN.md section 5, acceptance criterion 3).
   */
  const interpretations = readInterpretations(state.selectedJob)
  const [interpretationId, setInterpretationId] = useState<string | null>(null)

  // Default to the first option, and drop a stale choice when the design changes.
  useEffect(() => {
    setInterpretationId(interpretations[0]?.id ?? null)
  }, [selectedJobId, state.selectedJob?.intentResult])

  const hasPendingDecision = isAsking && Boolean(interpretationId)

  /*
   * Lighting rule (DESIGN.md section 5): the action is lit only when pressing it
   * would do something. One writer owns the button and its status line - keeping
   * them in two places is what produced a lit button beside a stale "无需重建".
   */
  const actionLabel = state.isProcessing
    ? t("Stop")
    : floatingPrompt.trim()
      ? t("Generate")
      : hasPendingDecision
        ? t("Confirm and generate")
        : hasDraftChanges
          ? t("Rebuild")
          : state.selectedJob
            ? t("Rebuild")
            : t("Generate")
  const isActionArmed =
    state.isProcessing ||
    Boolean(floatingPrompt.trim()) ||
    hasPendingDecision ||
    hasDraftChanges ||
    Boolean(state.selectedJob && !state.selectedJob.stlPath)
  const isActionBusy = isSaving || state.isProcessing

  /*
   * The cube has two ways to ask for a view and they must reach the same camera:
   * a click asks for a standard view, a drag asks for a free angle.
   *
   * `ThreeDViewer` applies a command only when the nonce changes - that guard is
   * what keeps an unrelated re-render from re-applying a stale angle. The drag path
   * used to set the angle without bumping it, so dragging the cube rotated the cube,
   * moved the label, and left the part exactly where it was (measured: 0 of 360,000
   * viewport pixels changed). Both paths now go through here.
   */
  const applyViewCommand = (next: { azimuth: number; elevation: number }) => {
    setCamera({ azimuth: next.azimuth, elevation: next.elevation })
    setViewNonce(v => v + 1)
  }

  /*
   * The viewer reports its camera back on every orbit frame. A command we just sent
   * arrives as an echo of the same angle, and storing it as a fresh object would
   * re-render the whole workspace a second time per pointer move during a cube drag -
   * that echo was the other half of the drag lag. Angles wrap, so compare them on a
   * circle; elevation does not, so compare it directly.
   */
  const handleViewChange = (next: { azimuth: number; elevation: number }) => {
    setCamera(prev =>
      Math.abs(((prev.azimuth - next.azimuth + 540) % 360) - 180) < 0.05 &&
      Math.abs(prev.elevation - next.elevation) < 0.05
        ? prev
        : { azimuth: next.azimuth, elevation: next.elevation }
    )
  }

  // Re-stacking positions for column layout
  // When a module is free, its user-dragged coordinates are used.
  // When not free, it stacks neatly into its column.
  const slotsState = moduleStates['slots'] || DEFAULT_MODULE_STATES.slots
  const viewerState = moduleStates['viewer'] || DEFAULT_MODULE_STATES.viewer
  const paramsState = moduleStates['params'] || DEFAULT_MODULE_STATES.params
  const decisionState = moduleStates['decision'] || DEFAULT_MODULE_STATES.decision
  const checksState = moduleStates['checks'] || DEFAULT_MODULE_STATES.checks
  const codeState = moduleStates['code'] || DEFAULT_MODULE_STATES.code

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none relative bg-[var(--shell-canvas)] text-[var(--shell-text)] font-sans">
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
        onDelete={state.handleDelete}
        onProcess={state.handleProcess}
      />

      {/* ── Precision Metrology Canvas: Grid + Radial Stage + Measurement Frame ── */}
      <main
        id="stage"
        className="flex-1 min-h-0 w-full max-w-full overflow-hidden relative"
        style={{
          background: 'var(--shell-canvas-grad)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* Background Grid */}
        <div
          id="canvas-grid"
          className="absolute inset-0 pointer-events-none opacity-50"
          style={{
            backgroundImage: 'linear-gradient(var(--shell-grid) 1px, transparent 1px), linear-gradient(90deg, var(--shell-grid) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
            backgroundPosition: 'center',
          }}
        />

        {/* Precision Corner Brackets */}
        <div className="pointer-events-none absolute left-[22px] top-[22px] w-[14px] h-[14px] border-t border-l border-[color:var(--shell-tick)]" />
        <div className="pointer-events-none absolute right-[22px] top-[22px] w-[14px] h-[14px] border-t border-r border-[color:var(--shell-tick)]" />
        <div className="pointer-events-none absolute left-[22px] bottom-[22px] w-[14px] h-[14px] border-b border-l border-[color:var(--shell-tick)]" />
        <div className="pointer-events-none absolute right-[22px] bottom-[22px] w-[14px] h-[14px] border-b border-r border-[color:var(--shell-tick)]" />

        {/* Vertical Ruler */}
        <div
          className="pointer-events-none absolute left-[30px] top-[96px] bottom-[120px] w-4 border-l border-[color:var(--shell-border-strong)]"
          style={{
            backgroundImage: 'repeating-linear-gradient(180deg, var(--shell-tick) 0 1px, transparent 1px 24px)',
          }}
        >
          <span
            className="absolute left-5 top-[-4px] font-mono text-[8.5px] text-[var(--shell-text-dim)] select-none"
            style={{ writingMode: 'vertical-rl' }}
          >
            mm · 0 — 200
          </span>
        </div>

        {/* Canvas Hint */}
        <div className="pointer-events-none absolute left-1/2 bottom-[82px] -translate-x-1/2 font-mono text-[9.5px] tracking-[0.12em] text-[var(--shell-text-dim)] uppercase select-none z-10">
          {isSpaceHidden ? t("Panels hidden · Press Space to restore") : t("Drag a module header to move it · Space hides all panels")}
        </div>

        {/* ── Floating Module Layer (Layer 2) ─────────────────────────────────── */}
        <div id="layer" className="absolute inset-0 pointer-events-none">

          {/* 1. Brand Module (Static pinned top-left) */}
          {isModuleVisible('brand') && (
            <Module
              id="brand"
              title="AGENTSCAD"
              /* A wordmark, not a section: it stays out of the heading outline. */
              titleAs="span"
              collapsible={false}
              draggable={true}
              isFree={moduleStates['brand']?.isFree}
              position={moduleStates['brand']?.isFree ? { x: moduleStates['brand'].x, y: moduleStates['brand'].y } : undefined}
              onDragEnd={(pos) => handleModuleDragEnd('brand', pos)}
              onFocus={() => bringToFront('brand')}
              zIndex={moduleStates['brand']?.zIndex ?? 25}
              style={{ left: 16, top: 14 }}
              bodyClassName="p-0"
              headerClassName="hidden"
            >
              <div className="flex items-center gap-2.5 px-3 py-2 cursor-grab active:cursor-grabbing">
                <span className="text-xs font-bold tracking-[0.08em] text-[var(--shell-text)] select-none">
                  AGENTSCAD
                </span>
                <span className="text-[10px] text-[var(--shell-text-dim)] font-mono select-none">·</span>
                <span
                  className="min-w-0 truncate text-[11px] text-[var(--shell-text-label)] max-w-[160px] sm:max-w-[260px]"
                  title={activeJobName}
                >
                  {activeJobName}
                </span>
                <div className="flex items-center gap-1.5 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--shell-ok)] shadow-[0_0_7px_rgba(123,214,138,0.65)]" title={t("Provider Ready")} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--shell-ok)] shadow-[0_0_7px_rgba(123,214,138,0.65)]" title={t("OpenSCAD Ready")} />
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      state.isProcessing
                        ? 'bg-[var(--shell-signal)] shadow-[0_0_8px_rgba(255,90,31,0.8)] animate-pulse'
                        : state.selectedJob
                        ? 'bg-[var(--shell-ok)] shadow-[0_0_7px_rgba(123,214,138,0.65)]'
                        : 'bg-[var(--shell-raise)]'
                    )}
                    title={state.isProcessing ? t("Running") : state.selectedJob ? t("Ready") : t("Idle")}
                  />
                  <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--shell-text-label)] ml-0.5">
                    {state.isProcessing ? t("Running") : state.selectedJob ? t("Ready") : t("Idle")}
                  </span>
                </div>

                {/* DESIGN.md "Secondary surfaces": settings and notifications are the
                    only two utility entry points in the product. Everything else is a
                    keystroke or a contextual action. */}
                <div className="flex items-center gap-0.5 ml-1 pl-2 border-l border-[color:var(--shell-border)]">
                  <NotificationCenter
                    notifications={state.notifications}
                    activityEvents={state.activityEvents}
                    onMarkRead={state.markNotificationRead}
                    onMarkAllRead={state.markAllNotificationsRead}
                    onClearAll={state.clearAllNotifications}
                    onClearActivity={state.clearActivityEvents}
                    onActivityClick={(event) => {
                      const found = state.allJobs.find(j => j.id.slice(0, 8) === event.jobId)
                      if (found) { state.setSelectedJob(found); state.setActiveTab('SPEC') }
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t("Settings")}
                    title={t("Settings ⌘,")}
                    onClick={() => { setSettingsTab('providers'); setSettingsOpen(true) }}
                    className="w-6 h-6 grid place-items-center rounded-[4px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Module>
          )}

          {/* 2. Controls & Density Module (Static pinned top-right) */}
          {isModuleVisible('controls') && (
            <Module
              id="controls"
              title={t("CONTROLS")}
              collapsible={false}
              draggable={true}
              isFree={moduleStates['controls']?.isFree}
              position={moduleStates['controls']?.isFree ? { x: moduleStates['controls'].x, y: moduleStates['controls'].y } : undefined}
              onDragEnd={(pos) => handleModuleDragEnd('controls', pos)}
              onFocus={() => bringToFront('controls')}
              zIndex={moduleStates['controls']?.zIndex ?? 25}
              style={{ right: 16, top: 14 }}
              bodyClassName="p-0"
              headerClassName="hidden"
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5 cursor-grab active:cursor-grabbing">
                <span className="font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)] px-1 select-none">
                  {t("Panels")}
                </span>

                {/* Density Presets: Full / Tuning / Model-Only */}
                <div id="density" className="flex items-center gap-0.5 bg-[var(--shell-well)] rounded-[5px] p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDensity('full')
                      setIsSpaceHidden(false)
                    }}
                    className={cn(
                      'font-mono text-[9px] tracking-[0.1em] px-2 py-1 rounded-[4px] cursor-pointer transition-all whitespace-nowrap',
                      density === 'full' && !isSpaceHidden
                        ? 'bg-[var(--shell-signal)] text-[#180D06] font-bold shadow-sm'
                        : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] bg-transparent'
                    )}
                  >
                    {t("Overview")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDensity('tuning')
                      setIsSpaceHidden(false)
                    }}
                    className={cn(
                      'font-mono text-[9px] tracking-[0.1em] px-2 py-1 rounded-[4px] cursor-pointer transition-all whitespace-nowrap',
                      density === 'tuning' && !isSpaceHidden
                        ? 'bg-[var(--shell-signal)] text-[#180D06] font-bold shadow-sm'
                        : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] bg-transparent'
                    )}
                  >
                    {t("Tune")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDensity('model-only')
                      setIsSpaceHidden(false)
                    }}
                    className={cn(
                      'font-mono text-[9px] tracking-[0.1em] px-2 py-1 rounded-[4px] cursor-pointer transition-all whitespace-nowrap',
                      density === 'model-only' && !isSpaceHidden
                        ? 'bg-[var(--shell-signal)] text-[#180D06] font-bold shadow-sm'
                        : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] bg-transparent'
                    )}
                  >
                    {t("Model")}
                  </button>
                </div>

                <div className="w-[1px] h-4 bg-white/[0.075] mx-0.5" />

                {/* Layout Reset Control */}
                <button
                  type="button"
                  id="reset"
                  onClick={handleResetLayout}
                  title={t("Reset module positions")}
                  className="w-6 h-6 rounded-[5px] border border-[color:var(--shell-border)] hover:border-white/20 text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] flex items-center justify-center font-mono text-xs cursor-pointer transition-colors"
                >
                  ↺
                </button>

                <div className="w-[1px] h-4 bg-white/[0.075] mx-0.5" />

                {/* Revision label */}
                <span id="qid" className="font-mono text-[9px] tracking-[0.1em] text-[var(--shell-text-dim)] px-1 select-none whitespace-nowrap">
                  {state.selectedJob ? t("Revision 4") : t("Revision —")}
                </span>

                <div className="w-[1px] h-4 bg-white/[0.075] mx-0.5" />


              </div>
            </Module>
          )}

          {/* 3. Four-Lamp Run Strip (Conditional while processing) */}
          {state.isProcessing && !isSpaceHidden && (
            <div
              id="lamps"
              className="mod absolute left-1/2 top-3.5 -translate-x-1/2 z-30 flex items-center px-2 py-1 rounded-[9px] pointer-events-auto"
              style={{
                background: 'var(--shell-module)',
                border: '1px solid var(--shell-border)',
                boxShadow: 'inset 0 1px 0 var(--shell-hairline), 0 14px 30px -10px rgba(0, 0, 0, 0.62), 0 3px 8px rgba(0, 0, 0, 0.34)',
                backdropFilter: 'blur(16px) saturate(1.15)',
              }}
            >
              {[
                { label: t("Interpret request"), state: 'INTAKE' },
                { label: t("Write OpenSCAD"), state: 'SYNTHESIS' },
                { label: t("Render geometry"), state: 'RENDER' },
                { label: t("Checks"), state: 'VALIDATION' },
              ].map((lamp, i) => {
                // The strip reports where the run actually is, from the SSE steps
                // the pipeline emits, instead of a fixed "third lamp is running".
                const isPassed = lampStates[i] === 'done'
                const isCurrent = lampStates[i] === 'now'
                return (
                  <div
                    key={lamp.label}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1',
                      i < 3 && 'border-r border-[color:var(--shell-hairline)]'
                    )}
                  >
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-[1px] shrink-0',
                        isPassed
                          ? 'bg-[var(--shell-ok)]'
                          : isCurrent
                          ? 'bg-[var(--shell-signal)] shadow-[0_0_7px_rgba(255,90,31,0.75)] animate-pulse'
                          : 'bg-[var(--shell-raise)]'
                      )}
                    />
                    <span
                      className={cn(
                        'font-mono text-[9px] tracking-[0.1em]',
                        isPassed ? 'text-[var(--shell-ok)]' : isCurrent ? 'text-[var(--shell-text)] font-semibold' : 'text-[var(--shell-text-dim)]'
                      )}
                    >
                      {lamp.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* 4. Slots Module (Job List) */}
          {isModuleVisible('slots') && (
            <Module
              id="slots"
              title={t("Part slots")}
              badge={`${state.jobs.length}`}
              isFree={slotsState.isFree}
              isCollapsed={slotsState.isCollapsed}
              onCollapseChange={(col) => handleCollapseChange('slots', col)}
              position={slotsState.isFree ? { x: slotsState.x, y: slotsState.y } : undefined}
              onDragEnd={(pos) => handleModuleDragEnd('slots', pos)}
              onFocus={() => bringToFront('slots')}
              zIndex={slotsState.zIndex}
              style={{
                left: 16,
                top: 70,
                width: 268,
                maxHeight: slotsState.isCollapsed ? undefined : 470,
              }}
              bodyClassName="p-0"
            >
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
                onClearSelection={() => state.setSelectedIds(new Set())}
                onFilterChange={state.handleFilterChange}
                onSetActiveTab={state.setActiveTab}
                onShowComposer={(presetText) => {
                  if (presetText) {
                    state.setNewJobText(presetText)
                  }
                  state.setShowComposer(true)
                }}
                onResetFilters={() => state.handleFilterChange({ ...DEFAULT_FILTER_STATE })}
                onOpenStats={() => state.setShowStats(true)}
                onOpenCompare={() => state.setShowCompare(true)}
              />
            </Module>
          )}

          {/* 5. Viewer Area Module */}
          {isModuleVisible('viewer') && (
            <Module
              id="viewer"
              title={t("Viewport · 3D")}
              badge={state.selectedJob ? (state.isProcessing ? t("Rendering") : state.selectedJob.state) : t("Ready")}
              isFree={viewerState.isFree}
              isCollapsed={viewerState.isCollapsed}
              onCollapseChange={(col) => handleCollapseChange('viewer', col)}
              position={viewerState.isFree ? { x: viewerState.x, y: viewerState.y } : undefined}
              onDragEnd={(pos) => handleModuleDragEnd('viewer', pos)}
              onFocus={() => bringToFront('viewer')}
              zIndex={viewerState.zIndex}
              style={{
                // DESIGN.md section 3: the canvas IS the application.
                inset: 0,
                background: 'none',
                border: 'none',
                borderRadius: 0,
                boxShadow: 'none',
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
                zIndex: 1,
              }}
              headerClassName="hidden"
              draggable={false}
              bodyClassName="h-full p-0"
            >
              <ViewerPanel
                viewCommand={{ azimuth: camera.azimuth, elevation: camera.elevation, nonce: viewNonce, fit: fitNonce }}
                onViewChange={handleViewChange}
                selectedJob={state.selectedJob}
                isProcessing={state.isProcessing}
                processingJobId={state.processingJobId}
                pipelineEvents={state.pipelineEvents}
                onProcess={state.handleProcess}
                onResolveIntent={state.handleResolveIntent}
                onCancel={(j) => state.setCancelTarget(j)}
                onDelete={state.handleDelete}
                onDownloadScad={state.downloadScad}
                onView3D={state.handleQuickView3D}
                onViewLog={state.handleQuickViewLog}
                onShare={state.handleQuickShare}
                onRepair={state.handleRepair}
                onVisualRepair={state.handleVisualRepair}
                onSetActiveTab={state.setActiveTab}
                onShowComposer={(presetText) => {
                  if (presetText) {
                    state.setNewJobText(presetText)
                  }
                  state.setShowComposer(true)
                }}
                isFirstLoadComplete={state.isFirstLoadComplete}
              />
            </Module>
          )}

          {/* ── 6. Right column: 尺寸 / 要你定一下 · 检验 ─────────────────────
              DESIGN.md section 3: modules live in their own columns and re-stack
              when one is collapsed or dragged away. `flow` puts them in the
              column's flex layout so that happens with no layout arithmetic;
              dragging one makes it free and the column closes the gap. */}
          <div
            id="right-column"
            data-testid="right-column"
            className="absolute right-4 top-[70px] w-[262px] flex flex-col gap-[10px] bottom-[132px] pointer-events-auto overflow-y-auto overflow-x-hidden custom-scrollbar"
            style={{ scrollbarWidth: 'thin' }}
          >
            {state.selectedJob && isModuleVisible('params') && !isAsking && (
              <Module
                id="params"
                flow
                title={t("Dimensions")}
                badge={hasDraftChanges ? t("{0} changed", { 0: changes.length }) : resolvedSchema ? t("{0} parameters", { 0: resolvedSchema.parameters.length }) : t("Awaiting generation")}
                isFree={paramsState.isFree}
                isCollapsed={paramsState.isCollapsed}
                onCollapseChange={col => handleCollapseChange('params', col)}
                onDragEnd={pos => handleModuleDragEnd('params', pos)}
                onFocus={() => bringToFront('params')}
                zIndex={paramsState.zIndex}
                /* Each plate owns a share of the column and scrolls its own body, so
                   a long parameter list can never push 检验 off the bottom edge. */
                style={paramsState.isFree ? undefined : { maxHeight: '46%' }}
              >
                <DimensionsModule
                  job={state.selectedJob}
                  values={effectiveValues}
                  isProcessing={state.isProcessing}
                  onDraft={handleParamDraft}
                  onReset={handleParamReset}
                />
              </Module>
            )}

            {state.selectedJob && isModuleVisible('decision') && isAsking && (
              <Module
                id="decision"
                flow
                title={t("Choose an interpretation")}
                badge={t("No geometry yet")}
                isFree={decisionState.isFree}
                isCollapsed={decisionState.isCollapsed}
                onCollapseChange={col => handleCollapseChange('decision', col)}
                position={decisionState.isFree ? { x: decisionState.x, y: decisionState.y } : undefined}
                onDragEnd={pos => handleModuleDragEnd('decision', pos)}
                onFocus={() => bringToFront('decision')}
                zIndex={decisionState.zIndex}
              >
                <DecisionModule
                  job={state.selectedJob}
                  selectedId={interpretationId}
                  onSelect={setInterpretationId}
                />
              </Module>
            )}

            {state.selectedJob && isModuleVisible('checks') && (
              <Module
                id="checks"
                flow
                title={t("Checks")}
                badge={checksModuleHint(state.selectedJob, state.isProcessing, t)}
                isFree={checksState.isFree}
                isCollapsed={isChecksCollapsed}
                onCollapseChange={col => {
                  setChecksCollapseTouched(true)
                  handleCollapseChange('checks', col)
                }}
                position={checksState.isFree ? { x: checksState.x, y: checksState.y } : undefined}
                onDragEnd={pos => handleModuleDragEnd('checks', pos)}
                onFocus={() => bringToFront('checks')}
                zIndex={checksState.zIndex}
                style={checksState.isFree ? undefined : { maxHeight: '46%' }}
              >
                <ChecksModule
                  job={state.selectedJob}
                  isProcessing={state.isProcessing}
                  hasDraftChanges={hasDraftChanges}
                  revision={revision}
                  onRepair={
                    state.selectedJob.stlPath || state.selectedJob.scadSource
                      ? () => state.handleRepair(state.selectedJob!)
                      : undefined
                  }
                  onVisualRepair={
                    state.selectedJob.stlPath ? () => state.handleVisualRepair(state.selectedJob!) : undefined
                  }
                  onOpenVersions={() => {
                    state.setActiveTab('HISTORY')
                    setShowDetails(true)
                  }}
                />
              </Module>
            )}

            {/* 源码 stays its own module (DESIGN.md section 6): the editor is not
                a tab inside another module, and it opens the full canvas view. */}
            {state.selectedJob?.scadSource && isModuleVisible('code') && !isCompact && (
              <Module
                id="code"
                flow
                title={t("Code")}
                badge={t("{0} lines", { 0: state.selectedJob.scadSource.split('\n').length })}
                isFree={codeState.isFree}
                isCollapsed={codeState.isCollapsed ?? true}
                onCollapseChange={col => handleCollapseChange('code', col)}
                position={codeState.isFree ? { x: codeState.x, y: codeState.y } : undefined}
                onDragEnd={pos => handleModuleDragEnd('code', pos)}
                onFocus={() => bringToFront('code')}
                zIndex={codeState.zIndex}
              >
                <div className="px-[11px] pb-[11px]">
                  <button
                    type="button"
                    onClick={() => setShowDetails(true)}
                    className="w-full h-[30px] rounded-[4px] border border-[color:var(--shell-border)] font-mono text-[10px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:border-[var(--shell-border-strong)] transition-colors"
                    style={{ background: 'var(--shell-well)' }}
                  >
                    {t("Open code / history")}
                  </button>
                </div>
              </Module>
            )}
          </div>

          {/* ViewCube: viewport-native, frameless, bottom-left above the readout.
              DESIGN.md section 4 - the cube is a shortcut into the same camera. */}
          {!isSpaceHidden && (
            <div className="absolute left-3 bottom-[136px] z-20 pointer-events-auto" data-testid="view-cube">
              <ViewCube
                azimuth={camera.azimuth}
                elevation={camera.elevation}
                onChange={applyViewCommand}
                onCommand={applyViewCommand}
              />
            </div>
          )}

          {/* 7. Readout Module (Static pinned bottom-left per Section 6) */}
          {isModuleVisible('readout') && (
            <Module
              id="readout"
              title={t("Readouts")}
              collapsible={true}
              draggable={true}
              isFree={moduleStates['readout']?.isFree}
              isCollapsed={moduleStates['readout']?.isCollapsed}
              onCollapseChange={(col) => handleCollapseChange('readout', col)}
              position={moduleStates['readout']?.isFree ? { x: moduleStates['readout'].x, y: moduleStates['readout'].y } : undefined}
              onDragEnd={(pos) => handleModuleDragEnd('readout', pos)}
              onFocus={() => bringToFront('readout')}
              zIndex={moduleStates['readout']?.zIndex ?? 25}
              style={{
                left: 16,
                bottom: 16,
                minWidth: 204,
              }}
            >
              <ReadoutModule
                job={state.selectedJob}
                declaredBoundingBox={declaredBox}
                declaredWallThickness={declaredWall}
              />
            </Module>
          )}

          {/* 8. Anchored Composer (Never hidden by Space; Section 3 & 5 anchor) */}
          <div
            id="cmd"
            /* 620px at the reference size. Below ~1100px the centred composer starts to
               reach the 读数 column at bottom-left; capping the width at
               `100vw - 2*(16 + 204 + 8)` keeps the two out of each other's way without
               moving either (the 456 is the readout column plus its margins, twice).
               The 320px floor matters: without it the formula goes negative on a phone
               and the composer collapses to zero width - no field, no action, no way to
               start a design. Measured at 375px: 0px wide before, 320px after. */
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(620px,max(320px,calc(100vw-456px)))] max-w-[calc(100vw-32px)] pointer-events-auto select-none"
          >
            <div
              className="mod p-2"
              style={{
                background: 'var(--shell-module)',
                border: '1px solid var(--shell-border)',
                borderRadius: '9px',
                boxShadow: 'inset 0 1px 0 var(--shell-hairline), 0 14px 30px -10px rgba(0, 0, 0, 0.62), 0 3px 8px rgba(0, 0, 0, 0.34)',
                backdropFilter: 'blur(16px) saturate(1.15)',
                WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
              }}
            >
              {/* Inner top highlight */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-[var(--shell-hairline)] z-10" />

              {/* Composer Input Field with 34px Circular Action Button.
                  The active state is one signal, not three: a 1px border that turns
                  amber plus the caret. The row used to add a 2px ring on top of the
                  border and a third boxed hint row below, which read as a warning
                  panel rather than an input (DESIGN.md section 5: "The action is a
                  circular button inside the field"). */}
              <div className="flex items-center gap-2.5 h-11 px-3.5 rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] focus-within:border-[var(--shell-signal)] transition-colors">
                <span className="text-[var(--shell-placeholder)] font-mono text-sm select-none">›</span>
                <input
                  id="prompt"
                  type="text"
                  placeholder={
                    state.selectedJob?.inputRequest
                      ? t("Describe a change, for example: “Increase wall thickness to 2.4”")
                      : t("Describe the part you need, for example: “Camera bracket for a 35 mm DIN rail”")
                  }
                  value={floatingPrompt}
                  onChange={(e) => setFloatingPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleComposerSubmit()
                    }
                  }}
                  className="shell-field flex-1 bg-transparent border-0 outline-none text-[12.5px] text-[var(--shell-text)] placeholder:text-[var(--shell-placeholder)] min-w-0 font-normal select-text"
                />

                {/* Circular Action Button. Stops an in-flight run; otherwise it
                    generates, rebuilds, or commits the parameter draft — whichever
                    the staleness line says is pending. */}
                <button
                  type="button"
                  id="build"
                  onClick={() => {
                    if (state.isProcessing && state.selectedJob) {
                      state.setCancelTarget(state.selectedJob)
                      return
                    }
                    handleComposerSubmit()
                  }}
                  title={actionLabel}
                  aria-label={actionLabel}
                  disabled={isSaving}
                  className={cn(
                    'w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0 transition-all duration-150 cursor-pointer active:scale-95',
                    isActionArmed
                      ? 'bg-[var(--shell-signal)] text-[#1A0F08] shadow-[0_0_18px_rgba(255,90,31,0.34)] hover:bg-[#FF6E36]'
                      : 'bg-[var(--shell-hairline)] text-[var(--shell-text-label)] hover:bg-white/[0.14] hover:text-[var(--shell-text)]'
                  )}
                >
                  {isActionBusy ? (
                    <span className="w-3 h-3 bg-current rounded-[1px]" />
                  ) : (
                    <svg className="w-4 h-4 stroke-[2.5]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Hint row and staleness line.
                  Three bordered chips sat here; the shortcuts are the same
                  information but they do not need three boxes competing with the
                  field above them. Only ⌘K is a control (it opens the palette), so
                  only ⌘K is a button; the rest is engraved text. */}
              <div className="flex items-center justify-between gap-3 px-1 pt-1.5 text-[9px] font-mono text-[var(--shell-text-dim)]">
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <span>{t("⌘⏎ Generate")}</span>
                  <span>{t("Space Hide panels")}</span>
                  <button
                    type="button"
                    onClick={() => state.setShowCommandPalette(true)}
                    className="hover:text-[var(--shell-text)] transition-colors"
                  >
                    {t("⌘K Commands")}
                  </button>
                </div>
                <span
                  id="tip-right"
                  className={cn(
                    'truncate',
                    (isSpaceHidden || state.isProcessing || Boolean(floatingPrompt.trim()) || hasDraftChanges)
                      ? 'text-[var(--shell-signal-soft)]'
                      : 'text-[var(--shell-text-dim)]'
                  )}
                >
                  {isSpaceHidden
                    ? t("Panels hidden · Press Space to restore")
                    : isSaving
                    ? t("Saving parameters · Rebuilding")
                    : state.isProcessing
                    ? t("Rendering")
                    : floatingPrompt.trim()
                    ? t("Press ⌘ ⏎ to generate a new version")
                    : hasPendingDecision
                    ? t("Your choice will be added to the description")
                    : hasDraftChanges
                    ? t("{0} parameters changed · Rebuild required", { 0: changes.length })
                    : state.selectedJob?.stlPath
                    ? t("No rebuild needed")
                    : state.selectedJob
                    ? t("No geometry yet · Press Generate")
                    : t("Start with a description below")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Dialogs and Modals ─────────────────────────────────────────────── */}

      {/* 源码 / 记录 / 依赖: tier-2 surfaces (DESIGN.md section 6). They are a
          sheet, not a module, so they never take canvas space from the part. */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent
          className="bg-[rgba(34,31,28,0.96)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] flex w-[min(56rem,calc(100vw-2rem))] max-w-none h-[min(760px,calc(100vh-4rem))] flex-col overflow-hidden backdrop-blur-xl"
          aria-describedby="details-description"
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-[var(--shell-text)]">{t("Code / history")}</DialogTitle>
            <DialogDescription id="details-description" className="sr-only">
              {t("Source code, version history, notes and dependencies for this part")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {state.selectedJob ? (
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
                  state.setSelectedJob({ ...job, parameterValues: JSON.stringify(parameterValues) })
                }}
                onApplyScad={state.handleApplyScad}
                onProcess={state.handleProcess}
                onRepair={state.handleRepair}
                onNavigateToJob={handleNavigateToJob}
                onClearSelectedJob={() => state.setSelectedJob(null)}
                onShowComposer={() => state.setShowComposer(true)}
                onOpenSettings={(tab) => {
                  setSettingsTab(tab)
                  state.setShowSettings(true)
                }}
                onOpenShortcuts={() => state.setShowShortcuts(true)}
                isFirstLoadComplete={state.isFirstLoadComplete}
              />
            ) : (
              <p className="p-6 text-[13px] text-[var(--shell-text-dim)]">{t("Select a part first.")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
        providerRevision={providerRevision}
        onProvidersChanged={() => setProviderRevision(r => r + 1)}
        onExportAllData={state.exportAllData}
      />

      <JobComposer
        showComposer={state.showComposer}
        providerRevision={providerRevision}
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
        <AlertDialogContent className="bg-[rgba(34,31,28,0.96)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold text-[var(--shell-text)]">{t("Cancel Job?")}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-[var(--shell-text-muted)]">
              {t("This will cancel job \"")}{state.cancelTarget?.inputRequest?.slice(0, 60)}{t("\". This action cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[var(--shell-module-solid)] border-[color:var(--shell-border)] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] text-xs">{t("Keep Running")}</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--shell-fail)] hover:bg-[#FF6E36] text-white text-xs font-semibold" onClick={() => state.cancelTarget && state.handleCancel(state.cancelTarget)}>
              {t("Cancel Job")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={state.showShortcuts} onOpenChange={state.setShowShortcuts}>
        <DialogContent className="bg-[rgba(34,31,28,0.96)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] max-w-md overflow-x-hidden backdrop-blur-xl" aria-describedby="shortcuts-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 text-[var(--shell-text)]">
              <Keyboard className="w-4 h-4 text-[var(--shell-signal)]" />{t("Keyboard Shortcuts")}
            </DialogTitle>
            <DialogDescription id="shortcuts-description" className="sr-only">
              {t("Keyboard shortcuts for navigating and controlling AgentSCAD")}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[1px] bg-white/[0.075] my-1" />
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
            {/* Navigation */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpDown className="w-3.5 h-3.5 text-[var(--shell-signal)]" />
                <span className="text-[13px] font-mono tracking-widest text-[var(--shell-signal)] uppercase">{t("Navigation")}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { keys: ['Space', ''], desc: t("Hide/show panels") },
                  { keys: ['?', ''], desc: t("Toggle shortcuts") },
                  { keys: ['1', '-', '6'], desc: t("Switch inspector tab") },
                  { keys: ['E', ''], desc: t("Edit SCAD code") },
                  { keys: ['H', ''], desc: t("Show history (LOG)") },
                  { keys: ['S', ''], desc: t("Open stats dashboard") },
                  { keys: ['T', ''], desc: t("Open theme settings") },
                ].map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--shell-text-muted)]">{s.desc}</span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((k, i) => k ? <span key={i} className="px-1.5 py-0.5 rounded-[3px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] font-mono text-[11px] text-[var(--shell-text-muted)]">{k}</span> : <span key={i} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Job Actions */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Play className="w-3.5 h-3.5 text-[var(--shell-ok)]" />
                <span className="text-[13px] font-mono tracking-widest text-[var(--shell-ok)] uppercase">{t("Actions")}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { keys: ['⌘', 'N'], desc: t("New job") },
                  { keys: ['⌘', '⏎'], desc: t("Generate / Rebuild") },
                  { keys: ['Del'], desc: t("Delete selected") },
                ].map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--shell-text-muted)]">{s.desc}</span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((k, i) => <span key={i} className="px-1.5 py-0.5 rounded-[3px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] font-mono text-[11px] text-[var(--shell-text-muted)]">{k}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Inspector */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-3.5 h-3.5 text-[var(--shell-warn)]" />
                <span className="text-[13px] font-mono tracking-widest text-[var(--shell-warn)] uppercase">{t("Inspector Tabs")}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { key: '1', tab: t("SPEC") },
                  { key: '2', tab: t("PARAMS") },
                  { key: '3', tab: t("ASSIST") },
                  { key: '4', tab: t("VALID") },
                  { key: '5', tab: t("HISTORY") },
                  { key: '6', tab: t("CODE") },
                ].map((s) => (
                  <div key={s.tab} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--shell-text-muted)] font-mono">{s.tab}</span>
                    <span className="px-1.5 py-0.5 rounded-[3px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] font-mono text-[11px] text-[var(--shell-text-muted)]">{s.key}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* General */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-3.5 h-3.5 text-[var(--shell-signal)]" />
                <span className="text-[13px] font-mono tracking-widest text-[var(--shell-signal)] uppercase">{t("General")}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { keys: ['Esc'], desc: t("Close dialog") },
                  { keys: ['?'], desc: t("Toggle shortcuts") },
                ].map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-[var(--shell-text-muted)]">{s.desc}</span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((k, i) => <span key={i} className="px-1.5 py-0.5 rounded-[3px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] font-mono text-[11px] text-[var(--shell-text-muted)]">{k}</span>)}
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
        <DialogContent className="bg-[rgba(34,31,28,0.96)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] w-[min(44rem,calc(100vw-2rem))] max-w-none max-h-[min(82vh,760px)] overflow-y-auto overflow-x-hidden backdrop-blur-xl" aria-describedby="stats-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 text-[var(--shell-text)]">
              <BarChart3 className="w-4 h-4 text-[var(--shell-ok)]" />{t("Stats Dashboard")}
            </DialogTitle>
            <DialogDescription id="stats-description" className="sr-only">
              {t("Statistics and metrics for all CAD jobs")}
            </DialogDescription>
          </DialogHeader>
          <StatsDashboard jobs={state.allJobs} onClose={() => state.setShowStats(false)} />
        </DialogContent>
      </Dialog>

      {/* Job Compare */}
      <Dialog open={state.showCompare} onOpenChange={state.setShowCompare}>
        <DialogContent className="bg-[rgba(34,31,28,0.96)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] max-w-4xl max-h-[80vh] overflow-y-auto overflow-x-hidden backdrop-blur-xl" aria-describedby="compare-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 text-[var(--shell-text)]">
              <GitCompare className="w-4 h-4 text-[var(--shell-warn)]" />{t("Compare Designs")}
            </DialogTitle>
            <DialogDescription id="compare-description" className="sr-only">
              {t("Side-by-side comparison of selected CAD designs")}
            </DialogDescription>
          </DialogHeader>
          <JobCompare jobs={state.allJobs} />
        </DialogContent>
      </Dialog>

      {/* Theme & Settings */}
      <Dialog open={state.showSettings} onOpenChange={state.setShowSettings}>
        <DialogContent className="bg-[rgba(34,31,28,0.96)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] flex h-[min(760px,calc(100vh-3rem))] w-[min(42rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden backdrop-blur-xl" aria-describedby="settings-description">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 text-[var(--shell-text)]">
              <Settings className="w-4 h-4 text-[var(--shell-signal)]" />{t("Settings")}
            </DialogTitle>
            <DialogDescription id="settings-description" className="sr-only">
              {t("Theme customization, providers, and application settings")}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[1px] bg-white/[0.075] my-1" />
          <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as SettingsTab)} className="min-h-0 flex-1">
            <TabsList className="grid w-full grid-cols-3 bg-[var(--shell-module-solid)] border border-[color:var(--shell-border)]">
              <TabsTrigger value="providers" className="text-xs data-[state=active]:bg-[var(--shell-signal)] data-[state=active]:text-[#180D06]">{t("Providers")}</TabsTrigger>
              <TabsTrigger value="theme" className="text-xs data-[state=active]:bg-[var(--shell-signal)] data-[state=active]:text-[#180D06]">{t("Theme")}</TabsTrigger>
              <TabsTrigger value="language" className="text-xs data-[state=active]:bg-[var(--shell-signal)] data-[state=active]:text-[#180D06]">{t("Language")}
</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
              <TabsContent value="providers" forceMount className="mt-3 data-[state=inactive]:hidden">
                <ProviderSettingsPanel
                  onProvidersChanged={() => setProviderRevision(revision => revision + 1)}
                />
              </TabsContent>
              <TabsContent value="theme" forceMount className="mt-3 data-[state=inactive]:hidden">
                <ThemePanel />
              </TabsContent>
              <TabsContent value="language" forceMount className="mt-3 data-[state=inactive]:hidden">
                <LanguagePanel />
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
