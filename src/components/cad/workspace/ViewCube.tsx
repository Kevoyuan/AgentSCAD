'use client'

import { useI18n } from '@/components/i18n-provider'
import { englishTranslator, type Translator } from '@/lib/i18n'
import { useReducedMotion } from '@/hooks/use-reduced-motion'

import * as React from 'react'
import { ChevronUp } from 'lucide-react'

/*
 * ViewCube, per DESIGN.md section 4.
 *
 * 26 selectable regions - 6 faces, 12 edges, 8 corners - each a real standard
 * view. Picking is by ray intersection, not DOM hit-testing: hit-testing rotated
 * 3D elements is unreliable, and the middle of a face has to mean that face
 * while the outer band means the 45 degree view.
 *
 * The cube mirrors the camera; it never owns orientation. Dragging is free and
 * is NOT snapped on release - landing on a standard view is a deliberate click.
 *
 * Readability pass (2026-10-26): the face labels used the label ladder at 9px,
 * which measured 3.27-3.9:1 on the cube faces, and the current-view caption was
 * a single 8.5px line that wrapped as "Free view · Front /" + "Right". Face
 * labels now use the strongest text step (>= 6.9:1 on the darkest face in dark
 * theme and > 15:1 in light theme) at 10px, the caption is a two-line structured
 * label ("Free view" / "Front / Right") instead of a broken line, and the caption
 * is also the keyboard-accessible trigger for a menu that names all 26 regions.
 * Ray picking still owns the pointer behaviour; the menu is the non-pointer
 * equivalent DESIGN.md section 21 requires ("no drag-only operation").
 */

const VC_SIZE = 56
const HALF = VC_SIZE / 2
const FACE_T = 0.62

const AZ: Record<string, number> = { front: 0, right: 90, back: 180, left: -90 }

const CUBE: Record<string, { label: string; css: string }> = {
  front: { label: "Front", css: 'translateZ(HALFpx)' },
  back: { label: "Back", css: 'rotateY(180deg) translateZ(HALFpx)' },
  right: { label: "Right", css: 'rotateY(90deg) translateZ(HALFpx)' },
  left: { label: "Left", css: 'rotateY(-90deg) translateZ(HALFpx)' },
  top: { label: "Top", css: 'rotateX(90deg) translateZ(HALFpx)' },
  bottom: { label: "Bottom", css: 'rotateX(-90deg) translateZ(HALFpx)' },
}

const VIEW_TABLE: Array<[string, number, number]> = [
  ['front', 0, 0], ['back', 0, 180], ['right', 0, 90], ['left', 0, -90],
  ['top', 90, 0], ['bottom', -90, 0],
  ['top-front', 45, 0], ['top-right', 45, 90], ['top-back', 45, 180], ['top-left', 45, -90],
  ['bottom-front', -45, 0], ['bottom-right', -45, 90], ['bottom-back', -45, 180], ['bottom-left', -45, -90],
  ['front-right', 0, 45], ['back-right', 0, 135], ['back-left', 0, -135], ['front-left', 0, -45],
  ['tf-right', 45, 45], ['tb-right', 45, 135], ['tb-left', 45, -135], ['tf-left', 45, -45],
  ['bf-right', -45, 45], ['bb-right', -45, 135], ['bb-left', -45, -135], ['bf-left', -45, -45],
]

const VIEW_LABEL: Record<string, string> = {
  front: "Front", back: "Back", right: "Right", left: "Left", top: "Top", bottom: "Bottom",
  'top-front': "Top front", 'top-right': "Top right", 'top-back': "Top back", 'top-left': "Top left",
  'bottom-front': "Bottom front", 'bottom-right': "Bottom right", 'bottom-back': "Bottom back", 'bottom-left': "Bottom left",
  'front-right': "Front right", 'back-right': "Back right", 'back-left': "Back left", 'front-left': "Front left",
  'tf-right': "Isometric · Top front right", 'tb-right': "Isometric · Top back right",
  'tb-left': "Isometric · Top back left", 'tf-left': "Isometric · Top front left",
  'bf-right': "Bottom front right", 'bb-right': "Bottom back right", 'bb-left': "Bottom back left", 'bf-left': "Bottom front left",
}

/** Compact text for the 26-item menu; the full name stays the accessible name. */
const VIEW_SHORT: Record<string, string> = {
  front: "Front", back: "Back", right: "Right", left: "Left", top: "Top", bottom: "Bottom",
  'top-front': "Top front", 'top-right': "Top right", 'top-back': "Top back", 'top-left': "Top left",
  'bottom-front': "Bottom front", 'bottom-right': "Bottom right", 'bottom-back': "Bottom back", 'bottom-left': "Bottom left",
  'front-right': "Front right", 'back-right': "Back right", 'back-left': "Back left", 'front-left': "Front left",
  'tf-right': "Top front right", 'tb-right': "Top back right", 'tb-left': "Top back left", 'tf-left': "Top front left",
  'bf-right': "Bottom front right", 'bb-right': "Bottom back right", 'bb-left': "Bottom back left", 'bf-left': "Bottom front left",
}

/** The 26 regions, grouped the way the cube is read: faces, edges, corners. */
const VIEW_GROUPS: Array<{ key: string; label: string; columns: number; regions: string[] }> = [
  { key: 'faces', label: 'Faces', columns: 3, regions: ['front', 'back', 'right', 'left', 'top', 'bottom'] },
  {
    key: 'edges',
    label: 'Edges',
    columns: 3,
    regions: [
      'top-front', 'top-right', 'top-back', 'top-left',
      'bottom-front', 'bottom-right', 'bottom-back', 'bottom-left',
      'front-right', 'back-right', 'back-left', 'front-left',
    ],
  },
  {
    key: 'corners',
    label: 'Corners',
    columns: 2,
    regions: ['tf-right', 'tb-right', 'tb-left', 'tf-left', 'bf-right', 'bb-right', 'bb-left', 'bf-left'],
  },
]

const VIEW_ANGLES = new Map(VIEW_TABLE.map(([name, elevation, azimuth]) => [name, { elevation, azimuth }]))

const norm = (a: number) => ((a % 360) + 360) % 360
const byAngle = new Map(VIEW_TABLE.map(([n, r, a]) => [`${r}|${norm(a)}`, n]))

/** unit vector from the part toward the camera, in the cube's own frame */
function dirOf(rx: number, az: number): [number, number, number] {
  const r = (rx * Math.PI) / 180
  const a = (az * Math.PI) / 180
  return [Math.cos(r) * Math.sin(a), -Math.sin(r), Math.cos(r) * Math.cos(a)]
}

function resolveView(faces: string[]): { rx: number; az: number; name?: string } {
  const sides = faces.filter(f => f in AZ)
  const vert = faces.includes('top') ? 'top' : faces.includes('bottom') ? 'bottom' : null
  let az = 0
  if (sides.length === 1) az = AZ[sides[0]]
  else if (sides.length === 2) {
    const a = AZ[sides[0]]
    const b = AZ[sides[1]]
    az = a + (((b - a + 540) % 360) - 180) / 2
  }
  const rx = vert ? (vert === 'top' ? (sides.length ? 45 : 90) : sides.length ? -45 : -90) : 0
  return { rx, az, name: byAngle.get(`${rx}|${norm(az)}`) }
}

/*
 * The camera clamps elevation to +/-89.8 degrees (three-d-viewer), because the up
 * vector is undefined at exactly +/-90. The stop table stores the canonical +/-90.
 * Without this tolerance the top and bottom stops were unreachable: `3` and `6`,
 * and a click on the cube's top or bottom face, all landed on 89.8 and reported
 * "自由视角 · 上", i.e. a stop that labels itself as a free angle.
 *
 * 0.2 degrees is the whole distance between the clamp and the stop, so this snaps
 * nothing the user could aim at; it only lets the clamp stop lying about itself.
 */
const VERTICAL_STOP_TOLERANCE = 0.25

/** The standard view a camera angle is standing on, if it is standing on one. */
function regionFor(rx: number, az: number): string | undefined {
  const rxRounded = +rx.toFixed(2)
  return (
    byAngle.get(`${rxRounded}|${+norm(az).toFixed(2)}`) ??
    (Math.abs(rxRounded) >= 90 - VERTICAL_STOP_TOLERANCE
      ? byAngle.get(`${rxRounded > 0 ? 90 : -90}|0`)
      : undefined)
  )
}

export function labelFor(rx: number, az: number, t: Translator = englishTranslator): string {
  const hit = regionFor(rx, az)
  if (hit) return t(VIEW_LABEL[hit])
  const d = dirOf(rx, az)
  const parts: string[] = []
  if (Math.abs(d[2]) > FACE_T) parts.push(d[2] > 0 ? "Front" : "Back")
  if (Math.abs(d[0]) > FACE_T) parts.push(d[0] > 0 ? "Right" : "Left")
  if (Math.abs(d[1]) > FACE_T) parts.push(d[1] > 0 ? "Bottom" : "Top")
  return t("Free view") + (parts.length ? ' · ' + parts.map(part => t(part)).join(' / ') : '')
}

function rot(v: [number, number, number], rx: number, az: number): [number, number, number] {
  const r = (rx * Math.PI) / 180
  const a = (az * Math.PI) / 180
  const y1 = v[1] * Math.cos(r) - v[2] * Math.sin(r)
  const z1 = v[1] * Math.sin(r) + v[2] * Math.cos(r)
  return [v[0] * Math.cos(a) + z1 * Math.sin(a), y1, -v[0] * Math.sin(a) + z1 * Math.cos(a)]
}

const unit = (v: [number, number, number]): [number, number, number] => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / L, v[1] / L, v[2] / L]
}

/**
 * Pure region picker, exported for testing. `px`/`py` are pixel offsets from the
 * cube's centre. Returns null when the ray misses the cube entirely, so a click
 * on empty space is a no-op rather than a random jump. `faces` is the raw list of
 * cube faces the ray entered through; the ViewCube uses it for hover feedback.
 */
export function pickViewRegion(
  px: number,
  py: number,
  perspective: number,
  elevation: number,
  azimuth: number
): { rx: number; az: number; name?: string; faces: string[] } | null {
  const D = unit([px, py, -perspective])
  const O: [number, number, number] = [0, 0, perspective]
  const Ol = rot(O, elevation, azimuth)
  const Dl = rot(D, elevation, azimuth)
  let tIn = -Infinity
  let tOut = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(Dl[i]) < 1e-6) {
      if (Math.abs(Ol[i]) > HALF) return null
      continue
    }
    const a = (-HALF - Ol[i]) / Dl[i]
    const b = (HALF - Ol[i]) / Dl[i]
    tIn = Math.max(tIn, Math.min(a, b))
    tOut = Math.min(tOut, Math.max(a, b))
  }
  if (!isFinite(tIn) || tIn > tOut) return null
  const P: [number, number, number] = [
    Ol[0] + Dl[0] * tIn,
    Ol[1] + Dl[1] * tIn,
    Ol[2] + Dl[2] * tIn,
  ]
  const r = P.map(c => Math.abs(c) / HALF)
  const faces: string[] = []
  if (r[2] > FACE_T) faces.push(P[2] > 0 ? 'front' : 'back')
  if (r[0] > FACE_T) faces.push(P[0] > 0 ? 'right' : 'left')
  if (r[1] > FACE_T) faces.push(P[1] > 0 ? 'bottom' : 'top')
  if (!faces.length) {
    const i = r.indexOf(Math.max(...r))
    faces.push(
      i === 2 ? (P[2] > 0 ? 'front' : 'back')
        : i === 0 ? (P[0] > 0 ? 'right' : 'left')
          : (P[1] > 0 ? 'bottom' : 'top')
    )
  }
  return { ...resolveView(faces), faces }
}

export const VIEWCUBE_GEOMETRY = { size: VC_SIZE, half: HALF, faceThreshold: FACE_T, regions: VIEW_TABLE.length }

const hoverKey = (faces: string[]) => faces.join('|')

export function ViewCube({
  azimuth,
  elevation,
  onCommand,
  onChange,
}: {
  azimuth: number
  elevation: number
  /** request a standard view; the caller applies it to the camera */
  onCommand?: (view: { azimuth: number; elevation: number }) => void
  /** free orbit from dragging the cube itself */
  onChange?: (view: { azimuth: number; elevation: number }) => void
}) {
  const { t } = useI18n()
  // The cube's rotation is animated with an inline style, which no stylesheet
  // media query can reach. Asking here is the only way to stop it.
  const reducedMotion = useReducedMotion()

  const hostRef = React.useRef<HTMLDivElement>(null)
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [perspective, setPerspective] = React.useState(400)
  const dragRef = React.useRef({ moved: false })
  const frameRef = React.useRef<number | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [hovered, setHovered] = React.useState<string[]>([])
  const [pressed, setPressed] = React.useState<string[]>([])
  const [menuOpen, setMenuOpen] = React.useState(false)
  const lastHoverRef = React.useRef('')
  const descId = React.useId()

  // A pending frame must not fire after the cube unmounts.
  React.useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  React.useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const p = parseFloat(getComputedStyle(el).perspective)
    if (Number.isFinite(p) && p > 0) setPerspective(p)
  }, [])

  /**
   * Ray-pick the cube region under a point. The ray is built with the same
   * `perspective` the CSS uses, then intersected with the cube in the cube's own
   * frame; each axis joins the region once it is far enough across its half-width.
   */
  const pickView = React.useCallback(
    (px: number, py: number) => pickViewRegion(px, py, perspective, elevation, azimuth),
    [perspective, azimuth, elevation]
  )

  const relPoint = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const el = hostRef.current
    if (!el) return [0, 0]
    const r = el.getBoundingClientRect()
    return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)]
  }

  /* Hover feedback: highlight the faces the pointer is actually over. The region
     is resolved with the same ray picker the click uses, so the highlight can
     never advertise a different view than the click would apply. */
  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) return
    const [px, py] = relPoint(e)
    const region = Math.hypot(px, py) > HALF * 1.9 ? null : pickView(px, py)
    const faces = region?.faces ?? []
    const key = hoverKey(faces)
    if (key === lastHoverRef.current) return
    lastHoverRef.current = key
    setHovered(faces)
  }

  const clearHover = () => {
    if (lastHoverRef.current === '') return
    lastHoverRef.current = ''
    setHovered([])
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const start = { x: e.clientX, y: e.clientY, az: azimuth, el: elevation }
    let pending: { x: number; y: number } | null = null
    dragRef.current.moved = false
    const [downX, downY] = relPoint(e)
    const downRegion = pickView(downX, downY)
    if (downRegion) setPressed(downRegion.faces)
    setIsDragging(true)
    el.setPointerCapture(e.pointerId)

    /*
     * One state update per frame, not one per pointer event: a trackpad reports at
     * 120Hz and a React update here re-renders the whole workspace, so applying every
     * event was doing twice the work the display could show.
     */
    const apply = () => {
      frameRef.current = null
      if (!pending) return
      const dx = pending.x - start.x
      const dy = pending.y - start.y
      if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true
      onChange?.({
        azimuth: start.az - dx * 0.65,
        elevation: Math.max(-89.8, Math.min(89.8, start.el + dy * 0.55)),
      })
    }

    const move = (ev: PointerEvent) => {
      pending = { x: ev.clientX, y: ev.clientY }
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(apply)
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      // Land exactly on the release point rather than on the last painted frame, and
      // settle `moved` before the click handler reads it.
      apply()
      setIsDragging(false)
      setPressed([])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handleClick = (e: React.MouseEvent) => {
    if (dragRef.current.moved) return
    const [px, py] = relPoint(e)
    if (Math.hypot(px, py) > HALF * 1.9) return
    const v = pickView(px, py)
    if (v) onCommand?.({ azimuth: v.az, elevation: v.rx })
  }

  /* Keyboard orbit: the pointer is not the only way to turn the part (DESIGN.md
     section 21). The 26 standard views also live in the caption menu below. */
  const handleHostKeyDown = (e: React.KeyboardEvent) => {
    const step = 15
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const sign = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        onChange?.({ azimuth: azimuth + sign * step, elevation })
      } else {
        onChange?.({ azimuth, elevation: Math.max(-89.8, Math.min(89.8, elevation + sign * step)) })
      }
    }
  }

  const faceTransform = (css: string) => css.replace(/translateZ\([^)]+\)/, `translateZ(${HALF}px)`)

  const label = labelFor(elevation, azimuth, t)
  const [kind, ...rest] = label.split(' · ')
  const detail = rest.join(' · ')
  const currentRegion = regionFor(elevation, azimuth)
  const hoveredSet = React.useMemo(() => new Set(hovered), [hovered])
  const pressedSet = React.useMemo(() => new Set(pressed), [pressed])

  /* Menu behaviour: focus the active view when it opens, arrow through the 26
     items, Escape/outside-pointer closes and returns focus to the caption. */
  React.useEffect(() => {
    if (!menuOpen) return
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const active = menuRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]')
    ;(active ?? items?.[0])?.focus()
  }, [menuOpen])

  React.useEffect(() => {
    if (!menuOpen) return
    const onDocumentPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
    }
  }, [menuOpen])

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = index
    if (e.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    if (e.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  const applyRegion = (id: string) => {
    const angles = VIEW_ANGLES.get(id)
    if (angles) onCommand?.({ azimuth: angles.azimuth, elevation: angles.elevation })
    setMenuOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={wrapRef} className="relative select-none" style={{ width: 118 }}>
      <div
        ref={hostRef}
        data-testid="view-cube-host"
        className="relative grid cursor-grab place-items-center rounded-[9px] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--shell-signal)]/40"
        style={{
          height: 86,
          perspective: 400,
          touchAction: 'none',
          /*
           * No painted shadow behind the cube. Two attempts at one failed:
           *
           * 1. `radial-gradient(ellipse at 50% 44%, var(--shell-scrim) 0%, transparent 78%)`
           *    borrowed the modal scrim token (35% dark in light theme) and, because the
           *    gradient had no explicit size, its farthest-corner default filled the whole
           *    118x86 footprint. Clipped by the host's 12px radius it read as a grey
           *    rounded plate - the cube looked like it sat on a dirty square.
           * 2. Shrinking it to a 32x11 contact ellipse under the bottom vertex made it
           *    subtle, but it still tinted the field around a control that DESIGN.md
           *    section 4 calls "small and quiet - the part is the subject, the cube is a
           *    control". The faces already separate themselves with borders and an inset
           *    highlight; the shadow was decoration, not structure.
           *
           * So it is gone rather than tuned. Nothing here paints outside the 56px cube.
           */
        }}
        tabIndex={0}
        role="group"
        aria-label={t("View cube")}
        aria-describedby={descId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={clearHover}
        onClick={handleClick}
        onKeyDown={handleHostKeyDown}
      >
        <span id={descId} className="sr-only">
          {t("Drag to orbit. Click a face, edge or corner to jump to a standard view. Use the view menu below, or keys 1-6, 0 and F from the workspace.")}
        </span>
        <div
          className="relative"
          style={{
            width: VC_SIZE,
            height: VC_SIZE,
            transformStyle: 'preserve-3d',
            transform: `rotateX(${-elevation}deg) rotateY(${-azimuth}deg)`,
            /* Promote the cube to its own layer: it rotates on every drag frame, and
               without this Chrome repaints six shadowed faces each time. */
            willChange: 'transform',
            /*
             * The eased transition is for a *commanded* view (a click lands on a
             * standard angle, and watching the cube travel there is how the user
             * learns the mapping). It must not be on while dragging: at 0.34s the
             * cube eases toward the pointer and reads as lag, which is exactly the
             * feel the C5 iteration removed from the prototype.
             */
            /*
             * With reduced motion the cube still turns to the commanded view —
             * it just arrives there instead of travelling. The view change
             * itself is the information; the journey is not.
             */
            transition: isDragging || reducedMotion ? 'none' : 'transform .34s cubic-bezier(.32,.72,.28,1)',
          }}
        >
          {Object.entries(CUBE).map(([id, def]) => {
            const isHovered = hoveredSet.has(id)
            const isPressed = pressedSet.has(id)
            return (
              <div
                key={id}
                className="absolute inset-0 grid place-items-center border font-mono text-[10px] leading-none tracking-[0.03em] text-[var(--shell-text)] transition-[background-color,border-color,filter] duration-150"
                style={{
                  transform: faceTransform(def.css),
                  backfaceVisibility: 'hidden',
                  padding: '0 2px',
                  // The cube sits on the canvas field (var(--shell-canvas)), so the faces have to
                  // be a clear step brighter than it or the cube reads as a dark square. The face
                  // labels use the strongest text step: the old label step measured 3.27-3.9:1
                  // here, and readability beats quietness (brief: >=4.6:1 at any size).
                  borderColor: isPressed
                    ? 'var(--shell-signal)'
                    : isHovered
                      ? 'var(--shell-border-strong)'
                      : 'var(--shell-cube-border)',
                  background:
                    id === 'front' || id === 'back'
                      ? 'var(--shell-cube-face-a)'
                      : id === 'top' || id === 'bottom'
                        ? 'var(--shell-cube-face-b)'
                        : 'var(--shell-cube-face-c)',
                  backgroundImage: isHovered || isPressed
                    ? 'linear-gradient(rgba(255,255,255,0.12), rgba(255,255,255,0.12))'
                    : 'none',
                  boxShadow: 'var(--shell-cube-shadow)',
                  filter: isPressed ? 'brightness(0.94)' : 'none',
                }}
              >
                {t(def.label)}
              </div>
            )
          })}
        </div>
      </div>

      {/*
       * The caption is the current-view readout AND the keyboard/SR equivalent of
       * the 26 ray-picked regions. Two structured lines instead of one broken one:
       * "Free view" / "Front / Right" and "Isometric" / "Top front right" never
       * wrap mid-phrase. aria-haspopup tells assistive tech a list of views exists.
       */}
      <button
        ref={triggerRef}
        type="button"
        data-testid="view-cube-label"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${t('Current view')}: ${label}`}
        title={t('Standard views')}
        onClick={() => setMenuOpen(open => !open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setMenuOpen(true)
          }
        }}
        className="group/label mt-0.5 flex w-full items-start justify-center gap-1 rounded-[4px] border border-transparent px-1 py-0.5 text-center transition-colors hover:border-[var(--shell-border)] hover:bg-[var(--shell-hover)] focus-visible:border-[var(--shell-signal)] focus-visible:outline-none [@media(pointer:coarse)]:min-h-11"
      >
        <span className="min-w-0">
          <span className="block truncate font-mono text-[10px] leading-[1.35] text-[var(--shell-text-muted)]">
            {kind}
          </span>
          {detail && (
            <span className="block truncate font-mono text-[10px] leading-[1.35] text-[var(--shell-text-label)]">
              {detail}
            </span>
          )}
        </span>
        <ChevronUp
          aria-hidden="true"
          strokeWidth={1.5}
          className="mt-px h-2.5 w-2.5 shrink-0 text-[var(--shell-text-dim)] transition-colors group-hover/label:text-[var(--shell-text-muted)]"
        />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('Standard views')}
          data-testid="view-cube-menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-[calc(100%+6px)] left-0 z-30 w-[286px] rounded-[9px] border border-[var(--shell-border-strong)] p-2 backdrop-blur-xl"
          style={{ background: 'var(--shell-module-solid)', boxShadow: 'var(--shell-shadow)' }}
        >
          {VIEW_GROUPS.map((group) => (
            <div key={group.key} role="group" aria-label={t(group.label)} className="mb-1.5 last:mb-0">
              <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-text-dim)]">
                {t(group.label)}
              </p>
              <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))` }}>
                {group.regions.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    data-active={currentRegion === id ? 'true' : undefined}
                    aria-label={t(VIEW_LABEL[id])}
                    onClick={() => applyRegion(id)}
                    className={`flex min-h-7 items-center rounded-[4px] px-1.5 py-1 text-left font-mono text-[10px] leading-[1.25] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--shell-signal)]/40 [@media(pointer:coarse)]:min-h-11 ${
                      currentRegion === id
                        ? 'bg-[var(--shell-well)] text-[var(--shell-text)]'
                        : 'text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
                    }`}
                  >
                    {t(VIEW_SHORT[id])}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
