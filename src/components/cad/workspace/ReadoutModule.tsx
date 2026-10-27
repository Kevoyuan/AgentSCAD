'use client'

import { useI18n } from '@/components/i18n-provider'

/*
 * 读数 — DESIGN.md section 6, "Readout".
 *
 *   BOUNDING BOX                     MEASURED
 *   163.4 × 78.0 × 8.8                   mm
 *   Wall thickness                     2.01  mm
 *   Triangles                         2 868
 *   Artifact                          Built
 *
 * Bounding box, the one derived dimension that matters, mesh size, artifact state.
 *
 * Evidence only. A measured value prints at full strength and says nothing else; a
 * value that comes from the design's own parameters is dimmed and labelled "Target",
 * and a row with neither prints "—" plus its unit. A declared parameter must never
 * arrive in the same clothes as a measured fact (DESIGN.md section 18, evidence
 * hierarchy).
 *
 * 2026-10-27: this is the instrument's display and it had no subject. The envelope -
 * the one number a person opens the plate for - was 11px, right-aligned into the
 * same column as every other row, and read exactly like "Wall thickness". It now
 * sits on its own line at 16px, left-aligned, with its evidence state spelled out in
 * words above it. `Built` used to be printed in the *unit* column of the Triangles
 * row, so a sentence occupied the place where a unit belongs; artifact state is now
 * its own row and the unit column holds units only.
 */

import { Job } from '@/components/cad/types'
import { readRenderLog, measuredBoundingBox, measuredWallThickness } from './mesh-facts'
import { formatMeasure } from './parameter-schema'
import { cn } from '@/lib/utils'
import { formatMeasured } from './instrument'
import { jobDetailsPending } from './job-detail-state'

export function ReadoutModule({
  job,
  declaredBoundingBox,
  declaredWallThickness,
  builtBy,
}: {
  job: Job | null
  /** from the design's parameters, shown as a target until a mesh has been measured */
  declaredBoundingBox: [number, number, number] | null
  declaredWallThickness: number | null
  /** the engine that produced this artifact, if it is known */
  builtBy?: string | null
}) {
  const { t, locale } = useI18n()

  const render = readRenderLog(job)
  const measuredBox = measuredBoundingBox(job)
  const measuredWall = measuredWallThickness(job)

  const box = measuredBox ?? declaredBoundingBox
  const wall = measuredWall ?? declaredWallThickness
  const boxIsMeasured = measuredBox !== null
  const wallIsMeasured = measuredWall !== null
  const hasGeometry = Boolean(job?.stlPath)
  const hasTarget = (box !== null && !boxIsMeasured) || (wall !== null && !wallIsMeasured)

  const dims = box
    ? boxIsMeasured
      ? `${formatMeasured(box[0])} × ${formatMeasured(box[1])} × ${formatMeasured(box[2])}`
      : `${formatMeasure(box[0])} × ${formatMeasure(box[1])} × ${formatMeasure(box[2])}`
    : '—'

  const boxState = !box
    ? t("Not measured")
    : boxIsMeasured
      ? t("Measured")
      : t("Target")
  /*
   * While the part's detail record is still in flight the readout knows neither
   * the measured box nor the declared one, and "Not measured" would be a claim
   * about a part that has in fact been measured. A dash is the honest answer:
   * it says "nothing here yet" without saying why.
   */
  const pendingDetails = jobDetailsPending(job)
  const boxStateText = pendingDetails ? '—' : boxState
  const artifactState = !job ? '—' : hasGeometry ? t("Built") : t("Awaiting build")

  const rows: Array<{
    label: string
    value: string
    unit: string
    tone: 'measured' | 'target' | 'unknown'
    title: string
  }> = [
    {
      label: t("Wall thickness"),
      value: wall !== null ? (wallIsMeasured ? formatMeasured(wall, 2) : formatMeasure(wall)) : '—',
      unit: wall !== null ? 'mm' : '',
      tone: wall === null ? 'unknown' : wallIsMeasured ? 'measured' : 'target',
      title:
        wall === null
          ? t("No wall thickness available")
          : wallIsMeasured
            ? t("Minimum wall thickness measured from the built mesh")
            : t("Wall thickness from the design's parameters — not measured yet"),
    },
    {
      label: t("Triangles"),
      value:
        render.triangles !== null
          ? render.triangles.toLocaleString(locale).replace(/,/g, ' ')
          : '—',
      unit: '',
      tone: render.triangles !== null ? 'measured' : 'unknown',
      title:
        render.triangles !== null
          ? t("Mesh size from the render log")
          : t("No render measurements yet"),
    },
    {
      label: t("Artifact"),
      value: artifactState,
      unit: '',
      tone: hasGeometry ? 'measured' : 'unknown',
      title: hasGeometry
        ? t("This part has a built mesh on disk")
        : t("No built mesh yet — the values above are targets"),
    },
  ]

  return (
    <div className="px-[11px] pb-[10px] pt-[2px]">
      {/* The display: the envelope gets a line of its own. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
          {t("Bounding box")}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-[10px] tracking-[0.05em]',
            boxIsMeasured ? 'text-[var(--shell-text-muted)]' : 'text-[var(--shell-text-label)]'
          )}
        >
          {boxStateText}
        </span>
      </div>
      <div
        className="mt-[3px] flex items-baseline justify-between gap-2"
        title={
          box
            ? boxIsMeasured
              ? t("Bounding box measured from the built mesh")
              : t("Bounding box from the design's parameters — not measured yet")
            : t("No bounding box available")
        }
      >
        <span
          className={cn(
            'min-w-0 truncate font-mono text-[16px] leading-[1.15] tabular-nums',
            box ? 'text-[var(--shell-text)]' : 'text-[var(--shell-text-label)]'
          )}
        >
          {dims}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[var(--shell-text-label)]">
          {box ? 'mm' : ''}
        </span>
      </div>

      <div className="mt-[7px] flex flex-col gap-[3px] border-t border-[color:var(--shell-hairline)] pt-[6px] font-mono text-[12px] leading-[1.5] tabular-nums">
        {rows.map(row => (
          <div key={row.label} className="flex items-baseline gap-[6px]" title={row.title}>
            <span className="shrink-0 font-sans text-[11px] text-[var(--shell-text-label)]">{row.label}</span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-right',
                row.tone === 'measured'
                  ? 'text-[var(--shell-text)]'
                  : row.tone === 'target'
                    ? 'text-[var(--shell-text-muted)]'
                    : 'text-[var(--shell-text-label)]'
              )}
            >
              {row.value}
            </span>
            {/* Units only. A sentence in this column made a whole row read as a
                measurement with an unreadable unit. */}
            <span className="w-[18px] shrink-0 text-right text-[10px] text-[var(--shell-text-label)]">
              {row.unit}
            </span>
          </div>
        ))}
      </div>

      {hasTarget && (
        <p
          className="mt-[5px] text-[11px] leading-[1.4] text-[var(--shell-text-label)]"
          title={t("These values come from the design's parameters. Rebuild the part to measure the mesh.")}
        >
          {t("From parameters · not measured")}
        </p>
      )}

      {builtBy && (
        <p className="mt-[5px] truncate font-mono text-[11px] text-[var(--shell-text-dim)]" title={builtBy}>
          {t("Built by {0}", { 0: builtBy })}
        </p>
      )}
    </div>
  )
}
