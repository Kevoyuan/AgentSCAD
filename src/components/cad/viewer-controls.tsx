'use client'

import { useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  RotateCcw,
  Grid3x3,
  Eye,
  EyeOff,
  Camera,
  ZoomIn,
  ZoomOut,
  Move3D,
  Axis3D,
  Sun,
  Moon,
  Ruler,
  Download,
  Loader2,
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
  const toggle = useCallback(
    (key: keyof ViewerControlsState) => {
      onChange({ ...state, [key]: !state[key] })
    },
    [state, onChange]
  )

  const handleScreenshot = useCallback(() => {
    onScreenshot()
  }, [onScreenshot])

  const navControls = [
    {
      icon: RotateCcw,
      label: 'Auto-rotate',
      active: state.autoRotate,
      onClick: () => toggle('autoRotate'),
    },
    {
      icon: Move3D,
      label: 'Reset camera',
      active: false,
      onClick: onResetCamera,
    },
    { icon: ZoomIn, label: 'Zoom in', active: false, onClick: onZoomIn },
    { icon: ZoomOut, label: 'Zoom out', active: false, onClick: onZoomOut },
  ]

  const displayControls = [
    {
      icon: state.wireframe ? Eye : EyeOff,
      label: 'Wireframe',
      active: state.wireframe,
      onClick: () => toggle('wireframe'),
    },
    {
      icon: Grid3x3,
      label: 'Grid',
      active: state.showGrid,
      onClick: () => toggle('showGrid'),
    },
    {
      icon: Axis3D,
      label: 'Axes',
      active: state.showAxes,
      onClick: () => toggle('showAxes'),
    },
    {
      icon: Ruler,
      label: 'Dimensions',
      active: state.showDimensions,
      onClick: () => toggle('showDimensions'),
    },
    {
      icon: state.darkBg ? Moon : Sun,
      label: 'Background',
      active: state.darkBg,
      onClick: () => toggle('darkBg'),
    },
  ]

  const outputControls = [
    {
      icon: Camera,
      label: 'Screenshot',
      active: false,
      onClick: handleScreenshot,
    },
    ...(onDownloadStl
      ? [
          {
            icon: isDownloadingStl ? Loader2 : Download,
            iconClassName: isDownloadingStl ? 'animate-spin' : undefined,
            label: isDownloadingStl ? 'Downloading STL...' : 'Download STL',
            active: false,
            disabled: !hasStl || isDownloadingStl,
            onClick: onDownloadStl,
          },
        ]
      : []),
  ]

  const renderGroup = (items: typeof navControls) => (
    <div className="flex items-center gap-0.5">
      {items.map((ctrl) => {
        const Icon = ctrl.icon
        const isDisabled = 'disabled' in ctrl && Boolean(ctrl.disabled)
        const isMeasure = ctrl.label === 'Dimensions'
        return (
          <button
            key={ctrl.label}
            onClick={isDisabled ? undefined : ctrl.onClick}
            disabled={isDisabled}
            title={isDisabled ? (!hasStl ? 'STL not rendered yet' : 'Downloading STL...') : `${ctrl.label}${ctrl.active ? ': ON' : ': OFF'}`}
            className={`
              relative flex items-center justify-center w-7 h-7 rounded-md transition-all active:scale-95
              ${
                isDisabled
                  ? 'opacity-30 cursor-not-allowed text-[var(--app-text-muted)]'
                  : ctrl.active
                  ? isMeasure
                    ? 'bg-[var(--cad-measure)]/15 text-[var(--cad-measure)] shadow-sm'
                    : 'bg-[var(--app-accent-bg)] text-[var(--app-accent)] shadow-sm'
                  : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]'
              }
            `}
          >
            <Icon className={`w-3.5 h-3.5 ${'iconClassName' in ctrl && ctrl.iconClassName ? ctrl.iconClassName : ''}`} />
            {ctrl.active && (
              <motion.span
                className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isMeasure ? 'bg-[var(--cad-measure)]' : 'bg-[var(--app-accent)]'}`}
                layoutId="viewer-control-active"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <motion.div
      className="absolute bottom-3 right-3 z-20"
      variants={fadeInUp}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={fadeInUpTransition}
    >
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#12161F]/85 backdrop-blur-2xl px-2 py-1 shadow-2xl">
        {renderGroup(navControls)}
        <div className="h-4 w-px bg-[color:var(--app-border-subtle)] mx-0.5" />
        {renderGroup(displayControls)}
        <div className="h-4 w-px bg-[color:var(--app-border-subtle)] mx-0.5" />
        {renderGroup(outputControls)}
      </div>
    </motion.div>
  )
}

/**
 * Hook that provides default ViewerControls state and handlers.
 * The actual Three.js integration is in the parent component.
 */
export function useViewerControls(defaultState?: Partial<ViewerControlsState>) {
  const [state, setState] = useState<ViewerControlsState>({
    autoRotate: true,
    wireframe: false,
    showGrid: true,
    showAxes: true,
    darkBg: true,
    showDimensions: true,
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
