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
  Plus, Keyboard,
  BarChart3, GitCompare, Palette,
  PanelLeft, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import dynamic from 'next/dynamic'
import type { CommandAction } from '@/components/cad/command-palette'
import { cn } from '@/lib/utils'

const NotificationCenter = dynamic(() => import('@/components/cad/notification-center').then(m => ({ default: m.NotificationCenter })), { ssr: false })
const CommandPalette = dynamic(() => import('@/components/cad/command-palette').then(m => ({ default: m.CommandPalette })), { ssr: false })
const ThemePanel = dynamic(() => import('@/components/cad/theme-panel').then(m => ({ default: m.ThemePanel })), { ssr: false })
const ProviderSettingsPanel = dynamic(() => import('@/components/cad/provider-settings-panel').then(m => ({ default: m.ProviderSettingsPanel })), { ssr: false })

const StatsDashboard = dynamic(() => import('@/components/cad/stats-dashboard').then(m => ({ default: m.StatsDashboard })), { ssr: false, loading: () => <div className="p-6"><Skeleton className="h-96 w-full rounded-[9px]" /></div> })
const JobCompare = dynamic(() => import('@/components/cad/job-compare').then(m => ({ default: m.JobCompare })), { ssr: false, loading: () => <div className="p-6"><Skeleton className="h-96 w-full rounded-[9px]" /></div> })

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
import { ModelPicker, engineLabel } from './ModelPicker'
import { Module } from './Module'
import { DimensionsModule } from './DimensionsModule'
import { ChecksModule, checksModuleHint } from './ChecksModule'
import { DecisionModule, readInterpretations } from './DecisionModule'
import { ReadoutModule } from './ReadoutModule'
import { resolveParameterSchema, effectiveParameterValues, builtParameterValues, parameterBoundingBox, parameterWallThickness } from './parameter-schema'
import { updateParameters, fetchJobVersions, fetchModels, type ModelInfo } from '@/components/cad/api'
import { getJobStateUi, getJobStateLabel, STATE_TONE_CLASS, STATE_TONE_DOT_CLASS } from '@/components/cad/types'

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

/*
 * The left column's geometry, in one place.
 *
 * The slots rail is anchored at the top of the column and the readout plate at
 * the bottom, so the rail's height ceiling is the distance between them - and
 * the readout's height is measured at runtime because it changes with the
 * part. These three constants are the fixed half of that sum.
 */
const SLOTS_RAIL_TOP = 70
const READOUT_BOTTOM = 16
const PLATE_GAP = 12

/** Which of the four run lamps is done / current, from the pipeline's own steps. */
function readLampStates(events: Array<{ step: string }>): Array<'done' | 'now' | 'idle'> {
  const reached = new Set<string>()
  for (const e of events) reached.add(e.step)

  const intakeDone = ['intent_analyzed', 'planning_reused', 'planning_geometry', 'geometry_planned'].some(s => reached.has(s))
  const synthesisDone = reached.has('scad_generated') || reached.has('compiling_scad')
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

  /*
   * The inline composer shows and switches the model engine, so the list has to
   * live at this level. It deliberately duplicates the fetch inside JobComposer
   * instead of lifting that one up: provider-model-refresh-contract.test.ts pins
   * the dialog's effect (its guard and its dependency array), and the dialog still
   * has to load the list when it is the first thing the user opens. Both follow the
   * same `providerRevision` counter, so a provider added in Settings appears in the
   * chip and in the dialog without a reload.
   *
   * Seeding matters more than it looks. Without it `newJobModelId` stays "" and
   * every inline creation posts an empty modelId, which the server quietly resolves
   * to a default - the user would be picking an engine and silently getting another.
   * DESIGN.md section 8: the model "defaults to the last healthy configured model".
   */
  const [generationModels, setGenerationModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoadingModels(true)
    fetchModels()
      .then(data => {
        if (cancelled) return
        const configured = data.models.slice(0, 9)
        setGenerationModels(configured)
        if (configured.length > 0) {
          state.setNewJobModelId(previous => (previous && configured.some(model => model.id === previous) ? previous : configured[0].id))
        }
      })
      .catch(() => {
        if (!cancelled) setGenerationModels([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false)
      })
    return () => { cancelled = true }
  }, [providerRevision, state.setNewJobModelId])

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
  /* The values the part was built from. Every "changed" answer on this screen is
     measured against this baseline and nothing else (DESIGN.md section 18: one
     writer for staleness). Comparing against `parameter.value` instead reports a
     change the moment a part whose build overrode the declared default is
     opened — the database contains exactly such a row. */
  const baselineValues = builtParameterValues(state.selectedJob, resolvedSchema)
  const declaredBox = Object.keys(effectiveValues).length ? parameterBoundingBox(effectiveValues) : null
  const declaredWall = parameterWallThickness(effectiveValues)

  /*
   * Which engine produced the part on screen.
   *
   * `job.modelId` has been stored since the pipeline started recording it, but
   * nothing rendered it, so a part could only be judged by its output. Once the
   * composer could switch engines, two parts in the same list can come from two
   * different models and there was no way to tell them apart - which is exactly
   * what you need when a build fails and the first instinct is "try another model".
   * Provenance lives with the part (here), the picker lives with the next action
   * (the composer chip); they answer different questions and must not look alike.
   */
  const jobEngine = engineLabel(generationModels, state.selectedJob?.modelId)

  const changes = (() => {
    if (!resolvedSchema || !paramDraft) return []
    return resolvedSchema.parameters
      .filter(p => {
        const next = paramDraft[p.key]
        const from = baselineValues[p.key]
        return (
          typeof next === 'number' &&
          typeof from === 'number' &&
          Math.abs(next - from) > 1e-9
        )
      })
      .map(p => ({ key: p.key, label: p.label, from: baselineValues[p.key], to: paramDraft[p.key] }))
  })()
  const hasDraftChanges = changes.length > 0
  const changedKeys = new Set(changes.map(change => change.key))

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
    const prompt = floatingPrompt.trim()
    if (prompt) {
      /*
       * The inline composer is the agent surface (DESIGN.md section 7): submitting a
       * brief creates the part here, without detouring through the New-part dialog.
       * That dialog used to be the only way in - ⌘⏎ and the circular button both
       * just opened it with the text copied across, so every creation cost a second
       * click and showed the user their own sentence again. The dialog is still
       * reachable from the rail (New part ⌘N) for templates, case memory and an
       * explicit model choice.
       *
       * A change to an existing part deliberately keeps the old path: there is no
       * revise endpoint, and creating a fresh job from one sentence like "make the
       * wall 3 mm" would throw away the original brief.
       */
      if (state.selectedJob) {
        state.setNewJobText(prompt)
        state.setShowComposer(true)
        setFloatingPrompt('')
        return
      }
      /*
       * The field is cleared only once the request has actually gone out. Clearing
       * first is what a submit handler usually does to stop a double send, but this
       * one can decline - no engine selected, or the POST fails - and a decline that
       * eats the user's sentence is worse than the double-send it prevents
       * (`activeOperationRef` already guards that).
       */
      void state.handleCreate(prompt).then(started => {
        if (started) setFloatingPrompt('')
      })
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

      /*
       * E / H open the two inspector tabs that have a natural mnemonic.
       *
       * Binding the tab alone was not binding the key. `setActiveTab('CODE')` only
       * moved a tab inside the 源码 / 记录 sheet, and that sheet is closed unless
       * something opened it - so E set a value nobody could see, the shortcut sheet
       * promised an editor, and pressing E did nothing at all. A shortcut has to
       * reach a surface the user can observe, so the key opens the sheet too.
       *
       * One key, one owner (DESIGN.md section 22): the digits below belong to
       * the camera, so the tab keys are letters and never collide.
       */
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase()
        if ((key === 'e' || key === 'h') && state.selectedJob) {
          e.preventDefault()
          state.setActiveTab(key === 'e' ? 'CODE' : 'HISTORY')
          setShowDetails(true)
          return
        }
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
  }, [state.showComposer, state.setActiveTab, state.selectedJob])

  // Command Palette Actions
  /* Icons inherit currentColor on purpose: the palette is a command list, not a
     colour legend. The previous per-row greens/ambers/oranges read as status. */
  const commandPaletteActions: CommandAction[] = [
    {
      id: 'create-job',
      label: t("New part"),
      icon: <Plus className="w-4 h-4" />,
      shortcut: '⌘N',
      onSelect: () => state.setShowComposer(true),
      category: 'action' as const,
    },
    {
      id: 'generate-selected',
      label: t("Generate"),
      icon: <Play className="w-4 h-4" />,
      shortcut: '⌘⏎',
      onSelect: () =>
        state.selectedJob ? state.handleProcess(state.selectedJob) : state.setShowComposer(true),
      category: 'action' as const,
    },
    {
      id: 'open-settings',
      label: t("Settings"),
      icon: <Settings className="w-4 h-4" />,
      shortcut: '',
      onSelect: () => {
        setSettingsTab('providers')
        setSettingsOpen(true)
      },
      category: 'action' as const,
    },
    {
      id: 'toggle-panels',
      label: t("Toggle panels"),
      icon: <PanelLeft className="w-4 h-4" />,
      shortcut: 'Space',
      onSelect: () => setIsSpaceHidden(v => !v),
      category: 'action' as const,
    },
    {
      id: 'toggle-theme',
      label: t("Toggle Theme"),
      icon: <Palette className="w-4 h-4" />,
      shortcut: 'T',
      onSelect: () => {
        setSettingsTab('theme')
        setSettingsOpen(true)
      },
      category: 'action' as const,
    },
    {
      id: 'show-stats',
      label: t("Show Statistics"),
      icon: <BarChart3 className="w-4 h-4" />,
      shortcut: '',
      onSelect: () => state.setShowStats(true),
      category: 'action' as const,
    },
    {
      id: 'show-compare',
      label: t("Compare Designs"),
      icon: <GitCompare className="w-4 h-4" />,
      shortcut: 'C',
      onSelect: () => state.setShowCompare(true),
      category: 'action' as const,
    },
    {
      id: 'export-data',
      label: t("Export All Data"),
      icon: <Box className="w-4 h-4" />,
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
    ? state.selectedJob.inputRequest
    : t("Untitled part")

  const lampStates = readLampStates(state.pipelineEvents)
  const revision = useRevision(state.selectedJob?.id ?? null)

  /* The header names the selected part's real state, from the one vocabulary in
     types.tsx. The previous triple lamp (provider / OpenSCAD / "Ready") showed three
     unexplained dots and still said "Ready" for a part whose run had failed, which
     is the opposite of trust. Provider health moved to Settings → Providers. */
  const headerState = state.selectedJob ? getJobStateUi(state.selectedJob.state) : null
  const headerStateLabel = state.isProcessing
    ? t("Running")
    : state.selectedJob
      ? getJobStateLabel(state.selectedJob.state, t)
      : t("No part selected")

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

  /*
   * DESIGN.md section 20: below 960px the floating-plate metaphor is replaced by a
   * stacked layout - the canvas takes the top of the screen, the composer is pinned
   * to the bottom, and every plate is a full-width sheet summoned one at a time from
   * a compact sheet bar. This is deliberately a layout swap, not a smaller version of
   * the floating layout: plates that overlap each other at 390px are unusable.
   */
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 959px)')
    const apply = () => setIsNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  type SheetId = 'slots' | 'params' | 'decision' | 'checks' | 'readout'
  const [activeSheet, setActiveSheet] = useState<SheetId | null>(null)

  /*
   * The slots rail and the readout plate share the left column, and the readout
   * changes height with its content: a part with no measured mesh prints two
   * extra lines (the "from parameters" note and the provenance line), which is
   * exactly the failure state the 2026-10-27 audit measured. A hardcoded
   * reserve therefore went wrong precisely when the screen was busiest - the
   * rail's 280px allowance assumed a 198px plate and the failed plate is 59px
   * taller, so the two overlapped by an area of 3511px² at 1024, 1280 and 1440.
   *
   * So the rail's ceiling is derived from the plate it has to clear, measured at
   * runtime. DESIGN.md section 27: derive layout maths from measured elements,
   * not duplicated constants.
   */
  const [readoutHeight, setReadoutHeight] = useState(0)
  useEffect(() => {
    if (isNarrow) {
      setReadoutHeight(0)
      return
    }
    const node = document.getElementById('readout')
    if (!node) return
    const measure = () => setReadoutHeight(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [isNarrow, state.selectedJob?.id, state.isProcessing])

  // A sheet can disappear when its content disappears (no job selected, code hidden).
  useEffect(() => {
    if (!isNarrow) return
    if (!state.selectedJob && (activeSheet === 'params' || activeSheet === 'decision' || activeSheet === 'checks')) {
      setActiveSheet('slots')
    }
  }, [isNarrow, state.selectedJob, activeSheet])

  const toggleSheet = useCallback((sheet: SheetId) => {
    setActiveSheet(current => (current === sheet ? null : sheet))
  }, [])

  /* The sheet bar is the narrow layout's only navigation: one plate at a time.
     Its labels are the plate titles verbatim - "Parts" on the tab opened a plate
     called "PART SLOTS", and a navigation that renames its destination is a small
     lie the user has to reconcile every time. */
  const narrowSheets: Array<{ id: SheetId; label: string; available: boolean }> = [
    { id: 'slots', label: t("Part slots"), available: true },
    { id: 'params', label: t("Dimensions"), available: Boolean(state.selectedJob) },
    { id: 'checks', label: t("Checks"), available: Boolean(state.selectedJob) },
    { id: 'readout', label: t("Readouts"), available: true },
  ]

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
   *
   * The failure state is the case the 2026-10-27 review flagged and the spec
   * never covered. Its trigger was here: the last term of the arming condition
   * was `selectedJob && !selectedJob.stlPath`, which is true for a part that was
   * never generated AND for a part whose generation failed. So on a failed part
   * the composer carried a 34px solid signal circle while the action the user
   * actually needed - "Generate again" on the failure card - was a 1px outline,
   * and both buttons ran the same pipeline call.
   *
   * The two cases are now separate. A part that has never been generated still
   * lights the composer, because pressing it is the only way to start it. A part
   * whose run failed does not: the failure card owns that state, it explains
   * what failed, and its button is the lit one. Typing a brief or editing a
   * parameter still lights the composer, because then it is a genuinely
   * different action and the only lit control on screen.
   */
  const isFailedJob = Boolean(
    state.selectedJob &&
    ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(state.selectedJob.state)
  )
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
    (!isFailedJob && Boolean(state.selectedJob && !state.selectedJob.stlPath))
  const isActionBusy = isSaving || state.isProcessing
  /*
   * The failure card is the lit action only while the composer is not. When the
   * user types a brief or edits a parameter the composer's circle takes the
   * accent back, and the card's button drops to the soft form so exactly one
   * solid control is on screen (DESIGN.md section 11).
   */
  const failureActionIsSolid = isFailedJob && !isActionArmed

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
        className={cn(
          "flex-1 min-h-0 w-full max-w-full overflow-hidden relative",
          isNarrow && "pt-12"
        )}
        style={{
          background: 'var(--shell-canvas-grad)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* Narrow layout: one compact header row (DESIGN.md section 20). The floating
            brand and density plates do not fit 390px, and two plates that fight for
            the same row clipped the wordmark off-screen. */}
        {isNarrow && (
          <header
            className="absolute inset-x-0 top-0 z-30 h-12 flex items-center gap-2 pl-3 pr-1.5 border-b border-[color:var(--shell-border)]"
            style={{ background: 'var(--shell-module)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
          >
            <span className="text-[12px] font-bold tracking-[0.06em] text-[var(--shell-text)] shrink-0">AGENTSCAD</span>
            <span className="min-w-0 flex-1 text-[11px] leading-[1.35] text-[var(--shell-text-label)] line-clamp-2" title={activeJobName}>
              {activeJobName}
            </span>
            <span
              className="flex items-center gap-1.5 shrink-0"
              title={t("Current state: {0}", { 0: headerStateLabel })}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  state.isProcessing
                    ? 'bg-[var(--shell-signal)] animate-pulse'
                    : headerState
                      ? STATE_TONE_DOT_CLASS[headerState.tone]
                      : 'bg-[var(--shell-text-dim)]'
                )}
              />
              <span
                className={cn(
                  'font-mono text-[11px] whitespace-nowrap',
                  state.isProcessing
                    ? 'text-[var(--shell-signal-soft)]'
                    : headerState
                      ? STATE_TONE_CLASS[headerState.tone]
                      : 'text-[var(--shell-text-label)]'
                )}
              >
                {headerStateLabel}
              </span>
            </span>
            <div id="mobile-header-actions" className="flex items-center shrink-0">
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
              title={t("Settings")}
              onClick={() => { setSettingsTab('providers'); setSettingsOpen(true) }}
              className="w-10 h-10 grid place-items-center rounded-[6px] text-[var(--shell-text-label)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
            </div>
          </header>
        )}

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

        {/* Vertical Ruler (desktop only) */}
        {!isNarrow && (
        <div
          className="pointer-events-none absolute left-[30px] top-[96px] bottom-[120px] w-4 border-l border-[color:var(--shell-border-strong)]"
          style={{
            backgroundImage: 'repeating-linear-gradient(180deg, var(--shell-tick) 0 1px, transparent 1px 24px)',
          }}
        >
          <span
            className="absolute left-5 top-[-4px] font-mono text-[11px] text-[var(--shell-text-dim)] select-none"
            style={{ writingMode: 'vertical-rl' }}
          >
            mm · 0 — 200
          </span>
        </div>
        )}

        {/* Canvas hint (desktop only: on touch it would sit under the sheets).
            It used to repeat the Space instruction that the composer's own hint row
            already carries, and after Space was pressed both places printed
            "PANELS HIDDEN · PRESS SPACE TO RESTORE" - two identical sentences, one
            above the other, one of them 108px off the bottom of the canvas. Only the
            thing the composer cannot say is left: that plates can be dragged. */}
        {!isNarrow && !isSpaceHidden && (
        <div className="pointer-events-none absolute left-1/2 bottom-[108px] -translate-x-1/2 font-mono text-[11px] tracking-[0.1em] text-[var(--shell-text-label)] uppercase select-none z-10">
          {t("Drag a module header to move it")}
        </div>
        )}

        {/* ── Floating Module Layer (Layer 2) ─────────────────────────────────── */}
        <div id="layer" className="absolute inset-0 pointer-events-none">

          {/* 1. Brand Module (Static pinned top-left) */}
          {!isNarrow && isModuleVisible('brand') && (
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
              /* Fixed width, not `calc(100vw - 480px)`. The plate measured 419 /
                 544 / 698 / 726px across four parts because it was sized by the
                 length of the brief, so the whole top row moved when the selection
                 changed and at 1024 the plate came within 22px of the density
                 control. One width, one truncation, one tooltip. */
              style={{ left: 16, top: 14, width: 460 }}
              bodyClassName="p-0"
              headerClassName="hidden"
            >
              <div className="flex items-center gap-2.5 px-3 py-1.5 cursor-grab active:cursor-grabbing">
                <span className="shrink-0 text-[12px] font-bold tracking-[0.08em] text-[var(--shell-text)] select-none">
                  AGENTSCAD
                </span>
                <span className="text-[10px] text-[var(--shell-text-dim)] font-mono select-none">·</span>
                <span
                  className="min-w-0 flex-1 text-[11px] leading-[1.35] text-[var(--shell-text-label)] line-clamp-2"
                  title={jobEngine ? t("{0} — built by {1}", { 0: activeJobName, 1: jobEngine.full }) : activeJobName}
                >
                  {activeJobName}
                </span>
                <div
                  className="shrink-0 flex items-center gap-1.5 ml-1 pl-2 border-l border-[color:var(--shell-hairline)]"
                  title={t("Current state: {0}", { 0: headerStateLabel })}
                >
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      state.isProcessing
                        ? 'bg-[var(--shell-signal)] shadow-[0_0_8px_rgb(var(--shell-signal-rgb)/0.8)] animate-pulse'
                        : headerState
                          ? STATE_TONE_DOT_CLASS[headerState.tone]
                          : 'bg-[var(--shell-text-dim)]'
                    )}
                  />
                  <span
                    className={cn(
                      'font-mono text-[11px] tracking-[0.06em] whitespace-nowrap',
                      state.isProcessing
                        ? 'text-[var(--shell-signal-soft)]'
                        : headerState
                          ? STATE_TONE_CLASS[headerState.tone]
                          : 'text-[var(--shell-text-label)]'
                    )}
                  >
                    {headerStateLabel}
                  </span>
                </div>

                {/* DESIGN.md "Secondary surfaces": settings and notifications are the
                    only two utility entry points in the product. Everything else is a
                    keystroke or a contextual action.
                    The engine that built the part used to sit here as a third chip;
                    it now lives in 读数, next to the measurements it produced - a
                    provenance label belongs with the artifact, not with the next
                    action, and this plate had no width left to give it. */}
                <div className="shrink-0 flex items-center gap-0.5 ml-1 pl-2 border-l border-[color:var(--shell-border)]">
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
                    className="w-7 h-7 grid place-items-center rounded-[4px] text-[var(--shell-text-label)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Module>
          )}

          {/* 2. Controls & Density Module (Static pinned top-right) */}
          {!isNarrow && isModuleVisible('controls') && (
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
                <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)] px-1 select-none">
                  {t("Panels")}
                </span>

                {/* Density Presets: Full / Tuning / Model-Only */}
                <div id="density" className="flex items-center gap-0.5 bg-[var(--shell-well)] rounded-[4px] p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDensity('full')
                      setIsSpaceHidden(false)
                    }}
                    aria-pressed={density === 'full' && !isSpaceHidden}
                    title={t("Show every panel")}
                    className={cn(
                      'font-mono text-[10px] tracking-[0.08em] px-2.5 h-7 inline-flex items-center rounded-[4px] cursor-pointer transition-all whitespace-nowrap',
                      density === 'full' && !isSpaceHidden
                        ? 'shell-selected font-semibold'
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
                    aria-pressed={density === 'tuning' && !isSpaceHidden}
                    title={t("Dimensions in focus, checks folded")}
                    className={cn(
                      'font-mono text-[10px] tracking-[0.08em] px-2.5 h-7 inline-flex items-center rounded-[4px] cursor-pointer transition-all whitespace-nowrap',
                      density === 'tuning' && !isSpaceHidden
                        ? 'shell-selected font-semibold'
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
                    aria-pressed={density === 'model-only' && !isSpaceHidden}
                    title={t("Only the model and composer")}
                    className={cn(
                      'font-mono text-[10px] tracking-[0.08em] px-2.5 h-7 inline-flex items-center rounded-[4px] cursor-pointer transition-all whitespace-nowrap',
                      density === 'model-only' && !isSpaceHidden
                        ? 'shell-selected font-semibold'
                        : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] bg-transparent'
                    )}
                  >
                    {t("Model")}
                  </button>
                </div>

                <div className="w-[1px] h-4 bg-[var(--shell-hairline)] mx-0.5" />

                {/* Layout Reset Control */}
                <button
                  type="button"
                  id="reset"
                  onClick={handleResetLayout}
                  title={t("Reset module positions")}
                  aria-label={t("Reset module positions")}
                  className="w-7 h-7 rounded-[4px] border border-[color:var(--shell-border)] hover:border-[color:var(--shell-border-strong)] text-[var(--shell-text-label)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] flex items-center justify-center font-mono text-[12px] cursor-pointer transition-colors"
                >
                  ↺
                </button>

                <div className="w-[1px] h-4 bg-[var(--shell-hairline)] mx-0.5" />

                {/* Revision label */}
                <span
                  id="qid"
                  className="font-mono text-[10px] tracking-[0.08em] text-[var(--shell-text-label)] px-1 select-none whitespace-nowrap"
                  title={state.selectedJob ? t("{0} saved versions", { 0: revision - 1 }) : undefined}
                >
                  {state.selectedJob ? t("Revision {0}", { 0: revision }) : t("Revision —")}
                </span>

                <div className="w-[1px] h-4 bg-[var(--shell-hairline)] mx-0.5" />


              </div>
            </Module>
          )}

          {/* 3. Four-Lamp Run Strip (Conditional while processing) */}
          {state.isProcessing && !isSpaceHidden && !isNarrow && (
            <div
              id="lamps"
              role="status"
              aria-live="polite"
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
                    aria-current={isCurrent ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1',
                      i < 3 && 'border-r border-[color:var(--shell-hairline)]'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        isPassed
                          ? 'bg-[var(--shell-ok)]'
                          : isCurrent
                          ? 'bg-[var(--shell-signal)] shadow-[0_0_7px_rgb(var(--shell-signal-rgb)/0.75)] animate-pulse'
                          : 'bg-[var(--shell-raise)]'
                      )}
                    />
                    <span
                      className={cn(
                        'font-mono text-[10px] tracking-[0.1em]',
                        isPassed ? 'text-[var(--shell-ok)]' : isCurrent ? 'text-[var(--shell-text)] font-semibold' : 'text-[var(--shell-text-dim)]'
                      )}
                    >
                      {lamp.label}
                    </span>
                    {/*
                      The four lamps printed the same four words at every stage:
                      which one was current was carried by colour alone, so a
                      screen reader heard nothing at all and the stage was
                      invisible without colour vision. The word is the signal;
                      the colour is the accent.
                    */}
                    <span className="sr-only">
                      {isPassed ? t("Done") : isCurrent ? t("Running") : t("Pending")}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* 4. Slots Module (Job List). On narrow screens this is a full-width
              sheet, summoned from the sheet bar; on desktop it is the left rail. */}
          {isModuleVisible('slots') && (!isNarrow || activeSheet === 'slots') && (
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
              style={
                isNarrow
                  ? {
                      left: 8,
                      right: 8,
                      top: 'auto',
                      bottom: 152,
                      width: 'auto',
                      maxHeight: 'max(220px, calc(55dvh - 200px))',
                    }
                  : {
                      left: 16,
                      top: 70,
                      width: 268,
                      /*
                       * Safe-area cap, measured rather than guessed.
                       *
                       * The rail is anchored at top 70 and the readout plate is
                       * anchored at bottom 16, so the rail has to stop short of
                       * wherever the readout actually starts. The readout's height
                       * is not a constant - it grows by two lines when a part has
                       * no measured mesh - so the reserve is computed from the
                       * live measurement (see `readoutHeight` above) instead of a
                       * number that was right for one part and wrong for the
                       * next. The 198px figure is only the pre-measurement
                       * fallback, for the first frame.
                       */
                      maxHeight: slotsState.isCollapsed
                        ? undefined
                        : isModuleVisible('readout')
                          ? `calc(100vh - ${SLOTS_RAIL_TOP + READOUT_BOTTOM + PLATE_GAP + (readoutHeight || 198)}px)`
                          : `calc(100vh - ${SLOTS_RAIL_TOP + PLATE_GAP + 60}px)`,
                    }
              }
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
                onSelectJob={(job) => {
                  state.selectJob(job, 'SPEC')
                  if (isNarrow) setActiveSheet(null)
                }}
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
                inset: isNarrow ? '48px 0 0 0' : 0,
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
                onViewLog={(job) => {
                  state.handleQuickViewLog(job)
                  setShowDetails(true)
                }}
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
                hasParts={state.allJobs.length > 0}
                failureActionIsSolid={failureActionIsSolid}
              />
            </Module>
          )}

          {/* ── 6. Right column: 尺寸 / 要你定一下 · 检验 ─────────────────────
              DESIGN.md section 3: modules live in their own columns and re-stack
              when one is collapsed or dragged away. `flow` puts them in the
              column's flex layout so that happens with no layout arithmetic;
              dragging one makes it free and the column closes the gap.

              Height is divided here, not by the container. The column used to be a
              fixed 702px scroll box holding 754px of plates with `shrink-0` on each:
              CODE was clipped to its title strip and, after any scroll, no plate was
              ever fully visible. Now the column does not scroll at all - 尺寸 takes
              what it needs up to 52%, 检验 takes the rest, CODE is fixed, and each
              plate scrolls its own body. DESIGN.md section 3.4: "a cutoff control is
              a bug". */}
          {(!isNarrow || activeSheet === 'params' || activeSheet === 'decision' || activeSheet === 'checks') && (
          <div
            id="right-column"
            data-testid="right-column"
            className={cn(
              'absolute flex flex-col gap-[10px] pointer-events-auto overflow-hidden',
              isNarrow
                ? 'left-2 right-2 bottom-[152px] top-auto w-auto max-h-[max(220px,calc(55dvh-200px))]'
                : 'right-4 top-[70px] w-[262px] bottom-[128px]'
            )}
          >
            {state.selectedJob && isModuleVisible('params') && !isAsking && (!isNarrow || activeSheet === 'params') && (
              <Module
                id="params"
                flow
                title={t("Dimensions")}
                /* No schema yet is a dash, not a sentence: the module is 262px wide and
                   "Awaiting generation" pushed the title itself into an ellipsis. The
                   body already says "Generate this part to see them here." */
                badge={hasDraftChanges ? t("{0} changed", { 0: changes.length }) : resolvedSchema ? t("{0} parameters", { 0: resolvedSchema.parameters.length }) : '—'}
                isFree={paramsState.isFree}
                isCollapsed={paramsState.isCollapsed}
                onCollapseChange={col => handleCollapseChange('params', col)}
                onDragEnd={pos => handleModuleDragEnd('params', pos)}
                onFocus={() => bringToFront('params')}
                zIndex={paramsState.zIndex}
                className={cn(!paramsState.isFree && 'shrink')}
                /* Each plate owns a share of the column and scrolls its own body, so
                   a long parameter list can never push 检验 off the bottom edge. */
                style={
                  paramsState.isFree
                    ? undefined
                    : isNarrow
                      ? { maxHeight: 'max(220px, calc(55dvh - 200px))' }
                      : { maxHeight: '52%' }
                }
              >
                <DimensionsModule
                  job={state.selectedJob}
                  values={effectiveValues}
                  changedKeys={changedKeys}
                  isProcessing={state.isProcessing}
                  onDraft={handleParamDraft}
                  onReset={handleParamReset}
                />
              </Module>
            )}

            {state.selectedJob && isModuleVisible('decision') && isAsking && (!isNarrow || activeSheet === 'decision') && (
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

            {state.selectedJob && isModuleVisible('checks') && (!isNarrow || activeSheet === 'checks') && (
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
                className={cn(!checksState.isFree && 'flex-1')}
                style={
                  checksState.isFree
                    ? undefined
                    : isNarrow
                      ? { maxHeight: 'max(220px, calc(55dvh - 200px))' }
                      : undefined
                }
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
                a tab inside another module, and it opens the full canvas view.
                The plate has no body - a module whose whole content was one button
                plus 41px of empty space read as a failed load. The action moved into
                the header, where a plate-level action belongs. */}
            {state.selectedJob?.scadSource && isModuleVisible('code') && !isCompact && (
              <Module
                id="code"
                flow
                title={t("Code")}
                badge={t("{0} ln", { 0: state.selectedJob.scadSource.split('\n').length })}
                collapsible={false}
                isFree={codeState.isFree}
                position={codeState.isFree ? { x: codeState.x, y: codeState.y } : undefined}
                onDragEnd={pos => handleModuleDragEnd('code', pos)}
                onFocus={() => bringToFront('code')}
                zIndex={codeState.zIndex}
                className={cn(!codeState.isFree && 'flex-none')}
                bodyClassName="hidden"
                headerAction={
                  <button
                    type="button"
                    onClick={() => {
                      state.setActiveTab('CODE')
                      setShowDetails(true)
                    }}
                    title={t("Open code and history")}
                    aria-label={t("Open code and history")}
                    className="flex h-[22px] items-center gap-[3px] rounded-[4px] border border-[color:var(--shell-border)] px-[7px] font-mono text-[10px] tracking-[0.06em] text-[var(--shell-text-muted)] transition-colors hover:border-[var(--shell-border-strong)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)]"
                  >
                    {t("Open")}
                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                }
              >
                {null}
              </Module>
            )}
          </div>
          )}

          {/* ViewCube: viewport-native, frameless, bottom-left above the readout.
              DESIGN.md section 4 - the cube is a shortcut into the same camera. */}
          {!isSpaceHidden && !isNarrow && (
            <div className="absolute left-[292px] bottom-[136px] z-20 pointer-events-auto" data-testid="view-cube">
              <ViewCube
                azimuth={camera.azimuth}
                elevation={camera.elevation}
                onChange={applyViewCommand}
                onCommand={applyViewCommand}
              />
            </div>
          )}

          {/* 7. Readout Module (Static pinned bottom-left per Section 6; sheet on narrow) */}
          {isModuleVisible('readout') && (!isNarrow || activeSheet === 'readout') && (
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
              style={
                isNarrow
                  ? { left: 8, right: 8, top: 'auto', bottom: 152, minWidth: 'auto' }
                  : { left: 16, bottom: 16, minWidth: 244 }
              }
            >
              <ReadoutModule
                job={state.selectedJob}
                declaredBoundingBox={declaredBox}
                declaredWallThickness={declaredWall}
                builtBy={jobEngine?.label ?? null}
              />
            </Module>
          )}

          {/* Narrow sheet bar (DESIGN.md section 20). Sits between the model and the
              composer; exactly one sheet can be open at a time. */}
          {isNarrow && !isSpaceHidden && (
            <nav
              aria-label={t("Panels")}
              className="absolute inset-x-2 bottom-[96px] z-40 pointer-events-auto flex items-center gap-1 p-1 rounded-[9px] border border-[color:var(--shell-border)]"
              style={{
                background: 'var(--shell-module)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow: 'var(--shell-shadow)',
              }}
            >
              {narrowSheets.filter(sheet => sheet.available).map((sheet) => (
                <button
                  key={sheet.id}
                  type="button"
                  aria-pressed={activeSheet === sheet.id}
                  onClick={() => toggleSheet(sheet.id)}
                  className={cn(
                    'flex-1 h-11 min-w-0 px-1 rounded-[6px] font-mono text-[11px] tracking-[0.02em] transition-colors truncate',
                    activeSheet === sheet.id
                      ? 'shell-tab-active font-semibold'
                      : 'text-[var(--shell-text-label)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)]'
                  )}
                >
                  {sheet.label}
                </button>
              ))}
            </nav>
          )}

          {/* 8. Anchored Composer (Never hidden by Space; Section 3 & 5 anchor) */}
          <div
            id="cmd"
            /* 620px at the reference size. Below ~1100px the centred composer starts to
               reach the 读数 column at bottom-left; capping the width at
               `100vw - 2*(16 + 244 + 8)` keeps the two out of each other's way without
               moving either (the 536 is the readout column plus its margins, twice).
               The 320px floor matters: without it the formula goes negative on a phone
               and the composer collapses to zero width - no field, no action, no way to
               start a design. Measured at 375px: 0px wide before, 320px after. */
            className={cn(
              'absolute z-40 pointer-events-auto select-none',
              isNarrow
                ? 'left-2 right-2 bottom-2 w-auto max-w-none'
                : 'bottom-4 left-1/2 -translate-x-1/2 w-[min(620px,max(320px,calc(100vw-536px)))] max-w-[calc(100vw-32px)]'
            )}
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
                <span className="text-[var(--shell-placeholder)] font-mono text-[13px] select-none">›</span>
                <input
                  id="prompt"
                  type="text"
                  /* The empty canvas already says "Describe the part you need."
                     Repeating it inside the field made the same sentence appear
                     twice within 400px, and the half that carried the useful part -
                     an example - was the one nobody finished reading. The field
                     shows only the example. */
                  placeholder={
                    state.selectedJob?.inputRequest
                      ? t("e.g. “Increase wall thickness to 2.4”")
                      : t("e.g. “Camera bracket for a 35 mm DIN rail”")
                  }
                  value={floatingPrompt}
                  onChange={(e) => setFloatingPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleComposerSubmit()
                    }
                  }}
                  aria-label={t("Describe the part or change")}
                  className="shell-field h-7 max-[959px]:h-11 flex-1 bg-transparent border-0 outline-none text-[13px] text-[var(--shell-text)] placeholder:text-[var(--shell-placeholder)] min-w-0 font-normal select-text"
                />

                {/* The engine, in the field. Before this chip the only place to see or
                    change the model was the New-part dialog, so an inline creation ran on
                    whatever the server defaulted to and the Settings sheet was the only
                    way to change it - a round trip for a one-word decision (DESIGN.md
                    section 5: the composer owns the action; section 8: the engine is part
                    of the brief). Quiet mono text, not a second filled control. */}
                <ModelPicker
                  models={generationModels}
                  value={state.newJobModelId}
                  isLoading={isLoadingModels}
                  partSelected={Boolean(state.selectedJob)}
                  onChange={state.setNewJobModelId}
                  onManage={() => {
                    setSettingsTab('providers')
                    state.setShowSettings(true)
                  }}
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
                    'w-[34px] h-[34px] max-[959px]:w-11 max-[959px]:h-11 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 cursor-pointer active:scale-95',
                    isActionArmed
                      ? 'bg-[var(--shell-signal)] text-[var(--shell-signal-ink)] shadow-[0_0_18px_rgb(var(--shell-signal-rgb)/0.34)] hover:bg-[var(--shell-signal-hover)]'
                      : 'bg-[var(--shell-hairline)] text-[var(--shell-text-label)] hover:bg-[var(--shell-border)] hover:text-[var(--shell-text)]'
                  )}
                >
                  {isActionBusy ? (
                    <span className="w-3 h-3 bg-current rounded-[3px]" />
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
              <div className="flex items-center justify-between gap-3 px-1 pt-1.5 text-[11px] font-mono text-[var(--shell-text-label)]">
                {!isNarrow && (
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <span>{t("⌘⏎ Generate")}</span>
                    <span>{t("Space Hide panels")}</span>
                    <button
                      type="button"
                      onClick={() => state.setShowCommandPalette(true)}
                      className="h-7 hover:text-[var(--shell-text)] transition-colors"
                    >
                      {t("⌘K Commands")}
                    </button>
                  </div>
                )}
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
                    ? /* "a new version" only makes sense when there is a version to
                         replace; on an empty workspace the same sentence described a
                         state that does not exist yet. */
                      state.selectedJob
                      ? t("Press ⌘ ⏎ to generate a new version")
                      : t("Press ⌘ ⏎ to generate")
                    : hasPendingDecision
                    ? t("Your choice will be added to the description")
                    : hasDraftChanges
                    ? t("{0} parameters changed · Rebuild required", { 0: changes.length })
                    : state.selectedJob?.stlPath
                    ? t("No rebuild needed")
                    : state.selectedJob
                    ? t("No geometry yet · Press Generate")
                    : /*
                       * The New-part dialog offers four groups of chips (Dimensions,
                       * Material, Process, Tolerance) that append vocabulary to the
                       * brief. The inline composer - now the default way in - has no
                       * chips, so without this line that vocabulary is invisible and
                       * nobody writes "PETG, FDM, 0.2 mm". One example teaches the
                       * shape of a good brief without a second row of controls on the
                       * input surface (DESIGN.md section 5).
                       */
                      t("Try “bracket, PETG, FDM, 0.2 mm”")}
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
          className="bg-[var(--shell-module)] border border-[color:var(--shell-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_48px_-12px_rgba(0,0,0,0.6)] rounded-[9px] flex w-[min(56rem,calc(100vw-2rem))] sm:max-w-none max-w-none h-[min(760px,calc(100vh-4rem))] flex-col overflow-hidden backdrop-blur-xl"
          aria-describedby="details-description"
        >
          <DialogHeader>
            <DialogTitle className="text-[13px] font-semibold text-[var(--shell-text)]">{t("Code / history")}</DialogTitle>
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
        open={settingsOpen || state.showSettings}
        onOpenChange={(open) => {
          if (!open) {
            setSettingsOpen(false)
            state.setShowSettings(false)
          } else {
            setSettingsOpen(true)
          }
        }}
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
        <AlertDialogContent className="shell-overlay rounded-[9px] backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[13px] font-semibold text-[var(--shell-text)]">{t("Cancel Job?")}</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] text-[var(--shell-text-muted)]">
              {t("This will cancel job \"")}{state.cancelTarget?.inputRequest?.slice(0, 60)}{t("\". This action cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[var(--shell-module-solid)] border-[color:var(--shell-border)] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] text-[12px]">{t("Keep Running")}</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--shell-fail)] hover:bg-[var(--shell-signal-hover)] text-white text-[12px] font-semibold" onClick={() => state.cancelTarget && state.handleCancel(state.cancelTarget)}>
              {t("Cancel Job")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Keyboard Shortcuts Dialog
          DESIGN.md section 5: "The shortcuts sheet is a contract, not a summary.
          If a key is retired, the row goes; if a key is promised, it is bound."
          The sheet listed E twice (once as "Edit SCAD code", once as "Code" under a
          second INSPECTOR TABS group), "Toggle shortcuts" twice, and coloured each
          group with a different hue - four headings at 13px, larger than any module
          title, in a dialog about keys. One heading style, one row per key, and
          every row is bound in MainWorkspace's keydown handler. */}
      <Dialog open={state.showShortcuts} onOpenChange={state.setShowShortcuts}>
        <DialogContent className="shell-overlay max-w-md overflow-x-hidden backdrop-blur-xl" aria-describedby="shortcuts-description">
          <DialogHeader>
            <DialogTitle className="text-[13px] flex items-center gap-2 text-[var(--shell-text)]">
              <Keyboard className="w-4 h-4 text-[var(--shell-signal)]" aria-hidden="true" />{t("Keyboard Shortcuts")}
            </DialogTitle>
            <DialogDescription id="shortcuts-description" className="sr-only">
              {t("Keyboard shortcuts for navigating and controlling AgentSCAD")}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[1px] bg-[var(--shell-hairline)] my-1" />
          <div className="max-h-[60vh] space-y-4 overflow-y-auto scroll-shell pr-1">
            {([
              {
                title: t("Navigation"),
                rows: [
                  { keys: ['Space'], desc: t("Hide or show the panels") },
                  { keys: ['1', '–', '6'], desc: t("Standard views") },
                  { keys: ['0'], desc: t("Isometric view") },
                  { keys: ['F'], desc: t("Fit to view") },
                  { keys: ['E'], desc: t("Open the code panel") },
                  { keys: ['H'], desc: t("Open the history panel") },
                  { keys: ['S'], desc: t("Open statistics") },
                  { keys: ['T'], desc: t("Open appearance settings") },
                ],
              },
              {
                title: t("Actions"),
                rows: [
                  { keys: ['⌘', 'K'], desc: t("Command palette") },
                  { keys: ['⌘', 'N'], desc: t("New part") },
                  { keys: ['⌘', '⏎'], desc: t("Generate or rebuild") },
                  { keys: ['Del'], desc: t("Delete the selected part") },
                  { keys: ['?'], desc: t("This sheet") },
                  { keys: ['Esc'], desc: t("Close the open panel") },
                ],
              },
            ]).map(group => (
              <div key={group.title}>
                <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
                  {group.title}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {group.rows.map(row => (
                    <div key={row.desc} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] text-[var(--shell-text-muted)]">{row.desc}</span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {row.keys.map((k, i) => (
                          <span
                            key={i}
                            className="min-w-[20px] rounded-[3px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] px-1.5 py-0.5 text-center font-mono text-[10px] text-[var(--shell-text-muted)]"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats Dashboard */}
      <Dialog open={state.showStats} onOpenChange={state.setShowStats}>
        <DialogContent className="shell-overlay rounded-[9px] w-[min(44rem,calc(100vw-2rem))] max-w-none max-h-[min(82vh,760px)] overflow-y-auto overflow-x-hidden backdrop-blur-xl" aria-describedby="stats-description">
          <DialogHeader>
            <DialogTitle className="text-[13px] flex items-center gap-2 text-[var(--shell-text)]">
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
        <DialogContent className="shell-overlay rounded-[9px] max-w-4xl max-h-[80vh] overflow-y-auto overflow-x-hidden backdrop-blur-xl" aria-describedby="compare-description">
          <DialogHeader>
            <DialogTitle className="text-[13px] flex items-center gap-2 text-[var(--shell-text)]">
              <GitCompare className="w-4 h-4 text-[var(--shell-warn)]" />{t("Compare Designs")}
            </DialogTitle>
            <DialogDescription id="compare-description" className="sr-only">
              {t("Side-by-side comparison of selected CAD designs")}
            </DialogDescription>
          </DialogHeader>
          <JobCompare jobs={state.allJobs} />
        </DialogContent>
      </Dialog>

      {/* Settings used to exist twice: this Dialog (opened by ⌘, / S / T and the
          command palette) and a SettingsSheet (opened by the gear). Two surfaces for
          one destination meant two tab styles, two focus treatments and two places to
          add a setting. The sheet is the one that owns the height contract and the
          export footer, so the dialog is gone and both entry points open the sheet. */}

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
