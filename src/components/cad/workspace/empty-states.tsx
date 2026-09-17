'use client'

import React from 'react'
import {
  BoxSelect,
  SlidersHorizontal,
  Sparkles,
  ShieldCheck,
  History,
  FileCode,
  Plus,
  Play,
  RotateCcw,
  Layers,
  Filter,
  Cpu,
  Keyboard,
  Settings,
  Ruler,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Job } from '@/components/cad/types'

// ============================================================================
// 1. JobListEmptyState (左侧任务列表冷启动与筛选无匹配空状态)
// ============================================================================

export interface JobListEmptyStateProps {
  isFirstLoadComplete: boolean
  totalJobsCount: number
  hasActiveFilters: boolean
  onResetFilters: () => void
  onShowComposer: (presetText?: string) => void
}

export function JobListEmptyState({
  isFirstLoadComplete,
  totalJobsCount,
  hasActiveFilters,
  onResetFilters,
  onShowComposer,
}: JobListEmptyStateProps) {
  // Loading Skeleton State (Replaces Loader2 animate-spin, compliant with BAP-06)
  if (!isFirstLoadComplete) {
    return (
      <div className="p-2 space-y-2 min-w-0" data-testid="job-list-loading-skeleton">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-2.5 rounded-[6px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-24 rounded-[4px]" />
              <Skeleton className="h-4 w-14 rounded-[4px]" />
            </div>
            <Skeleton className="h-3 w-3/4 rounded-[3px]" />
            <div className="flex items-center gap-2 pt-0.5">
              <Skeleton className="h-2.5 w-16 rounded-[2px]" />
              <Skeleton className="h-2.5 w-12 rounded-[2px]" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Case B: Filter Mismatch (Jobs exist, but 0 matches current filter)
  if (totalJobsCount > 0 && hasActiveFilters) {
    return (
      <div className="relative flex flex-col items-center justify-center px-4 py-12 text-center select-none min-w-0">
        <div className="w-12 h-12 rounded-[6px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] flex items-center justify-center mb-3 text-[var(--app-text-dim)]">
          <Filter className="w-5 h-5 opacity-60" />
        </div>
        <span className="text-eyebrow text-[var(--app-text-muted)] mb-1">
          FILTER CRITERIA ACTIVE
        </span>
        <h4 className="text-[13px] font-semibold text-[var(--app-text-primary)] mb-1">
          No Matching CAD Jobs
        </h4>
        <p className="text-[11px] leading-relaxed text-[var(--app-text-dim)] max-w-[200px] mb-4">
          No jobs match your current search query or state filters.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onResetFilters}
          className="h-7 text-xs gap-1.5 border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] rounded-[6px] active:scale-[0.98]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          重置筛选 (Reset)
        </Button>
      </div>
    )
  }

  // Case A: Cold Start (No jobs exist in workspace)
  return (
    <div className="relative flex flex-col items-center justify-center px-3 py-10 text-center select-none min-w-0">
      <div className="w-12 h-12 rounded-[6px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] flex items-center justify-center mb-3 text-[var(--app-accent)] shadow-sm">
        <Layers className="w-5 h-5 opacity-75" />
      </div>
      <span className="text-eyebrow text-[var(--app-text-muted)] mb-1">
        WORKSPACE INITIALIZED
      </span>
      <h4 className="text-[13px] font-semibold text-[var(--app-text-primary)] mb-1">
        No CAD Jobs Yet
      </h4>
      <p className="text-[11px] leading-relaxed text-[var(--app-text-dim)] max-w-[220px] mb-4">
        Describe a physical part or choose an engineering preset below to synthesize OpenSCAD code.
      </p>

      {/* Primary Action */}
      <Button
        size="sm"
        onClick={() => onShowComposer()}
        className="h-7 text-xs font-medium gap-1.5 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white px-3 rounded-[6px] mb-4 active:scale-[0.98] w-full max-w-[200px]"
      >
        <Plus className="w-3.5 h-3.5" />
        Create CAD Job (⌘N)
      </Button>

      {/* Engineering Presets */}
      <div className="w-full max-w-[220px] space-y-1.5 text-left">
        <span className="text-[10px] font-mono text-[var(--app-text-dim)] uppercase tracking-wider block px-0.5">
          Engineering Presets
        </span>
        <button
          type="button"
          onClick={() =>
            onShowComposer(
              'Parametric spur gear with module 2, 24 teeth, 20-degree pressure angle, and 8mm bore.'
            )
          }
          className="w-full text-left px-2.5 py-1.5 rounded-[4px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors flex items-center justify-between group"
        >
          <span className="truncate">Spur Gear (模数 2)</span>
          <span className="text-[9px] font-mono text-[var(--app-text-dim)] group-hover:text-[var(--app-accent-text)]">
            +USE
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            onShowComposer(
              'Hinged electronics enclosure with 2.5mm wall thickness, M3 screw posts, ventilated grid slots, and snap-fit locking lid.'
            )
          }
          className="w-full text-left px-2.5 py-1.5 rounded-[4px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors flex items-center justify-between group"
        >
          <span className="truncate">Electronics Enclosure</span>
          <span className="text-[9px] font-mono text-[var(--app-text-dim)] group-hover:text-[var(--app-accent-text)]">
            +USE
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            onShowComposer(
              'Universal smartphone/tablet stand with adjustable 20-degree incline angle, 12mm phone slot width, and back cable routing hole.'
            )
          }
          className="w-full text-left px-2.5 py-1.5 rounded-[4px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors flex items-center justify-between group"
        >
          <span className="truncate">Device Stand</span>
          <span className="text-[9px] font-mono text-[var(--app-text-dim)] group-hover:text-[var(--app-accent-text)]">
            +USE
          </span>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// 2. CadViewportEmptyState (中央 3D 视口等轴测工程线框、十字标与遥测空状态)
// ============================================================================

export interface CadViewportEmptyStateProps {
  selectedJob?: Job | null
  isProcessing?: boolean
  isFirstLoadComplete?: boolean
  onProcess?: (job: Job) => void
  onShowComposer: (presetText?: string) => void
  onSetActiveTab?: (tab: string) => void
}

export function CadViewportEmptyState({
  selectedJob,
  isProcessing = false,
  isFirstLoadComplete = true,
  onProcess,
  onShowComposer,
  onSetActiveTab,
}: CadViewportEmptyStateProps) {
  // First load skeleton for viewport
  if (!isFirstLoadComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 h-full w-full cad-viewport-shell min-w-0 overflow-hidden select-none">
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center justify-between px-2">
            <Skeleton className="h-4 w-32 rounded-[4px]" />
            <Skeleton className="h-4 w-20 rounded-[4px]" />
          </div>
          <Skeleton className="h-56 w-full rounded-[8px]" />
          <div className="flex justify-center">
            <Skeleton className="h-8 w-44 rounded-[6px]" />
          </div>
        </div>
      </div>
    )
  }

  // Case B: A job is selected, but geometry (STL) is pending generation
  if (selectedJob && (selectedJob.state === 'NEW' || selectedJob.state === 'SCAD_GENERATED')) {
    return (
      <div className="flex-1 flex flex-col h-full w-full cad-viewport-shell min-w-0 overflow-hidden relative select-none">
        {/* Top Telemetry Strip */}
        <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between px-3 py-1.5 cad-viewport-glass rounded-[6px] border border-[color:var(--app-border-subtle)] text-[11px] font-mono tabular-nums text-[var(--app-text-muted)]">
          <div className="flex items-center gap-2 truncate">
            <span className="text-[var(--app-accent-text)] font-semibold">JOB: {selectedJob.id.slice(0, 8)}</span>
            <span className="text-[var(--app-border)]">|</span>
            <span className="truncate">FAMILY: {selectedJob.partFamily || 'INFERENCE_PENDING'}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] text-[10px] uppercase font-mono font-medium">
              {selectedJob.state}
            </span>
          </div>
        </div>

        {/* Center Pending Geometry Card with Technical Blueprint Background */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center z-0">
          {/* Isometric SVG Crosshair Watermark */}
          <div className="relative mb-5 flex items-center justify-center">
            <svg
              className="w-24 h-24 text-[var(--app-border-strong)] opacity-40"
              viewBox="0 0 100 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            >
              {/* Isometric 30° Cube Outline */}
              <path d="M50 15 L85 35 L85 75 L50 95 L15 75 L15 35 Z" />
              <path d="M50 15 L50 95" />
              <path d="M15 35 L85 75" />
              <path d="M85 35 L15 75" />
              {/* Center Crosshair */}
              <circle cx="50" cy="55" r="3" fill="#5e6ad2" fillOpacity="0.8" stroke="none" />
            </svg>
          </div>

          <span className="text-eyebrow text-[var(--app-text-muted)] mb-1">
            GEOMETRY SYNTHESIS STANDBY
          </span>
          <h3 className="text-sm font-semibold tracking-tight text-[var(--app-text-primary)] mb-1.5">
            Ready for OpenSCAD Compile
          </h3>
          <p className="text-xs font-mono text-[var(--app-text-muted)] max-w-md bg-[var(--app-surface)] border border-[color:var(--app-border-subtle)] rounded-[6px] p-2 mb-4 truncate text-left">
            "{selectedJob.inputRequest}"
          </p>

          <div className="flex items-center gap-2 shrink-0">
            {onProcess && (
              <Button
                size="sm"
                className="h-7 text-xs font-medium gap-1.5 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white px-3.5 rounded-[6px] active:scale-[0.98]"
                onClick={() => onProcess(selectedJob)}
                disabled={isProcessing}
              >
                <Play className="w-3.5 h-3.5" />
                {isProcessing ? 'Processing Pipeline...' : 'Process CAD Pipeline'}
              </Button>
            )}
            {onSetActiveTab && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs font-medium gap-1.5 border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] px-3 rounded-[6px] active:scale-[0.98]"
                onClick={() => onSetActiveTab('CODE')}
              >
                <FileCode className="w-3.5 h-3.5" />
                Inspect SCAD Source
              </Button>
            )}
          </div>
        </div>

        {/* Bottom Status Telemetry */}
        <div className="p-2 border-t border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] flex items-center justify-between text-[10px] font-mono text-[var(--app-text-dim)]">
          <span>PIPELINE ENGINE: DETERMINISTIC CSG</span>
          <span>COMPILER: OPENSCAD CLI</span>
        </div>
      </div>
    )
  }

  // Case A: No job selected at all (CAD Workbench Ready state)
  return (
    <div className="flex-1 flex flex-col h-full w-full cad-viewport-shell min-w-0 overflow-hidden relative select-none">
      {/* Top Glass Telemetry Bar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between px-3 py-1.5 cad-viewport-glass rounded-[6px] border border-[color:var(--app-border-subtle)] text-[11px] font-mono tabular-nums text-[var(--app-text-muted)]">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[var(--app-text-primary)] font-medium">SYS: STANDBY</span>
          <span className="text-[var(--app-border)]">|</span>
          <span className="hidden sm:inline">VIEW: 30° ISOMETRIC</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline">GRID: 10.0mm</span>
          <span className="text-[var(--app-border)] hidden md:inline">|</span>
          <span>KERNEL: CSG PARAMETRIC</span>
        </div>
      </div>

      {/* Isometric Grid Wireframe Center Stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center z-0 relative">
        {/* Isometric Coordinate Blueprint Wireframe SVG */}
        <div className="relative mb-5 flex items-center justify-center">
          <svg
            className="w-40 h-40 text-[var(--app-border-strong)]"
            viewBox="0 0 160 160"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            {/* 30-degree isometric ground grid lines */}
            <line x1="80" y1="95" x2="20" y2="60" strokeDasharray="3 3" opacity="0.4" />
            <line x1="80" y1="95" x2="140" y2="60" strokeDasharray="3 3" opacity="0.4" />
            <line x1="80" y1="95" x2="80" y2="25" opacity="0.3" strokeDasharray="2 2" />

            {/* 30° Isometric Bounding Box */}
            <path
              d="M80 30 L130 58 L130 115 L80 142 L30 115 L30 58 Z"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity="0.6"
            />
            <path d="M80 30 L80 87 L130 115" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
            <path d="M80 87 L30 115" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />

            {/* Triad Coordinate Axis Arrows from Origin */}
            {/* Z-Axis (Up, Blueprint Indigo) */}
            <line x1="80" y1="87" x2="80" y2="45" stroke="#5e6ad2" strokeWidth="2" />
            <polygon points="80,41 77,47 83,47" fill="#5e6ad2" />
            <text x="85" y="47" fill="#5e6ad2" fontSize="9" fontFamily="monospace" fontWeight="bold">
              Z
            </text>

            {/* X-Axis (Right-Down, Soft Red) */}
            <line x1="80" y1="87" x2="118" y2="108" stroke="#f87171" strokeWidth="2" />
            <polygon points="121,110 114,107 117,103" fill="#f87171" />
            <text x="124" y="112" fill="#f87171" fontSize="9" fontFamily="monospace" fontWeight="bold">
              X
            </text>

            {/* Y-Axis (Left-Down, Soft Green) */}
            <line x1="80" y1="87" x2="42" y2="108" stroke="#34d399" strokeWidth="2" />
            <polygon points="39,110 43,103 46,107" fill="#34d399" />
            <text x="32" y="112" fill="#34d399" fontSize="9" fontFamily="monospace" fontWeight="bold">
              Y
            </text>

            {/* Origin Dot */}
            <circle cx="80" cy="87" r="2.5" fill="#ffffff" stroke="#5e6ad2" strokeWidth="1.5" />
            <text x="60" y="80" fill="currentColor" opacity="0.6" fontSize="7" fontFamily="monospace">
              [0,0,0]
            </text>

            {/* Crosshair reticles */}
            <path d="M26 58 L34 58 M30 54 L30 62" stroke="currentColor" opacity="0.4" />
            <path d="M126 58 L134 58 M130 54 L130 62" stroke="currentColor" opacity="0.4" />
            <path d="M76 30 L84 30 M80 26 L80 34" stroke="currentColor" opacity="0.4" />
          </svg>
        </div>

        {/* Center Information Block (Solid Typography, NO BAP-04 Gradient) */}
        <span className="text-eyebrow text-[var(--app-text-muted)] mb-1">
          PRECISION WORKBENCH
        </span>
        <h3 className="text-base font-semibold tracking-tight text-[var(--app-text-primary)] mb-1.5">
          CAD Viewport Ready
        </h3>
        <p className="text-xs text-[var(--app-text-muted)] max-w-sm mb-5 leading-relaxed">
          Select a CAD job from the left panel to explore 3D geometry and watertight manifold telemetry, or initialize a new parametric design.
        </p>

        {/* Action Button */}
        <div className="flex flex-col sm:flex-row items-center gap-2 mb-4">
          <Button
            size="sm"
            onClick={() => onShowComposer()}
            className="h-8 text-xs font-medium gap-1.5 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white px-4 rounded-[6px] active:scale-[0.98] shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Create New CAD Design (⌘N)
          </Button>
        </div>

        {/* Fast-load Template Chips */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md">
          <button
            type="button"
            onClick={() =>
              onShowComposer(
                'Parametric spur gear with module 2, 24 teeth, 20-degree pressure angle, and 8mm bore.'
              )
            }
            className="px-2.5 py-1 rounded-[4px] border border-[color:var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors"
          >
            Spur Gear
          </button>
          <button
            type="button"
            onClick={() =>
              onShowComposer(
                'Hinged electronics enclosure with 2.5mm wall thickness, M3 screw posts, ventilated grid slots, and snap-fit locking lid.'
              )
            }
            className="px-2.5 py-1 rounded-[4px] border border-[color:var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors"
          >
            Electronics Box
          </button>
          <button
            type="button"
            onClick={() =>
              onShowComposer(
                'Universal smartphone/tablet stand with adjustable 20-degree incline angle, 12mm phone slot width, and back cable routing hole.'
              )
            }
            className="px-2.5 py-1 rounded-[4px] border border-[color:var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors"
          >
            Device Stand
          </button>
          <button
            type="button"
            onClick={() =>
              onShowComposer(
                'Minimalist phone case with camera bump lip protection, accurate cutout slots for charger and speakers, and 1.5mm wrap-around bumper walls.'
              )
            }
            className="px-2.5 py-1 rounded-[4px] border border-[color:var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)] text-[11px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors"
          >
            Phone Case
          </button>
        </div>
      </div>

      {/* Bottom Technical Strip */}
      <div className="p-2 border-t border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] flex items-center justify-between text-[10px] font-mono text-[var(--app-text-dim)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-emerald-500 font-semibold">● OPENSCAD RUNTIME ACTIVE</span>
          <span className="text-[var(--app-border)]">|</span>
          <span>WASM & NATIVE CLI</span>
        </div>
        <div className="flex items-center gap-2">
          <span>STL / PNG EXPORT READY</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 3. InspectorEmptyState (右侧检查器 6 大灰度功能架构卡片与快捷入口)
// ============================================================================

export interface InspectorEmptyStateProps {
  isFirstLoadComplete: boolean
  onShowComposer: () => void
  onOpenSettings: (tab: 'providers' | 'theme') => void
  onOpenShortcuts: () => void
}

export function InspectorEmptyState({
  isFirstLoadComplete,
  onShowComposer,
  onOpenSettings,
  onOpenShortcuts,
}: InspectorEmptyStateProps) {
  // First load skeleton for inspector
  if (!isFirstLoadComplete) {
    return (
      <div className="p-4 space-y-3 h-full min-w-0 select-none" data-testid="inspector-loading-skeleton">
        {/* Tab Header Skeleton */}
        <div className="flex items-center gap-1 pb-2 border-b border-[color:var(--app-border)]">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-6 flex-1 rounded-[4px]" />
          ))}
        </div>
        {/* Content Skeletons */}
        <div className="space-y-3 pt-2">
          <Skeleton className="h-20 w-full rounded-[6px]" />
          <Skeleton className="h-28 w-full rounded-[6px]" />
          <Skeleton className="h-28 w-full rounded-[6px]" />
        </div>
      </div>
    )
  }

  const capabilityCards = [
    {
      id: 'SPEC',
      label: 'SPEC',
      title: 'Specification & Intent',
      desc: 'Physical constraints, bounding limits, and generative requirements.',
      icon: BoxSelect,
    },
    {
      id: 'PARAMS',
      label: 'PARAMS',
      title: 'Parametric Engine',
      desc: 'Dual-bound sliders & precision numerical inputs for OpenSCAD variables.',
      icon: SlidersHorizontal,
    },
    {
      id: 'ASSIST',
      label: 'ASSIST',
      title: 'Copilot & Diagnostics',
      desc: 'AI repair proposals, patch synthesis, and manufacturing suggestions.',
      icon: Sparkles,
    },
    {
      id: 'VALID',
      label: 'VALID',
      title: 'Deterministic Rules',
      desc: 'C001, B001, C002, H001 watertight manifold & minimum thickness validation.',
      icon: ShieldCheck,
    },
    {
      id: 'HIST',
      label: 'HISTORY',
      title: 'Audit & Rollback',
      desc: 'Immutable snapshot history, line-by-line diffs, and notes audit trail.',
      icon: History,
    },
    {
      id: 'CODE',
      label: 'CODE',
      title: 'OpenSCAD Syntax Editor',
      desc: 'Direct code editor with live syntax highlighting and recompile binding.',
      icon: FileCode,
    },
  ]

  return (
    <div className="flex flex-col h-full justify-between p-4 select-none min-w-0 overflow-y-auto">
      <div className="space-y-4 min-w-0">
        {/* Architecture Header */}
        <div className="border-b border-[color:var(--app-border-subtle)] pb-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-eyebrow text-[var(--app-text-muted)]">
              INSPECTOR ARCHITECTURE
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--app-surface-raised)] border border-[color:var(--app-border-subtle)] text-[var(--app-text-dim)]">
              STANDBY
            </span>
          </div>
          <h3 className="text-sm font-semibold tracking-tight text-[var(--app-text-primary)]">
            No CAD Job Selected
          </h3>
          <p className="text-xs text-[var(--app-text-muted)] leading-relaxed mt-1">
            Select an active job from the workspace to unlock parameter tuning, manufacturing rule checks, and code editing.
          </p>
        </div>

        {/* 6 Grayscale Capability Cards (Neutral Surface, Monospace Details) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
          {capabilityCards.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.id}
                className="p-2.5 rounded-[6px] border border-[color:var(--app-border-subtle)] bg-[var(--app-surface)] opacity-75 hover:opacity-100 transition-opacity flex flex-col justify-between space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 text-[var(--app-text-secondary)]">
                    <Icon className="w-3.5 h-3.5 shrink-0 text-[var(--app-text-muted)]" />
                    <span className="text-[11px] font-mono font-semibold tracking-wider">
                      {card.label}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[var(--app-text-dim)]">
                    READY
                  </span>
                </div>
                <p className="text-[10px] leading-tight text-[var(--app-text-dim)]">
                  {card.desc}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Quick Access Footer */}
      <div className="pt-4 border-t border-[color:var(--app-border-subtle)] mt-4 space-y-2 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--app-text-dim)] block">
          Quick Actions
        </span>
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm"
            onClick={onShowComposer}
            className="h-7 text-xs font-medium gap-1.5 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white px-3 rounded-[6px] active:scale-[0.98] w-full justify-start"
          >
            <Plus className="w-3.5 h-3.5" />
            Create New CAD Job (⌘N)
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenSettings('providers')}
              className="h-7 text-xs gap-1.5 border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] rounded-[6px] active:scale-[0.98] truncate"
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Providers</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenShortcuts}
              className="h-7 text-xs gap-1.5 border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] rounded-[6px] active:scale-[0.98] truncate"
            >
              <Keyboard className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Shortcuts (?)</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
