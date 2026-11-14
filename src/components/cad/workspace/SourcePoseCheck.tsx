'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'
import type { AssemblySpec } from '@/lib/assembly/assembly-spec'
import type { SourcePoseReport } from '@/lib/assembly/source-pose-observer'

type SourcePoseJobView = {
  schemaVersion: 1
  sourceSha256: string
  specSha256: string
  contractSha256: string
  confirmedRequirementCurrent: boolean
  bindingSha256: string
  binding: {
    connectionId: string
    sourceParameter: string
    movingInstanceId: string
    groundedInstanceId: string
    rotationDeg: number
    axis: { origin: number[]; direction: number[] }
    userConfirmed: boolean
    independentParameterSemanticsVerified: false
  }
  report: SourcePoseReport
  productMotionApproval: 'NOT_RUN'
  physicalFunctionApproval: 'NOT_RUN'
  limitations: string
}
type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function fetchSourcePoseCheck(input: {
  jobId: string
  sourceSha256: string
  specSha256: string
  connectionId: string
  sourceParameter: string
  rotationDeg: number
}, request: Request = fetch): Promise<{ data?: SourcePoseJobView; error?: string }> {
  try {
    const response = await request('/api/jobs/' + encodeURIComponent(input.jobId) + '/assembly/source-poses', {
      method: 'POST',
      credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceSha256: input.sourceSha256, specSha256: input.specSha256,
        connectionId: input.connectionId, sourceParameter: input.sourceParameter,
        rotationDeg: input.rotationDeg, confirmedBinding: true,
      }),
    })
    if (response.status === 409) return { error: 'The job or assembly changed during the source-pose check. Refresh before retrying.' }
    if (!response.ok) {
      const issue = await response.json().catch(() => ({})) as { error?: string }
      return { error: typeof issue.error === 'string' ? issue.error : 'Source-pose inspection failed.' }
    }
    const data = await response.json() as SourcePoseJobView
    if (data?.schemaVersion !== 1 || data.sourceSha256 !== input.sourceSha256 ||
      data.specSha256 !== input.specSha256 || data.report?.sourceSha256 !== input.sourceSha256 ||
      data.report?.status === undefined || data.report.samples?.length !== 3 ||
      data.productMotionApproval !== 'NOT_RUN' || data.physicalFunctionApproval !== 'NOT_RUN' ||
      data.binding.connectionId !== input.connectionId ||
      data.binding.sourceParameter !== input.sourceParameter ||
      data.binding.rotationDeg !== input.rotationDeg ||
      data.binding.independentParameterSemanticsVerified !== false) {
      return { error: 'Source-pose results are not bound to this version and declared parameter.' }
    }
    return { data }
  } catch { return { error: 'Source-pose inspection failed.' } }
}

/**
 * Explicit user-initiated three-pose source reference. No timers, polling,
 * export button, persisted JobOutcome or contract-verdict promotion.
 */
export function SourcePoseCheck({ jobId, sourceSha256, specSha256, spec }: {
  jobId: string
  sourceSha256: string
  specSha256: string
  spec: AssemblySpec
}) {
  const { t } = useI18n()
  const joints = spec.connections.filter(c =>
    c.type === 'revolute' && c.a === spec.groundedInstanceId &&
    c.frameA !== null && c.frameB !== null && c.range?.unit === 'deg' &&
    c.range.min < 0 && c.range.max > 0)
  const [connectionId, setConnectionId] = React.useState(joints[0]?.id ?? '')
  const [sourceParameter, setSourceParameter] = React.useState('')
  const [rotation, setRotation] = React.useState('15')
  const [confirmed, setConfirmed] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [saved, setSaved] = React.useState<{ key: string; data: SourcePoseJobView } | null>(null)
  const selected = joints.find(j => j.id === connectionId)
  const maximum = selected?.range ? Math.min(90, -selected.range.min, selected.range.max) : 0
  const angle = Number(rotation)
  const validAngle = Number.isFinite(angle) && angle >= 1 && angle <= maximum
  const key = [jobId, sourceSha256, specSha256, connectionId, sourceParameter, rotation].join(':')
  const displayed = saved?.key === key ? saved.data : null

  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !confirmed || !validAngle || !sourceParameter.trim() || loading) return
    setLoading(true)
    setError('')
    setSaved(null)
    const result = await fetchSourcePoseCheck({
      jobId, sourceSha256, specSha256, connectionId,
      sourceParameter: sourceParameter.trim(), rotationDeg: angle,
    })
    if (result.data) setSaved({ key, data: result.data })
    else setError(result.error ?? 'Source-pose inspection failed.')
    setLoading(false)
  }

  if (!joints.length) return null
  return <section className="mt-3 border-t border-[color:var(--shell-hairline)] pt-2 text-[var(--shell-text-label)]"
    aria-label={t('Independent source-pose inspection')}>
    <p className="font-medium text-[var(--shell-text-primary)]">{t('Independent source-pose inspection')}</p>
    <p className="mt-1">{t('Select a grounded revolute joint and explicitly identify which OpenSCAD source parameter controls it. This does not infer parameter meaning or verify continuous motion.')}</p>
    <form onSubmit={event => void run(event)} className="mt-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        {t('Grounded revolute joint')}
        <select value={connectionId} onChange={event => { setConnectionId(event.target.value); setConfirmed(false) }}
          className="rounded border border-[color:var(--shell-hairline)] bg-transparent p-1">
          {joints.map(j => <option key={j.id} value={j.id}>{j.id}: {j.a} / {j.b}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {t('Explicit source motion parameter')}
        <input value={sourceParameter} onChange={event => { setSourceParameter(event.target.value); setConfirmed(false) }}
          placeholder="e.g. hinge_angle" required maxLength={64} autoComplete="off"
          className="rounded border border-[color:var(--shell-hairline)] bg-transparent p-1" />
      </label>
      <label className="flex flex-col gap-1">
        {t('Symmetric angle (degrees)')} · 1–{maximum.toFixed(1)}°
        <input type="number" min="1" max={maximum} step="1" value={rotation}
          onChange={event => { setRotation(event.target.value); setConfirmed(false) }}
          className="rounded border border-[color:var(--shell-hairline)] bg-transparent p-1" />
      </label>
      <p>{t('Three independently rendered poses will be checked')}: −{validAngle ? angle : '?'}°, 0°, +{validAngle ? angle : '?'}°.</p>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>{t('I confirm this source parameter and joint binding; CAD source semantics and physical function are still unverified.')}</span>
      </label>
      <button type="submit" disabled={loading || !confirmed || !validAngle || !sourceParameter.trim()}
        className="self-start rounded border border-[color:var(--shell-hairline)] px-2 py-1">
        {loading ? t('Rendering three source poses…') : t('Run three source-pose comparisons')}
      </button>
    </form>
    {error && <p role="alert" className="mt-2 text-[var(--shell-fail)]">{t(error)}</p>}
    {displayed && <div className="mt-2">
      <p className="font-medium">{t('Raw sampled surface comparison')}: {displayed.report.status}</p>
      <p>{t('Binding SHA-256')}: <code className="break-all">{displayed.bindingSha256}</code></p>
      <p>{t('Approved motion')}: {displayed.productMotionApproval}; {t('Physical function')}: {displayed.physicalFunctionApproval}</p>
      <ol className="mt-1 space-y-2">{displayed.report.samples.map(sample => <li key={sample.id}>
        <strong>{sample.id}: {sample.status}</strong>
        <p>{sample.reason}</p>
        <p>{sample.comparisonMethod ?? '—'} · {t('Triangle pairs evaluated')}: {sample.testedPairs ?? 0}</p>
        {sample.maximumAreaMismatchMm2 !== undefined &&
          <p>{t('Maximum planar area mismatch')}: {sample.maximumAreaMismatchMm2.toFixed(6)} mm²</p>}
        <p className="break-all">{t('Reference STL SHA-256')}: {sample.referenceStlSha256}</p>
      </li>)}</ol>
      <p className="mt-2">{t('These are explicitly sampled surface observations, not confirmed or continuous mechanical motion.')}</p>
      <p>{displayed.limitations}</p>
    </div>}
  </section>
}
