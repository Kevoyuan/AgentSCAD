'use client'

/*
 * 正在生成 — the loader that sits in the middle of the canvas while the pipeline
 * runs (DESIGN.md section 17).
 *
 * A small machined gear tumbling on two axes, built the way the ViewCube is built:
 * real CSS 3D with an extruded body rather than a sprite, so it belongs to the same
 * instrument as the cube and costs no second WebGL context (the viewport already
 * owns one).
 *
 * It reports nothing. The four lamps are the progress display; this is only the sign
 * that the machine is working, and it leaves the moment geometry arrives.
 */

const TOOTH_COUNT = 12

/* One disc per layer, 0.9px apart across 9px of thickness, so the body reads as a
   solid extrusion even when it turns edge-on: at wider spacing the tooth tips of
   each layer separate and the silhouette frays. Front layers carry the lit tone,
   the back layers the shaded one. */
const LAYERS = Array.from({ length: 11 }, (_, i) => {
  const z = -4.5 + i * 0.9
  return { z: Number(z.toFixed(2)), back: z < 0 }
})

function GearDisc({ tone, bore }: { tone: string; bore: string }) {
  return (
    <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <g fill={tone}>
        <circle cx="32" cy="32" r="21" />
        {Array.from({ length: TOOTH_COUNT }, (_, i) => (
          <rect
            key={i}
            x="28.9"
            y="3.4"
            width="6.2"
            height="10"
            rx="1.8"
            transform={`rotate(${(i * 360) / TOOTH_COUNT} 32 32)`}
          />
        ))}
      </g>
      <circle cx="32" cy="32" r="8.2" fill={bore} />
    </svg>
  )
}

export function GeneratingPart({ className }: { className?: string }) {
  return (
    <div
      className={className}
      data-testid="generating-part"
      /* The scene is decoration: the state it describes is also written out in the
         two lines below it, so assistive tech gets the words and skips the gear. */
      role="presentation"
      aria-hidden="true"
    >
      <div className="relative h-[64px] w-[64px]">
        {/* Ground shadow: the part is being measured on a bench, not floating. */}
        <div
          className="pointer-events-none absolute left-1/2 top-[58px] h-[10px] w-[54px] -translate-x-1/2 rounded-[50%]"
          style={{ background: 'radial-gradient(ellipse at center, var(--shell-part-shadow) 0%, transparent 68%)' }}
        />
        <div className="part-tumble absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
          {LAYERS.map(layer => (
            <div
              key={layer.z}
              className="absolute inset-0"
              /* No backface culling: the body is a stack, so the half of the turn
                 where the back faces the camera has to render the same discs,
                 otherwise the part vanishes twice per revolution. */
              style={{ transform: `translateZ(${layer.z}px)` }}
            >
              <GearDisc
                tone={layer.back ? 'var(--shell-part-edge)' : 'var(--shell-part-face)'}
                bore="var(--shell-part-edge)"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
