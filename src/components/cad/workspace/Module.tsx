'use client'

import { useI18n } from '@/components/i18n-provider'

import * as React from 'react'
import { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

export interface ModuleProps {
  id: string
  title: React.ReactNode
  /**
   * A module title is a heading, so screen readers can navigate the eight plates as
   * an outline (DESIGN.md section 21). The brand plate carries a wordmark rather than
   * a section name, so it opts out.
   */
  titleAs?: 'h2' | 'span'
  badge?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  headerClassName?: string
  draggable?: boolean
  collapsible?: boolean
  isCollapsed?: boolean
  defaultCollapsed?: boolean
  onCollapseChange?: (collapsed: boolean) => void
  position?: { x?: number; y?: number }
  isFree?: boolean
  onDragEnd?: (pos: { x: number; y: number }) => void
  onFocus?: () => void
  hidden?: boolean
  zIndex?: number
  style?: React.CSSProperties
  right?: number | string
  bottom?: number | string
  /**
   * Flow mode: the module takes part in its column's flex layout instead of being
   * absolutely positioned. This is what makes re-stacking work without JS —
   * collapsing or dragging one module out of a column moves the modules below it
   * up (DESIGN.md "Module contract", item 3).
   */
  flow?: boolean
  /**
   * A quiet control that belongs to the plate rather than to its body: the CODE
   * plate's "open" action lives here instead of inside an otherwise empty body.
   */
  headerAction?: React.ReactNode
}

export function Module({
  id,
  title,
  titleAs = 'h2',
  badge,
  children,
  className,
  bodyClassName,
  headerClassName,
  draggable = true,
  collapsible = true,
  isCollapsed: controlledCollapsed,
  defaultCollapsed = false,
  onCollapseChange,
  position,
  isFree = false,
  onDragEnd,
  onFocus,
  hidden = false,
  zIndex,
  style,
  right,
  bottom,
  flow = false,
  headerAction,
}: ModuleProps) {
  const { t } = useI18n()

  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed

  const [isDragging, setIsDragging] = useState(false)
  const moduleRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    initX: number
    initY: number
  }>({ startX: 0, startY: 0, initX: 0, initY: 0 })

  const toggleCollapse = () => {
    const next = !isCollapsed
    if (controlledCollapsed === undefined) {
      setInternalCollapsed(next)
    }
    onCollapseChange?.(next)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return
    const target = e.target as HTMLElement
    if (target.closest('button, input, select, textarea, .no-drag, [role="button"]')) return

    const moduleEl = moduleRef.current
    if (!moduleEl) return

    e.preventDefault()
    onFocus?.()
    setIsDragging(true)

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    const parentRect = moduleEl.offsetParent?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const currentRect = moduleEl.getBoundingClientRect()

    const curX = currentRect.left - parentRect.left
    const curY = currentRect.top - parentRect.top

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: curX,
      initY: curY,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const moduleEl = moduleRef.current
    if (!moduleEl) return

    const parent = moduleEl.offsetParent as HTMLElement | null
    const parentWidth = parent ? parent.clientWidth : window.innerWidth
    const parentHeight = parent ? parent.clientHeight : window.innerHeight

    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY

    const w = moduleEl.offsetWidth
    const h = moduleEl.offsetHeight

    const nextX = Math.max(8, Math.min(parentWidth - w - 8, dragRef.current.initX + dx))
    const nextY = Math.max(8, Math.min(parentHeight - h - 8, dragRef.current.initY + dy))

    moduleEl.style.left = `${nextX}px`
    moduleEl.style.top = `${nextY}px`
    moduleEl.style.right = 'auto'
    moduleEl.style.bottom = 'auto'
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    const moduleEl = moduleRef.current
    if (moduleEl) {
      const left = parseFloat(moduleEl.style.left) || 0
      const top = parseFloat(moduleEl.style.top) || 0
      onDragEnd?.({ x: left, y: top })
    }
  }

  // The style prop owns static left/top. This effect owns only the *free* (dragged)
  // position. Writing '' here when position is undefined is what flattened every
  // module to 0,0 - two writers for one element, which DESIGN.md section 22 forbids.
  const wasFreeRef = useRef(false)
  const staticPosRef = useRef<{ left?: unknown; top?: unknown }>({ left: style?.left, top: style?.top })

  useEffect(() => {
    if (isDragging) return
    const moduleEl = moduleRef.current
    if (!moduleEl) return

    const isFreeNow = isFree && position?.x !== undefined && position?.y !== undefined

    if (isFreeNow) {
      moduleEl.style.left = `${position!.x}px`
      moduleEl.style.top = `${position!.y}px`
      moduleEl.style.right = 'auto'
      moduleEl.style.bottom = 'auto'
      wasFreeRef.current = true
      return
    }

    // Not free. If this component never took over the position, the style prop still
    // owns it and must be left alone.
    if (!wasFreeRef.current) return
    wasFreeRef.current = false

    // A flow module returns to its column: clearing the inline offsets is what
    // puts it back in the flex layout rather than at the stage origin.
    if (flow) {
      moduleEl.style.left = ''
      moduleEl.style.top = ''
      moduleEl.style.right = ''
      moduleEl.style.bottom = ''
      return
    }

    const px = (v: unknown) =>
      v === undefined || v === null || v === '' ? '' : typeof v === 'number' ? `${v}px` : String(v)
    moduleEl.style.left = px(staticPosRef.current.left)
    moduleEl.style.top = px(staticPosRef.current.top)
    moduleEl.style.right = px(right)
    moduleEl.style.bottom = px(bottom)
  }, [position, isFree, right, bottom, isDragging, flow])

  return (
    <div
      id={id}
      data-module={id}
      data-free={isFree ? '1' : undefined}
      ref={moduleRef}
      onMouseDown={onFocus}
      className={cn(
        // overflow-hidden: the plate clips its own rounded corners and the body below
        // scrolls instead of painting outside it. The column display is applied
        // conditionally - putting `flex` in the base list would out-rank Tailwind's
        // `hidden` in the stylesheet and modules would stop hiding entirely.
        'mod group select-none transition-[box-shadow,border-color] duration-200 pointer-events-auto',
        // A flow module rides its column; a free or standalone module is absolute.
        // It also becomes absolute for the duration of a drag, because the drag
        // maths produces stage coordinates, and the drag ends by reporting those
        // coordinates back as the module's free position.
        //
        // `min-h-0` and no `shrink-0`: a plate in a flex column must be allowed to
        // give height back to its siblings. With `shrink-0` three plates whose
        // natural heights summed to 754px sat in a 702px column and the last one
        // was simply clipped - which is what made CODE look like a broken plate.
        flow && !isFree && !isDragging ? 'relative min-h-0' : 'absolute',
        'overflow-hidden',
        isDragging && 'drag',
        isCollapsed && 'closed',
        hidden ? 'hidden' : 'flex flex-col',
        className
      )}
      style={{
        background: 'var(--shell-module)',
        border: '1px solid var(--shell-border)',
        borderRadius: '9px',
        // One token per state: a dragging plate is the same plate, raised.
        boxShadow: isDragging ? 'var(--shell-shadow-lift)' : 'var(--shell-shadow)',
        backdropFilter: 'blur(16px) saturate(1.15)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
        zIndex: zIndex ?? (isDragging ? 60 : 20),
        ...(flow
          ? {}
          : {
              left: position?.x !== undefined ? `${position.x}px` : undefined,
              top: position?.y !== undefined ? `${position.y}px` : undefined,
              right: isFree ? 'auto' : right !== undefined ? (typeof right === 'number' ? `${right}px` : right) : undefined,
              bottom: isFree ? 'auto' : bottom !== undefined ? (typeof bottom === 'number' ? `${bottom}px` : bottom) : undefined,
            }),
        ...style,
      }}
    >
      {/* 1px inner top highlight per section 13 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-[var(--shell-hairline)] z-10" />

      {/* Module Header (Draggable handle) */}
      <div
        className={cn(
          'mod-h flex items-center gap-2 px-[11px] py-[9px] pb-[8px] relative select-none',
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          headerClassName
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Grip line affordance on hover */}
        {draggable && (
          <div className="grip pointer-events-none absolute left-1/2 top-[3px] -translate-x-1/2 w-[26px] h-[2px] rounded-full bg-[var(--shell-border-strong)] opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        )}

        {/* Title: 9px mono engraved per Section 12, and a real heading so the eight
            plates form an outline for screen readers (DESIGN.md section 21). */}
        {titleAs === 'h2' ? (
          <h2 className="font-mono text-[10px] font-medium tracking-[0.14em] uppercase text-[var(--shell-text-label)] truncate m-0">
            {title}
          </h2>
        ) : (
          <span className="font-mono text-[10px] font-medium tracking-[0.14em] uppercase text-[var(--shell-text-label)] truncate">
            {title}
          </span>
        )}

        {/* State/Badge on the right */}
        {badge && (
          <span className="font-mono text-[10px] tracking-[0.06em] text-[var(--shell-text-muted)] ml-auto mr-1 truncate">
            {badge}
          </span>
        )}

        {/* A plate-level action sits before the collapse control, at the same
            optical weight as the badge. */}
        {headerAction && <div className={cn('shrink-0', !badge && 'ml-auto')}>{headerAction}</div>}

        {/* Collapse Control Button.
            A chevron, not ＋ / −: a minus reads as "already collapsed" to most
            people, and the two glyphs sat at different optical weights inside a
            22px box. ▾ / ▸ is the pair every disclosure on the platform uses. */}
        {collapsible && (
          <button
            type="button"
            data-c={id}
            className={cn(
              'cv w-[22px] h-[22px] rounded-[4px] border border-[color:var(--shell-border)] bg-transparent text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] hover:border-[color:var(--shell-border-strong)] transition-colors flex items-center justify-center shrink-0 cursor-pointer',
              !badge && !headerAction && 'ml-auto'
            )}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapse()
            }}
            aria-label={isCollapsed ? t("Expand {0}", { 0: String(title) }) : t("Collapse {0}", { 0: String(title) })}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? t("Expand {0}", { 0: String(title) }) : t("Collapse {0}", { 0: String(title) })}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms ease' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Module Content: Never clips content */}
      {!isCollapsed && (
        <div
          className={cn(
            'mod-b scroll-shell flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain select-text',
            bodyClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
