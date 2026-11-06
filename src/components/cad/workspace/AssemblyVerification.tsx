'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'
import { ASSEMBLY_EVIDENCE_LAYERS, type AssemblyVerificationView, type VerificationEvidence } from '@/lib/assembly/verification-types'

export type VerificationResponse = { verification: AssemblyVerificationView; evidence: VerificationEvidence }
const labels = { identity: 'Part identity', geometry: 'Part geometry', reconstruction: 'Assembly reconstruction', jointFrames: 'Joint frames', assembly: 'Assembly fit', assemblyPath: 'Assembly path', disassembly: 'Disassembly', motion: 'Motion', physical: 'Physical function' }

export function currentEvidenceStatus(report: VerificationResponse | undefined, layer: string) {
  return report?.verification.status === 'CURRENT' && report.verification.executionStatus !== 'ERROR' ? report.evidence[layer]?.status ?? 'NOT_RUN' : 'NOT_RUN'
}

export function AssemblyVerification({ jobId, sourceSha256, specSha256, revision, canCheck }: {
  jobId: string; sourceSha256: string; specSha256: string; revision: string; canCheck: boolean
}) {
  const { t } = useI18n()
  const [report, setReport] = React.useState<VerificationResponse>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const sequence = React.useRef(0)
  const active = React.useRef<AbortController | null>(null)
  const endpoint = `/api/jobs/${encodeURIComponent(jobId)}/assembly/evidence`
  React.useEffect(() => {
    const request = ++sequence.current
    const controller = new AbortController()
    active.current = controller
    setReport(undefined); setError(''); setBusy(false)
    fetch(endpoint, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<VerificationResponse> })
      .then(value => { if (!controller.signal.aborted && request === sequence.current) setReport(value) })
      .catch(() => { if (!controller.signal.aborted && request === sequence.current) setError('Assembly verification is unavailable.') })
    return () => controller.abort()
  }, [endpoint, sourceSha256, specSha256, revision])

  const check = async () => {
    const controller = active.current
    if (!canCheck || busy || !controller || controller.signal.aborted) return
    const request = ++sequence.current
    setBusy(true); setError(''); setReport(undefined)
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceSha256, specSha256 }) })
      if (!response.ok) throw new Error(response.status === 409 ? 'The job changed. Refresh before checking again.' : 'Assembly verification is unavailable.')
      const value = await response.json() as VerificationResponse
      if (!controller.signal.aborted && request === sequence.current) setReport(value)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Assembly verification is unavailable.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  const download = async () => {
    const controller = active.current
    if (!report?.verification.id || !controller || controller.signal.aborted) return
    try {
      const query = new URLSearchParams({ reportId: report.verification.id })
      const response = await fetch(`${endpoint}?${query}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = 'assembly-verification.json'
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { if (!controller.signal.aborted) setError('Assembly verification is unavailable.') }
  }

  return <section aria-label={t('Assembly verification')} className="border-t border-[color:var(--shell-hairline)] py-3 text-xs">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!canCheck || busy} onClick={() => void check()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1 disabled:opacity-50">{t(busy ? 'Checking assembly…' : 'Check assembly')}</button>
      {report?.verification.id && <button type="button" onClick={() => void download()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{t('Download verification report')}</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-[var(--shell-fail)]">{t(error)}</p>}
    {report?.verification.status === 'STALE' && <p role="status" className="mt-2">{t('Verification is out of date. Check the current version again.')}</p>}
    {report?.verification.status === 'UNAVAILABLE' && <p role="alert">{t('The saved verification report is unavailable.')}</p>}
    {report?.verification.executionStatus === 'ERROR' && <p role="alert">{t('Assembly verification could not complete.')}{' '}{report.verification.executionMessage}</p>}
    {report?.verification.completedAt && <p className="mt-2">{t('Last checked')}{' '}{new Date(report.verification.completedAt).toLocaleString()}</p>}
    <ul aria-label={t('Assembly evidence')} className="mt-2 space-y-1">
      {ASSEMBLY_EVIDENCE_LAYERS.map(layer => {
        const status = currentEvidenceStatus(report, layer)
        const word = status === 'PASS' ? 'Pass' : status === 'FAIL' ? 'Fail' : status === 'ERROR' ? 'Unavailable' : status === 'SKIP' ? 'Not applicable' : 'Not checked'
        const reason = report?.verification.status === 'CURRENT' ? report.evidence[layer]?.reason : undefined
        return <li key={layer}>{reason ? <details>
          <summary className="cursor-pointer">{t(labels[layer])}: {t(word)}</summary>
          <p className="mt-1 text-[var(--shell-text-label)]">{reason}</p>
        </details> : <span>{t(labels[layer])}: {t(word)}</span>}</li>
      })}
    </ul>
    {report?.verification.id && <p className="mt-2 text-[var(--shell-text-label)]">{t('This report retains measurements and input versions. Original meshes are not retained in the report.')}</p>}
  </section>
}
