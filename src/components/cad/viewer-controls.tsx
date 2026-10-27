'use client'

import { useI18n } from '@/components/i18n-provider'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Axis3D,
  Box,
  Camera,
  Download,
  Grid3x3,
  Loader2,
  Maximize2,
  Ruler,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import { fadeInUp, fadeInUpTransition } from './motion-presets'

export interface ViewerControlsState {
  autoRotate: boolean
  wireframe: boolean
  showGrid: boolean
  showAxes: boolean
  darkBg: boolean
  showDimensions: boolean
}

interface ViewerControlsProps {
  state: ViewerControlsState
  onChange: (state: ViewerControlsState) => void
  onResetCamera: () => void
  onScreenshot: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onDownloadStl?: () => void
  isDownloadingStl?: boolean
  hasStl?: boolean
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
}

interface ControlSpec {
  id: string
  icon: LucideIcon
  /** visible tooltip + accessible name */
  tooltip: string
  onClick?: () => void
  /** defined only for toggles; drives aria-pressed and the on/off plate treatment */
  pressed?: boolean
  disabled?: boolean
  spin?: boolean
  /** keep the last button's tooltip inside the viewport */
  align?: 'center' | 'right'
}

/*
 * One quiet plate, three groups: view actions, display toggles, output actions.
 *
 * The audit found nine floating unlabelled glyphs that nobody could decode. The
 * fix is not bigger icons - it is grouping, a visible on/off state, an accessible
 * name and a tooltip on every control, and an output pair that is recognisably
 * "capture" and "download". The plate borrows the module surface (9px radius,
 * module background, shell border and shadow) so the overlay reads as part of the
 * instrument panel rather than a stock media-player bar (DESIGN.md sections 3, 11,
 * 14: plates, not pills; one accent, never a second lit group).
 *
 * Glyph metric (DESIGN.md section 12, UI-14): every icon is drawn in the same
 * 18px box at 1.5 stroke, so the ruler no longer reads heavier than the grid just
 * because its diagonal silhouette fills more of its own bounds. On/off state is a
 * raised plate plus the icon stepping up to `--shell-text` - the 3px dot that used
 * to sit under it was a second, weaker encoding of the same fact and is gone.
 *
 * Responsive: at <1280 the composer owns the bottom centre and the plate keeps a
 * 206px footprint so it never lands on top of it; each group wraps to its own row
 * inside the same plate. At >=1280 (xl) the three groups sit on one row.
 */
export function ViewerControls({
  state,
  onChange,
  onResetCamera,
  onScreenshot,
  onZoomIn,
  onZoomOut,
  onDownloadStl,
  isDownloadingStl = false,
  hasStl = true,
}: ViewerControlsProps) {
  const { t } = useI18n()

  const toggle = useCallback(
    (key: keyof ViewerControlsState) => {
      onChange({ ...state, [key]: !state[key] })
    },
    [state, onChange]
  )

  const handleScreenshot = useCallback(() => {
    onScreenshot()
  }, [onScreenshot])

  /*
   * Active display toggles stay neutral rather than signal orange: grid and axes
   * are on by default, and the accent budget (DESIGN.md section 11) allows exactly
   * one lit group - the composer's action. A raised plate + brighter icon is the
   * on/off state, and aria-pressed carries it to assistive tech.
   */
  const viewControls: ControlSpec[] = [
    { id: 'fit', icon: Maximize2, tooltip: t('Fit to view'), onClick: onResetCamera },
    { id: 'zoom-in', icon: ZoomIn, tooltip: t('Zoom in'), onClick: onZoomIn },
    { id: 'zoom-out', icon: ZoomOut, tooltip: t('Zoom out'), onClick: onZoomOut },
  ]

  const displayControls: ControlSpec[] = [
    { id: 'wireframe', icon: Box, tooltip: t('Wireframe'), pressed: state.wireframe, onClick: () => toggle('wireframe') },
    { id: 'grid', icon: Grid3x3, tooltip: t('Grid'), pressed: state.showGrid, onClick: () => toggle('showGrid') },
    /*
     * The triad is ground furniture: it is measured against the grid, so it is
     * drawn with the grid and not independently of it. The button reports what
     * is actually on screen - with the grid off, the axes are off, and the
     * tooltip says why rather than leaving a switch that appears broken.
     */
    {
      id: 'axes',
      icon: Axis3D,
      tooltip: state.showGrid ? t('Axes') : t('Axes (needs the grid)'),
      pressed: state.showAxes && state.showGrid,
      onClick: () => toggle('showAxes'),
    },
    { id: 'dimensions', icon: Ruler, tooltip: t('Dimension labels'), pressed: state.showDimensions, onClick: () => toggle('showDimensions') },
  ]

  const outputControls: ControlSpec[] = [
    { id: 'screenshot', icon: Camera, tooltip: t('Screenshot'), onClick: handleScreenshot },
    ...(onDownloadStl
      ? [{
          id: 'export-stl',
          icon: isDownloadingStl ? Loader2 : Download,
          tooltip: isDownloadingStl ? t('Downloading STL…') : t('Export STL'),
          onClick: onDownloadStl,
          disabled: !hasStl || isDownloadingStl,
          spin: isDownloadingStl,
          align: 'right' as const,
        }]
      : []),
  ]

  const renderControl = (ctrl: ControlSpec) => {
    const Icon = ctrl.icon
    const tooltip = ctrl.pressed === undefined
      ? ctrl.tooltip
      : `${ctrl.tooltip} · ${ctrl.pressed ? t('On') : t('Off')}`
    return (
      <button
        key={ctrl.id}
        type="button"
        onClick={ctrl.disabled ? undefined : ctrl.onClick}
        disabled={ctrl.disabled}
        aria-label={ctrl.tooltip}
        aria-pressed={ctrl.pressed === undefined ? undefined : ctrl.pressed}
        title={tooltip}
        data-control={ctrl.id}
        className={`
          group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border
          transition-[background-color,color,border-color] duration-150
          focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1
          focus-visible:outline-[var(--shell-signal)]
          [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11
          ${
            ctrl.disabled
              ? 'cursor-not-allowed border-transparent text-[var(--shell-text-dim)] opacity-45'
              : ctrl.pressed
                ? 'border-[var(--shell-border-strong)] bg-[var(--shell-raise)] text-[var(--shell-text)] hover:bg-[var(--shell-hover)]'
                : 'border-transparent text-[var(--shell-text-label)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] active:bg-[var(--shell-raise)]'
          }
        `}
      >
        <Icon
          aria-hidden="true"
          strokeWidth={1.5}
          className={`h-[18px] w-[18px] ${ctrl.spin ? 'animate-spin' : ''}`}
        />
        <span
          role="tooltip"
          className={`
            pointer-events-none absolute bottom-[calc(100%+7px)] z-30 whitespace-nowrap rounded-[4px]
            border border-[var(--shell-border)] bg-[var(--shell-module-solid)] px-1.5 py-1
            font-mono text-[10px] leading-none text-[var(--shell-text)] shadow-[var(--shell-shadow)]
            opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100
            ${ctrl.align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'}
          `}
        >
          {tooltip}
        </span>
      </button>
    )
  }

  return (
    <>
      {/*
       * Desktop / tablet: the one quiet plate, bottom-right. Hidden below 960px
       * because the stacked layout (DESIGN.md section 20) pins a full-width sheet
       * bar + composer over the canvas bottom there: the plate sat behind their
       * z-40 layer and could not be used at all. Orbit and zoom are touch
       * gestures on that layout, so only Fit needs a floating control.
       */}
      <motion.div
        className="absolute bottom-4 right-4 z-20 hidden min-[960px]:block"
        variants={fadeInUp}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={fadeInUpTransition}
      >
        <div
          role="toolbar"
          aria-label={t('Viewport controls')}
          aria-orientation="horizontal"
          data-testid="viewer-toolbar"
          className="flex w-[206px] flex-wrap items-center justify-end rounded-[9px] border border-[var(--shell-border)] p-[2px] backdrop-blur-2xl xl:w-auto xl:flex-nowrap"
          style={{ background: 'var(--shell-module)', boxShadow: 'var(--shell-shadow)' }}
        >
          <div role="group" aria-label={t('View')} className="flex items-center">
            {viewControls.map(renderControl)}
          </div>
          <div aria-hidden="true" className="mx-px h-5 w-px shrink-0 bg-[var(--shell-border)]" />
          <div role="group" aria-label={t('Display')} className="flex items-center">
            {displayControls.map(renderControl)}
          </div>
          <div aria-hidden="true" className="mx-px hidden h-5 w-px shrink-0 bg-[var(--shell-border)] xl:block" />
          <div role="group" aria-label={t('Output')} className="flex items-center">
            {outputControls.map(renderControl)}
          </div>
        </div>
      </motion.div>

      {/* Narrow layouts: one 44px touch target for fit, top-right under the header.
          `onResetCamera` is the same fit that the desktop plate and the `f` key use. */}
      <div className="absolute right-4 top-4 z-20 min-[960px]:hidden">
        <button
          type="button"
          onClick={onResetCamera}
          aria-label={t('Fit to view')}
          title={t('Fit to view')}
          data-testid="viewer-fit-button"
          className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-[var(--shell-border-strong)] bg-[var(--shell-module)] text-[var(--shell-text)] backdrop-blur-2xl transition-transform hover:bg-[var(--shell-raise)] active:scale-95 focus-visible:border-[var(--shell-signal)] focus-visible:outline-none"
          style={{ boxShadow: 'var(--shell-shadow)' }}
        >
          <Maximize2 aria-hidden="true" strokeWidth={1.5} className="h-[18px] w-[18px]" />
        </button>
      </div>
    </>
  )
}

/**
 * Hook that provides default ViewerControls state and handlers.
 * The actual Three.js integration is in the parent component.
 */
export function useViewerControls(defaultState?: Partial<ViewerControlsState>) {
  const [state, setState] = useState<ViewerControlsState>({
    // DESIGN.md section 4: the part is inspected, not performed at. Auto-rotate
    // also makes the ViewCube's meaning drift, so it defaults off.
    autoRotate: false,
    wireframe: false,
    showGrid: true,
    showAxes: true,
    darkBg: true,
    showDimensions: false,
    ...defaultState,
  })

  const handleResetCamera = useCallback(() => {
    // This should be connected to the Three.js camera reset
    // The parent component should override this with actual camera reset logic
  }, [])

  const handleScreenshot = useCallback(() => {
    // Find the canvas in the viewer and capture it
    const canvas = document.querySelector('canvas')
    if (canvas) {
      const link = document.createElement('a')
      link.download = `cad-preview-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
  }, [])

  const handleZoomIn = useCallback(() => {
    // Dispatch a wheel event on the canvas to zoom in
    const canvas = document.querySelector('canvas')
    if (canvas) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, bubbles: true })
      )
    }
  }, [])

  const handleZoomOut = useCallback(() => {
    const canvas = document.querySelector('canvas')
    if (canvas) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, bubbles: true })
      )
    }
  }, [])

  return {
    state,
    setState,
    handleResetCamera,
    handleScreenshot,
    handleZoomIn,
    handleZoomOut,
  }
}
