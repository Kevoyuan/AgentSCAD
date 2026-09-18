'use client'

import * as React from 'react'

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
 */

const VC_SIZE = 56
const HALF = VC_SIZE / 2
const FACE_T = 0.62

const AZ: Record<string, number> = { front: 0, right: 90, back: 180, left: -90 }

const CUBE: Record<string, { label: string; css: string }> = {
  front: { label: '前', css: 'translateZ(HALFpx)' },
  back: { label: '后', css: 'rotateY(180deg) translateZ(HALFpx)' },
  right: { label: '右', css: 'rotateY(90deg) translateZ(HALFpx)' },
  left: { label: '左', css: 'rotateY(-90deg) translateZ(HALFpx)' },
  top: { label: '上', css: 'rotateX(90deg) translateZ(HALFpx)' },
  bottom: { label: '下', css: 'rotateX(-90deg) translateZ(HALFpx)' },
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
  front: '前', back: '后', right: '右', left: '左', top: '上', bottom: '下',
  'top-front': '前上', 'top-right': '右上', 'top-back': '后上', 'top-left': '左上',
  'bottom-front': '前下', 'bottom-right': '右下', 'bottom-back': '后下', 'bottom-left': '左下',
  'front-right': '前右', 'back-right': '后右', 'back-left': '后左', 'front-left': '前左',
  'tf-right': '等轴 · 前上右', 'tb-right': '等轴 · 后上右',
  'tb-left': '等轴 · 后上左', 'tf-left': '等轴 · 前上左',
  'bf-right': '前下右', 'bb-right': '后下右', 'bb-left': '后下左', 'bf-left': '前下左',
}

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

export function labelFor(rx: number, az: number): string {
  const rxRounded = +rx.toFixed(2)
  const hit =
    byAngle.get(`${rxRounded}|${+norm(az).toFixed(2)}`) ??
    (Math.abs(rxRounded) >= 90 - VERTICAL_STOP_TOLERANCE
      ? byAngle.get(`${rxRounded > 0 ? 90 : -90}|0`)
      : undefined)
  if (hit) return VIEW_LABEL[hit]
  const d = dirOf(rx, az)
  const parts: string[] = []
  if (Math.abs(d[2]) > FACE_T) parts.push(d[2] > 0 ? '前' : '后')
  if (Math.abs(d[0]) > FACE_T) parts.push(d[0] > 0 ? '右' : '左')
  if (Math.abs(d[1]) > FACE_T) parts.push(d[1] > 0 ? '下' : '上')
  return '自由视角' + (parts.length ? ' · ' + parts.join('') : '')
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
 * on empty space is a no-op rather than a random jump.
 */
export function pickViewRegion(
  px: number,
  py: number,
  perspective: number,
  elevation: number,
  azimuth: number
): { rx: number; az: number; name?: string } | null {
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
  return resolveView(faces)
}

export const VIEWCUBE_GEOMETRY = { size: VC_SIZE, half: HALF, faceThreshold: FACE_T, regions: VIEW_TABLE.length }

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
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [perspective, setPerspective] = React.useState(400)
  const dragRef = React.useRef({ moved: false })
  const frameRef = React.useRef<number | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)

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

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const start = { x: e.clientX, y: e.clientY, az: azimuth, el: elevation }
    let pending: { x: number; y: number } | null = null
    dragRef.current.moved = false
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

  const faceTransform = (css: string) => css.replace(/translateZ\([^)]+\)/, `translateZ(${HALF}px)`)

  return (
    <div className="select-none" style={{ width: 118 }}>
      <div
        ref={hostRef}
        data-testid="view-cube-host"
        className="relative grid place-items-center cursor-grab active:cursor-grabbing rounded-[12px]"
        style={{
          height: 86,
          perspective: 400,
          background:
            'radial-gradient(ellipse at 50% 44%, var(--shell-scrim) 0%, transparent 78%)',
        }}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        role="group"
        aria-label="视角立方体"
      >
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
            transition: isDragging ? 'none' : 'transform .34s cubic-bezier(.32,.72,.28,1)',
          }}
        >
          {Object.entries(CUBE).map(([id, def]) => (
            <div
              key={id}
              className="absolute inset-0 grid place-items-center border font-mono text-[9px] tracking-[0.08em] text-[var(--shell-text-label)] transition-colors hover:text-[var(--shell-text)]"
              style={{
                transform: faceTransform(def.css),
                backfaceVisibility: 'hidden',
                // The cube sits on the canvas field (var(--shell-canvas)), so the faces have to
                // be a clear step brighter than it or the cube reads as a dark square.
                borderColor: 'var(--shell-cube-border)',
                background:
                  id === 'front' || id === 'back'
                    ? 'var(--shell-cube-face-a)'
                    : id === 'top' || id === 'bottom'
                      ? 'var(--shell-cube-face-b)'
                      : 'var(--shell-cube-face-c)',
                boxShadow: 'var(--shell-cube-shadow)',
              }}
            >
              {def.label}
            </div>
          ))}
        </div>
      </div>
      <div data-testid="view-cube-label" className="mt-0.5 text-center font-mono text-[8.5px] text-[var(--shell-text-label)]">
        {labelFor(elevation, azimuth)}
      </div>
    </div>
  )
}
