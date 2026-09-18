'use client'

/*
 * 读数 — DESIGN.md section 6, "Readout".
 *
 *   163.4 × 78.0 × 8.8      mm
 *   壁厚 2.00               mm
 *   面片 1 284              已构建
 *
 * Bounding box, the one derived dimension that matters, mesh size, artifact state.
 *
 * Evidence only. A measured value prints at full strength and says nothing else; a
 * value that comes from the design's own parameters is dimmed and prefixed 目标, and
 * a row with neither prints "—". A declared parameter must never arrive in the same
 * clothes as a measured fact (DESIGN.md section 18, evidence hierarchy): before this,
 * an unbuilt design showed "15 × 40 × 30 mm" exactly like a measured one, and the only
 * tell was the artifact state.
 */

import { Job } from '@/components/cad/types'
import { readRenderLog, measuredBoundingBox, measuredWallThickness } from './mesh-facts'
import { formatMeasure } from './parameter-schema'

export function ReadoutModule({
  job,
  declaredBoundingBox,
  declaredWallThickness,
}: {
  job: Job | null
  /** from the design's parameters, shown as a target until a mesh has been measured */
  declaredBoundingBox: [number, number, number] | null
  declaredWallThickness: number | null
}) {
  const render = readRenderLog(job)
  const measuredBox = measuredBoundingBox(job)
  const measuredWall = measuredWallThickness(job)

  const box = measuredBox ?? declaredBoundingBox
  const wall = measuredWall ?? declaredWallThickness
  const boxIsMeasured = measuredBox !== null
  const wallIsMeasured = measuredWall !== null
  const hasGeometry = Boolean(job?.stlPath)

  const dims = box
    ? `${boxIsMeasured ? '' : '目标 '}${formatMeasure(box[0])} × ${formatMeasure(box[1])} × ${formatMeasure(box[2])}`
    : '—'

  const artifactState = !job
    ? ''
    : hasGeometry
      ? '已构建'
      : '待构建'

  const rows: Array<{ value: string; unit: string; isDim: boolean }> = [
    { value: dims, unit: 'mm', isDim: !box || !boxIsMeasured },
    {
      value: wall !== null
        ? `${wallIsMeasured ? '壁厚' : '目标 壁厚'} ${formatMeasure(wall)}`
        : '壁厚 —',
      unit: 'mm',
      isDim: wall === null || !wallIsMeasured,
    },
    {
      value:
        render.triangles !== null
          ? `面片 ${render.triangles.toLocaleString('en-US').replace(/,/g, ' ')}`
          : '面片 —',
      unit: artifactState,
      isDim: render.triangles === null,
    },
  ]

  return (
    <div className="px-[11px] pb-[10px] pt-[1px]">
      <div className="flex flex-col gap-1 font-mono text-[10.5px] leading-[1.72] tabular-nums">
        {rows.map((row, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span className={row.isDim ? 'text-[var(--shell-text-dim)]' : 'text-[var(--shell-text)]'}>
              {row.value}
            </span>
            <span className="text-[var(--shell-text-label)]">{row.unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
