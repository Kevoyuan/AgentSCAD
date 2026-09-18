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
      icon: Move3D,
      label: '重置视角',
      active: false,
      onClick: onResetCamera,
    },
    { icon: ZoomIn, label: '放大', active: false, onClick: onZoomIn },
    { icon: ZoomOut, label: '缩小', active: false, onClick: onZoomOut },
  ]

  /*
   * DESIGN.md section 4 keeps the viewport calm by default and section 6 gives the
   * measurements their own module. Grid and axes ride with the part; a rendered
   * bounding box duplicates the 读数 module and is therefore opt-in, not default.
   */
  const displayControls = [
    {
      icon: state.wireframe ? Eye : EyeOff,
      label: '线框',
      active: state.wireframe,
      onClick: () => toggle('wireframe'),
    },
    {
      icon: Grid3x3,
      label: '网格',
      active: state.showGrid,
      onClick: () => toggle('showGrid'),
    },
    {
      icon: Axis3D,
      label: '坐标轴',
      active: state.showAxes,
      onClick: () => toggle('showAxes'),
    },
    {
      icon: Ruler,
      label: '标注尺寸',
      active: state.showDimensions,
      onClick: () => toggle('showDimensions'),
    },
  ]

  const outputControls = [
    {
      icon: Camera,
      label: '截图',
      active: false,
      onClick: handleScreenshot,
    },
    ...(onDownloadStl
      ? [
          {
            icon: isDownloadingStl ? Loader2 : Download,
            iconClassName: isDownloadingStl ? 'animate-spin' : undefined,
            label: isDownloadingStl ? '正在下载 STL…' : '导出 STL',
            active: false,
            disabled: !hasStl || isDownloadingStl,
            onClick: onDownloadStl,
          },
        ]
      : []),
  ]

  /*
   * Active display toggles are neutral, not signal orange. Grid and axes are ON by
   * default, so lighting them with the signal colour would put two permanent orange
   * elements on screen competing with the composer's action — the accent budget in
   * DESIGN.md section 11 allows exactly one. DESIGN.md also removed the separate
   * measurement colour, so dimension values read as ordinary text.
   */
  const renderGroup = (items: typeof navControls) => (
    <div className="flex items-center gap-0.5">
      {items.map((ctrl) => {
        const Icon = ctrl.icon
        const isDisabled = 'disabled' in ctrl && Boolean(ctrl.disabled)
        return (
          <button
            key={ctrl.label}
            onClick={isDisabled ? undefined : ctrl.onClick}
            disabled={isDisabled}
            aria-label={ctrl.label}
            aria-pressed={ctrl.active}
            title={isDisabled ? (!hasStl ? '还没有可导出的 STL' : '正在下载…') : `${ctrl.label}${ctrl.active ? ' · 开' : ' · 关'}`}
            className={`
              relative flex items-center justify-center w-7 h-7 rounded-md transition-all active:scale-95
              ${
                isDisabled
                  ? 'opacity-30 cursor-not-allowed text-[var(--shell-text-muted)]'
                  : ctrl.active
                  ? 'bg-[var(--shell-raise)] text-[var(--shell-text)] shadow-sm'
                  : 'text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)]'
              }
            `}
          >
            <Icon className={`w-3.5 h-3.5 ${'iconClassName' in ctrl && ctrl.iconClassName ? ctrl.iconClassName : ''}`} />
            {ctrl.active && (
              <motion.span
                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--shell-text-label)]"
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
      <div
        className="flex items-center gap-1 rounded-full border border-[var(--shell-border)] px-2 py-1 backdrop-blur-2xl"
        style={{ background: 'var(--shell-module)', boxShadow: 'var(--shell-shadow)' }}
      >
        {renderGroup(navControls)}
        <div className="h-4 w-px bg-[color:var(--shell-border)] mx-0.5" />
        {renderGroup(displayControls)}
        <div className="h-4 w-px bg-[color:var(--shell-border)] mx-0.5" />
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
